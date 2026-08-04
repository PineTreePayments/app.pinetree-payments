/**
 * `transaction.purchaseCard` — the single canonical builder.
 *
 * Level 2 purchasing-card data is REQUIRED by the published sale, authorization
 * and manual-authorization schemas (both the Commerce Engine For Cloud and the
 * GTV-token variants). Documented limits, transcribed:
 *
 *   customerReference      max 25
 *   destinationPostalCode  max 9
 *   productDescriptors     1-4 entries, each max 40
 *
 * ── Real data only ───────────────────────────────────────────────────────────
 * Every value here is derived from PineTree's own stored merchant and payment
 * information. Shift4's example values (`D019D09309F2`, `94719`, `Hamburger`)
 * are never emitted, and no placeholder postal code is ever invented — a
 * missing postal code fails the build rather than sending `00000`, because a
 * fabricated ZIP is Level 2 data the merchant would be attesting to.
 *
 * ── Stability ────────────────────────────────────────────────────────────────
 * `customerReference` is DETERMINISTIC for a payment. The same value must appear
 * on the authorization, on the manual authorization that follows a referral, and
 * on any replay comparison during timeout recovery — so it is derived from the
 * payment identity, never from a clock or a random source.
 *
 * SECURITY: server-only and pure. No cardholder data, email, phone, token, or
 * internal secret may enter any field; the input type offers no way to express
 * one, and descriptor sanitization strips control characters.
 */

export const SHIFT4_PURCHASE_CARD_LIMITS = {
  customerReference: 25,
  destinationPostalCode: 9,
  productDescriptor: 40,
  productDescriptorCount: 4,
} as const

/**
 * The documented generic fallback.
 *
 * Shift4 explicitly permits "a generic text description of what the merchant
 * sells (such as 'Groceries')". This is used ONLY when no real item name or
 * order description exists — it must never displace real descriptions.
 */
export const SHIFT4_GENERIC_PRODUCT_DESCRIPTOR = "Retail Purchase" as const

export class Shift4PurchaseCardError extends Error {
  readonly code: "postal_code_unavailable" | "customer_reference_unavailable"

  constructor(message: string, code: Shift4PurchaseCardError["code"]) {
    super(message)
    this.name = "Shift4PurchaseCardError"
    this.code = code
  }
}

export type Shift4PurchaseCardSources = Readonly<{
  /** Canonical PineTree payment id. The last-resort reference derivation. */
  paymentId: string
  /** Merchant-visible order or reference number, when the payment has one. */
  merchantOrderReference?: string | null
  /** Shipping destination postal code, when the purchase is shipped. */
  shippingPostalCode?: string | null
  /** Postal code of the selected terminal location. */
  terminalLocationPostalCode?: string | null
  /** The merchant's stored business postal code (`merchant_settings.zip`). */
  merchantBusinessPostalCode?: string | null
  /** Real line-item names, in order. */
  lineItemNames?: readonly (string | null | undefined)[]
  /** Payment or order description. */
  orderDescription?: string | null
}>

export type Shift4PurchaseCardData = Readonly<{
  customerReference: string
  destinationPostalCode: string
  productDescriptors: readonly string[]
}>

/** Strip control characters and collapse whitespace, preserving meaningful text. */
function cleanText(value: unknown): string {
  let out = ""
  for (const character of String(value ?? "")) {
    const code = character.codePointAt(0) ?? 0
    // C0 controls and DEL become a space rather than vanishing, so
    // "Coffee<TAB>Beans" stays two words instead of becoming "CoffeeBeans".
    out += code < 0x20 || code === 0x7f ? " " : character
  }
  return out.replace(/\s+/g, " ").trim()
}

/**
 * Derive a stable 25-character-max reference from the payment id.
 *
 * PineTree payment ids are UUIDs (36 characters), which do not fit. The hyphens
 * are removed and the value truncated, which stays deterministic — the same
 * payment always yields the same reference, on the first attempt and on every
 * recovery replay.
 */
function referenceFromPaymentId(paymentId: string): string {
  const compact = cleanText(paymentId).replace(/-/g, "").toUpperCase()
  return compact.slice(0, SHIFT4_PURCHASE_CARD_LIMITS.customerReference)
}

/**
 * Normalize a postal code.
 *
 * Letters are preserved so Canadian codes survive; spaces and hyphens are
 * removed so "K1A 0B1" and "94719-1234" both fit the 9-character maximum.
 * Anything that normalizes to empty is treated as absent, not as a value.
 */
export function normalizeShift4PostalCode(value: unknown): string | null {
  const cleaned = cleanText(value).toUpperCase().replace(/[^A-Z0-9]/g, "")
  if (!cleaned) return null
  return cleaned.slice(0, SHIFT4_PURCHASE_CARD_LIMITS.destinationPostalCode)
}

/**
 * Resolve the destination postal code in documented priority order:
 * shipping destination, then the terminal location, then the merchant's
 * business address.
 */
export function resolveShift4DestinationPostalCode(sources: Shift4PurchaseCardSources): string | null {
  return (
    normalizeShift4PostalCode(sources.shippingPostalCode) ??
    normalizeShift4PostalCode(sources.terminalLocationPostalCode) ??
    normalizeShift4PostalCode(sources.merchantBusinessPostalCode)
  )
}

/**
 * Build the 1-4 product descriptors.
 *
 * Real line-item names first, then the order description, then the documented
 * generic fallback. Blanks and case-insensitive duplicates are removed, and each
 * entry is truncated to 40 characters.
 *
 * PineTree has no stored merchant business-category field, so that intermediate
 * tier is skipped rather than filled with the business NAME, which describes the
 * merchant rather than the goods sold.
 */
export function buildShift4ProductDescriptors(sources: Shift4PurchaseCardSources): readonly string[] {
  const collect = (values: readonly (string | null | undefined)[]): string[] => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const value of values) {
      const text = cleanText(value).slice(0, SHIFT4_PURCHASE_CARD_LIMITS.productDescriptor)
      if (!text) continue
      const key = text.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(text)
      if (out.length >= SHIFT4_PURCHASE_CARD_LIMITS.productDescriptorCount) break
    }
    return out
  }

  const fromItems = collect(sources.lineItemNames ?? [])
  if (fromItems.length > 0) return Object.freeze(fromItems)

  const fromDescription = collect([sources.orderDescription])
  if (fromDescription.length > 0) return Object.freeze(fromDescription)

  return Object.freeze([SHIFT4_GENERIC_PRODUCT_DESCRIPTOR])
}

/**
 * Build the complete, documented `transaction.purchaseCard` object.
 *
 * Throws when no real postal code exists anywhere in the chain. Failing closed
 * is deliberate: preparation should stop with a specific, fixable reason rather
 * than send Level 2 data the merchant never supplied.
 */
export function buildShift4PurchaseCardData(
  sources: Shift4PurchaseCardSources
): Shift4PurchaseCardData {
  const orderReference = cleanText(sources.merchantOrderReference)
    .replace(/\s/g, "")
    .slice(0, SHIFT4_PURCHASE_CARD_LIMITS.customerReference)

  const customerReference = orderReference || referenceFromPaymentId(sources.paymentId)
  if (!customerReference) {
    throw new Shift4PurchaseCardError(
      "No PineTree payment reference is available for transaction.purchaseCard.customerReference.",
      "customer_reference_unavailable"
    )
  }

  const destinationPostalCode = resolveShift4DestinationPostalCode(sources)
  if (!destinationPostalCode) {
    throw new Shift4PurchaseCardError(
      "No postal code is recorded for the shipping destination, the terminal location, or the merchant's business address. Level 2 purchasing-card data requires a real postal code.",
      "postal_code_unavailable"
    )
  }

  return Object.freeze({
    customerReference,
    destinationPostalCode,
    productDescriptors: buildShift4ProductDescriptors(sources),
  })
}
