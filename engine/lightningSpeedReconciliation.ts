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
import { SpeedApiError, isSpeedPaymentPaid } from "@/providers/lightning/speedClient"
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

export async function reconcileSpeedLightningPayment(
  payment: Pick<Payment, "id" | "status" | "provider_reference" | "merchant_id">
): Promise<SpeedLightningReconciliationResult> {
  const paymentId = payment.id
  const currentStatus = String(payment.status || "").toUpperCase()
  if (TERMINAL_STATUSES.has(currentStatus)) {
    return { checked: false, detected: false, speedStatus: "", status: currentStatus }
  }

  const speedPaymentId = String(payment.provider_reference || "").trim()
  if (!speedPaymentId) {
    return { checked: false, detected: false, speedStatus: "", status: currentStatus }
  }

  // A payment whose Speed provider reference has already been confirmed
  // permanently invalid (404 "Invalid payment id") must not be polled again
  // on every maintenance sweep forever - that's a stale/missing reference,
  // not a transient failure. The canonical PineTree payment record is left
  // exactly as-is (untouched status) for support review; only the fact that
  // this reference is stale is recorded so this function can skip the Speed
  // call cheaply next time.
  const fullPayment = await getPaymentById(paymentId)
  const existingMetadata = readMetadataRecord(fullPayment?.metadata)
  if (existingMetadata.speedRetrieveStale === true) {
    console.info("[speed] payment_retrieve_stale_skip", {
      canonicalTransactionId: paymentId,
      speedPaymentId,
      staleSince: existingMetadata.speedRetrieveStaleAt ?? null,
    })
    return { checked: false, detected: false, speedStatus: "stale_reference", status: currentStatus }
  }

  let speedPayment: Awaited<ReturnType<typeof retrieveMerchantSpeedPayment>>
  try {
    speedPayment = await retrieveMerchantSpeedPayment(speedPaymentId, payment.merchant_id)
  } catch (error) {
    if (error instanceof SpeedApiError && error.status === 404) {
      console.warn("[speed] payment_retrieve_permanently_stale", {
        canonicalTransactionId: paymentId,
        speedPaymentId,
        httpStatus: error.status,
        providerCode: error.providerCode,
        requestId: error.requestId,
        operation: "payment.retrieve",
      })
      await updatePaymentMetadata(paymentId, {
        speedRetrieveStale: true,
        speedRetrieveStaleAt: new Date().toISOString(),
        speedRetrieveStaleReference: speedPaymentId,
      }).catch((metadataError) => {
        console.warn("[speed] payment_retrieve_stale_flag_failed", {
          canonicalTransactionId: paymentId,
          error: metadataError instanceof Error ? metadataError.message : String(metadataError),
        })
      })
      return { checked: true, detected: false, speedStatus: "stale_reference", status: currentStatus }
    }
    throw error
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
    await advancePaymentToTargetStatus(paymentId, "INCOMPLETE", {
      providerEvent: "payment.expired",
      rawPayload: { speedPaymentId, speedStatus }
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
