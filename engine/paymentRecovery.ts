import { getPaymentById } from "@/database"
import type { Payment } from "@/database/payments"
import { updatePaymentMetadata } from "@/database/payments"
import { getProvider } from "@/providers/registry"
import type { PaymentStatus as ProviderPaymentStatus } from "@/types/provider"
import { loadProviders } from "./loadProviders"
import { runPaymentWatcher } from "./checkPaymentOnce"
import { advancePaymentToTargetStatus } from "./eventProcessor"
import { reconcileSpeedLightningPayment } from "./lightningSpeedReconciliation"
import { normalizeToStrictPaymentStatus, type PaymentStatus } from "./paymentStateMachine"
import { updatePaymentStatus } from "./updatePaymentStatus"
import { SPEED_PROVIDER_NAME } from "@/database/merchantProviders"
import { isPaymentRecoverySchemaReady } from "@/database/paymentMaintenance"
import { getLatestEvmWatcherTransactionHash } from "@/database/paymentEvents"

const DEFAULT_MAX_LOOKUP_FAILURES = 5
const DEFAULT_MAX_PROCESSING_AGE_MS = 24 * 60 * 60_000
const PRIOR_WATCHER_EVIDENCE_GRACE_MS = 5 * 60_000
const SPEED_PROVIDER_ALIASES = new Set([SPEED_PROVIDER_NAME, "speed", "tryspeed"])
const NWC_PROVIDER_ALIASES = new Set(["lightning_nwc", "nwc", "lightning"])

const CANONICAL_TERMINAL_STATUSES = new Set<PaymentStatus>([
  "CONFIRMED",
  "FAILED",
  "EXPIRED",
  "CANCELED",
  "INCOMPLETE",
])

type RecoveryMetadata = {
  firstObservedAt?: string
  lastCheckedAt?: string
  attemptCount?: number
  consecutiveLookupFailures?: number
  lastOutcome?: string
  lastReason?: string
  lastProviderStatus?: string | null
  investigationRequired?: boolean
  lastError?: string | null
}

export type PaymentRecoveryResult = {
  paymentId: string
  checked: boolean
  previousStatus: string
  status: string
  action:
    | "none"
    | "provider_recheck"
    | "watcher_recheck"
    | "transitioned"
    | "marked_unknown"
    | "skipped"
  reason: string
  providerStatus?: string
  detected?: boolean
  consecutiveLookupFailures?: number
}

export type PaymentRecoveryOptions = {
  txHash?: string
  maxAttempts?: number
  sessionAttemptId?: string
  maxLookupFailures?: number
  maxProcessingAgeMs?: number
  now?: number
}

function recoveryLog(
  level: "info" | "warn" | "error",
  payload: Record<string, unknown>
): void {
  console[level]("[payment-recovery]", {
    component: "payment_recovery",
    timestamp: new Date().toISOString(),
    ...payload,
  })
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function recoveryMetadata(payment: Pick<Payment, "metadata">): RecoveryMetadata {
  const root = metadataRecord(payment.metadata)
  return metadataRecord(root.paymentRecovery) as RecoveryMetadata
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : fallback
}

function paymentAgeMs(payment: Pick<Payment, "created_at">, now: number): number {
  const createdAt = Date.parse(String(payment.created_at || ""))
  return Number.isFinite(createdAt) ? Math.max(0, now - createdAt) : 0
}

export function usesNativePaymentWatcher(payment: Pick<Payment, "provider" | "network">): boolean {
  const provider = String(payment.provider || "").trim().toLowerCase()
  const network = String(payment.network || "").trim().toLowerCase()
  return (
    ((network === "base" || network === "ethereum") &&
      (!provider || provider === "base" || provider === "base_pay")) ||
    (network === "solana" && (!provider || provider === "solana"))
  )
}

async function recordRecoveryMetadata(
  payment: Pick<Payment, "id" | "metadata" | "created_at">,
  patch: Partial<RecoveryMetadata>,
  now: number,
  incrementAttempt = true
): Promise<RecoveryMetadata> {
  const existing = recoveryMetadata(payment)
  const next: RecoveryMetadata = {
    ...existing,
    firstObservedAt:
      existing.firstObservedAt || String(payment.created_at || "").trim() || new Date(now).toISOString(),
    lastCheckedAt: new Date(now).toISOString(),
    attemptCount: Number(existing.attemptCount || 0) + (incrementAttempt ? 1 : 0),
    ...patch,
  }
  try {
    await updatePaymentMetadata(payment.id, { paymentRecovery: next })
  } catch (error) {
    // Recovery audit metadata is diagnostic. Never let an audit-write outage
    // prevent already-retrieved provider/network evidence from advancing the
    // canonical payment status.
    recoveryLog("warn", {
      event: "payment_recovery_audit_write_failed",
      action: "retry_scheduled",
      reason: "recovery_metadata_write_failed",
      paymentId: payment.id,
      error: safeError(error),
    })
  }
  return next
}

async function markRecoveryUnknown(input: {
  payment: Payment
  reason: string
  error?: string
  providerStatus?: string
  now: number
  consecutiveLookupFailures?: number
  attemptAlreadyRecorded?: boolean
}): Promise<PaymentRecoveryResult> {
  const current = normalizeToStrictPaymentStatus(input.payment.status)
  await recordRecoveryMetadata(input.payment, {
    lastOutcome: "investigation_required",
    lastReason: input.reason,
    lastProviderStatus: input.providerStatus || null,
    lastError: input.error || null,
    investigationRequired: true,
    ...(typeof input.consecutiveLookupFailures === "number"
      ? { consecutiveLookupFailures: input.consecutiveLookupFailures }
      : {}),
  }, input.now, !input.attemptAlreadyRecorded)

  if (current !== "UNKNOWN") {
    try {
      await updatePaymentStatus(input.payment.id, "UNKNOWN", {
        providerEvent: `payment_recovery.${input.reason}`,
        rawPayload: {
          recoveryException: true,
          reason: input.reason,
          providerStatus: input.providerStatus || null,
          error: input.error || null,
          consecutiveLookupFailures: input.consecutiveLookupFailures ?? null,
        },
      })
    } catch (error) {
      recoveryLog("error", {
        event: "payment_recovery_skipped",
        action: "transition_rejected",
        reason: "unknown_transition_rejected",
        paymentId: input.payment.id,
        provider: input.payment.provider,
        network: input.payment.network || null,
        previousStatus: current,
        targetStatus: "UNKNOWN",
        error: safeError(error),
      })
      throw error
    }
  }

  recoveryLog("warn", {
    event: "payment_recovery_exception",
    action: current === "UNKNOWN" ? "unknown_retained" : "marked_unknown",
    reason: input.reason,
    paymentId: input.payment.id,
    provider: input.payment.provider,
    network: input.payment.network || null,
    previousStatus: current,
    providerStatus: input.providerStatus || null,
    consecutiveLookupFailures: input.consecutiveLookupFailures ?? null,
    error: input.error || null,
  })

  return {
    paymentId: input.payment.id,
    checked: false,
    previousStatus: current,
    status: "UNKNOWN",
    action: "marked_unknown",
    reason: input.reason,
    providerStatus: input.providerStatus,
    consecutiveLookupFailures: input.consecutiveLookupFailures,
  }
}

async function resolveAuthorityStatus(
  payment: Payment,
  options: PaymentRecoveryOptions
): Promise<{
  status: ProviderPaymentStatus
  detected?: boolean
  source: "watcher" | "provider"
  exceptionReason?: string
}> {
  const provider = String(payment.provider || "").trim().toLowerCase()

  if (SPEED_PROVIDER_ALIASES.has(provider)) {
    const result = await reconcileSpeedLightningPayment(payment)
    if (result.speedStatus === "stale_reference" || !result.checked) {
      throw new Error(result.speedStatus === "stale_reference"
        ? "provider_reference_not_resolvable"
        : "speed_payment_not_checked")
    }
    const refreshed = await getPaymentById(payment.id)
    return {
      status: String(refreshed?.status || result.status || "UNKNOWN").toUpperCase() as ProviderPaymentStatus,
      detected: result.detected,
      source: "provider",
    }
  }

  if (usesNativePaymentWatcher(payment) || NWC_PROVIDER_ALIASES.has(provider)) {
    let authoritativeTxHash = String(options.txHash || "").trim() || undefined
    let priorWatcherEvidenceFound = false
    const network = String(payment.network || "").trim().toLowerCase()
    if (!authoritativeTxHash && (network === "base" || network === "ethereum")) {
      try {
        authoritativeTxHash = await getLatestEvmWatcherTransactionHash(payment.id) || undefined
        if (authoritativeTxHash) {
          priorWatcherEvidenceFound = true
          recoveryLog("info", {
            event: "payment_recovery_evidence_reused",
            action: "watcher_receipt_recheck",
            reason: "prior_watcher_transaction_hash_found",
            paymentId: payment.id,
            provider: payment.provider,
            network: payment.network || null,
          })
        }
      } catch (error) {
        recoveryLog("warn", {
          event: "payment_recovery_skipped",
          action: "fallback_scheduled",
          reason: "prior_watcher_evidence_lookup_failed",
          paymentId: payment.id,
          provider: payment.provider,
          network: payment.network || null,
          error: safeError(error),
        })
      }
    }
    const watcherOptions = authoritativeTxHash
      ? {
          txHash: authoritativeTxHash,
          maxAttempts: options.maxAttempts ?? 1,
          sessionAttemptId: options.sessionAttemptId,
        }
      : undefined
    const detected = await runPaymentWatcher(payment.id, watcherOptions)
    const refreshed = await getPaymentById(payment.id)
    const refreshedStatus = String(refreshed?.status || payment.status).toUpperCase() as ProviderPaymentStatus
    if (
      priorWatcherEvidenceFound &&
      !detected &&
      !CANONICAL_TERMINAL_STATUSES.has(refreshedStatus as PaymentStatus) &&
      paymentAgeMs(payment, options.now ?? Date.now()) >= PRIOR_WATCHER_EVIDENCE_GRACE_MS
    ) {
      recoveryLog("warn", {
        event: "payment_recovery_exception",
        action: "investigation_required",
        reason: "prior_watcher_evidence_rejected",
        paymentId: payment.id,
        provider: payment.provider,
        network: payment.network || null,
        previousStatus: payment.status,
      })
      return {
        status: "UNKNOWN",
        detected,
        source: "watcher",
        exceptionReason: "prior_watcher_evidence_rejected",
      }
    }
    return {
      status: refreshedStatus,
      detected,
      source: "watcher",
    }
  }

  const providerReference = String(payment.provider_reference || "").trim()
  if (!providerReference) throw new Error("missing_provider_reference")

  await loadProviders()
  const adapter = getProvider(provider)
  if (!adapter.getPaymentStatus) throw new Error("provider_status_lookup_not_implemented")
  const result = await adapter.getPaymentStatus(providerReference, payment.merchant_id)
  return {
    status: String(result.status || "UNKNOWN").toUpperCase() as ProviderPaymentStatus,
    source: "provider",
  }
}

export async function recoverPayment(
  paymentOrId: Payment | string,
  options: PaymentRecoveryOptions = {}
): Promise<PaymentRecoveryResult> {
  const payment = typeof paymentOrId === "string"
    ? await getPaymentById(paymentOrId)
    : paymentOrId

  if (!payment) {
    recoveryLog("warn", {
      event: "payment_recovery_skipped",
      action: "skipped",
      reason: "payment_not_found",
      paymentId: typeof paymentOrId === "string" ? paymentOrId : paymentOrId.id,
    })
    return {
      paymentId: typeof paymentOrId === "string" ? paymentOrId : paymentOrId.id,
      checked: false,
      previousStatus: "NOT_FOUND",
      status: "NOT_FOUND",
      action: "skipped",
      reason: "payment_not_found",
    }
  }

  const previousStatus = normalizeToStrictPaymentStatus(payment.status)
  if (CANONICAL_TERMINAL_STATUSES.has(previousStatus)) {
    recoveryLog("info", {
      event: "payment_recovery_skipped",
      action: "skipped",
      reason: "canonical_terminal_status",
      paymentId: payment.id,
      provider: payment.provider,
      network: payment.network || null,
      previousStatus,
    })
    return {
      paymentId: payment.id,
      checked: false,
      previousStatus,
      status: previousStatus,
      action: "skipped",
      reason: "canonical_terminal_status",
    }
  }

  try {
    if (!await isPaymentRecoverySchemaReady()) {
      recoveryLog("warn", {
        event: "payment_recovery_skipped",
        action: "retry_scheduled",
        reason: "recovery_schema_not_ready",
        paymentId: payment.id,
        provider: payment.provider,
        network: payment.network || null,
        previousStatus,
      })
      return {
        paymentId: payment.id,
        checked: false,
        previousStatus,
        status: previousStatus,
        action: "skipped",
        reason: "recovery_schema_not_ready",
      }
    }
  } catch (error) {
    recoveryLog("warn", {
      event: "payment_recovery_skipped",
      action: "retry_scheduled",
      reason: "recovery_schema_check_failed",
      paymentId: payment.id,
      provider: payment.provider,
      network: payment.network || null,
      previousStatus,
      error: safeError(error),
    })
    return {
      paymentId: payment.id,
      checked: false,
      previousStatus,
      status: previousStatus,
      action: "skipped",
      reason: "recovery_schema_check_failed",
    }
  }

  const now = options.now ?? Date.now()
  const maxLookupFailures = positiveInteger(options.maxLookupFailures, DEFAULT_MAX_LOOKUP_FAILURES)
  const maxProcessingAgeMs = positiveInteger(options.maxProcessingAgeMs, DEFAULT_MAX_PROCESSING_AGE_MS)
  const existingRecovery = recoveryMetadata(payment)
  const normalizedProvider = String(payment.provider || "").trim().toLowerCase()
  const providerReferencePresent = Boolean(String(payment.provider_reference || "").trim())
  const split = metadataRecord(metadataRecord(payment.metadata).split)
  const nwcReferencePresent = providerReferencePresent || Boolean(
    String(split.lightningPaymentHash || "").trim()
  )

  if (
    (!providerReferencePresent && !usesNativePaymentWatcher(payment) &&
      !NWC_PROVIDER_ALIASES.has(normalizedProvider)) ||
    (NWC_PROVIDER_ALIASES.has(normalizedProvider) && !nwcReferencePresent)
  ) {
    return markRecoveryUnknown({ payment, reason: "missing_provider_reference", now })
  }

  let authority: Awaited<ReturnType<typeof resolveAuthorityStatus>>
  try {
    authority = await resolveAuthorityStatus(payment, options)
  } catch (error) {
    const failureCount = Number(existingRecovery.consecutiveLookupFailures || 0) + 1
    const message = safeError(error)
    recoveryLog(failureCount >= maxLookupFailures ? "error" : "warn", {
      event: "payment_recovery_skipped",
      action: failureCount >= maxLookupFailures ? "retry_limit_reached" : "retry_scheduled",
      reason: failureCount >= maxLookupFailures
        ? "lookup_retry_limit_reached"
        : "provider_lookup_failed",
      paymentId: payment.id,
      provider: payment.provider,
      network: payment.network || null,
      previousStatus,
      providerReferencePresent: Boolean(String(payment.provider_reference || "").trim()),
      consecutiveLookupFailures: failureCount,
      maxLookupFailures,
      error: message,
    })

    if (failureCount >= maxLookupFailures) {
      return markRecoveryUnknown({
        payment,
        reason: "lookup_retry_limit_reached",
        error: message,
        now,
        consecutiveLookupFailures: failureCount,
      })
    }

    await recordRecoveryMetadata(payment, {
      consecutiveLookupFailures: failureCount,
      lastOutcome: "lookup_failure",
      lastReason: "provider_lookup_failed",
      lastError: message,
      investigationRequired: false,
    }, now)

    return {
      paymentId: payment.id,
      checked: false,
      previousStatus,
      status: previousStatus,
      action: "skipped",
      reason: "provider_lookup_failed",
      consecutiveLookupFailures: failureCount,
    }
  }

  const providerStatus = String(authority.status || "UNKNOWN").toUpperCase()
  if (providerStatus === "UNKNOWN") {
    return markRecoveryUnknown({
      payment,
      reason: authority.exceptionReason || "provider_returned_unknown",
      providerStatus,
      now,
    })
  }

  if (providerStatus === "REFUNDED") {
    return markRecoveryUnknown({
      payment,
      reason: "provider_status_requires_investigation",
      providerStatus,
      now,
    })
  }

  const overProcessingLimit =
    (providerStatus === "PROCESSING" ||
      (previousStatus === "PROCESSING" && (providerStatus === "PENDING" || providerStatus === "CREATED"))) &&
    paymentAgeMs(payment, now) >= maxProcessingAgeMs

  if (overProcessingLimit) {
    return markRecoveryUnknown({
      payment,
      reason: "processing_age_limit_reached",
      providerStatus,
      now,
    })
  }

  await recordRecoveryMetadata(payment, {
    consecutiveLookupFailures: 0,
    lastOutcome: "authority_status_received",
    lastReason: "provider_or_network_status_received",
    lastProviderStatus: providerStatus,
    lastError: null,
    investigationRequired: previousStatus === "UNKNOWN",
  }, now)

  const target = providerStatus as PaymentStatus
  if (previousStatus === "UNKNOWN" && !CANONICAL_TERMINAL_STATUSES.has(target)) {
    recoveryLog("info", {
      event: "payment_recovery_checked",
      action: "unknown_retained",
      reason: "authority_still_non_terminal",
      paymentId: payment.id,
      provider: payment.provider,
      network: payment.network || null,
      previousStatus,
      providerStatus,
    })
    return {
      paymentId: payment.id,
      checked: true,
      previousStatus,
      status: previousStatus,
      action: authority.source === "watcher" ? "watcher_recheck" : "provider_recheck",
      reason: "authority_still_non_terminal",
      providerStatus,
      detected: authority.detected,
    }
  }

  if (target === previousStatus || (previousStatus === "PROCESSING" && (target === "PENDING" || target === "CREATED"))) {
    recoveryLog("info", {
      event: "payment_recovery_checked",
      action: authority.source === "watcher" ? "watcher_recheck" : "provider_recheck",
      reason: target === previousStatus ? "status_unchanged" : "provider_status_regression_ignored",
      paymentId: payment.id,
      provider: payment.provider,
      network: payment.network || null,
      previousStatus,
      providerStatus,
      detected: authority.detected ?? null,
    })
    return {
      paymentId: payment.id,
      checked: true,
      previousStatus,
      status: previousStatus,
      action: authority.source === "watcher" ? "watcher_recheck" : "provider_recheck",
      reason: target === previousStatus ? "status_unchanged" : "provider_status_regression_ignored",
      providerStatus,
      detected: authority.detected,
    }
  }

  try {
    await advancePaymentToTargetStatus(payment.id, target, {
      providerEvent: `payment_recovery.provider_status.${providerStatus.toLowerCase()}`,
      rawPayload: {
        providerStatusEvidence: true,
        failureEvidence: target === "FAILED",
        providerStatus,
        providerReference: payment.provider_reference || null,
        recoverySource: authority.source,
      },
    })
  } catch (error) {
    const message = safeError(error)
    recoveryLog("error", {
      event: "payment_recovery_skipped",
      action: "transition_rejected",
      reason: "engine_transition_rejected",
      paymentId: payment.id,
      provider: payment.provider,
      network: payment.network || null,
      previousStatus,
      targetStatus: target,
      providerStatus,
      error: message,
    })
    return markRecoveryUnknown({
      payment,
      reason: "engine_transition_rejected",
      error: message,
      providerStatus,
      now,
      attemptAlreadyRecorded: true,
    })
  }

  const refreshed = await getPaymentById(payment.id)
  const status = String(refreshed?.status || target).toUpperCase()
  recoveryLog("info", {
    event: "payment_recovery_transitioned",
    action: "transitioned",
    reason: "provider_or_network_evidence_applied",
    paymentId: payment.id,
    provider: payment.provider,
    network: payment.network || null,
    previousStatus,
    providerStatus,
    status,
  })
  return {
    paymentId: payment.id,
    checked: true,
    previousStatus,
    status,
    action: "transitioned",
    reason: "provider_or_network_evidence_applied",
    providerStatus,
    detected: authority.detected,
  }
}
