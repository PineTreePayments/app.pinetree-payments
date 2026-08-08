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
 * The idempotency key for creating a merchant's Bridge business CUSTOMER.
 *
 * Deliberately distinct from the KYC-link key: they create different Bridge
 * objects, and sharing a key across two operations would make Bridge return the
 * wrong cached response for one of them.
 */
export function bridgeCustomerIdempotencyKey(input: {
  merchantId: string
  version?: string
}): string {
  const merchantId = String(input.merchantId || "").trim()
  if (!merchantId) {
    throw new Error("A merchant id is required to derive a Bridge idempotency key.")
  }
  const version = String(input.version || BRIDGE_ONBOARDING_VERSION).trim() || BRIDGE_ONBOARDING_VERSION
  return `${BRIDGE_IDEMPOTENCY_NAMESPACE}.customer.${version}.${stableDigest(merchantId, version)}`
}

/**
 * The idempotency key for a customer UPDATE.
 *
 * Unlike creation, an update must actually apply each time the merchant edits
 * their profile, so the key incorporates a caller-supplied revision. Reusing
 * the same revision (a double-clicked Save) is a no-op at Bridge; a genuinely
 * changed profile produces a new revision and therefore a new key.
 */
export function bridgeCustomerUpdateIdempotencyKey(input: {
  merchantId: string
  revision: string
  version?: string
}): string {
  const merchantId = String(input.merchantId || "").trim()
  const revision = String(input.revision || "").trim()
  if (!merchantId || !revision) {
    throw new Error("A merchant id and revision are required to derive a Bridge update key.")
  }
  const version = String(input.version || BRIDGE_ONBOARDING_VERSION).trim() || BRIDGE_ONBOARDING_VERSION
  return `${BRIDGE_IDEMPOTENCY_NAMESPACE}.customer_update.${version}.${stableDigest(merchantId, revision, version)}`
}

/**
 * The idempotency key for registering a merchant bank account with Bridge.
 *
 * Keyed on the merchant plus a PineTree-generated destination id, so a retried
 * submission reuses the same Bridge external account instead of registering the
 * bank account twice. The raw account number is never part of the key: an
 * idempotency key travels in a header.
 */
export function bridgeExternalAccountIdempotencyKey(input: {
  merchantId: string
  destinationId: string
  version?: string
}): string {
  const merchantId = String(input.merchantId || "").trim()
  const destinationId = String(input.destinationId || "").trim()
  if (!merchantId || !destinationId) {
    throw new Error("A merchant id and destination id are required to derive a Bridge idempotency key.")
  }
  const version = String(input.version || BRIDGE_ONBOARDING_VERSION).trim() || BRIDGE_ONBOARDING_VERSION
  return `${BRIDGE_IDEMPOTENCY_NAMESPACE}.external_account.${version}.${stableDigest(merchantId, destinationId, version)}`
}

/**
 * The idempotency key for a liquidation address.
 *
 * A liquidation address is a PERMANENT route, so the key is derived from the
 * complete route identity (merchant, chain, asset, destination bank account).
 * Re-running the same route therefore returns the existing Bridge object
 * instead of creating a duplicate permanent route.
 */
export function bridgeLiquidationAddressIdempotencyKey(input: {
  merchantId: string
  chain: string
  currency: string
  externalAccountId: string
  destinationPaymentRail: string
  destinationCurrency: string
  version?: string
}): string {
  const parts = [
    String(input.merchantId || "").trim(),
    String(input.chain || "").trim(),
    String(input.currency || "").trim(),
    String(input.externalAccountId || "").trim(),
    String(input.destinationPaymentRail || "").trim(),
    String(input.destinationCurrency || "").trim(),
  ]
  if (parts.some((part) => !part)) {
    throw new Error("A complete route identity is required to derive a Bridge idempotency key.")
  }
  const version = String(input.version || BRIDGE_ONBOARDING_VERSION).trim() || BRIDGE_ONBOARDING_VERSION
  return `${BRIDGE_IDEMPOTENCY_NAMESPACE}.liquidation.${version}.${stableDigest(...parts, version)}`
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
