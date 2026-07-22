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
import { WalletApiRouteError } from "./walletErrors"
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
  getWalletOperationForMerchant,
  listWalletOperations,
  upsertWalletOperationFromProviderActivity,
  updateWalletOperation,
  type MerchantWalletOperation,
  type WalletOperationStatus,
  type WalletOperationType,
} from "@/database/merchantWalletOperations"
import { listWalletBalanceSnapshots, upsertWalletBalanceSnapshot } from "@/database/merchantWalletBalanceSnapshots"
import { classifyBitcoinWithdrawalDestination } from "@/providers/wallets/bitcoinWithdrawalDestination"
import { speedAmountFitsAvailable } from "@/engine/withdrawals/speedWithdrawalQuote"

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
  return {
    id: row.id,
    provider: row.provider,
    operationType: row.operation_type,
    direction: row.direction,
    status: row.status,
    asset: row.asset,
    network: row.network || null,
    amountBaseUnits: row.amount_base_units,
    feeBaseUnits: row.fee_base_units,
    destinationSummary: row.destination_summary,
    txHash: row.tx_hash,
    explorerUrl: row.explorer_url,
    // Deliberately omits provider_reference/provider_status/raw_provider_status -
    // those are internal reconciliation fields, never returned to the browser.
    failureReason: row.failure_reason,
    createdAt: row.provider_created_at || row.created_at,
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

function maskDestination(destination: string): string {
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
  return updateWalletOperation(merchantId, operationId, {
    providerAccountId,
    status: result.status,
    providerReference: result.providerReference,
    providerStatus: result.providerStatus,
    providerSecondaryReference: result.providerSecondaryReference,
    rawProviderStatus: result.rawProviderStatus,
    txHash: result.txHash ?? undefined,
    explorerUrl: result.explorerUrl ?? undefined,
    feeBaseUnits: result.feeBaseUnits ?? undefined,
    completedAt: result.status === "COMPLETED" ? now : undefined,
    confirmedAt: result.status === "COMPLETED" ? now : undefined,
    failedAt: result.status === "FAILED" || result.status === "EXPIRED" ? now : undefined,
  })
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
  })
}

async function createWalletWrite(
  merchantId: string,
  operationType: "WITHDRAWAL" | "PAYOUT" | "SWAP_OUT",
  input: WalletAdapterWriteInput,
  destinationSummary: string,
  adapterCall: (
    resolution: Awaited<ReturnType<typeof resolveMerchantWalletProvider>>
  ) => Promise<WalletAdapterOperationResult> | undefined
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
    amountBaseUnits: input.amountBaseUnits,
    destinationSummary,
    idempotencyKey: input.idempotencyKey,
  })

  if (!created) {
    const operationProviderAccountId = operation.provider_account_id
      || String(operation.raw_provider_status?.providerAccountId || "")
    if (
      operation.asset !== input.asset ||
      operation.amount_base_units !== input.amountBaseUnits.toString() ||
      operation.destination_summary !== destinationSummary ||
      (operationProviderAccountId && operationProviderAccountId !== resolution.context.providerAccountId)
    ) {
      throw new WalletApiRouteError(
        "IDEMPOTENCY_KEY_CONFLICT",
        "This Idempotency-Key was already used for a different wallet operation."
      )
    }
    const capabilities = await resolution.adapter.getCapabilities(resolution.context)
    const capabilityAvailable =
      operationType === "WITHDRAWAL"
        ? capabilities.withdrawals
        : operationType === "PAYOUT"
          ? capabilities.payouts
          : capabilities.swaps
    return { operation: toPineTreeWalletOperation(operation), capabilityAvailable }
  }

  const capabilities = await resolution.adapter.getCapabilities(resolution.context)
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
      })
      throw error
    }
    input.diagnostics?.setSubstage?.("balance_validation")
    const requestedBalanceAsset = input.asset === "SATS" ? "BTC" : input.asset
    const available = balances.find((balance) =>
      canonicalWalletBalanceIdentity(balance.asset, balance.network).asset === requestedBalanceAsset
    )?.availableBaseUnits
    const speedQuote = resolution.provider === "speed" && input.asset === "SATS" && available != null
      ? (() => {
          const classified = classifyBitcoinWithdrawalDestination(input.destination)
          const method = classified.valid && classified.method === "onchain" ? "onchain" : "lightning"
          return speedAmountFitsAvailable({
            amountSats: input.amountBaseUnits,
            providerAvailableSats: available,
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
  const call = adapterCall(resolution)
  if (!call) {
    const failed = await failOperationAsCapabilityUnavailable(
      merchantId,
      operation.id,
      `${resolution.adapter.providerDisplayName} does not implement this operation.`
    )
    return { operation: toPineTreeWalletOperation(failed), capabilityAvailable: false }
  }

  await updateWalletOperation(merchantId, operation.id, {
    status: "PROCESSING",
    submittedAt: new Date().toISOString(),
  })
  try {
    const result = await call
    input.diagnostics?.setSubstage?.("operation_persistence")
    const reconciled = await reconcileOperationWithAdapterResult(
      merchantId,
      operation.id,
      resolution.context.providerAccountId,
      result
    )
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
    if (error instanceof WalletApiRouteError && !error.retryable) {
      await updateWalletOperation(merchantId, operation.id, {
        status: "FAILED",
        failureCode: error.code,
        failureReason: error.message,
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
  input.diagnostics?.setSubstage?.("provider_resolution")
  const resolution = await resolveMerchantWalletProvider(merchantId)
  input.diagnostics?.setProviderAccountId?.(resolution.context.providerAccountId)
  input.diagnostics?.setSubstage?.("destination_classification")
  resolution.adapter.validateWithdrawal?.(adapterInput)
  return createWalletWrite(merchantId, "WITHDRAWAL", adapterInput, maskDestination(validated.destination), (resolution) =>
    resolution.adapter.createWithdrawal?.(resolution.context, adapterInput)
  )
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
  return createWalletWrite(merchantId, "PAYOUT", adapterInput, maskDestination(validated.destination), (resolution) =>
    resolution.adapter.createPayout?.(resolution.context, adapterInput)
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
  if (!operation.provider_reference) {
    return toPineTreeWalletOperation(operation)
  }

  const call = statusCall(resolution, operation.provider_reference)
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
  return createWalletWrite(merchantId, "SWAP_OUT", adapterInput, `${sourceAsset} -> ${targetAsset}`, (resolution) =>
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
