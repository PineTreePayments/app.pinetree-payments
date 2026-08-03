/**
 * Canonical payment-source (origin) vocabulary.
 *
 * Pure and dependency-free on purpose: the engine projects it onto the
 * canonical transaction record, and Admin presentation renders the resulting
 * label. Both import this module, so there is exactly one mapping from a
 * stored channel to the words an operator reads.
 *
 * This module never infers origin from a provider, rail, or network. An
 * untagged historical row is "Unknown source" — it is not defaulted into
 * Terminal or Online Checkout.
 */

export type CanonicalPaymentSourceKey = "terminal" | "online" | "api" | "invoice" | "unknown"

export type CanonicalPaymentSource = {
  key: CanonicalPaymentSourceKey
  label: string
}

export const PAYMENT_SOURCE_LABELS: Record<CanonicalPaymentSourceKey, string> = {
  terminal: "Terminal",
  online: "Online Checkout",
  api: "API",
  invoice: "Invoice",
  unknown: "Unknown source",
}

/** Stored channel values, normalized to a comparison key. */
const SOURCE_KEYS: Record<string, CanonicalPaymentSourceKey> = {
  pos: "terminal",
  terminal: "terminal",
  inperson: "terminal",
  online: "online",
  checkout: "online",
  ecommerce: "online",
  api: "api",
  invoice: "invoice",
}

/** Case/separator-insensitive comparison key ("in_person" and "IN-PERSON" match). */
function sourceKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "")
}

/**
 * Resolve a stored channel to its canonical source key and display label.
 *
 * Callers pass `payments.channel` (or the canonical record's `channel`) and
 * nothing else — never a provider or a rail.
 */
export function resolveCanonicalPaymentSource(
  channel: string | null | undefined
): CanonicalPaymentSource {
  const key = SOURCE_KEYS[sourceKey(channel)] ?? "unknown"
  return { key, label: PAYMENT_SOURCE_LABELS[key] }
}

/** Display label only, for surfaces that render text rather than a pill. */
export function formatPaymentSource(channel: string | null | undefined): string {
  return resolveCanonicalPaymentSource(channel).label
}
