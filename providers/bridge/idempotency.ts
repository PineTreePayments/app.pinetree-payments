/**
 * Bridge (by Stripe) - deterministic idempotency keys.
 *
 * Bridge requires an `Idempotency-Key` on every mutating request. PineTree
 * derives the key DETERMINISTICALLY from the merchant plus an onboarding
 * version, never randomly and never from client input.
 *
 * That determinism is the mechanism that prevents duplicate Bridge customers:
 * a merchant who abandons onboarding, times out, or clicks "Start" twice
 * re-sends the identical key, and Bridge returns the original object instead
 * of creating a second one. A random key here would silently create a second
 * KYB record for the same business.
 *
 * The onboarding version is bumped ONLY when a genuinely new Bridge object is
 * intended (for example, if Bridge instructs PineTree to re-onboard a merchant
 * after an offboarding).
 */

import { createHash } from "node:crypto"

/** Current PineTree Bridge onboarding contract version. */
export const BRIDGE_ONBOARDING_VERSION = "v1" as const

/** Namespace prefix so a Bridge key can never collide with another provider's. */
const BRIDGE_IDEMPOTENCY_NAMESPACE = "pinetree.bridge" as const

/**
 * Hash the merchant identifier rather than embedding it.
 *
 * The key travels to a third party in a header, so it must not carry a
 * PineTree internal identifier verbatim. The hash is stable, which is all
 * idempotency requires.
 */
function stableDigest(...parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32)
}

/**
 * The idempotency key for creating a merchant's Bridge KYC link / customer.
 *
 * Stable for a given (merchant, version) pair for the lifetime of that
 * onboarding.
 */
export function bridgeOnboardingIdempotencyKey(input: {
  merchantId: string
  version?: string
}): string {
  const merchantId = String(input.merchantId || "").trim()
  if (!merchantId) {
    throw new Error("A merchant id is required to derive a Bridge idempotency key.")
  }
  const version = String(input.version || BRIDGE_ONBOARDING_VERSION).trim() || BRIDGE_ONBOARDING_VERSION
  return `${BRIDGE_IDEMPOTENCY_NAMESPACE}.onboarding.${version}.${stableDigest(merchantId, version)}`
}

/**
 * The idempotency key for registering a Bridge webhook endpoint.
 *
 * Keyed on the endpoint URL so re-running operator setup against the same URL
 * cannot register a duplicate endpoint.
 */
export function bridgeWebhookIdempotencyKey(input: { url: string; version?: string }): string {
  const url = String(input.url || "").trim()
  if (!url) {
    throw new Error("A webhook URL is required to derive a Bridge idempotency key.")
  }
  const version = String(input.version || BRIDGE_ONBOARDING_VERSION).trim() || BRIDGE_ONBOARDING_VERSION
  return `${BRIDGE_IDEMPOTENCY_NAMESPACE}.webhook.${version}.${stableDigest(url, version)}`
}
