import { getPublicPaymentById } from "@/database/payments"
import { toPublicCheckoutSessionMetadata } from "./checkoutSessionMetadata"
import { mapInternalCheckoutSessionStatus } from "./publicCheckoutSessionStatus"
import { normalizePaymentNetwork } from "@/types/payment"

export type PublicPayment = {
  id: string
  object: "payment"
  status: ReturnType<typeof mapInternalCheckoutSessionStatus>
  amount: number
  currency: string
  network: string | null
  rail: ReturnType<typeof normalizePaymentNetwork>
  reference: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export async function getPublicPayment(
  merchantId: string,
  paymentId: string
): Promise<PublicPayment | null> {
  const payment = await getPublicPaymentById(paymentId, merchantId)
  if (!payment) return null
  const metadata = (payment.metadata || {}) as Record<string, unknown>
  const publicMetadata = toPublicCheckoutSessionMetadata(metadata)
  for (const internalKey of [
    "split",
    "checkoutLinkId",
    "checkoutLinkName",
    "channel",
    "customerEmail",
    "successUrl",
    "cancelUrl",
    "reference",
  ]) {
    delete publicMetadata[internalKey]
  }
  const rail = normalizePaymentNetwork(payment.network)

  return {
    id: payment.id,
    object: "payment" as const,
    status: mapInternalCheckoutSessionStatus(payment.status),
    amount: Number(payment.merchant_amount),
    currency: payment.currency,
    network: payment.network || null,
    rail,
    reference: String(metadata.reference || "").trim() || null,
    metadata: publicMetadata,
    createdAt: payment.created_at,
    updatedAt: payment.updated_at,
  }
}
