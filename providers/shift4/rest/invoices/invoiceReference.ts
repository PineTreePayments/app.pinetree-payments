/**
 * Shift4 invoice identity and PineTree correlation.
 *
 * ── The constraint ───────────────────────────────────────────────────────────
 * Shift4's invoice is a string of AT MOST 10 CHARACTERS. It is carried as
 * `transaction.invoice` in POST bodies and as the `Invoice` request header on
 * GET/DELETE /transactions/invoice. PineTree payment IDs are UUIDs, so an
 * invoice cannot simply be a PineTree identifier - it must be derived.
 *
 * ── The rules, from "Understanding Invoices" ─────────────────────────────────
 *  - The invoice number uniquely identifies a transaction on a per-batch basis.
 *  - Subsequent requests on the SAME transaction (authorization -> capture,
 *    incremental authorization, void) reuse the SAME invoice number.
 *  - Refunds and credits are NOT subsequent requests. They require a NEW
 *    invoice number. Reusing the sale's invoice for a refund can leave the
 *    consumer with a net credit, because the invoice is overwritten before the
 *    batch settles.
 *  - An invoice number must never be reused once a payment flow is complete
 *    within a batch.
 *
 * ── The derivation ───────────────────────────────────────────────────────────
 * The invoice is a deterministic 10-digit value derived by HMAC-SHA256 from
 * immutable PineTree identifiers:
 *
 *     invoice = digits10( HMAC(namespace | connectionId | paymentId | attemptId | purpose) )
 *
 * Determinism is what makes timeout recovery correct: after a communication
 * failure the same attempt recomputes the same invoice, so the Invoice
 * Information lookup targets the transaction that may have been approved, and a
 * documented resend uses the same invoice number as required. Nothing is read
 * from mutable UI state, a React ref, a query parameter, or a clock.
 *
 * Separation is what keeps money safe: a different payment attempt derives a
 * different invoice, and a refund derives from a distinct purpose so it can
 * never collide with the sale it refunds.
 */

import { createHmac } from "node:crypto"

import { SHIFT4_FIELD_LIMITS, Shift4ConfigError } from "../config"

/**
 * The invoice length PineTree emits. Shift4 permits up to 10 characters and the
 * documented examples are numeric, so all 10 digits are used for the widest
 * possible key space.
 *
 * ── Collision assumption (stated explicitly) ────────────────────────────────
 * 10 digits gives 10^10 = 10,000,000,000 possible invoices, and the derivation
 * distributes uniformly across them.
 *
 * The uniqueness Shift4 actually requires is **per merchant, per batch** - a
 * batch being one merchant's transactions between settlements, typically a
 * single day. By the birthday bound, the probability that any two invoices in
 * one batch collide is about n^2 / (2 * 10^10):
 *
 *   1,000 transactions/day  ->  ~1 in 20,000,000
 *   10,000 transactions/day ->  ~1 in 200,000
 *   100,000 transactions/day->  ~1 in 2,000
 *
 * PineTree's expected per-merchant volume is far below the first row, so the
 * risk is negligible at current scale. The assumption to revisit is therefore
 * "no single merchant settles anywhere near 10,000 card transactions in one
 * batch"; a merchant sustaining that volume would justify a persisted
 * uniqueness index. No migration is added for this now - a database constraint
 * for a theoretical collision would be speculative schema.
 *
 * Note the failure mode is bounded and detectable rather than silent: a
 * collision would make two attempts share an invoice, which Shift4 would treat
 * as the same transaction, and `invoiceMatchesReference` plus the recorded
 * `derivationKey` make the condition identifiable during reconciliation.
 */
export const SHIFT4_INVOICE_LENGTH = SHIFT4_FIELD_LIMITS.invoice

/**
 * What the invoice identifies. A refund is a NEW Shift4 transaction and must
 * therefore derive a separate invoice from the payment it refunds.
 */
export type Shift4InvoicePurpose = "payment" | "refund"

export type Shift4InvoiceReferenceInput = {
  /** The merchant_providers connection row that owns the Shift4 credential. */
  merchantProviderConnectionId: string
  /** Canonical PineTree payment ID. Immutable. */
  pineTreePaymentId: string
  /**
   * The PineTree payment attempt. A retry is a new attempt with a new ID, which
   * is exactly why a retry must not inherit an earlier invoice.
   */
  pineTreePaymentAttemptId: string
  purpose?: Shift4InvoicePurpose
  /**
   * Distinguishes multiple refunds against one payment. Required when
   * `purpose` is "refund" so two partial refunds cannot share an invoice.
   */
  refundId?: string
}

export type Shift4InvoiceReference = {
  /** The value sent to Shift4. At most 10 characters. */
  invoice: string
  purpose: Shift4InvoicePurpose
  merchantProviderConnectionId: string
  pineTreePaymentId: string
  pineTreePaymentAttemptId: string
  refundId: string | null
  /**
   * The exact string the invoice was derived from, minus the secret. Stored as
   * audit evidence so a later reconciliation can prove which attempt produced
   * which invoice without re-running business logic.
   */
  derivationKey: string
}

const INVOICE_NAMESPACE = "pinetree.shift4.invoice.v1"

/**
 * Derivation secret. Keeping the derivation keyed means an outside party cannot
 * enumerate a merchant's invoice numbers from a known payment ID.
 *
 * This is intentionally the SAME key as the credential encryption key: both are
 * server-only Shift4 integration secrets with the same blast radius, and adding
 * a second required key would create a rotation hazard where invoices silently
 * change identity - which would break timeout recovery for in-flight payments.
 * Rotation guidance is therefore explicit: this key must not be rotated while
 * any Shift4 payment attempt is unsettled.
 */
function loadInvoiceDerivationKey(): Buffer {
  const hex = String(process.env.SHIFT4_CREDENTIAL_ENCRYPTION_KEY || "").trim()
  if (hex.length !== 64 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Shift4ConfigError(
      "SHIFT4_CREDENTIAL_ENCRYPTION_KEY must be a 64-char hex string (32 bytes) to derive Shift4 invoice numbers.",
      ["SHIFT4_CREDENTIAL_ENCRYPTION_KEY"]
    )
  }
  return Buffer.from(hex, "hex")
}

function requireIdentifier(value: string | undefined, label: string): string {
  const text = String(value || "").trim()
  if (!text) {
    throw new Shift4ConfigError(`${label} is required to derive a Shift4 invoice number.`)
  }
  return text
}

/**
 * Map an HMAC digest to a fixed-width decimal string.
 *
 * The digest is folded byte by byte into a running value modulo 10^length, which
 * is equivalent to reducing the whole big-endian digest and keeps the result
 * uniform across the key space. The intermediate `value * 256 + byte` stays
 * below 2.56e12, well inside the exact-integer range, so no BigInt is needed and
 * no precision is lost.
 */
function digestToDigits(digest: Buffer, length: number): string {
  const modulus = 10 ** length
  let value = 0
  for (const byte of digest) {
    value = (value * 256 + byte) % modulus
  }
  return String(value).padStart(length, "0")
}

/**
 * Derive the Shift4 invoice reference for a PineTree payment attempt.
 *
 * Calling this twice for the same attempt always returns the same invoice.
 * Calling it for a different attempt, payment, connection, purpose, or refund
 * returns a different invoice.
 */
export function createInvoiceReference(
  input: Shift4InvoiceReferenceInput
): Shift4InvoiceReference {
  const purpose: Shift4InvoicePurpose = input.purpose ?? "payment"
  const merchantProviderConnectionId = requireIdentifier(
    input.merchantProviderConnectionId,
    "merchantProviderConnectionId"
  )
  const pineTreePaymentId = requireIdentifier(input.pineTreePaymentId, "pineTreePaymentId")
  const pineTreePaymentAttemptId = requireIdentifier(
    input.pineTreePaymentAttemptId,
    "pineTreePaymentAttemptId"
  )

  // A refund is a new Shift4 transaction. Requiring a refund identifier stops
  // two refunds against one payment from deriving the same invoice.
  const refundId = purpose === "refund"
    ? requireIdentifier(input.refundId, "refundId (required when purpose is \"refund\")")
    : null

  const derivationKey = [
    INVOICE_NAMESPACE,
    purpose,
    merchantProviderConnectionId,
    pineTreePaymentId,
    pineTreePaymentAttemptId,
    refundId ?? "",
  ].join("|")

  const digest = createHmac("sha256", loadInvoiceDerivationKey())
    .update(derivationKey, "utf8")
    .digest()

  const invoice = digestToDigits(digest, SHIFT4_INVOICE_LENGTH)

  return {
    invoice,
    purpose,
    merchantProviderConnectionId,
    pineTreePaymentId,
    pineTreePaymentAttemptId,
    refundId,
    derivationKey,
  }
}

/**
 * Validate an invoice value received from outside this module (for example one
 * read back from persistence) before it is placed in a Shift4 request.
 */
export function assertValidShift4Invoice(invoice: string): string {
  const value = String(invoice || "").trim()
  if (!value) {
    throw new Shift4ConfigError("A Shift4 invoice number is required.")
  }
  if (value.length > SHIFT4_FIELD_LIMITS.invoice) {
    throw new Shift4ConfigError(
      `A Shift4 invoice number may be at most ${SHIFT4_FIELD_LIMITS.invoice} characters.`
    )
  }
  return value
}

/**
 * Confirm a normalized Shift4 result belongs to the invoice PineTree asked
 * about. Shift4 echoes `transaction.invoice`; a mismatch means the response
 * describes a different transaction and must not be applied to this attempt.
 */
export function invoiceMatchesReference(
  reference: Pick<Shift4InvoiceReference, "invoice">,
  echoedInvoice: string | null | undefined
): boolean {
  const echoed = String(echoedInvoice || "").trim()
  if (!echoed) return false
  return echoed === reference.invoice
}
