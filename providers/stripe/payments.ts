import type { PaymentStatus } from "@/types/provider"
import { StripeClient } from "./client"
import type {
  StripeCreatePaymentInput,
  StripeNormalizedPayment,
  StripePaymentIntentRequest
} from "./types"

export function stripeAmountToMinorUnits(amount: number): number {
  const value = Number(amount)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Invalid Stripe payment amount")
  }
  return Math.round(value * 100)
}

export function normalizeStripePaymentStatus(status?: string): PaymentStatus {
  switch (String(status || "").toLowerCase().trim()) {
    case "requires_payment_method":
    case "requires_confirmation":
      return "PENDING"
    case "requires_action":
    case "processing":
    case "requires_capture":
      return "PROCESSING"
    case "succeeded":
      return "CONFIRMED"
    case "canceled":
      return "INCOMPLETE"
    default:
      console.warn("[stripe] unknown payment status", { providerStatus: status || null })
      return "UNKNOWN"
  }
}

export function buildStripePaymentIntentRequest(
  input: StripeCreatePaymentInput
): StripePaymentIntentRequest {
  const paymentId = String(input.paymentId || "").trim()
  const merchantId = String(input.merchantId || "").trim()
  if (!paymentId) throw new Error("Missing PineTree payment id")
  if (!merchantId) throw new Error("Missing PineTree merchant id")

  return {
    amount: stripeAmountToMinorUnits(input.grossAmount),
    currency: String(input.currency || "usd").trim().toLowerCase() || "usd",
    automatic_payment_methods: {
      enabled: true
    },
    metadata: {
      paymentId,
      pinetree_payment_id: paymentId,
      merchantId,
      pinetree_merchant_id: merchantId,
      provider: "stripe",
      network: "stripe"
    }
  }
}

export async function createPayment(
  input: StripeCreatePaymentInput
): Promise<StripeNormalizedPayment> {
  const client = new StripeClient({ secretKey: input.providerApiKey || undefined })
  const request = buildStripePaymentIntentRequest(input)
  const connectedAccountId = String(input.stripeConnectedAccountId || "").trim()
  if (!connectedAccountId) throw new Error("Stripe connected account not configured")
  const response = await client.createPaymentIntent(request, input.paymentId, connectedAccountId)

  return {
    provider: "stripe",
    providerReference: response.id,
    clientSecret: response.client_secret || undefined,
    amount: Number(response.amount ?? request.amount),
    currency: String(response.currency || request.currency).toLowerCase(),
    status: normalizeStripePaymentStatus(response.status),
    feeCaptureMethod: "collection_then_settle",
    raw: response
  }
}
