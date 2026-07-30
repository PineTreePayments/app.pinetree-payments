/**
 * Generic, provider-agnostic PineTree wallet engine.
 *
 * This is the ONLY layer app/api/wallets/* routes are allowed to call.
 * Every function here resolves the merchant's configured provider via
 * engine/wallet/walletProviderResolution.ts, dispatches to that provider's
 * registered WalletProviderAdapter, and returns a normalized
 * engine/wallet/walletTypes.ts model - callers never see a provider name,
 * provider account id, or provider-shaped payload.
 */

import { resolveMerchantWalletProvider, tryResolveMerchantWalletProvider } from "./walletProviderResolution"
import { WalletApiRouteError, type WalletApiErrorCode } from "./walletErrors"
import {
  getWalletAssetDecimals,
  isSupportedWalletAsset,
  parseWalletAmountToBaseUnits,
  type WalletAsset,
} from "./walletMoney"
import type {
  PineTreeWalletActivityPage,
  PineTreeWalletBalance,
  PineTreeWalletBalancesResult,
  PineTreeWalletCapabilitiesResult,
  PineTreeWalletOperation,
  PineTreeWalletSwapQuote,
  PineTreeWalletWriteResult,
} from "./walletTypes"
import type { WalletAdapterOperationResult, WalletAdapterWriteInput } from "./walletProviderAdapter"
import {
  createWalletOperation,
  getWalletOperationByIdempotencyKey,
  getWalletOperationForMerchant,
  listWalletOperations,
  upsertWalletOperationFromProviderActivity,
  updateWalletOperation,
  sumPendingWithdrawalOperationBaseUnits,
  type MerchantWalletOperation,
  type WalletOperationStatus,
  type WalletOperationType,
} from "@/database/merchantWalletOperations"
import { listWalletBalanceSnapshots, upsertWalletBalanceSnapshot } from "@/database/merchantWalletBalanceSnapshots"
import { classifyBitcoinWithdrawalDestination } from "@/providers/wallets/bitcoinWithdrawalDestination"
import { speedAmountFitsAvailable } from "@/engine/withdrawals/speedWithdrawalQuote"
import {
  evaluateWithdrawalPreflight,
  WithdrawalPreflightError,
  unavailableWithdrawalPreflight,
  type WithdrawalPreflightResult,
} from "@/engine/withdrawals/withdrawalPreflightResult"
import { isAbandonedCreatedWalletOperation } from "@/engine/withdrawals/canonicalWithdrawalStatus"

export const STALE_BALANCE_THRESHOLD_MS = 15 * 60 * 1000

function canonicalWalletBalanceIdentity(asset: string, network: string | null | undefined) {
  const normalizedAsset = String(asset || "").trim().toLowerCase()
  const normalizedNetwork = String(network || "").trim().toLowerCase()
  if (["btc", "sats", "bitcoin", "bitcoin_lightning"].includes(normalizedAsset) || normalizedNetwork === "bitcoin_lightning") {
    return { asset: "BTC", network: "bitcoin_lightning" }
  }
  return { asset: String(asset || "").trim().toUpperCase(), network: network || null }
}

function toPineTreeWalletOperation(row: MerchantWalletOperation): PineTreeWalletOperation {
  const status = isAbandonedCreatedWalletOperation({
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    providerReference: row.provider_reference,
    providerTransactionId: row.provider_transaction_id,
    submittedAt: row.submitted_at,
  })
    ? "INCOMPLETE"
    : row.status === "REQUIRES_ACTION"
      ? "ACTION_REQUIRED"
      : row.status

  return {
    id: row.id,
    provider: row.provider,
    operationType: row.operation_type,
    direction: row.direction,
    status,
    asset: row.asset,
    network: row.network || null,
    amountBaseUnits: row.amount_base_units,
    feeBaseUnits: row.fee_base_units,
    destinationSummary: row.destination_summary,
    destinationAddress: row.destination_address || null,
    destinationLabel:
      row.destination_label
      || (typeof row.destination_snapshot?.label === "string" ? row.destination_snapshot.label : null)
      || null,
    txHash: row.tx_hash,
    explorerUrl: row.explorer_url,
    // Deliberately omits provider_reference/provider_status/raw_provider_status -
    // those are internal reconciliation fields, never returned to the browser.
    failureReason: row.failure_reason,
    createdAt: row.provider_created_at || row.created_at,
    submittedAt: row.submitted_at || null,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  }
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export async function getWalletCapabilities(merchantId: string): Promise<PineTreeWalletCapabilitiesResult> {
  const resolution = await tryResolveMerchantWalletProvider(merchantId)
  if (!resolution) {
    return {
      provider: null,
      providerDisplayName: null,
      configured: false,
      ready: false,
      capabilities: {
        balances: false,
        activity: false,
        withdrawals: false,
        payouts: false,
        swaps: false,
        automaticPayouts: false,
        automaticConversion: false,
      },
    }
  }

  const { adapter, context } = resolution
  const adapterCapabilities = await adapter.getCapabilities(context)
  return {
    provider: adapter.provider,
    providerDisplayName: adapter.providerDisplayName,
    configured: true,
    ready: true,
    capabilities: {
      ...adapterCapabilities,
      // Activity is PineTree's own operation ledger - always readable once a
      // provider is connected, independent of any provider capability.
      activity: true,
    },
  }
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

export async function getWalletBalances(merchantId: string): Promise<PineTreeWalletBalancesResult> {
  const { provider, adapter, context } = await resolveMerchantWalletProvider(merchantId)
  const capabilities = await adapter.getCapabilities(context)
  let liveSyncSucceeded = false
  let providerUnavailable = false
  const liveBalanceKeys = new Set<string>()

  if (capabilities.balances && adapter.getBalances) {
    try {
      const live = await adapter.getBalances(context)
      const now = new Date().toISOString()
      for (const entry of live) liveBalanceKeys.add(`${entry.asset}:${entry.network ?? ""}`)
      await Promise.all(
        live.map((entry) =>
          upsertWalletBalanceSnapshot({
            merchantId,
            provider,
            providerAccountId: context.providerAccountId,
            asset: entry.asset,
            network: entry.network ?? undefined,
            availableBaseUnits: entry.availableBaseUnits,
            pendingBaseUnits: entry.pendingBaseUnits,
            totalBaseUnits: entry.totalBaseUnits,
            providerUpdatedAt: entry.providerUpdatedAt ?? now,
          })
        )
      )
      liveSyncSucceeded = true
    } catch (error) {
      // A provider read must never destroy or hide a previously confirmed
      // balance. The adapter has already normalized/logged the provider error;
      // return the last successful snapshot and let the UI identify it as
      // cached instead of rendering a provider failure as zero.
      providerUnavailable = true
      console.warn("[wallet-balances] live provider sync unavailable", {
        merchantId,
        provider,
        code: error instanceof WalletApiRouteError ? error.code : "WALLET_PROVIDER_UNAVAILABLE"
      })
      if (error instanceof WalletApiRouteError && error.code === "WALLET_CAPABILITY_UNAVAILABLE") {
        // Capability state may have changed between the capability check and
        // the provider call. Treat it as unavailable, just like a transient
        // provider failure, while preserving the snapshot.
      }
    }
  }

  const allCached = await listWalletBalanceSnapshots(merchantId, provider, context.providerAccountId)
  const cached = liveSyncSucceeded
    ? allCached.filter((row) => liveBalanceKeys.has(`${row.asset}:${row.network || ""}`))
    : allCached
  const now = Date.now()
  const normalizedBalances: PineTreeWalletBalance[] = cached.map((row) => {
    const cachedAtMs = new Date(row.cached_at).getTime()
    const identity = canonicalWalletBalanceIdentity(row.asset, row.network)
    return {
      asset: identity.asset,
      availableBaseUnits: row.available_base_units,
      pendingBaseUnits: row.pending_base_units,
      totalBaseUnits: row.total_base_units,
      decimals: getWalletAssetDecimals(identity.asset),
      network: identity.network,
      providerUpdatedAt: row.provider_updated_at,
      cachedAt: row.cached_at,
      stale: !Number.isFinite(cachedAtMs) || now - cachedAtMs > STALE_BALANCE_THRESHOLD_MS,
    }
  })
  const balances = Array.from(new Map(
    normalizedBalances.map((balance) => [`${balance.asset}:${balance.network || ""}`, balance])
  ).values())
  if (provider === "speed" && !balances.some((balance) => balance.asset === "BTC" && balance.network === "bitcoin_lightning")) {
    balances.push({
      asset: "BTC",
      availableBaseUnits: "0",
      pendingBaseUnits: null,
      totalBaseUnits: null,
      decimals: 8,
      network: "bitcoin_lightning",
      providerUpdatedAt: null,
      cachedAt: null,
      stale: false,
    })
  }

  const lastSuccessfulSyncAt = balances.reduce<string | null>((latest, balance) => {
    const candidate = balance.providerUpdatedAt || balance.cachedAt
    if (!candidate) return latest
    return !latest || candidate > latest ? candidate : latest
  }, null)

  return {
    capabilityAvailable: capabilities.balances,
    unavailableReason: !capabilities.balances
      ? "WALLET_CAPABILITY_UNAVAILABLE"
      : providerUnavailable
        ? "WALLET_PROVIDER_UNAVAILABLE"
        : null,
    syncStatus: liveSyncSucceeded ? "live" : normalizedBalances.length > 0 ? "cached" : "unavailable",
    lastSuccessfulSyncAt,
    balances,
  }
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export type ListActivityInput = {
  type?: WalletOperationType
  status?: WalletOperationStatus
  cursor?: string | null
  limit?: number
}

export async function getWalletActivity(
  merchantId: string,
  input: ListActivityInput
): Promise<PineTreeWalletActivityPage> {
  const resolution = await resolveMerchantWalletProvider(merchantId)

  if (resolution.adapter.listActivity) {
    try {
      let providerCursor: string | null = null
      const seenTransactions = new Set<string>()
      for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
        let pageHasNewTransactions = false
        const page = await resolution.adapter.listActivity(resolution.context, {
          cursor: providerCursor,
          limit: 100,
        })
        for (const item of page.activity) {
          if (seenTransactions.has(item.providerTransactionId)) continue
          seenTransactions.add(item.providerTransactionId)
          const sync = await upsertWalletOperationFromProviderActivity({
            merchantId,
            provider: resolution.provider,
            providerAccountId: resolution.context.providerAccountId,
            ...item,
          })
          if (!sync.transactionWasKnown) pageHasNewTransactions = true
        }
        if (!page.nextCursor || page.nextCursor === providerCursor || !pageHasNewTransactions) break
        providerCursor = page.nextCursor
      }
    } catch (error) {
      console.warn("[wallet-activity] provider synchronization unavailable", {
        merchantId,
        provider: resolution.provider,
        code: error instanceof WalletApiRouteError ? error.code : "WALLET_PROVIDER_UNAVAILABLE",
      })
    }
  }

  const page = await listWalletOperations({
    merchantId,
    providerAccountId: resolution.context.providerAccountId,
    type: input.type,
    status: input.status,
    cursor: input.cursor,
    limit: input.limit,
  })

  return {
    operations: page.operations.map(toPineTreeWalletOperation),
    nextCursor: page.nextCursor,
  }
}

export async function getWalletOperation(merchantId: string, operationId: string): Promise<PineTreeWalletOperation> {
  const resolution = await resolveMerchantWalletProvider(merchantId)
  const operation = await getWalletOperationForMerchant(merchantId, operationId)
  if (!operation) {
    throw new WalletApiRouteError("WALLET_OPERATION_NOT_FOUND", "Wallet operation not found.")
  }
  const operationAccountId = operation.provider_account_id
    || String(operation.raw_provider_status?.providerAccountId || "")
  if (operationAccountId && operationAccountId !== resolution.context.providerAccountId) {
    throw new WalletApiRouteError("WALLET_OPERATION_NOT_FOUND", "Wallet operation not found.")
  }
  return toPineTreeWalletOperation(operation)
}

// ---------------------------------------------------------------------------
// Withdrawals / Payouts
// ---------------------------------------------------------------------------

export type CreateWalletWithdrawalOrPayoutInput = {
  asset: string
  amountDecimal: string
  destination: string
  destinationLabel?: string | null
  note?: string
  idempotencyKey: string
  correlationId?: string | null
  diagnostics?: {
    setSubstage?: (substage: string) => void
    setProviderAccountId?: (providerAccountId: string | null | undefined) => void
  }
}

function validateWriteInput(input: CreateWalletWithdrawalOrPayoutInput): {
  asset: WalletAsset
  amountBaseUnits: bigint
  destination: string
} {
  const idempotencyKey = String(input.idempotencyKey || "").trim()
  if (!idempotencyKey) {
    throw new WalletApiRouteError("IDEMPOTENCY_KEY_REQUIRED", "An Idempotency-Key header is required for this request.")
  }

  const asset = String(input.asset || "").trim().toUpperCase()
  if (!isSupportedWalletAsset(asset)) {
    throw new WalletApiRouteError("WALLET_VALIDATION_ERROR", `Unsupported asset: ${input.asset}`)
  }

  const destination = String(input.destination || "").trim()
  if (!destination) {
    throw new WalletApiRouteError("WALLET_VALIDATION_ERROR", "A destination is required.")
  }

  const amountBaseUnits = parseWalletAmountToBaseUnits(input.amountDecimal, asset)
  if (amountBaseUnits === null) {
    throw new WalletApiRouteError("WALLET_VALIDATION_ERROR", "Enter a valid amount greater than zero.")
  }

  return { asset, amountBaseUnits, destination }
}

export function maskDestination(destination: string): string {
  const trimmed = destination.trim()
  if (trimmed.length <= 10) return trimmed
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`
}

async function reconcileOperationWithAdapterResult(
  merchantId: string,
  operationId: string,
  providerAccountId: string,
  result: WalletAdapterOperationResult
): Promise<MerchantWalletOperation> {
  const now = new Date().toISOString()
  const submittedAt = result.providerCreatedAt ?? now
  return updateWalletOperation(merchantId, operationId, {
    providerAccountId,
    status: result.status,
    providerReference: result.providerReference,
    providerTransactionId: result.providerTransactionId ?? null,
    providerStatus: result.providerStatus,
    providerSecondaryReference: result.providerSecondaryReference,
    providerCreatedAt: result.providerCreatedAt ?? null,
    rawProviderStatus: result.rawProviderStatus,
    txHash: result.txHash ?? undefined,
    explorerUrl: result.explorerUrl ?? undefined,
    feeBaseUnits: result.feeBaseUnits ?? undefined,
    failureCode: result.status === "FAILED" || result.status === "EXPIRED" ? undefined : null,
    failureReason: result.status === "FAILED" || result.status === "EXPIRED" ? undefined : null,
    submittedAt,
    completedAt: result.status === "COMPLETED" ? now : undefined,
    confirmedAt: result.status === "COMPLETED" ? now : undefined,
    failedAt: result.status === "FAILED" || result.status === "EXPIRED" ? now : null,
    dispatchCompletedAt: now,
    providerResponseReceived: true,
    providerAcceptanceKnown: result.status !== "FAILED" && result.status !== "EXPIRED",
    providerAcceptanceUnknown: false,
    persistenceAfterAcceptanceFailed: false,
  })
}

function hasProviderReconciliationIdentifier(result: WalletAdapterOperationResult): boolean {
  return Boolean(
    String(result.providerReference || "").trim()
    || String(result.providerTransactionId || "").trim()
    || String(result.txHash || "").trim()
  )
}

function operationProviderAccountId(operation: MerchantWalletOperation): string {
  return operation.provider_account_id
    || String(operation.raw_provider_status?.providerAccountId || "")
}

function operationProviderLookupReference(operation: MerchantWalletOperation): string {
  return String(operation.provider_reference || operation.provider_transaction_id || operation.tx_hash || "").trim()
}

function operationHasProviderEvidence(operation: MerchantWalletOperation): boolean {
  return Boolean(
    operationProviderLookupReference(operation)
    || operation.provider_request_attempted
    || operation.dispatch_started_at
    || operation.submitted_at
    || operation.provider_response_received
  )
}

function canSafelyRetryExistingOperation(operation: MerchantWalletOperation): boolean {
  if (operation.operation_type !== "WITHDRAWAL") return false
  if (operationHasProviderEvidence(operation)) return false
  return operation.status === "CREATED" || operation.status === "FAILED"
}

function networkForWriteInput(input: WalletAdapterWriteInput): string | undefined {
  if (input.asset !== "SATS") return undefined
  const classified = classifyBitcoinWithdrawalDestination(input.destination)
  if (!classified.valid) return "bitcoin"
  return classified.method === "onchain" ? "bitcoin_onchain" : "bitcoin_lightning"
}

async function reconcileExistingSubmittedOperation(input: {
  merchantId: string
  operation: MerchantWalletOperation
  resolution: Awaited<ReturnType<typeof resolveMerchantWalletProvider>>
  operationType: "WITHDRAWAL" | "PAYOUT" | "SWAP_OUT"
}): Promise<MerchantWalletOperation> {
  const reference = operationProviderLookupReference(input.operation)
  if (!reference) return input.operation
  const statusCall =
    input.operationType === "WITHDRAWAL"
      ? input.resolution.adapter.getWithdrawalStatus
      : input.operationType === "PAYOUT"
        ? input.resolution.adapter.getPayoutStatus
        : input.resolution.adapter.getSwapStatus
  if (!statusCall) return input.operation
  try {
    const result = await statusCall(input.resolution.context, reference)
    return await reconcileOperationWithAdapterResult(
      input.merchantId,
      input.operation.id,
      input.resolution.context.providerAccountId,
      result
    )
  } catch (error) {
    console.warn("[wallet-operations] duplicate withdrawal reconciliation skipped", {
      merchantId: input.merchantId,
      operationId: input.operation.id,
      provider: input.resolution.provider,
      operationType: input.operationType,
      error: error instanceof Error ? error.message : String(error),
    })
    return input.operation
  }
}

async function failOperationAsCapabilityUnavailable(
  merchantId: string,
  operationId: string,
  reason: string
): Promise<MerchantWalletOperation> {
  return updateWalletOperation(merchantId, operationId, {
    status: "FAILED",
    failureCode: "WALLET_CAPABILITY_UNAVAILABLE",
    failureReason: reason,
    failedAt: new Date().toISOString(),
  })
}

function walletErrorFromUnknown(error: unknown): {
  code: WalletApiErrorCode
  reason: string
  retryable: boolean
  statusUnknown: boolean
} {
  if (error instanceof WalletApiRouteError) {
    return {
      code: error.code,
      reason: error.message,
      retryable: error.retryable,
      statusUnknown: error.code === "STATUS_UNKNOWN" || error.code === "WALLET_PROVIDER_TIMEOUT",
    }
  }
  const structuralCode = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : ""
  const code = structuralCode ? structuralCode as WalletApiErrorCode : "INTERNAL_ERROR"
  return {
    code,
    reason: error instanceof Error ? error.message : "Wallet withdrawal failed.",
    retryable: Boolean(error && typeof error === "object" && (error as { retryable?: unknown }).retryable),
    statusUnknown: code === "STATUS_UNKNOWN" || code === "WALLET_PROVIDER_TIMEOUT",
  }
}

function safeFailureReason(value: string): string {
  return String(value || "Wallet withdrawal failed.")
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/[A-Za-z0-9+/=]{120,}/g, "[redacted-payload]")
    .slice(0, 240)
}

const OUTCOME_UNKNOWN_WITHDRAWAL_MESSAGE =
  "PineTree received a provider response, but the withdrawal outcome is still being verified. Do not retry this withdrawal until manual review is complete."

function hasConcreteProviderRejectionEvidence(evidence?: Record<string, unknown>): boolean {
  if (!evidence || evidence.providerRejectionEvidence !== true) return false
  return Boolean(
    evidence.httpStatus ||
    evidence.normalizedErrorCode ||
    evidence.providerErrorCategory ||
    evidence.providerErrorCode ||
    evidence.responseBodySummary
  )
}

async function markOperationRequiresActionAfterDispatch(input: {
  merchantId: string
  operationId: string
  providerAccountId: string
  providerRequestKey?: string | null
  failureReason?: string | null
  stage: string
  responseReceived: boolean
  responseMissing?: boolean
  evidence?: Record<string, unknown>
}): Promise<void> {
  await updateWalletOperation(input.merchantId, input.operationId, {
    status: "REQUIRES_ACTION",
    failureCode: "STATUS_UNKNOWN",
    failureReason: safeFailureReason(input.failureReason || OUTCOME_UNKNOWN_WITHDRAWAL_MESSAGE),
    failedAt: null,
    providerResponseReceived: input.responseReceived,
    providerAcceptanceKnown: false,
    providerAcceptanceUnknown: true,
    rawProviderStatus: {
      providerAccountId: input.providerAccountId,
      ...(input.providerRequestKey ? { providerRequestKey: input.providerRequestKey } : {}),
      failureCode: "STATUS_UNKNOWN",
      failureStage: input.stage,
      responseReceived: input.responseReceived,
      responseMissing: Boolean(input.responseMissing),
      explicitProviderRejection: false,
      recoveryRequired: true,
      classificationReason: input.evidence?.classificationReason || input.stage,
      ...(input.evidence || {}),
    },
  }).catch((updateError) => {
    console.error("[wallet-operations] failed to mark post-dispatch withdrawal for recovery", {
      merchantId: input.merchantId,
      operationId: input.operationId,
      updateError: updateError instanceof Error ? updateError.message : String(updateError),
    })
  })
}

async function markOperationFailedBeforeProviderAcceptance(input: {
  merchantId: string
  operationId: string
  providerAccountId: string
  error: unknown
  stage: string
}): Promise<void> {
  const failure = walletErrorFromUnknown(input.error)
  if (failure.statusUnknown) {
    await updateWalletOperation(input.merchantId, input.operationId, {
      status: "REQUIRES_ACTION",
      failureCode: failure.code,
      failureReason: safeFailureReason(failure.reason || OUTCOME_UNKNOWN_WITHDRAWAL_MESSAGE),
      failedAt: null,
      providerAcceptanceUnknown: true,
      rawProviderStatus: {
        providerAccountId: input.providerAccountId,
        failureCode: failure.code,
        failureStage: input.stage,
        recoveryRequired: true,
        explicitProviderRejection: false,
        responseMissing: input.stage === "provider_submission_timeout" || input.stage === "provider_submission_status_unknown",
        staleCreatedAmbiguous: input.stage === "stale_created_ambiguous",
      },
    }).catch((updateError) => {
      console.error("[wallet-operations] failed to mark ambiguous withdrawal for recovery", {
        merchantId: input.merchantId,
        operationId: input.operationId,
        failureCode: failure.code,
        updateError: updateError instanceof Error ? updateError.message : String(updateError),
      })
    })
    return
  }

  await updateWalletOperation(input.merchantId, input.operationId, {
    status: "FAILED",
    failureCode: failure.code,
    failureReason: safeFailureReason(failure.reason),
    providerRequestAttempted: false,
    providerAcceptanceKnown: false,
    providerAcceptanceUnknown: false,
    rawProviderStatus: {
      providerAccountId: input.providerAccountId,
      failureCode: failure.code,
      failureStage: input.stage,
      retryable: failure.retryable,
      dispatchNotStarted: true,
      staleCreatedProvenPreDispatchFailure: input.stage === "stale_created_proven_pre_dispatch_failure",
    },
    failedAt: new Date().toISOString(),
  }).catch((updateError) => {
    console.error("[wallet-operations] failed to mark withdrawal failed", {
      merchantId: input.merchantId,
      operationId: input.operationId,
      failureCode: failure.code,
      updateError: updateError instanceof Error ? updateError.message : String(updateError),
    })
  })
}

async function createWalletWrite(
  merchantId: string,
  operationType: "WITHDRAWAL" | "PAYOUT" | "SWAP_OUT",
  input: WalletAdapterWriteInput,
  destinationSummary: string,
  destinationAddress: string | null,
  destinationLabel: string | null | undefined,
  adapterCall: (
    resolution: Awaited<ReturnType<typeof resolveMerchantWalletProvider>>
  ) => Promise<WalletAdapterOperationResult> | undefined,
  validateBeforeSubmission?: (resolution: Awaited<ReturnType<typeof resolveMerchantWalletProvider>>) => void
): Promise<PineTreeWalletWriteResult> {
  input.diagnostics?.setSubstage?.("provider_resolution")
  const resolution = await resolveMerchantWalletProvider(merchantId)
  input.diagnostics?.setProviderAccountId?.(resolution.context.providerAccountId)
  input.diagnostics?.setSubstage?.("context_resolution")

  input.diagnostics?.setSubstage?.("operation_persistence")
  const { operation, created } = await createWalletOperation({
    merchantId,
    provider: resolution.provider,
    providerAccountId: resolution.context.providerAccountId,
    operationType,
    direction: "debit",
    status: "CREATED",
    asset: input.asset,
    network: networkForWriteInput(input),
    amountBaseUnits: input.amountBaseUnits,
    destinationSummary,
    destinationAddress: operationType === "WITHDRAWAL" ? destinationAddress : null,
    destinationLabel: operationType === "WITHDRAWAL" ? destinationLabel?.trim() || null : null,
    idempotencyKey: input.idempotencyKey,
  })

  if (!created) {
    const existingProviderAccountId = operationProviderAccountId(operation)
    if (
      operation.asset !== input.asset ||
      operation.amount_base_units !== input.amountBaseUnits.toString() ||
      operation.destination_summary !== destinationSummary ||
      (operationType === "WITHDRAWAL" && operation.destination_address && operation.destination_address !== destinationAddress) ||
      (existingProviderAccountId && existingProviderAccountId !== resolution.context.providerAccountId)
    ) {
      throw new WalletApiRouteError(
        "IDEMPOTENCY_KEY_CONFLICT",
        "This Idempotency-Key was already used for a different wallet operation."
      )
    }
    if (canSafelyRetryExistingOperation(operation)) {
      console.info("[pinetree-withdrawals] DUPLICATE_SAFE_RETRY", {
        merchantId,
        provider: resolution.provider,
        operationId: operation.id,
        status: operation.status,
        idempotencyKey: input.idempotencyKey,
      })
    } else {
      const capabilities = await resolution.adapter.getCapabilities(resolution.context)
      const capabilityAvailable =
        operationType === "WITHDRAWAL"
          ? capabilities.withdrawals
          : operationType === "PAYOUT"
            ? capabilities.payouts
            : capabilities.swaps
      if (operationType === "WITHDRAWAL") {
        console.info("[pinetree-withdrawals] DUPLICATE_RESTORED", {
          merchantId,
          provider: resolution.provider,
          operationId: operation.id,
          status: operation.status,
          idempotencyKey: input.idempotencyKey,
          providerReferencePresent: Boolean(operation.provider_reference || operation.provider_transaction_id || operation.tx_hash),
        })
      }
      const reconciled = await reconcileExistingSubmittedOperation({
        merchantId,
        operation,
        resolution,
        operationType,
      })
      const normalized = toPineTreeWalletOperation(reconciled)
      return {
        operation: normalized,
        capabilityAvailable,
        reusedExisting: true,
        canonicalStatus: normalized.status,
      }
    }
  }

  try {
    validateBeforeSubmission?.(resolution)
  } catch (error) {
    await markOperationFailedBeforeProviderAcceptance({
      merchantId,
      operationId: operation.id,
      providerAccountId: resolution.context.providerAccountId,
      error,
      stage: "provider_account_validation",
    })
    throw error
  }

  let capabilities: Awaited<ReturnType<typeof resolution.adapter.getCapabilities>>
  try {
    capabilities = await resolution.adapter.getCapabilities(resolution.context)
  } catch (error) {
    await markOperationFailedBeforeProviderAcceptance({
      merchantId,
      operationId: operation.id,
      providerAccountId: resolution.context.providerAccountId,
      error,
      stage: "capability_check",
    })
    throw error
  }
  const capabilityAvailable =
    operationType === "WITHDRAWAL"
      ? capabilities.withdrawals
      : operationType === "PAYOUT"
        ? capabilities.payouts
        : capabilities.swaps

  if (!capabilityAvailable) {
    const failed = await failOperationAsCapabilityUnavailable(
      merchantId,
      operation.id,
      `${resolution.adapter.providerDisplayName} does not currently support this operation for connected accounts.`
    )
    return { operation: toPineTreeWalletOperation(failed), capabilityAvailable: false }
  }

  if (operationType === "WITHDRAWAL" && resolution.adapter.requiresFreshBalanceForWithdrawal) {
    if (!resolution.adapter.getBalances || !capabilities.balances) {
      const failed = await updateWalletOperation(merchantId, operation.id, {
        status: "FAILED",
        failureCode: "WALLET_CAPABILITY_UNAVAILABLE",
        failureReason: "A current available balance is required before withdrawal.",
        failedAt: new Date().toISOString(),
      })
      return { operation: toPineTreeWalletOperation(failed), capabilityAvailable: false }
    }
    let balances
    try {
      input.diagnostics?.setSubstage?.("balance_retrieval")
      balances = await resolution.adapter.getBalances(resolution.context)
      console.info("[pinetree-withdrawals] SPEED_BALANCE_CONFIRMED", {
        correlationId: input.correlationId || null,
        merchantId,
        providerAccountSuffix: resolution.context.providerAccountId.slice(-6),
        routeStage: "balance_confirmed",
      })
      console.info("[pinetree-withdrawals] SPEED_BALANCE_RESOLVED", {
        correlationId: input.correlationId || null,
        merchantId,
        providerAccountSuffix: resolution.context.providerAccountId.slice(-6),
        routeStage: "speed_balance_resolved",
      })
    } catch (error) {
      await updateWalletOperation(merchantId, operation.id, {
        status: "FAILED",
        failureCode: "WALLET_PROVIDER_UNAVAILABLE",
        failureReason: "The current available balance could not be verified.",
        failedAt: new Date().toISOString(),
        rawProviderStatus: {
          providerAccountId: resolution.context.providerAccountId,
          failureCode: "WALLET_PROVIDER_UNAVAILABLE",
          failureStage: "balance_retrieval",
        },
      })
      throw error
    }
    input.diagnostics?.setSubstage?.("balance_validation")
    const requestedBalanceAsset = input.asset === "SATS" ? "BTC" : input.asset
    const available = balances.find((balance) =>
      canonicalWalletBalanceIdentity(balance.asset, balance.network).asset === requestedBalanceAsset
    )?.availableBaseUnits
    const speedQuote = resolution.provider === "speed" && input.asset === "SATS" && available != null
      ? await (async () => {
          const classified = classifyBitcoinWithdrawalDestination(input.destination)
          const method = classified.valid && classified.method === "onchain" ? "onchain" : "lightning"
          const pendingSats = await sumPendingWithdrawalOperationBaseUnits(merchantId, "SATS", operation.id)
          return speedAmountFitsAvailable({
            amountSats: input.amountBaseUnits,
            providerAvailableSats: available,
            pendingSats,
            method,
          })
        })()
      : null
    if (speedQuote) {
      console.info("[pinetree-withdrawals] SPEED_WITHDRAWAL_QUOTE_RESOLVED", {
        correlationId: input.correlationId || null,
        merchantId,
        providerAccountSuffix: resolution.context.providerAccountId.slice(-6),
        totalAvailableSats: speedQuote.totalAvailableSats.toString(),
        estimatedFeeSats: speedQuote.estimatedFeeSats.toString(),
        maximumSendableSats: speedQuote.maximumSendableSats.toString(),
        routeStage: "speed_withdrawal_quote_resolved",
      })
    }
    const balanceFits = speedQuote
      ? speedQuote.fits
      : available != null && available >= input.amountBaseUnits
    if (!balanceFits) {
      await updateWalletOperation(merchantId, operation.id, {
        status: "FAILED",
        failureCode: "INSUFFICIENT_BALANCE",
        failureReason: speedQuote
          ? "The available balance is insufficient for this withdrawal and estimated provider/network fee."
          : "The available balance is insufficient for this withdrawal.",
        failedAt: new Date().toISOString(),
        rawProviderStatus: {
          providerAccountId: resolution.context.providerAccountId,
          failureCode: "INSUFFICIENT_BALANCE",
          failureStage: "balance_validation",
          ...(speedQuote ? {
            totalAvailableSats: speedQuote.totalAvailableSats.toString(),
            estimatedFeeSats: speedQuote.estimatedFeeSats.toString(),
            maximumSendableSats: speedQuote.maximumSendableSats.toString(),
          } : {}),
        },
      })
      throw new WalletApiRouteError(
        "INSUFFICIENT_BALANCE",
        speedQuote
          ? "The available balance is insufficient for this withdrawal and estimated provider/network fee."
          : "The available balance is insufficient for this withdrawal."
      )
    }
    console.info("[pinetree-withdrawals] SPEED_PRE_SUBMIT_VALIDATED", {
      correlationId: input.correlationId || null,
      merchantId,
      providerAccountSuffix: resolution.context.providerAccountId.slice(-6),
      amountSats: input.amountBaseUnits.toString(),
      estimatedFeeSats: speedQuote?.estimatedFeeSats.toString() ?? null,
      routeStage: "speed_pre_submit_validated",
    })
    console.info("[pinetree-withdrawals] SPEED_AMOUNT_VALIDATED", {
      correlationId: input.correlationId || null,
      merchantId,
      providerAccountSuffix: resolution.context.providerAccountId.slice(-6),
      amountSats: input.amountBaseUnits.toString(),
      routeStage: "amount_validated",
    })
  }

  input.diagnostics?.setSubstage?.("send_request")
  let call: Promise<WalletAdapterOperationResult> | undefined
  const providerRequestKey = `${resolution.provider}:${resolution.context.providerAccountId}:${operationType.toLowerCase()}:${input.idempotencyKey}`
  let dispatchStarted = false
  let providerResponseReceived = false
  let providerResponseMissing = false
  let providerRejected = false
  let lastProviderResponseEvidence: Record<string, unknown> | null = null
  const upstreamDiagnostics = input.diagnostics
  input.diagnostics = {
    ...upstreamDiagnostics,
    async markDispatchStarted() {
      if (dispatchStarted) return
      dispatchStarted = true
      const dispatchStartedAt = new Date().toISOString()
      await updateWalletOperation(merchantId, operation.id, {
        dispatchStartedAt,
        providerRequestKey,
        providerRequestAttempted: true,
        providerResponseReceived: false,
        providerAcceptanceKnown: false,
        providerAcceptanceUnknown: true,
        rawProviderStatus: {
          providerAccountId: resolution.context.providerAccountId,
          providerRequestKey,
          dispatchStarted: true,
          dispatchStartedAt,
          dispatchStage: "dispatchStarted",
        },
      })
    },
    async markProviderResponseReceived(evidence) {
      providerResponseReceived = true
      const dispatchCompletedAt = new Date().toISOString()
      lastProviderResponseEvidence = {
        providerAccountId: resolution.context.providerAccountId,
        providerRequestKey,
        responseReceived: true,
        dispatchCompletedAt,
        ...(evidence || {}),
      }
      await updateWalletOperation(merchantId, operation.id, {
        dispatchCompletedAt,
        providerResponseReceived: true,
        providerAcceptanceUnknown: true,
        rawProviderStatus: lastProviderResponseEvidence,
      })
    },
    async markProviderResponseMissing(evidence) {
      providerResponseMissing = true
      lastProviderResponseEvidence = {
        providerAccountId: resolution.context.providerAccountId,
        providerRequestKey,
        responseMissing: true,
        failureCode: "STATUS_UNKNOWN",
        failureStage: "provider_response_missing",
        recoveryRequired: true,
        explicitProviderRejection: false,
        ...(evidence || {}),
      }
      await updateWalletOperation(merchantId, operation.id, {
        status: "REQUIRES_ACTION",
        failureCode: "STATUS_UNKNOWN",
        failureReason: "The provider request was dispatched, but PineTree did not receive a definitive response. Do not retry this withdrawal until manual review is complete.",
        failedAt: null,
        providerResponseReceived: false,
        providerAcceptanceKnown: false,
        providerAcceptanceUnknown: true,
        rawProviderStatus: lastProviderResponseEvidence,
      })
    },
    async markProviderRejected(evidence) {
      providerResponseReceived = true
      const dispatchCompletedAt = new Date().toISOString()
      if (!hasConcreteProviderRejectionEvidence(evidence)) {
        lastProviderResponseEvidence = {
          providerAccountId: resolution.context.providerAccountId,
          providerRequestKey,
          responseReceived: true,
          dispatchCompletedAt,
          providerRejectionCallbackWithoutEvidence: true,
          classificationReason: "provider_rejection_callback_without_evidence",
          ...(evidence || {}),
        }
        await markOperationRequiresActionAfterDispatch({
          merchantId,
          operationId: operation.id,
          providerAccountId: resolution.context.providerAccountId,
          providerRequestKey,
          stage: "provider_response_unconfirmed",
          responseReceived: true,
          evidence: lastProviderResponseEvidence,
        })
        return
      }
      providerRejected = true
      lastProviderResponseEvidence = {
        providerAccountId: resolution.context.providerAccountId,
        providerRequestKey,
        responseReceived: true,
        explicitProviderRejection: true,
        providerRejectionEvidence: true,
        dispatchCompletedAt,
        ...(evidence || {}),
      }
      await updateWalletOperation(merchantId, operation.id, {
        dispatchCompletedAt,
        providerResponseReceived: true,
        providerAcceptanceKnown: false,
        providerAcceptanceUnknown: false,
        rawProviderStatus: lastProviderResponseEvidence,
      })
    },
  }
  try {
    call = adapterCall(resolution)
  } catch (error) {
    if (dispatchStarted) {
      await updateWalletOperation(merchantId, operation.id, {
        status: "REQUIRES_ACTION",
        failureCode: "STATUS_UNKNOWN",
        failureReason: safeFailureReason(error instanceof Error ? error.message : "Provider dispatch state is unknown."),
        providerAcceptanceUnknown: true,
        rawProviderStatus: {
          providerAccountId: resolution.context.providerAccountId,
          providerRequestKey,
          failureCode: "STATUS_UNKNOWN",
          failureStage: "provider_adapter_start",
          dispatchStarted: true,
          responseMissing: true,
          recoveryRequired: true,
        },
      })
    } else {
      await markOperationFailedBeforeProviderAcceptance({
        merchantId,
        operationId: operation.id,
        providerAccountId: resolution.context.providerAccountId,
        error,
        stage: "provider_adapter_start",
      })
    }
    throw error
  }
  if (!call) {
    const failed = await failOperationAsCapabilityUnavailable(
      merchantId,
      operation.id,
      `${resolution.adapter.providerDisplayName} does not implement this operation.`
    )
    return { operation: toPineTreeWalletOperation(failed), capabilityAvailable: false }
  }

  let providerAcceptanceReturned = false
  let referenceFreeRecoveryMarked = false
  try {
    const result = await call
    providerAcceptanceReturned = true
    if (result.status === "PROCESSING" && !hasProviderReconciliationIdentifier(result)) {
      console.error("[wallet-operations] provider accepted withdrawal without reconciliation identifier", {
        merchantId,
        provider: resolution.provider,
        operationType,
        operationId: operation.id,
        idempotencyKey: input.idempotencyKey,
        providerAccountId: resolution.context.providerAccountId,
        providerStatus: result.providerStatus ?? null,
        rawProviderStatus: result.rawProviderStatus ?? null,
      })
      await updateWalletOperation(merchantId, operation.id, {
        status: "REQUIRES_ACTION",
        failureCode: "STATUS_UNKNOWN",
        failureReason: "Your wallet provider accepted the request, but did not return a reconciliation reference.",
        dispatchCompletedAt: new Date().toISOString(),
        providerResponseReceived: true,
        providerAcceptanceKnown: false,
        providerAcceptanceUnknown: true,
        rawProviderStatus: {
          ...(result.rawProviderStatus || {}),
          providerAccountId: resolution.context.providerAccountId,
          providerRequestKey,
          failureCode: "STATUS_UNKNOWN",
          failureStage: "provider_response_parse",
          acceptedReferenceMissing: true,
          recoveryRequired: true,
        },
      }).then(() => {
        referenceFreeRecoveryMarked = true
      }).catch((updateError) => {
        console.error("[wallet-operations] failed to mark reference-free accepted withdrawal for recovery", {
          merchantId,
          operationId: operation.id,
          updateError: updateError instanceof Error ? updateError.message : String(updateError),
        })
      })
      throw new WalletApiRouteError(
        "STATUS_UNKNOWN",
        "Your wallet provider accepted the request, but did not return a reconciliation reference.",
        false
      )
    }
    input.diagnostics?.setSubstage?.("operation_persistence")
    let reconciled: MerchantWalletOperation
    try {
      reconciled = await reconcileOperationWithAdapterResult(
        merchantId,
        operation.id,
        resolution.context.providerAccountId,
        result
      )
    } catch (error) {
      console.error("[wallet-operations] provider withdrawal accepted but persistence failed", {
        merchantId,
        provider: resolution.provider,
        operationType,
        operationId: operation.id,
        idempotencyKey: input.idempotencyKey,
        providerAccountId: resolution.context.providerAccountId,
        providerReference: result.providerReference ?? null,
        providerTransactionId: result.providerTransactionId ?? null,
        providerSecondaryReference: result.providerSecondaryReference ?? null,
        providerStatus: result.providerStatus ?? null,
        providerCreatedAt: result.providerCreatedAt ?? null,
        txHash: result.txHash ?? null,
        explorerUrl: result.explorerUrl ?? null,
        rawProviderStatus: result.rawProviderStatus ?? null,
        error: error instanceof Error ? error.message : String(error),
      })
      await updateWalletOperation(merchantId, operation.id, {
        status: "REQUIRES_ACTION",
        failureCode: "STATUS_UNKNOWN",
        failureReason: "The provider accepted the withdrawal, but PineTree could not persist the provider response.",
        providerResponseReceived: true,
        providerAcceptanceKnown: true,
        providerAcceptanceUnknown: true,
        persistenceAfterAcceptanceFailed: true,
        rawProviderStatus: {
          ...(result.rawProviderStatus || {}),
          providerAccountId: resolution.context.providerAccountId,
          providerRequestKey,
          failureCode: "STATUS_UNKNOWN",
          failureStage: "provider_acceptance_persistence",
          persistenceFailedAfterAcceptance: true,
          recoveryRequired: true,
        },
      }).catch((updateError) => {
        console.error("[wallet-operations] failed to persist provider acceptance recovery state", {
          merchantId,
          operationId: operation.id,
          updateError: updateError instanceof Error ? updateError.message : String(updateError),
        })
      })
      throw error
    }
    if (operationType === "WITHDRAWAL" && resolution.provider === "speed") {
      console.info("[pinetree-withdrawals] SPEED_OPERATION_PERSISTED", {
        correlationId: input.correlationId || null,
        merchantId,
        providerAccountSuffix: resolution.context.providerAccountId.slice(-6),
        operationId: operation.id,
        status: reconciled.status,
        routeStage: "operation_persisted",
      })
    }
    return { operation: toPineTreeWalletOperation(reconciled), capabilityAvailable: true }
  } catch (error) {
    if (error instanceof WalletApiRouteError) {
      if (error.code === "STATUS_UNKNOWN") {
        if (!referenceFreeRecoveryMarked) {
          if (dispatchStarted) {
            await markOperationRequiresActionAfterDispatch({
              merchantId,
              operationId: operation.id,
              providerAccountId: resolution.context.providerAccountId,
              providerRequestKey,
              stage: providerResponseReceived ? "provider_response_parse" : "provider_submission_status_unknown",
              responseReceived: providerResponseReceived,
              responseMissing: !providerResponseReceived,
              failureReason: providerResponseReceived ? OUTCOME_UNKNOWN_WITHDRAWAL_MESSAGE : error.message,
              evidence: {
                ...(lastProviderResponseEvidence || {}),
                providerErrorCode: error.code,
                providerErrorMessage: safeFailureReason(error.message),
                classificationReason: providerResponseReceived
                  ? "status_unknown_after_provider_response"
                  : "status_unknown_after_dispatch_without_response",
              },
            })
          } else {
            await markOperationFailedBeforeProviderAcceptance({
              merchantId,
              operationId: operation.id,
              providerAccountId: resolution.context.providerAccountId,
              error,
              stage: "provider_submission_status_unknown",
            })
          }
        }
      } else if (error.code === "WALLET_PROVIDER_TIMEOUT") {
        if (dispatchStarted) {
          await markOperationRequiresActionAfterDispatch({
            merchantId,
            operationId: operation.id,
            providerAccountId: resolution.context.providerAccountId,
            providerRequestKey,
            stage: "provider_submission_timeout",
            responseReceived: providerResponseReceived,
            responseMissing: !providerResponseReceived,
            failureReason: "The provider request timed out after dispatch. PineTree is verifying the outcome; do not retry this withdrawal until manual review is complete.",
          evidence: {
            ...(lastProviderResponseEvidence || {}),
            providerErrorCode: error.code,
            providerErrorMessage: safeFailureReason(error.message),
            classificationReason: "timeout_after_dispatch",
            },
          })
        } else {
          await markOperationFailedBeforeProviderAcceptance({
            merchantId,
            operationId: operation.id,
            providerAccountId: resolution.context.providerAccountId,
            error,
            stage: "provider_submission_timeout",
          })
        }
      } else if (dispatchStarted && !providerResponseReceived && !providerRejected) {
        await markOperationRequiresActionAfterDispatch({
          merchantId,
          operationId: operation.id,
          providerAccountId: resolution.context.providerAccountId,
          providerRequestKey,
          stage: providerResponseMissing ? "provider_response_missing" : "provider_submission_status_unknown",
          responseReceived: false,
          responseMissing: providerResponseMissing,
          failureReason: providerResponseMissing
            ? "The provider request was dispatched, but PineTree did not receive a definitive response. Do not retry this withdrawal until manual review is complete."
            : "Provider dispatch started, but PineTree could not confirm the provider response. Do not retry this withdrawal until manual review is complete.",
        })
      } else if (dispatchStarted && providerResponseReceived && !providerRejected) {
        await markOperationRequiresActionAfterDispatch({
          merchantId,
          operationId: operation.id,
          providerAccountId: resolution.context.providerAccountId,
          providerRequestKey,
          stage: "provider_response_unconfirmed",
          responseReceived: true,
          failureReason: OUTCOME_UNKNOWN_WITHDRAWAL_MESSAGE,
          evidence: {
            ...(lastProviderResponseEvidence || {}),
            providerErrorCode: error.code,
            providerErrorMessage: safeFailureReason(error.message),
            classificationReason: "post_dispatch_response_without_rejection_evidence",
          },
        })
      } else if (providerRejected) {
        await updateWalletOperation(merchantId, operation.id, {
          status: "FAILED",
          failureCode: error.code,
          failureReason: error.message,
          failedAt: new Date().toISOString(),
          dispatchCompletedAt: new Date().toISOString(),
          providerResponseReceived: true,
          providerAcceptanceKnown: false,
          providerAcceptanceUnknown: false,
          rawProviderStatus: {
            ...(lastProviderResponseEvidence || {}),
            providerAccountId: resolution.context.providerAccountId,
            providerRequestKey,
            failureCode: error.code,
            failureStage: "provider_submission",
            dispatchStarted,
            explicitProviderRejection: true,
            providerRejectionEvidence: true,
          },
        })
      } else {
        await markOperationFailedBeforeProviderAcceptance({
          merchantId,
          operationId: operation.id,
          providerAccountId: resolution.context.providerAccountId,
          error,
          stage: "provider_submission",
        })
      }
    } else if (providerRejected) {
      const failure = walletErrorFromUnknown(error)
      await updateWalletOperation(merchantId, operation.id, {
        status: "FAILED",
        failureCode: failure.code,
        failureReason: safeFailureReason(failure.reason),
        failedAt: new Date().toISOString(),
        dispatchCompletedAt: new Date().toISOString(),
        providerResponseReceived: true,
        providerAcceptanceKnown: false,
        providerAcceptanceUnknown: false,
        rawProviderStatus: {
          ...(lastProviderResponseEvidence || {}),
          providerAccountId: resolution.context.providerAccountId,
          providerRequestKey,
          failureCode: failure.code,
          failureStage: "provider_submission",
          dispatchStarted,
          explicitProviderRejection: true,
          providerRejectionEvidence: true,
        },
      })
    } else if (providerAcceptanceReturned) {
      await markOperationFailedBeforeProviderAcceptance({
        merchantId,
        operationId: operation.id,
        providerAccountId: resolution.context.providerAccountId,
        error: new WalletApiRouteError(
          "STATUS_UNKNOWN",
          "The provider accepted the withdrawal, but PineTree could not persist the provider response.",
          false
        ),
        stage: "provider_acceptance_persistence",
      })
    } else if (dispatchStarted) {
      await markOperationRequiresActionAfterDispatch({
        merchantId,
        operationId: operation.id,
        providerAccountId: resolution.context.providerAccountId,
        providerRequestKey,
        stage: providerResponseReceived ? "provider_response_parse" : "provider_submission_status_unknown",
        responseReceived: providerResponseReceived,
        responseMissing: !providerResponseReceived,
        failureReason: providerResponseReceived
          ? OUTCOME_UNKNOWN_WITHDRAWAL_MESSAGE
          : "Provider dispatch started, but PineTree could not confirm the provider response. Do not retry this withdrawal until manual review is complete.",
        evidence: lastProviderResponseEvidence || undefined,
      })
    } else {
      await markOperationFailedBeforeProviderAcceptance({
        merchantId,
        operationId: operation.id,
        providerAccountId: resolution.context.providerAccountId,
        error,
        stage: "provider_submission",
      })
    }
    throw error
  }
}

export async function createWalletWithdrawal(
  merchantId: string,
  input: CreateWalletWithdrawalOrPayoutInput
): Promise<PineTreeWalletWriteResult> {
  input.diagnostics?.setSubstage?.("amount_validation")
  const validated = validateWriteInput(input)
  const adapterInput: WalletAdapterWriteInput = {
    asset: validated.asset,
    amountBaseUnits: validated.amountBaseUnits,
    destination: validated.destination,
    note: input.note,
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
    diagnostics: input.diagnostics,
  }
  // A new Speed withdrawal must pass live provider validation before the
  // idempotent operation row is created. Existing rows skip this boundary so
  // replay still restores/reconciles the original operation rather than
  // being reinterpreted against today's balance.
  const resolution = await resolveMerchantWalletProvider(merchantId)
  const existing = await getWalletOperationByIdempotencyKey(merchantId, input.idempotencyKey)
  if (!existing) await preflightProviderWalletWithdrawal(merchantId, adapterInput, resolution)
  return createWalletWrite(
    merchantId,
    "WITHDRAWAL",
    adapterInput,
    maskDestination(validated.destination),
    validated.destination,
    input.destinationLabel,
    (resolution) => resolution.adapter.createWithdrawal?.(resolution.context, adapterInput),
    (resolution) => {
      input.diagnostics?.setSubstage?.("destination_classification")
      resolution.adapter.validateWithdrawal?.(adapterInput)
    }
  )
}

export async function preflightProviderWalletWithdrawal(
  merchantId: string,
  input: WalletAdapterWriteInput,
  resolved?: Awaited<ReturnType<typeof resolveMerchantWalletProvider>>
): Promise<WithdrawalPreflightResult> {
  const resolution = resolved ?? await resolveMerchantWalletProvider(merchantId)
  input.diagnostics?.setProviderAccountId?.(resolution.context.providerAccountId)
  input.diagnostics?.setSubstage?.("provider_account_validation")
  resolution.adapter.validateWithdrawal?.(input)
  const capabilities = await resolution.adapter.getCapabilities(resolution.context)
  if (!capabilities.withdrawals || !capabilities.balances || !resolution.adapter.getBalances) {
    throw new WalletApiRouteError(
      "WALLET_CAPABILITY_UNAVAILABLE",
      "A current available balance is required before withdrawal."
    )
  }

  let balances: Awaited<ReturnType<NonNullable<typeof resolution.adapter.getBalances>>>
  try {
    input.diagnostics?.setSubstage?.("balance_retrieval")
    balances = await resolution.adapter.getBalances(resolution.context)
  } catch (error) {
    console.warn("[pinetree-withdrawals] provider_balance_preflight_unavailable", {
      correlationId: input.correlationId || null,
      withdrawalId: null,
      merchantId,
      rail: "bitcoin",
      asset: "BTC",
      providerErrorClass: error instanceof Error ? error.name : "Error",
      technicalError: error instanceof Error ? error.message : String(error || "unknown_error"),
    })
    throw new WithdrawalPreflightError(
      unavailableWithdrawalPreflight({ rail: "bitcoin", asset: "BTC", requestedAmount: input.amountBaseUnits.toString() })
    )
  }

  const requestedAsset = input.asset === "SATS" ? "BTC" : input.asset
  const available = balances.find(
    (balance) => canonicalWalletBalanceIdentity(balance.asset, balance.network).asset === requestedAsset
  )?.availableBaseUnits
  if (available == null) {
    throw new WithdrawalPreflightError(
      unavailableWithdrawalPreflight({ rail: "bitcoin", asset: "BTC", requestedAmount: input.amountBaseUnits.toString() })
    )
  }
  const classified = classifyBitcoinWithdrawalDestination(input.destination)
  const method = classified.valid && classified.method === "onchain" ? "onchain" : "lightning"
  const pendingSats = await sumPendingWithdrawalOperationBaseUnits(merchantId, "SATS")
  const quote = speedAmountFitsAvailable({
    amountSats: input.amountBaseUnits,
    providerAvailableSats: available,
    pendingSats,
    method,
  })
  const preflight = evaluateWithdrawalPreflight({
    capacity: {
      rail: "bitcoin",
      asset: "BTC",
      network: method === "onchain" ? "Bitcoin" : "Bitcoin Lightning",
      availableBaseUnits: quote.totalAvailableSats,
      pendingBaseUnits: quote.pendingSats,
      feeBaseUnits: quote.estimatedFeeSats,
      feeAsset: "BTC",
      verifiedAt: new Date().toISOString(),
    },
    requestedBaseUnits: input.amountBaseUnits,
    minimumBaseUnits: method === "onchain" ? BigInt(1000) : BigInt(1),
  })
  if (!preflight.allowed) throw new WithdrawalPreflightError(preflight)
  input.diagnostics?.setSubstage?.("balance_validation")
  console.info("[pinetree-withdrawals] provider_withdrawal_preflight_passed", {
    merchantId,
    rail: "bitcoin",
    asset: "BTC",
    requestedSats: input.amountBaseUnits.toString(),
    spendableSats: quote.maximumSendableSats.toString(),
    estimatedFeeSats: quote.estimatedFeeSats.toString(),
  })
  return preflight
}

export async function createWalletPayout(
  merchantId: string,
  input: CreateWalletWithdrawalOrPayoutInput
): Promise<PineTreeWalletWriteResult> {
  const validated = validateWriteInput(input)
  const adapterInput: WalletAdapterWriteInput = {
    asset: validated.asset,
    amountBaseUnits: validated.amountBaseUnits,
    destination: validated.destination,
    note: input.note,
    idempotencyKey: input.idempotencyKey,
  }
  return createWalletWrite(
    merchantId,
    "PAYOUT",
    adapterInput,
    maskDestination(validated.destination),
    null,
    null,
    (resolution) => resolution.adapter.createPayout?.(resolution.context, adapterInput)
  )
}

async function refreshWriteOperationStatus(
  merchantId: string,
  operationId: string,
  statusCall: (
    resolution: Awaited<ReturnType<typeof resolveMerchantWalletProvider>>,
    providerReference: string
  ) => Promise<WalletAdapterOperationResult> | undefined
): Promise<PineTreeWalletOperation> {
  const resolution = await resolveMerchantWalletProvider(merchantId)
  const operation = await getWalletOperationForMerchant(merchantId, operationId)
  if (!operation) {
    throw new WalletApiRouteError("WALLET_OPERATION_NOT_FOUND", "Wallet operation not found.")
  }
  const operationAccountId = operation.provider_account_id
    || String(operation.raw_provider_status?.providerAccountId || "")
  if (
    operation.provider !== resolution.provider
    || (operationAccountId && operationAccountId !== resolution.context.providerAccountId)
  ) {
    throw new WalletApiRouteError("WALLET_OPERATION_NOT_FOUND", "Wallet operation not found.")
  }
  const providerLookupReference = String(operation.provider_reference || operation.provider_transaction_id || "").trim()
  if (!providerLookupReference) {
    return toPineTreeWalletOperation(operation)
  }

  const call = statusCall(resolution, providerLookupReference)
  if (!call) return toPineTreeWalletOperation(operation)

  const result = await call
  const reconciled = await reconcileOperationWithAdapterResult(
    merchantId,
    operation.id,
    resolution.context.providerAccountId,
    result
  )
  return toPineTreeWalletOperation(reconciled)
}

export async function getWalletWithdrawal(merchantId: string, operationId: string): Promise<PineTreeWalletOperation> {
  return refreshWriteOperationStatus(merchantId, operationId, (resolution, providerReference) =>
    resolution.adapter.getWithdrawalStatus?.(resolution.context, providerReference)
  )
}

export async function getWalletPayout(merchantId: string, operationId: string): Promise<PineTreeWalletOperation> {
  return refreshWriteOperationStatus(merchantId, operationId, (resolution, providerReference) =>
    resolution.adapter.getPayoutStatus?.(resolution.context, providerReference)
  )
}

// ---------------------------------------------------------------------------
// Swaps
// ---------------------------------------------------------------------------

export type WalletSwapQuoteInput = {
  sourceAsset: string
  targetAsset: string
  amountDecimal: string
}

export async function quoteWalletSwap(merchantId: string, input: WalletSwapQuoteInput): Promise<PineTreeWalletSwapQuote> {
  const { adapter, context } = await resolveMerchantWalletProvider(merchantId)

  const sourceAsset = String(input.sourceAsset || "").trim().toUpperCase()
  const targetAsset = String(input.targetAsset || "").trim().toUpperCase()
  if (!isSupportedWalletAsset(sourceAsset) || !isSupportedWalletAsset(targetAsset)) {
    throw new WalletApiRouteError("WALLET_VALIDATION_ERROR", "Unsupported swap asset.")
  }
  if (sourceAsset === targetAsset) {
    throw new WalletApiRouteError("WALLET_VALIDATION_ERROR", "Source and target assets must differ.")
  }
  const amountBaseUnits = parseWalletAmountToBaseUnits(input.amountDecimal, sourceAsset)
  if (amountBaseUnits === null) {
    throw new WalletApiRouteError("WALLET_VALIDATION_ERROR", "Enter a valid amount greater than zero.")
  }

  const capabilities = await adapter.getCapabilities(context)
  if (!capabilities.swaps || !adapter.quoteSwap) {
    throw new WalletApiRouteError(
      "WALLET_CAPABILITY_UNAVAILABLE",
      `${adapter.providerDisplayName} does not currently support swaps for connected accounts.`,
      false
    )
  }

  return adapter.quoteSwap(context, { sourceAsset, targetAsset, amountBaseUnits })
}

export type CreateWalletSwapInput = WalletSwapQuoteInput & { idempotencyKey: string }

export async function createWalletSwap(
  merchantId: string,
  input: CreateWalletSwapInput
): Promise<PineTreeWalletWriteResult> {
  const sourceAsset = String(input.sourceAsset || "").trim().toUpperCase()
  const targetAsset = String(input.targetAsset || "").trim().toUpperCase()
  const idempotencyKey = String(input.idempotencyKey || "").trim()
  if (!idempotencyKey) {
    throw new WalletApiRouteError("IDEMPOTENCY_KEY_REQUIRED", "An Idempotency-Key header is required for this request.")
  }
  if (!isSupportedWalletAsset(sourceAsset) || !isSupportedWalletAsset(targetAsset)) {
    throw new WalletApiRouteError("WALLET_VALIDATION_ERROR", "Unsupported swap asset.")
  }
  const amountBaseUnits = parseWalletAmountToBaseUnits(input.amountDecimal, sourceAsset)
  if (amountBaseUnits === null) {
    throw new WalletApiRouteError("WALLET_VALIDATION_ERROR", "Enter a valid amount greater than zero.")
  }

  const adapterInput = { asset: sourceAsset, amountBaseUnits, destination: targetAsset, idempotencyKey }
  return createWalletWrite(merchantId, "SWAP_OUT", adapterInput, `${sourceAsset} -> ${targetAsset}`, null, null, (resolution) =>
    resolution.adapter.createSwap?.(resolution.context, {
      sourceAsset,
      targetAsset,
      amountBaseUnits,
      idempotencyKey,
    })
  )
}

export async function getWalletSwap(merchantId: string, operationId: string): Promise<PineTreeWalletOperation> {
  return refreshWriteOperationStatus(merchantId, operationId, (resolution, providerReference) =>
    resolution.adapter.getSwapStatus?.(resolution.context, providerReference)
  )
}
