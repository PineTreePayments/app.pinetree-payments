/**
 * Payment Mode — Test / Live Separation
 *
 * Lightweight tagging model that prevents internal test payments from polluting
 * admin analytics and revenue metrics.
 *
 * Design:
 *   - Tag is stored as metadata.payment_mode in the existing payments JSONB column.
 *   - No DB migration required — existing payments without the tag default to "live".
 *   - Analytics queries should filter with: metadata->>'payment_mode' != 'test'
 *     or use the helpers below.
 *
 * Usage:
 *   // When creating a test/debug payment:
 *   const extraMetadata = buildTestPaymentMetadata()
 *   // merge into the payment's metadata before calling createPayment
 *
 *   // When reading a payment:
 *   const mode = getPaymentMode(payment)  // "live" | "test"
 */

export type PaymentMode = "live" | "test"

type WithMetadata = {
  metadata?: unknown
}

/**
 * Read the payment_mode from a payment's metadata.
 * Defaults to "live" if not tagged (preserves backward compatibility).
 */
export function getPaymentMode(payment: WithMetadata): PaymentMode {
  const meta = payment.metadata
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return "live"
  const mode = (meta as Record<string, unknown>).payment_mode
  return mode === "test" ? "test" : "live"
}

/**
 * Returns true if this payment is a test/internal payment.
 */
export function isTestPayment(payment: WithMetadata): boolean {
  return getPaymentMode(payment) === "test"
}

/**
 * Build the metadata fragment to tag a payment as a test payment.
 * Merge this into the payment's metadata at creation time.
 *
 * @example
 *   createPayment({ ..., metadata: { ...existing, ...buildTestPaymentMetadata() } })
 */
export function buildTestPaymentMetadata(): { payment_mode: "test" } {
  return { payment_mode: "test" }
}

/**
 * Supabase/PostgREST filter string to exclude test payments from queries.
 *
 * Usage with supabase-js:
 *   .or('metadata->>payment_mode.is.null,metadata->>payment_mode.neq.test')
 */
export const EXCLUDE_TEST_PAYMENTS_FILTER =
  "metadata->>payment_mode.is.null,metadata->>payment_mode.neq.test"

/**
 * SQL fragment for raw Postgres queries (e.g. in Supabase SQL editor):
 *   WHERE (metadata->>'payment_mode' IS NULL OR metadata->>'payment_mode' != 'test')
 */
export const EXCLUDE_TEST_PAYMENTS_SQL =
  "(metadata->>'payment_mode' IS NULL OR metadata->>'payment_mode' != 'test')"
