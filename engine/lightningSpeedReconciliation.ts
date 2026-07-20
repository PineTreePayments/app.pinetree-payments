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
