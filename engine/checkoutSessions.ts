import { createCheckoutLinkEngine } from "./checkoutLinks"
import type { CheckoutLinkWithUrl } from "./checkoutLinks"
import { deliverWebhook, type WebhookPaymentData } from "./webhookDelivery"

export type CreateCheckoutSessionInput = {
  merchantId: string
  amount: number
  currency?: string
  orderId?: string
  customerEmail?: string
  description?: string
  successUrl?: string
  cancelUrl?: string
  metadata?: Record<string, unknown>
}

export type CheckoutSession = {
  sessionId: string
  token: string
  checkoutUrl: string
  amount: number
  currency: string
  status: "active"
  expiresAt: string | null
}

function validateUrl(url: string, field: string): void {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error(`${field} must be an http or https URL`)
    }
  } catch {
    throw new Error(`${field} must be a valid URL`)
  }
}

export async function createCheckoutSessionEngine(
  input: CreateCheckoutSessionInput
): Promise<CheckoutSession> {
  const amount = Number(input.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid amount")
  }

  const currency = String(input.currency || "USD").trim().toUpperCase() || "USD"
  const merchantId = String(input.merchantId || "").trim()
  if (!merchantId) throw new Error("Missing merchant ID")

  if (input.successUrl) validateUrl(input.successUrl, "successUrl")
  if (input.cancelUrl) validateUrl(input.cancelUrl, "cancelUrl")

  const sessionMetadata: Record<string, unknown> = {
    channel: "online",
    ...(input.metadata || {}),
  }

  const link: CheckoutLinkWithUrl = await createCheckoutLinkEngine({
    merchantId,
    name: input.orderId ? `Order ${input.orderId}` : `Checkout Session`,
    description: input.description,
    amount,
    currency,
    customerEmail: input.customerEmail,
    reference: input.orderId,
    expiration: "24h",
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    metadata: sessionMetadata,
  })

  // Fire checkout.session.created webhook — fire-and-forget, non-blocking
  const webhookData: WebhookPaymentData = {
    paymentId: link.id,
    merchantId,
    amount,
    currency,
    status: "active",
    reference: input.orderId,
    checkoutLinkId: link.id,
    metadata: sessionMetadata,
  }
  void deliverWebhook(merchantId, "checkout.session.created", webhookData).catch((err) => {
    console.error("[webhook] checkout.session.created delivery failed:", err)
  })

  return {
    sessionId: link.id,
    token: link.public_token,
    checkoutUrl: link.checkoutUrl,
    amount,
    currency,
    status: "active",
    expiresAt: link.expires_at ?? null,
  }
}
