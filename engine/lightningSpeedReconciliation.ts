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
import { advancePaymentToTargetStatus, processPaymentEvent } from "./eventProcessor"
import { isSpeedPaymentPaid } from "@/providers/lightning/speedClient"
import { retrieveMerchantSpeedPayment } from "@/providers/lightning/speedAdapter"
import { extractBitcoinFeeSettlementInfo } from "@/lib/bitcoin/feeSettlementInfo"

export type SpeedLightningReconciliationResult = {
  checked: boolean
  detected: boolean
  speedStatus: string
  status: string
}

const TERMINAL_STATUSES = new Set(["CONFIRMED", "FAILED", "INCOMPLETE", "EXPIRED", "CANCELED"])

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

  const speedPayment = await retrieveMerchantSpeedPayment(speedPaymentId, payment.merchant_id)
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
    const fullPayment = await getPaymentById(paymentId)
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
