import {
  getCheckoutLinkById,
  updateActiveCheckoutLinkLifecycle,
} from "@/database/checkoutLinks"
import {
  CHECKOUT_SESSION_LIFECYCLE_METADATA_KEY,
  type CheckoutSessionLifecycle,
} from "./checkoutSessionMetadata"
import {
  getPublicCheckoutSession,
  type PublicCheckoutSession,
} from "./publicCheckoutSessions"
import { deliverV1CheckoutSessionWebhook } from "./webhookDelivery"

export class CheckoutSessionLifecycleError extends Error {
  constructor(
    readonly reason: "not_found" | "not_open",
    message: string
  ) {
    super(message)
    this.name = "CheckoutSessionLifecycleError"
  }
}

export async function transitionCheckoutSessionLifecycle(input: {
  merchantId: string
  sessionId: string
  lifecycle: CheckoutSessionLifecycle
}): Promise<PublicCheckoutSession> {
  const current = await getPublicCheckoutSession(input.merchantId, input.sessionId)
  if (!current) {
    throw new CheckoutSessionLifecycleError("not_found", "Checkout session not found.")
  }
  if (current.status !== "open") {
    throw new CheckoutSessionLifecycleError(
      "not_open",
      `Checkout session is ${current.status} and cannot be ${input.lifecycle}.`
    )
  }

  const link = await getCheckoutLinkById(input.sessionId, input.merchantId)
  if (!link) {
    throw new CheckoutSessionLifecycleError("not_found", "Checkout session not found.")
  }

  const metadata = {
    ...((link.link_metadata || {}) as Record<string, unknown>),
    [CHECKOUT_SESSION_LIFECYCLE_METADATA_KEY]: input.lifecycle,
  }
  const updated = await updateActiveCheckoutLinkLifecycle(
    input.sessionId,
    input.merchantId,
    {
      metadata,
      ...(input.lifecycle === "expired" ? { expiresAt: new Date().toISOString() } : {}),
    }
  )
  if (!updated) {
    throw new CheckoutSessionLifecycleError(
      "not_open",
      `Checkout session is no longer open and cannot be ${input.lifecycle}.`
    )
  }

  const result = await getPublicCheckoutSession(input.merchantId, input.sessionId)
  if (!result) {
    throw new CheckoutSessionLifecycleError("not_found", "Checkout session not found.")
  }
  const event = input.lifecycle === "canceled"
    ? "checkout.session.canceled"
    : "checkout.session.expired"
  void deliverV1CheckoutSessionWebhook(input.merchantId, event, result).catch((error) => {
    console.error("[webhook] v1 checkout lifecycle delivery failed:", error)
  })
  return result
}
