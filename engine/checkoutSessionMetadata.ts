import { normalizePaymentNetwork, type PaymentNetwork } from "@/types/payment"

export const CHECKOUT_SESSION_RAILS_METADATA_KEY = "_pinetree_requested_rails"
export const CHECKOUT_SESSION_IDEMPOTENCY_METADATA_KEY = "idempotency_hash"
export const CHECKOUT_SESSION_IDEMPOTENCY_BODY_HASH_METADATA_KEY =
  "_pinetree_idempotency_body_hash"
export const CHECKOUT_SESSION_LIFECYCLE_METADATA_KEY = "_pinetree_session_lifecycle"

export type CheckoutSessionLifecycle = "canceled" | "expired"

export function normalizeCheckoutSessionRails(input: unknown): PaymentNetwork[] | undefined {
  if (input === undefined) return undefined
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("rails must be a non-empty array")
  }

  const rails = input.map((value) => normalizePaymentNetwork(String(value)))
  if (rails.some((rail) => rail === null)) {
    throw new Error("rails contains an unsupported payment rail")
  }

  return [...new Set(rails as PaymentNetwork[])]
}

export function getRequestedCheckoutSessionRails(
  metadata: Record<string, unknown> | null | undefined
): PaymentNetwork[] | undefined {
  const raw = metadata?.[CHECKOUT_SESSION_RAILS_METADATA_KEY]
  if (!Array.isArray(raw)) return undefined

  const rails = raw
    .map((value) => normalizePaymentNetwork(String(value)))
    .filter((value): value is PaymentNetwork => value !== null)

  return rails.length ? [...new Set(rails)] : undefined
}

export function toPublicCheckoutSessionMetadata(
  metadata: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const result = { ...(metadata || {}) }
  delete result[CHECKOUT_SESSION_RAILS_METADATA_KEY]
  delete result[CHECKOUT_SESSION_IDEMPOTENCY_METADATA_KEY]
  delete result[CHECKOUT_SESSION_IDEMPOTENCY_BODY_HASH_METADATA_KEY]
  delete result[CHECKOUT_SESSION_LIFECYCLE_METADATA_KEY]
  return result
}

export function getCheckoutSessionLifecycle(
  metadata: Record<string, unknown> | null | undefined
): CheckoutSessionLifecycle | null {
  const value = metadata?.[CHECKOUT_SESSION_LIFECYCLE_METADATA_KEY]
  return value === "canceled" || value === "expired" ? value : null
}
