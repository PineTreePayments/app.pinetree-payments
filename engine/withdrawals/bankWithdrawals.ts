/**
 * PineTree Engine - withdraw to a bank account.
 *
 * ── Why this reuses the existing withdrawal machinery ────────────────────────
 * A bank withdrawal IS a Base/Solana USDC withdrawal whose destination address
 * happens to belong to the settlement provider. So it goes through exactly the
 * same review -> prepare -> Dynamic authorization -> submit path, writes to the
 * same `wallet_withdrawal_requests` ledger, and reuses the same preflight,
 * balance checks, and error presentation. Nothing here is a parallel withdrawal
 * system; the only additions are the destination binding and the settlement
 * evidence that governs confirmation.
 *
 * ── The rule this module protects ────────────────────────────────────────────
 * A confirmed source-chain transaction proves the merchant's USDC reached the
 * settlement provider. It is NOT proof the bank was paid. A bank withdrawal
 * stays PROCESSING until the provider reports a completed payout, and only that
 * evidence may confirm it. Clicking Approve, a wallet return, a signed
 * transaction, a submitted transaction, a confirmed source-chain receipt,
 * `funds_received`, and `payment_submitted` are all explicitly insufficient.
 */

import { randomUUID } from "node:crypto"

import {
  findBankWithdrawalForDrain,
  getWalletWithdrawalRequest,
  listProcessingBankWithdrawalsForReconciliation,
  markWalletWithdrawalAsBankDestination,
  updateWalletWithdrawalRequest,
  updateWalletWithdrawalRequestCanonicalFields,
  updateWalletWithdrawalSettlementEvidence,
  type WalletWithdrawalRequestRecord,
} from "@/database/walletWithdrawalRequests"
import {
  getLiquidationRoute,
  findLiquidationRouteByProviderId,
  type LiquidationRouteRail,
  type MerchantBridgeLiquidationRoute,
} from "@/database/merchantBridgeLiquidationRoutes"
import { markBankDestinationUsed } from "@/database/merchantBankDestinations"
import { insertWithdrawalAuditEvent } from "@/database/merchantAuditEvents"
import {
  ensureLiquidationRouteEngine,
  isSupportedBankWithdrawalSource,
} from "@/engine/bridgeLiquidationRoutes"
import {
  createWalletWithdrawalReview,
  type CreateWalletWithdrawalReviewResult,
} from "@/engine/withdrawals/walletWithdrawals"
import {
  isStaleDrainEvidence,
  mapDrainStateToWithdrawal,
} from "@/engine/withdrawals/bridgeDrainLifecycle"
import { walletWithdrawalRequestStatusIsTerminal } from "@/engine/withdrawals/withdrawalLifecycle"
import { bridgeListItems, listLiquidationAddressDrains } from "@/providers/bridge/client"
import { describeBridgeError } from "@/providers/bridge/errors"
import {
  depositTxHashMatches,
  normalizeBridgeDrain,
  type NormalizedBridgeDrain,
} from "@/providers/bridge/normalizeMoneyMovement"
import type { NormalizedBridgeConnectionEvent } from "@/providers/bridge/translateEvent"
import type { BridgeDrain, BridgeDrainState } from "@/providers/bridge/types"

export type BankWithdrawalFailure = {
  ok: false
  error: string
  retryable: boolean
  correlationId: string
}

function failure(error: string, correlationId: string, retryable = false): BankWithdrawalFailure {
  return { ok: false, error, retryable, correlationId }
}

export type BankWithdrawalReviewResult = {
  ok: true
  request: WalletWithdrawalRequestRecord
  review: CreateWalletWithdrawalReviewResult["review"]
  canSubmit: boolean
  preflight: CreateWalletWithdrawalReviewResult["preflight"]
  correlationId: string
}

/**
 * Create a canonical withdrawal that settles to the merchant's bank.
 *
 * Order of operations is deliberate: the settlement route is ensured BEFORE the
 * withdrawal row exists, so a merchant never ends up holding a canonical
 * withdrawal that has nowhere to go. Once the route exists, the ordinary review
 * path takes over unchanged.
 */
export async function createBankWithdrawalReviewEngine(args: {
  merchantId: string
  rail: string
  asset: string
  amountDecimal: string
  bankDestinationId: string
  correlationId?: string | null
}): Promise<BankWithdrawalReviewResult | BankWithdrawalFailure> {
  const correlationId = String(args.correlationId || "").trim() || randomUUID()

  const rail = String(args.rail || "").trim().toLowerCase()
  const asset = String(args.asset || "").trim().toUpperCase()

  if (!isSupportedBankWithdrawalSource(rail, asset)) {
    // Native ETH and SOL cannot reach this route: the settlement address
    // receives USDC. PineTree says so rather than pretending otherwise.
    return failure(
      "Bank withdrawals currently support USDC on Base and Solana.",
      correlationId
    )
  }

  const ensured = await ensureLiquidationRouteEngine({
    merchantId: args.merchantId,
    bankDestinationId: args.bankDestinationId,
    sourceRail: rail as LiquidationRouteRail,
    sourceAsset: asset,
  })
  if (!ensured.ok) {
    return failure(ensured.error, correlationId, ensured.retryable)
  }

  // The existing review path performs every balance, preflight, signer, and
  // rail-readiness check. Nothing about those is special-cased for banks.
  const review = await createWalletWithdrawalReview(args.merchantId, {
    rail,
    asset,
    destinationAddress: ensured.route.deposit_address,
    amountDecimal: args.amountDecimal,
    correlationId,
  })

  const stamped = await updateWalletWithdrawalRequestCanonicalFields(
    args.merchantId,
    review.request.id,
    { source: "saved_address", destinationId: null }
  ).catch(() => review.request)

  const request = await markWalletWithdrawalAsBankDestination(args.merchantId, stamped.id, {
    bankDestinationId: args.bankDestinationId,
    liquidationRouteId: ensured.route.id,
  })

  await markBankDestinationUsed(args.merchantId, args.bankDestinationId).catch(() => undefined)

  void insertWithdrawalAuditEvent({
    merchantId: args.merchantId,
    eventType: "withdrawal.bank_review_created",
    withdrawalId: request.id,
    rail,
    asset,
    status: request.status,
    metadata: {
      bank_destination_id: args.bankDestinationId,
      liquidation_route_id: ensured.route.id,
      route_reused: ensured.reused,
      correlation_id: correlationId,
    },
  })

  return {
    ok: true,
    request,
    review: review.review,
    canSubmit: review.canSubmit,
    preflight: review.preflight,
    correlationId,
  }
}

/**
 * Apply settlement payout evidence to a canonical withdrawal.
 *
 * The single place a bank withdrawal may be confirmed or failed. Shared by the
 * webhook path and the reconciliation path so both reach identical conclusions
 * from identical evidence, and so duplicate delivery has exactly-once effect.
 */
export async function applyDrainEvidenceEngine(input: {
  merchantId: string
  withdrawal: WalletWithdrawalRequestRecord
  drain: NormalizedBridgeDrain
  correlationId: string
}): Promise<{ applied: boolean; reason: string }> {
  const { withdrawal, drain } = input

  if (withdrawal.destination_kind !== "bank") {
    // Defensive: settlement evidence must never touch an ordinary crypto
    // withdrawal, whose destination is the merchant's own address.
    return { applied: false, reason: "no_matching_withdrawal" }
  }

  // A terminal withdrawal is never reopened by a later delivery.
  if (walletWithdrawalRequestStatusIsTerminal(withdrawal.status)) {
    return { applied: false, reason: "out_of_order" }
  }

  const storedUpdatedAtMs = withdrawal.settlement_updated_at
    ? Date.parse(withdrawal.settlement_updated_at)
    : null
  if (
    isStaleDrainEvidence({
      storedState: (withdrawal.settlement_drain_state as BridgeDrainState | null) ?? null,
      incomingState: drain.state,
      storedUpdatedAtMs: Number.isFinite(storedUpdatedAtMs as number)
        ? (storedUpdatedAtMs as number)
        : null,
      incomingUpdatedAtMs: drain.occurredAtMs,
    })
  ) {
    return { applied: false, reason: "out_of_order" }
  }

  const outcome = mapDrainStateToWithdrawal(drain.state)

  // Evidence is recorded first and unconditionally: even an unresolved state is
  // support and reconciliation material.
  await updateWalletWithdrawalSettlementEvidence(input.merchantId, withdrawal.id, {
    drainId: drain.drainId,
    drainState: drain.rawState,
    payoutReference: drain.payoutTraceReference,
    settlementUpdatedAt: drain.occurredAt || new Date().toISOString(),
  })

  if (outcome.requiresOperatorAction) {
    console.warn("[bank-withdrawals] settlement_requires_operator_action", {
      correlationId: input.correlationId,
      merchantId: input.merchantId,
      withdrawalId: withdrawal.id,
      drainState: drain.state,
    })
  }

  if (!outcome.status) {
    // UNKNOWN. The withdrawal keeps its canonical state and reconciliation
    // keeps checking - it is never resubmitted and never failed on a guess.
    return { applied: false, reason: "state_reread_failed" }
  }

  const now = new Date().toISOString()
  await updateWalletWithdrawalRequest(input.merchantId, withdrawal.id, {
    status: outcome.status,
    ...(outcome.terminalSuccess
      ? { confirmedAt: now, errorMessage: null, errorCode: null }
      : outcome.terminalFailure
        ? { failedAt: now, errorMessage: outcome.merchantMessage, errorCode: outcome.errorCode }
        : { errorMessage: null, errorCode: null }),
  })

  void insertWithdrawalAuditEvent({
    merchantId: input.merchantId,
    eventType: outcome.terminalSuccess
      ? "withdrawal.confirmed"
      : outcome.terminalFailure
        ? "withdrawal.failed"
        : "withdrawal.processing",
    withdrawalId: withdrawal.id,
    rail: withdrawal.rail,
    asset: withdrawal.asset,
    status: outcome.status,
    metadata: {
      settlement_drain_id: drain.drainId,
      settlement_drain_state: drain.rawState,
      deposit_tx_hash: drain.depositTxHash,
      correlation_id: input.correlationId,
    },
  })

  return { applied: true, reason: "applied" }
}

/**
 * Apply a verified settlement drain webhook.
 *
 * The tenant is already resolved from PineTree's stored route. The drain object
 * on the event is used directly because the delivery is signature-verified and
 * carries the provider's own state; correlation to a withdrawal is still done
 * through PineTree's stored deposit transaction hash rather than anything the
 * payload claims about a merchant.
 */
export async function applyBridgeDrainEventEngine(input: {
  merchantId: string
  event: NormalizedBridgeConnectionEvent
  payload: unknown
  correlationId: string
}): Promise<{ applied: boolean; reason: string }> {
  const object = extractDrainObject(input.payload)
  const drain = object
    ? normalizeBridgeDrain({
        ...object,
        id: object.id || input.event.drainId || "",
        liquidation_address_id: object.liquidation_address_id || input.event.liquidationAddressId,
        state: object.state || input.event.objectStatus,
      })
    : null

  if (!drain) return { applied: false, reason: "unresolved_route" }

  const liquidationAddressId = drain.liquidationAddressId || input.event.liquidationAddressId
  if (!liquidationAddressId) return { applied: false, reason: "unresolved_route" }

  const route = await findLiquidationRouteByProviderId(liquidationAddressId).catch(() => null)
  if (!route || route.merchant_id !== input.merchantId) {
    return { applied: false, reason: "unresolved_route" }
  }

  const withdrawal = await findBankWithdrawalForDrain({
    liquidationRouteId: route.id,
    depositTxHash: drain.depositTxHash,
    drainId: drain.drainId,
  }).catch(() => null)

  if (!withdrawal || withdrawal.merchant_id !== input.merchantId) {
    // Verified, stored, and correlated to a route - but not to a PineTree
    // withdrawal (for example a deposit PineTree did not originate). Retained
    // as evidence rather than dropped or guessed at.
    console.warn("[bank-withdrawals] drain_without_withdrawal", {
      correlationId: input.correlationId,
      merchantId: input.merchantId,
      routeId: route.id,
    })
    return { applied: false, reason: "no_matching_withdrawal" }
  }

  return applyDrainEvidenceEngine({
    merchantId: input.merchantId,
    withdrawal,
    drain,
    correlationId: input.correlationId,
  })
}

function extractDrainObject(payload: unknown): (BridgeDrain & { id?: string }) | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  const object = (payload as { event_object?: unknown }).event_object
  if (!object || typeof object !== "object" || Array.isArray(object)) return null
  return object as BridgeDrain
}

export type BankWithdrawalReconciliationResult = {
  candidates: number
  checked: number
  confirmed: number
  failed: number
  stillProcessing: number
  unmatched: number
  errors: number
}

/**
 * Reconcile nonterminal bank withdrawals against the settlement provider.
 *
 * Sandbox emits no payment webhooks at all, and production webhook delivery is
 * at-least-once but not guaranteed-once, so this lookup - not the webhook - is
 * what makes the outcome eventually knowable.
 *
 * Nothing is ever resubmitted here. An unresolved lookup leaves the withdrawal
 * exactly as it was.
 */
export async function reconcileBankWithdrawalsEngine(options: {
  limit?: number
  merchantId?: string
}): Promise<BankWithdrawalReconciliationResult> {
  const limit = options.limit ?? 25
  const correlationId = randomUUID()
  const result: BankWithdrawalReconciliationResult = {
    candidates: 0,
    checked: 0,
    confirmed: 0,
    failed: 0,
    stillProcessing: 0,
    unmatched: 0,
    errors: 0,
  }

  let withdrawals: WalletWithdrawalRequestRecord[]
  try {
    withdrawals = await listProcessingBankWithdrawalsForReconciliation(limit, options.merchantId)
  } catch (error) {
    console.warn("[bank-withdrawals] reconcile_select_failed", {
      correlationId,
      ...describeBridgeError(error),
    })
    return { ...result, errors: 1 }
  }

  result.candidates = withdrawals.length

  for (const withdrawal of withdrawals) {
    try {
      const route = withdrawal.liquidation_route_id
        ? await getLiquidationRoute(withdrawal.merchant_id, withdrawal.liquidation_route_id)
        : null
      if (!route) {
        result.unmatched++
        continue
      }

      const drain = await lookupDrainForWithdrawal({ route, withdrawal, correlationId })
      result.checked++
      if (!drain) {
        result.stillProcessing++
        continue
      }

      const applied = await applyDrainEvidenceEngine({
        merchantId: withdrawal.merchant_id,
        withdrawal,
        drain,
        correlationId,
      })

      if (!applied.applied) {
        result.stillProcessing++
        continue
      }

      const outcome = mapDrainStateToWithdrawal(drain.state)
      if (outcome.terminalSuccess) result.confirmed++
      else if (outcome.terminalFailure) result.failed++
      else result.stillProcessing++
    } catch (error) {
      result.errors++
      console.warn("[bank-withdrawals] reconcile_one_failed", {
        correlationId,
        withdrawalId: withdrawal.id,
        ...describeBridgeError(error),
      })
    }
  }

  return result
}

/**
 * Find the drain a withdrawal's deposit created.
 *
 * Every deposit to a settlement address creates its own drain, so the deposit
 * transaction hash is the correlation key. The provider's own hash filter is
 * used where it accepts one, with a bounded scan as a fallback for a rail whose
 * hash casing may differ.
 */
async function lookupDrainForWithdrawal(input: {
  route: MerchantBridgeLiquidationRoute
  withdrawal: WalletWithdrawalRequestRecord
  correlationId: string
}): Promise<NormalizedBridgeDrain | null> {
  const depositTxHash = String(input.withdrawal.tx_hash || "").trim()
  if (!depositTxHash) return null

  const result = await listLiquidationAddressDrains({
    customerId: input.route.provider_customer_id,
    liquidationAddressId: input.route.provider_liquidation_address_id,
    txHash: depositTxHash,
    limit: 25,
    context: { correlationId: input.correlationId, merchantId: input.withdrawal.merchant_id },
  })

  const drains = bridgeListItems<BridgeDrain>(result.data)
    .map((entry) => normalizeBridgeDrain(entry))
    .filter((entry): entry is NormalizedBridgeDrain => entry !== null)

  const matched = drains.find((drain) =>
    depositTxHashMatches(input.route.source_rail, drain.depositTxHash, depositTxHash)
  )
  if (matched) return matched

  // The provider filtered by hash and returned exactly one drain: trust its own
  // filter rather than PineTree's string comparison of an opaque reference.
  return drains.length === 1 ? drains[0] : null
}

/**
 * Record that the source-chain transfer to the settlement provider succeeded.
 *
 * This is deliberately NOT a confirmation. It is the moment the merchant's
 * funds left their wallet and reached the provider, retained as evidence while
 * the withdrawal stays PROCESSING awaiting the actual bank payout.
 */
export async function recordBankWithdrawalSourceChainConfirmed(input: {
  merchantId: string
  withdrawalId: string
}): Promise<void> {
  const withdrawal = await getWalletWithdrawalRequest(input.merchantId, input.withdrawalId)
  if (!withdrawal || withdrawal.destination_kind !== "bank") return
  if (withdrawal.source_chain_confirmed_at) return

  await updateWalletWithdrawalSettlementEvidence(input.merchantId, input.withdrawalId, {
    sourceChainConfirmedAt: new Date().toISOString(),
  })

  void insertWithdrawalAuditEvent({
    merchantId: input.merchantId,
    eventType: "withdrawal.bank_source_chain_confirmed",
    withdrawalId: input.withdrawalId,
    rail: withdrawal.rail,
    asset: withdrawal.asset,
    status: withdrawal.status,
    metadata: { tx_hash: withdrawal.tx_hash },
  })
}
