import { getPaymentById } from "@/database"
import {
  getPaymentMaintenanceCandidates,
  getTerminalPaymentMaintenanceCandidates,
  getLightningReconciliationCandidates,
  getConfirmedLightningFeeSettlementCandidates,
  getIncompleteBasePaymentReconciliationCandidates
} from "@/database/paymentMaintenance"
import { getPaymentEvents } from "@/database/paymentEvents"
import { getTransactionByPaymentId } from "@/database/transactions"
import { CHECKOUT_TIMEOUT_MS } from "./config"
import { runPaymentWatcher } from "./checkPaymentOnce"
import { reconcileBasePaymentFromChain } from "./baseChainReconciliation"
import { isRpc429Error } from "./paymentWatcher"
import { reconcileSpeedLightningPayment, reconcileConfirmedLightningFeeSettlement } from "./lightningSpeedReconciliation"
import { paymentHasProcessingEvidence } from "./paymentEvidence"
import { markPaymentIncomplete } from "./paymentStateActions"
import {
  reconcileTransactionForPayment,
  type TerminalPaymentStatus
} from "./reconcileTransaction"
import { sweepStalePayments, type StalePaymentSweepSummary } from "./stalePaymentSweep"

// Payments with no checkout-session poller active for at least this long
// before a background reconciliation pass will consider re-asking Speed -
// keeps this from duplicating the customer-facing checkout poller's own
// work during a payment's first few minutes (lib/lightning/lightningStatusPoller.ts).
const LIGHTNING_RECONCILE_MIN_AGE_MS = 3 * 60_000

// A CONFIRMED payment's fee-settlement bookkeeping is only re-checked after
// this much time has passed since it last changed - gives Speed's own system
// a reasonable window to finish attaching the APPLICATION_FEE transfer to
// that payment before treating "not settled yet" as worth re-polling for.
const FEE_SETTLEMENT_RECHECK_MIN_AGE_MS = 2 * 60_000

// Self-healing window for INCOMPLETE Base payments: only payments created
// within this lookback are re-checked against the chain. A payment abandoned
// (or falsely cancelled) longer ago than this is treated as settled history
// rather than repeatedly re-scanned.
const BASE_RECONCILE_LOOKBACK_MS = 24 * 60 * 60_000

const DEFAULT_THROTTLE_MS = 60_000
const DEFAULT_WATCHER_TIMEOUT_MS = 4_000

type MaintenanceLease = {
  lastStartedAt: number
  running: boolean
}

const globalWithMaintenance = globalThis as typeof globalThis & {
  __pinetreePaymentMaintenanceLease?: MaintenanceLease
}

function getMaintenanceLease(): MaintenanceLease {
  globalWithMaintenance.__pinetreePaymentMaintenanceLease ??= {
    lastStartedAt: 0,
    running: false
  }
  return globalWithMaintenance.__pinetreePaymentMaintenanceLease
}

// Process-local (NOT cross-instance — see the maintenance lease above for
// the same documented limitation) circuit breaker for the EVM RPC provider's
// per-second rate limit. Alchemy's 429 ("exceeded compute units per second")
// means the endpoint just told us to slow down; the worst possible response
// is to immediately move on to the next candidate and hit it again. Once any
// EVM scan in a sweep observes a 429, every remaining EVM candidate in this
// tick (and the next, until the cooldown elapses) is skipped without making
// an RPC call at all, instead of retried.
type Rpc429CooldownState = { until: number; consecutive429s: number }

const globalWithRpcCooldown = globalThis as typeof globalThis & {
  __pinetreeEvmRpc429Cooldown?: Rpc429CooldownState
}

function getRpc429CooldownState(): Rpc429CooldownState {
  globalWithRpcCooldown.__pinetreeEvmRpc429Cooldown ??= { until: 0, consecutive429s: 0 }
  return globalWithRpcCooldown.__pinetreeEvmRpc429Cooldown
}

// A clean check proves the endpoint is healthy right now — un-escalate the
// backoff so a transient burst doesn't leave the cooldown growing long after
// the provider has recovered. Does not clear an already-scheduled `until`;
// that still runs its own course.
function noteRpc429RecoveryOnSuccess(): void {
  getRpc429CooldownState().consecutive429s = 0
}

const RPC_429_BASE_BACKOFF_MS = 2_000
const RPC_429_MAX_BACKOFF_MS = 30_000

function isRpc429CooldownActive(): boolean {
  return Date.now() < getRpc429CooldownState().until
}

// Bounded exponential backoff with jitter — consecutive429s resets to 0 the
// next time a check succeeds (noteRpc429RecoveryOnSuccess above). When the
// provider sent its own Retry-After guidance, that is used verbatim instead
// of the computed delay (still bounded to RPC_429_MAX_BACKOFF_MS).
function scheduleRpc429Backoff(retryAfterMs?: number): void {
  const state = getRpc429CooldownState()
  state.consecutive429s += 1
  let delayMs: number
  let usedProviderGuidance = false
  if (typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    delayMs = Math.min(RPC_429_MAX_BACKOFF_MS, retryAfterMs)
    usedProviderGuidance = true
  } else {
    const exponential = RPC_429_BASE_BACKOFF_MS * (2 ** (state.consecutive429s - 1))
    const jitterMs = Math.floor(Math.random() * exponential * 0.5)
    delayMs = Math.min(RPC_429_MAX_BACKOFF_MS, exponential + jitterMs)
  }
  state.until = Date.now() + delayMs
  console.warn("[watcher:evm] 429 backoff scheduled", {
    delayMs,
    consecutive429s: state.consecutive429s,
    usedProviderGuidance
  })
}

export type PaymentMaintenanceSummary = {
  runId: string
  startedAt: string
  completedAt: string
  skipped: boolean
  skipReason?: "already_running" | "recently_run"
  sweep: StalePaymentSweepSummary | null
  candidatesScanned: number
  expired: number
  canceledReconciled: number
  incomplete: number
  transactionSnapshotsReconciled: number
  skippedSubmittedEvidence: number
  skippedTerminal: number
  failures: number
  watcherCandidates: number
  watcherChecks: number
  watcherErrors: number
  reconciled: number
  reconcileErrors: number
  lightningCandidates: number
  lightningReconciled: number
  lightningErrors: number
  feeSettlementCandidates: number
  feeSettlementReconciled: number
  feeSettlementErrors: number
  baseReconcileCandidates: number
  baseReconciled: number
  baseReconcileErrors: number
}

export type PaymentFreshnessResult = {
  paymentId: string
  previousStatus: string
  status: string
  action: "none" | "marked_incomplete" | "watcher_recheck"
  detected?: boolean
}

function isTerminalPaymentStatus(status: string): status is TerminalPaymentStatus {
  return status === "CONFIRMED" || status === "FAILED" || status === "INCOMPLETE"
}

function isOlderThan(value: string | null | undefined, ageMs: number): boolean {
  const timestamp = new Date(String(value || "")).getTime()
  return Number.isFinite(timestamp) && Date.now() - timestamp >= ageMs
}

async function runWatcherWithTimeout(paymentId: string, timeoutMs: number): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      runPaymentWatcher(paymentId).then(() => undefined),
      new Promise<void>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("payment_maintenance_watcher_timeout")),
          timeoutMs
        )
      })
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export async function ensurePaymentFresh(
  paymentId: string,
  options?: { txHash?: string; forceWatcher?: boolean; sessionAttemptId?: string }
): Promise<PaymentFreshnessResult | null> {
  const payment = await getPaymentById(paymentId)
  if (!payment) return null

  const previousStatus = String(payment.status || "").toUpperCase()
  if (isTerminalPaymentStatus(previousStatus)) {
    return { paymentId, previousStatus, status: previousStatus, action: "none" }
  }

  const [transaction, events] = await Promise.all([
    getTransactionByPaymentId(paymentId),
    getPaymentEvents(paymentId).catch(() => [])
  ])
  const hasEvidence = paymentHasProcessingEvidence({ payment, transaction, events })

  let action: PaymentFreshnessResult["action"] = "none"
  if (
    (previousStatus === "CREATED" || previousStatus === "PENDING") &&
    !hasEvidence &&
    isOlderThan(payment.updated_at || payment.created_at, CHECKOUT_TIMEOUT_MS)
  ) {
    const changed = await markPaymentIncomplete(paymentId, {
      providerEvent: "traffic.payment_freshness_timeout",
      rawPayload: { timeoutMs: CHECKOUT_TIMEOUT_MS },
      minimumAgeMs: CHECKOUT_TIMEOUT_MS
    })
    if (changed) action = "marked_incomplete"
  } else if (
    previousStatus === "PROCESSING" ||
    (previousStatus === "PENDING" && (hasEvidence || options?.forceWatcher))
  ) {
    // maxAttempts: 1 — this path is reached synchronously from the
    // customer-facing POST /detect route (engine/paymentDetect.ts) the moment
    // a wallet returns a transaction hash. runPaymentWatcher's default retry
    // loop (up to 5 attempts x 3s sleep for EVM+txHash) is meant for
    // background/cron callers; running it here would block the customer's
    // browser for up to ~15s per call with no timeout guard. The client
    // already re-polls /detect on its own short interval, so a single bounded
    // check per call is sufficient and keeps this request fast.
    const watcherOptions = options?.txHash
      ? { txHash: options.txHash, maxAttempts: 1, sessionAttemptId: options.sessionAttemptId }
      : undefined
    const detected = await runPaymentWatcher(paymentId, watcherOptions)
    action = "watcher_recheck"
    const refreshed = await getPaymentById(paymentId)
    return {
      paymentId,
      previousStatus,
      status: String(refreshed?.status || payment.status || "").toUpperCase(),
      action,
      detected
    }
  }

  const refreshed = await getPaymentById(paymentId)
  return {
    paymentId,
    previousStatus,
    status: String(refreshed?.status || payment.status || "").toUpperCase(),
    action
  }
}

export async function runPaymentMaintenanceTick(options?: {
  throttleMs?: number
  sweepLimit?: number
  watcherLimit?: number
  reconcileLimit?: number
  watcherTimeoutMs?: number
  lightningReconcileLimit?: number
  feeSettlementReconcileLimit?: number
  now?: number
}): Promise<PaymentMaintenanceSummary> {
  const lease = getMaintenanceLease()
  const now = options?.now ?? Date.now()
  const throttleMs = Math.max(1_000, options?.throttleMs ?? DEFAULT_THROTTLE_MS)
  const runId = crypto.randomUUID()
  const startedAt = new Date(now).toISOString()

  const emptySummary = {
    runId,
    startedAt,
    completedAt: startedAt,
    sweep: null,
    candidatesScanned: 0,
    expired: 0,
    canceledReconciled: 0,
    incomplete: 0,
    transactionSnapshotsReconciled: 0,
    skippedSubmittedEvidence: 0,
    skippedTerminal: 0,
    failures: 0,
    watcherCandidates: 0,
    watcherChecks: 0,
    watcherErrors: 0,
    reconciled: 0,
    reconcileErrors: 0,
    lightningCandidates: 0,
    lightningReconciled: 0,
    lightningErrors: 0,
    feeSettlementCandidates: 0,
    feeSettlementReconciled: 0,
    feeSettlementErrors: 0,
    baseReconcileCandidates: 0,
    baseReconciled: 0,
    baseReconcileErrors: 0
  }

  if (lease.running) {
    return { skipped: true, skipReason: "already_running", ...emptySummary }
  }
  if (now - lease.lastStartedAt < throttleMs) {
    return { skipped: true, skipReason: "recently_run", ...emptySummary }
  }

  lease.running = true
  lease.lastStartedAt = now

  try {
    const sweep = await sweepStalePayments({
      maxRows: options?.sweepLimit ?? 10,
      staleAfterMs: CHECKOUT_TIMEOUT_MS
    })

    const watcherLimit = Math.max(1, Math.min(options?.watcherLimit ?? 3, 10))
    const candidates = await getPaymentMaintenanceCandidates(watcherLimit * 3)
    const watchable: Array<{ id: string; network: string }> = []

    for (const payment of candidates) {
      const status = String(payment.status || "").toUpperCase()
      if (status === "PROCESSING") {
        watchable.push({ id: payment.id, network: String(payment.network || "") })
      } else if (status === "PENDING") {
        const [transaction, events] = await Promise.all([
          getTransactionByPaymentId(payment.id),
          getPaymentEvents(payment.id).catch(() => [])
        ])
        if (paymentHasProcessingEvidence({ payment, transaction, events })) {
          watchable.push({ id: payment.id, network: String(payment.network || "") })
        }
      }
      if (watchable.length >= watcherLimit) break
    }

    let watcherChecks = 0
    let watcherErrors = 0
    const watcherTimeoutMs = Math.max(
      500,
      options?.watcherTimeoutMs ?? DEFAULT_WATCHER_TIMEOUT_MS
    )
    await Promise.all(watchable.map(async ({ id: paymentId, network }) => {
      // The 429 cooldown is specific to the EVM/Alchemy RPC endpoint — never
      // let it skip a Solana (or any other non-EVM) candidate's check.
      const isEvm = network === "base" || network === "ethereum"
      if (isEvm && isRpc429CooldownActive()) {
        console.warn("[watcher:evm] scan skipped: rate-limit cooldown active", { paymentId })
        return
      }
      try {
        await runWatcherWithTimeout(paymentId, watcherTimeoutMs)
        watcherChecks += 1
        if (isEvm) noteRpc429RecoveryOnSuccess()
      } catch (error) {
        watcherErrors += 1
        if (isEvm && isRpc429Error(error)) scheduleRpc429Backoff(error.retryAfterMs)
        console.warn("[payment-maintenance] watcher recheck failed", {
          paymentId,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }))

    let reconciled = 0
    let canceledReconciled = 0
    let reconcileErrors = 0
    const terminalCandidates = await getTerminalPaymentMaintenanceCandidates(
      options?.reconcileLimit ?? 10
    )
    for (const payment of terminalCandidates) {
      const status = String(payment.status || "").toUpperCase()
      if (!isTerminalPaymentStatus(status)) continue
      try {
        const result = await reconcileTransactionForPayment(payment.id, status)
        if (!result.skipped) {
          reconciled += 1
          const events = await getPaymentEvents(payment.id).catch(() => [])
          if (events.some((event) => event.event_type === "payment.canceled" || event.event_type === "payment.cancelled")) {
            canceledReconciled += 1
          }
        }
        if (result.skipReason?.startsWith("fetch_error:") || result.skipReason?.startsWith("update_error:")) {
          reconcileErrors += 1
        }
      } catch (error) {
        reconcileErrors += 1
        console.warn("[payment-maintenance] transaction reconciliation failed", {
          paymentId: payment.id,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    let lightningReconciled = 0
    let lightningErrors = 0
    const lightningLimit = Math.max(1, Math.min(options?.lightningReconcileLimit ?? 5, 25))
    const lightningCutoff = new Date(now - LIGHTNING_RECONCILE_MIN_AGE_MS).toISOString()
    const lightningCandidates = await getLightningReconciliationCandidates({
      limit: lightningLimit,
      cutoff: lightningCutoff
    })
    for (const payment of lightningCandidates) {
      try {
        const result = await reconcileSpeedLightningPayment(payment)
        if (result.checked) lightningReconciled += 1
      } catch (error) {
        lightningErrors += 1
        console.warn("[payment-maintenance] lightning reconciliation failed", {
          paymentId: payment.id,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    let feeSettlementReconciled = 0
    let feeSettlementErrors = 0
    const feeSettlementLimit = Math.max(1, Math.min(options?.feeSettlementReconcileLimit ?? 5, 25))
    const feeSettlementCutoff = new Date(now - FEE_SETTLEMENT_RECHECK_MIN_AGE_MS).toISOString()
    const feeSettlementCandidates = await getConfirmedLightningFeeSettlementCandidates({
      limit: feeSettlementLimit,
      cutoff: feeSettlementCutoff
    })
    for (const payment of feeSettlementCandidates) {
      try {
        const result = await reconcileConfirmedLightningFeeSettlement(payment)
        if (result.checked) feeSettlementReconciled += 1
      } catch (error) {
        feeSettlementErrors += 1
        console.warn("[payment-maintenance] fee settlement reconciliation failed", {
          paymentId: payment.id,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    let baseReconciled = 0
    let baseReconcileErrors = 0
    const baseReconcileLimit = Math.max(1, Math.min(options?.reconcileLimit ?? 5, 25))
    const baseReconcileSince = new Date(now - BASE_RECONCILE_LOOKBACK_MS).toISOString()
    const baseReconcileCandidates = await getIncompleteBasePaymentReconciliationCandidates({
      limit: baseReconcileLimit,
      since: baseReconcileSince
    })
    for (const candidate of baseReconcileCandidates) {
      if (isRpc429CooldownActive()) {
        console.warn("[watcher:evm] scan skipped: rate-limit cooldown active", {
          paymentId: candidate.id
        })
        continue
      }
      try {
        const result = await reconcileBasePaymentFromChain(candidate.id)
        if (result.detected) baseReconciled += 1
        noteRpc429RecoveryOnSuccess()
      } catch (error) {
        baseReconcileErrors += 1
        if (isRpc429Error(error)) {
          scheduleRpc429Backoff(error.retryAfterMs)
          console.warn("[payment-maintenance] base chain reconciliation failed", {
            paymentId: candidate.id,
            error: error instanceof Error ? error.message : String(error)
          })
          // Sequential loop over a batch of up to 25 candidates against the
          // SAME rate-limited endpoint — stop here rather than immediately
          // re-attempting the next one; it will be picked up on a later tick
          // once the cooldown elapses.
          break
        }
        console.warn("[payment-maintenance] base chain reconciliation failed", {
          paymentId: candidate.id,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    const completedAt = new Date(options?.now ?? Date.now()).toISOString()
    const failures = sweep.failures + watcherErrors + reconcileErrors + lightningErrors + feeSettlementErrors + baseReconcileErrors
    const summary: PaymentMaintenanceSummary = {
      runId,
      startedAt,
      completedAt,
      skipped: false,
      sweep,
      candidatesScanned: sweep.scanned,
      expired: sweep.expired,
      canceledReconciled,
      incomplete: sweep.incomplete,
      transactionSnapshotsReconciled: reconciled,
      skippedSubmittedEvidence: sweep.skippedSubmittedEvidence,
      skippedTerminal: sweep.skippedTerminal,
      failures,
      watcherCandidates: watchable.length,
      watcherChecks,
      watcherErrors,
      reconciled,
      reconcileErrors,
      lightningCandidates: lightningCandidates.length,
      lightningReconciled,
      lightningErrors,
      feeSettlementCandidates: feeSettlementCandidates.length,
      feeSettlementReconciled,
      feeSettlementErrors,
      baseReconcileCandidates: baseReconcileCandidates.length,
      baseReconciled,
      baseReconcileErrors
    }
    console.info("[payment-maintenance] run completed", summary)
    return summary
  } finally {
    lease.running = false
  }
}

export function resetPaymentMaintenanceLeaseForTests(): void {
  globalWithMaintenance.__pinetreePaymentMaintenanceLease = {
    lastStartedAt: 0,
    running: false
  }
}

export function resetRpc429CooldownForTests(): void {
  globalWithRpcCooldown.__pinetreeEvmRpc429Cooldown = { until: 0, consecutive429s: 0 }
}
