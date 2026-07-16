import { getPaymentById } from "@/database"
import {
  getPaymentMaintenanceCandidates,
  getTerminalPaymentMaintenanceCandidates
} from "@/database/paymentMaintenance"
import { getPaymentEvents } from "@/database/paymentEvents"
import { getTransactionByPaymentId } from "@/database/transactions"
import { CHECKOUT_TIMEOUT_MS } from "./config"
import { runPaymentWatcher } from "./checkPaymentOnce"
import { paymentHasProcessingEvidence } from "./paymentEvidence"
import { markPaymentIncomplete } from "./paymentStateActions"
import {
  reconcileTransactionForPayment,
  type TerminalPaymentStatus
} from "./reconcileTransaction"
import { sweepStalePayments, type StalePaymentSweepSummary } from "./stalePaymentSweep"

const DEFAULT_THROTTLE_MS = 60_000
const DEFAULT_WATCHER_TIMEOUT_MS = 4_000

// Multiple pollers (POS terminal, a customer's own browser tab, a merchant
// dashboard refresh) can all ask "is this payment fresh?" for the same
// paymentId within the same few seconds. Without this throttle, each one
// would independently trigger a live blockchain/NWC/provider check via
// runPaymentWatcher - the single most expensive step in this file, and the
// one most likely to hit provider rate limits under load. Single-flight
// (share the in-flight promise) plus a short per-payment cooldown collapses
// concurrent/rapid callers into one real provider check.
const WATCHER_THROTTLE_MS = 3_000

type WatcherThrottleEntry = {
  lastRunAt: number
  inFlight: Promise<boolean> | null
}

type MaintenanceLease = {
  lastStartedAt: number
  running: boolean
}

const globalWithMaintenance = globalThis as typeof globalThis & {
  __pinetreePaymentMaintenanceLease?: MaintenanceLease
  __pinetreePaymentWatcherThrottle?: Map<string, WatcherThrottleEntry>
}

function getMaintenanceLease(): MaintenanceLease {
  globalWithMaintenance.__pinetreePaymentMaintenanceLease ??= {
    lastStartedAt: 0,
    running: false
  }
  return globalWithMaintenance.__pinetreePaymentMaintenanceLease
}

function getWatcherThrottleMap(): Map<string, WatcherThrottleEntry> {
  globalWithMaintenance.__pinetreePaymentWatcherThrottle ??= new Map()
  return globalWithMaintenance.__pinetreePaymentWatcherThrottle
}

/**
 * Runs runPaymentWatcher for a payment, but collapses concurrent callers
 * onto one in-flight request and skips a fresh provider check entirely if
 * one just ran a moment ago - unless bypass is set (an explicit,
 * user-initiated recheck, e.g. a customer submitting a transaction hash,
 * must never be silently throttled).
 */
function runPaymentWatcherThrottled(
  paymentId: string,
  watcherOptions: { txHash?: string } | undefined,
  bypassThrottle: boolean
): Promise<boolean> {
  const throttleMap = getWatcherThrottleMap()
  const existing = throttleMap.get(paymentId)

  if (existing?.inFlight) {
    return existing.inFlight
  }

  if (!bypassThrottle && existing && Date.now() - existing.lastRunAt < WATCHER_THROTTLE_MS) {
    return Promise.resolve(false)
  }

  const run = runPaymentWatcher(paymentId, watcherOptions).finally(() => {
    const entry = throttleMap.get(paymentId)
    if (entry) {
      entry.lastRunAt = Date.now()
      entry.inFlight = null
    }
  })

  throttleMap.set(paymentId, { lastRunAt: existing?.lastRunAt ?? 0, inFlight: run })
  return run
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
  options?: { txHash?: string; forceWatcher?: boolean }
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
    const watcherOptions = options?.txHash ? { txHash: options.txHash } : undefined
    // An explicit forceWatcher call or a freshly-submitted txHash is a
    // deliberate, user-driven recheck request - never throttle those.
    const bypassThrottle = Boolean(options?.forceWatcher || options?.txHash)
    const detected = await runPaymentWatcherThrottled(paymentId, watcherOptions, bypassThrottle)
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
    reconcileErrors: 0
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
    const watchable: string[] = []

    for (const payment of candidates) {
      const status = String(payment.status || "").toUpperCase()
      if (status === "PROCESSING") {
        watchable.push(payment.id)
      } else if (status === "PENDING") {
        const [transaction, events] = await Promise.all([
          getTransactionByPaymentId(payment.id),
          getPaymentEvents(payment.id).catch(() => [])
        ])
        if (paymentHasProcessingEvidence({ payment, transaction, events })) {
          watchable.push(payment.id)
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
    await Promise.all(watchable.map(async (paymentId) => {
      try {
        await runWatcherWithTimeout(paymentId, watcherTimeoutMs)
        watcherChecks += 1
      } catch (error) {
        watcherErrors += 1
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

    const completedAt = new Date(options?.now ?? Date.now()).toISOString()
    const failures = sweep.failures + watcherErrors + reconcileErrors
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
      reconcileErrors
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
  globalWithMaintenance.__pinetreePaymentWatcherThrottle = new Map()
}
