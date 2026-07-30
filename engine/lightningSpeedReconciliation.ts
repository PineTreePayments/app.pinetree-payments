/**
 * Server-side reconciliation for a single non-terminal Speed Lightning
 * payment, independent of any live checkout session. Speed's signed webhook
 * and the customer-facing check route (app/api/payments/[paymentId]/lightning
 * /check/route.ts) both advance a payment while the customer's checkout tab
 * is open; this helper is the shared reconciliation logic both of those call,
 * and is also the entry point engine/checkPaymentOnce.ts and
 * engine/paymentMaintenance.ts use to recover a payment once nobody is
 * polling it anymore (webhook lost, tab closed, customer paid from a
 * different device).
 */
import { getPaymentById } from "@/database"
import type { Payment } from "@/database/payments"
import { updatePaymentMetadata } from "@/database/payments"
import { advancePaymentToTargetStatus, processPaymentEvent } from "./eventProcessor"
import {
  SpeedApiError,
  isSpeedPaymentPaid,
  retrieveSpeedPayment,
  type SpeedPaymentObject,
} from "@/providers/lightning/speedClient"
import { retrieveMerchantSpeedPayment } from "@/providers/lightning/speedAdapter"
import { extractBitcoinFeeSettlementInfo } from "@/lib/bitcoin/feeSettlementInfo"
import { recordSpeedApplicationFeeSettlement } from "./speedFeeSettlement"

export type SpeedLightningReconciliationResult = {
  checked: boolean
  detected: boolean
  speedStatus: string
  status: string
}

const TERMINAL_STATUSES = new Set(["CONFIRMED", "FAILED", "INCOMPLETE", "EXPIRED", "CANCELED"])

function readMetadataRecord(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {}
}

export type SpeedRetrievalScope = "merchant_connected_account" | "legacy_platform"

export type VerifiedSpeedReconciliationEvidence = {
  speedPayment: SpeedPaymentObject
  retrievalScope: SpeedRetrievalScope
}

function readMetadataString(metadata: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = String(metadata[key] || "").trim()
    if (value) return value
  }
  return ""
}

/**
 * An unscoped Speed GET can see platform-owned legacy payments, so it must
 * never be trusted based on the provider ID alone. PineTree has always placed
 * both canonical identities in payment metadata; require both before using a
 * platform-scoped response as lifecycle evidence.
 */
function legacyPlatformPaymentMatchesCanonical(input: {
  speedPayment: SpeedPaymentObject
  speedPaymentId: string
  paymentId: string
  merchantId: string
}): boolean {
  const metadata = readMetadataRecord(input.speedPayment.metadata)
  const canonicalPaymentId = readMetadataString(metadata, "pineTreePaymentId", "payment_id")
  const canonicalMerchantId = readMetadataString(metadata, "merchantId", "merchant_id")
  return (
    String(input.speedPayment.id || "").trim() === input.speedPaymentId &&
    canonicalPaymentId === input.paymentId &&
    canonicalMerchantId === input.merchantId
  )
}

function isSpeedNotFound(error: unknown): error is SpeedApiError {
  return error instanceof SpeedApiError && error.status === 404
}

async function recordUnresolvableSpeedReference(input: {
  paymentId: string
  speedPaymentId: string
  reason:
    | "missing_provider_reference"
    | "not_found_in_connected_or_platform_scope"
    | "platform_identity_mismatch"
}): Promise<void> {
  const checkedAt = new Date().toISOString()
  await updatePaymentMetadata(input.paymentId, {
    speedRetrieveStale: true,
    speedRetrieveStaleAt: checkedAt,
    speedRetrieveStaleReference: input.speedPaymentId,
    speedLegacyPlatformFallbackCheckedAt: checkedAt,
    speedRetrieveStaleReason: input.reason,
  }).catch((metadataError) => {
    console.warn("[speed] payment_retrieve_stale_flag_failed", {
      canonicalTransactionId: input.paymentId,
      error: metadataError instanceof Error ? metadataError.message : String(metadataError),
    })
  })
}

async function retrieveLegacyPlatformPayment(input: {
  paymentId: string
  merchantId: string
  speedPaymentId: string
}): Promise<SpeedPaymentObject | null> {
  let speedPayment: SpeedPaymentObject
  try {
    // Deliberately omit merchantContext. Payments created before connected-
    // account header scoping are owned by PineTree's platform account and are
    // invisible to the merchant-scoped GET.
    speedPayment = await retrieveSpeedPayment(input.speedPaymentId)
  } catch (error) {
    if (!isSpeedNotFound(error)) throw error
    await recordUnresolvableSpeedReference({
      ...input,
      reason: "not_found_in_connected_or_platform_scope",
    })
    return null
  }

  if (!legacyPlatformPaymentMatchesCanonical({ speedPayment, ...input })) {
    console.warn("[speed] legacy_platform_payment_identity_mismatch", {
      canonicalTransactionId: input.paymentId,
      speedPaymentId: input.speedPaymentId,
      providerPaymentIdMatches: String(speedPayment.id || "").trim() === input.speedPaymentId,
    })
    await recordUnresolvableSpeedReference({
      ...input,
      reason: "platform_identity_mismatch",
    })
    return null
  }

  const checkedAt = new Date().toISOString()
  // Persist the retrieval scope before applying lifecycle evidence. If this
  // audit write fails, leave the payment unchanged and retry safely later.
  await updatePaymentMetadata(input.paymentId, {
    speedRetrieveStale: false,
    speedRetrieveScope: "legacy_platform",
    speedLegacyPlatformFallbackCheckedAt: checkedAt,
    speedLegacyPlatformScopeConfirmedAt: checkedAt,
  })
  return speedPayment
}

export async function reconcileSpeedLightningPayment(
  payment: Pick<Payment, "id" | "status" | "provider_reference" | "merchant_id">,
  verifiedEvidence?: VerifiedSpeedReconciliationEvidence
): Promise<SpeedLightningReconciliationResult> {
  const paymentId = payment.id
  const currentStatus = String(payment.status || "").toUpperCase()
  if (TERMINAL_STATUSES.has(currentStatus)) {
    return { checked: false, detected: false, speedStatus: "", status: currentStatus }
  }

  const speedPaymentId = String(payment.provider_reference || "").trim()
  if (!speedPaymentId) {
    // Persist the exception for diagnosis. The shared recovery queue will
    // transition it to UNKNOWN and keep retrying it; it must never be evicted
    // while the canonical payment remains unresolved.
    await recordUnresolvableSpeedReference({
      paymentId,
      speedPaymentId: "",
      reason: "missing_provider_reference",
    })
    return { checked: false, detected: false, speedStatus: "", status: currentStatus }
  }

  // A legacy payment created before Speed connected-account header scoping can
  // be invisible to the merchant-scoped GET while still existing under the
  // PineTree platform account. Existing stale flags select that broader scope,
  // but are never treated as a permanent skip: UNKNOWN rows remain recheckable.
  const fullPayment = await getPaymentById(paymentId)
  const existingMetadata = readMetadataRecord(fullPayment?.metadata)
  const knownLegacyPlatformScope = existingMetadata.speedRetrieveScope === "legacy_platform"
  let speedPayment: Awaited<ReturnType<typeof retrieveMerchantSpeedPayment>>
  let retrievalScope: SpeedRetrievalScope = "merchant_connected_account"
  if (verifiedEvidence) {
    speedPayment = verifiedEvidence.speedPayment
    retrievalScope = verifiedEvidence.retrievalScope
    if (!legacyPlatformPaymentMatchesCanonical({
      speedPayment,
      paymentId,
      merchantId: payment.merchant_id,
      speedPaymentId,
    })) {
      throw new Error("Verified Speed evidence identity mismatch")
    }
    if (retrievalScope === "legacy_platform") {
      const checkedAt = new Date().toISOString()
      // Persist the broader retrieval scope before any lifecycle mutation.
      await updatePaymentMetadata(paymentId, {
        speedRetrieveStale: false,
        speedRetrieveScope: "legacy_platform",
        speedLegacyPlatformFallbackCheckedAt: checkedAt,
        speedLegacyPlatformScopeConfirmedAt: checkedAt,
      })
    }
  } else if (knownLegacyPlatformScope || existingMetadata.speedRetrieveStale === true) {
    const legacyPayment = await retrieveLegacyPlatformPayment({
      paymentId,
      merchantId: payment.merchant_id,
      speedPaymentId,
    })
    if (!legacyPayment) {
      return { checked: true, detected: false, speedStatus: "stale_reference", status: currentStatus }
    }
    speedPayment = legacyPayment
    retrievalScope = "legacy_platform"
  } else {
    try {
      speedPayment = await retrieveMerchantSpeedPayment(speedPaymentId, payment.merchant_id)
    } catch (error) {
      if (!isSpeedNotFound(error)) throw error
      console.warn("[speed] payment_retrieve_permanently_stale", {
        canonicalTransactionId: paymentId,
        speedPaymentId,
        httpStatus: error.status,
        providerCode: error.providerCode,
        requestId: error.requestId,
        operation: "payment.retrieve",
      })
      const legacyPayment = await retrieveLegacyPlatformPayment({
        paymentId,
        merchantId: payment.merchant_id,
        speedPaymentId,
      })
      if (!legacyPayment) {
        return { checked: true, detected: false, speedStatus: "stale_reference", status: currentStatus }
      }
      speedPayment = legacyPayment
      retrievalScope = "legacy_platform"
    }
  }
  const detected = isSpeedPaymentPaid(speedPayment)
  const speedStatus = String(speedPayment.status || "").toLowerCase().trim()

  if (detected) {
    // The payment itself is confirmed by Speed, but that does NOT by itself
    // prove PineTree's platform fee was actually credited to treasury - Speed
    // does not currently expose a documented way to read that back (see
    // docs/environment/bitcoin-fee-settlement.md). Log the fee-settlement
    // bookkeeping this payment was created with so reconciliation state is
    // visible, without ever claiming a credit this code cannot verify.
    // TERMINAL_STATUSES above already makes this a one-time transition per
    // payment - webhook retries/reconciliation re-runs against an
    // already-CONFIRMED payment short-circuit before reaching this branch,
    // so this can never fire twice for the same canonical payment.
    const feeInfo = extractBitcoinFeeSettlementInfo(fullPayment?.metadata)
    console.info("[speed] bitcoin_fee_reconciliation", {
      canonicalTransactionId: paymentId,
      feeUsd: feeInfo.feeUsd,
      feeSats: feeInfo.feeSats,
      feeBtc: feeInfo.feeSats != null ? feeInfo.feeSats / 100_000_000 : null,
      conversionRateUsd: feeInfo.feeConversionRateUsd,
      providerFeeReferencePresent: feeInfo.providerReferencePresent,
      treasuryCreditAmount: null,
      treasuryCreditConfirmed: false,
      reconciliationState: feeInfo.feeSettlementStatus ?? "unknown",
    })
    await processPaymentEvent({ type: "payment.confirmed", paymentId, feeCaptureValidated: true })
    await recordSpeedApplicationFeeSettlement(paymentId, speedPayment.transfers).catch((settlementError) => {
      console.warn("[speed] application_fee_settlement_record_failed", {
        paymentId,
        error: settlementError instanceof Error ? settlementError.message : String(settlementError),
      })
    })
  } else if (speedStatus === "processing" || speedStatus === "settling") {
    await processPaymentEvent({ type: "payment.processing", paymentId })
  } else if (speedStatus === "expired" || speedStatus === "cancelled" || speedStatus === "canceled") {
    const expired = speedStatus === "expired"
    const providerEvent = expired ? "payment.expired" : "payment.canceled"
    await advancePaymentToTargetStatus(paymentId, expired ? "EXPIRED" : "CANCELED", {
      providerEvent,
      rawPayload: { speedPaymentId, speedStatus, speedRetrievalScope: retrievalScope }
    })
  }

  const updatedPayment = await getPaymentById(paymentId)
  return {
    checked: true,
    detected,
    speedStatus: String(speedPayment.status || ""),
    status: String(updatedPayment?.status || payment.status || "").toUpperCase()
  }
}

export type ConfirmedFeeSettlementReconciliationResult = {
  checked: boolean
  feeSettlementStatus: string | null
}

/**
 * Re-verifies platform-fee settlement for a payment whose own status is
 * already CONFIRMED (terminal) - reconcileSpeedLightningPayment above never
 * reaches this payment again once it hits a terminal status, so a
 * connect-split fee that was still "transfer_created"/"missing" at the moment
 * the payment was confirmed (e.g. Speed's payment.confirmed webhook delivered
 * before that specific delivery's transfers[] was fully populated) would
 * otherwise never get a second look. This function ONLY ever re-reads the
 * fee-settlement bookkeeping via recordSpeedApplicationFeeSettlement - it must
 * never call processPaymentEvent/advancePaymentToTargetStatus, since the
 * payment's own status is already correct and terminal.
 */
export async function reconcileConfirmedLightningFeeSettlement(
  payment: Pick<Payment, "id" | "provider_reference" | "merchant_id">
): Promise<ConfirmedFeeSettlementReconciliationResult> {
  const paymentId = payment.id
  const speedPaymentId = String(payment.provider_reference || "").trim()
  if (!speedPaymentId) return { checked: false, feeSettlementStatus: null }

  const fullPayment = await getPaymentById(paymentId)
  const existingMetadata = readMetadataRecord(fullPayment?.metadata)
  if (existingMetadata.speedRetrieveStale === true) {
    return { checked: false, feeSettlementStatus: null }
  }

  let speedPayment: Awaited<ReturnType<typeof retrieveMerchantSpeedPayment>>
  try {
    speedPayment = await retrieveMerchantSpeedPayment(speedPaymentId, payment.merchant_id)
  } catch (error) {
    if (error instanceof SpeedApiError && error.status === 404) {
      console.warn("[speed] fee_settlement_recheck_payment_retrieve_permanently_stale", {
        canonicalTransactionId: paymentId,
        speedPaymentId,
        httpStatus: error.status,
      })
      await updatePaymentMetadata(paymentId, {
        speedRetrieveStale: true,
        speedRetrieveStaleAt: new Date().toISOString(),
        speedRetrieveStaleReference: speedPaymentId,
      }).catch(() => undefined)
      return { checked: true, feeSettlementStatus: null }
    }
    throw error
  }

  await recordSpeedApplicationFeeSettlement(paymentId, speedPayment.transfers)
  const updatedPayment = await getPaymentById(paymentId)
  const feeInfo = extractBitcoinFeeSettlementInfo(updatedPayment?.metadata)
  console.info("[speed] fee_settlement_recheck_completed", {
    canonicalTransactionId: paymentId,
    feeSettlementStatus: feeInfo.feeSettlementStatus,
    applicationFeeTransferIdPresent: Boolean(feeInfo.applicationFeeTransferId),
  })
  return { checked: true, feeSettlementStatus: feeInfo.feeSettlementStatus }
}
