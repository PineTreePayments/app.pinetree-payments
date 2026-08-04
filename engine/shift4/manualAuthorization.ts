/**
 * Manual Authorization after a voice referral.
 *
 * Shift4 documents `POST /transactions/manualauthorization` for all four
 * integration methods, including Commerce Engine For Cloud. A referral is a
 * `transaction.responseCode` of `R`: the issuer will not approve without a
 * phone call. The clerk telephones the voice centre, receives a six-character
 * code, and the interface submits it here.
 *
 * ── The lineage is the security model ────────────────────────────────────────
 * A manual authorization is an assertion that a human obtained approval by
 * phone. Everything that identifies WHICH transaction was approved is therefore
 * derived server-side from the original referral attempt — merchant, provider
 * connection, invoice, amount and card token all come from the persisted
 * evidence, never from the request. The browser supplies exactly two things: a
 * PineTree payment or attempt reference, and the six characters the issuer read
 * out.
 *
 * That matters because a caller who could choose the invoice or the amount could
 * attach a genuine phone approval to a different, larger transaction.
 *
 * ── Variant selection is deterministic ───────────────────────────────────────
 * The browser never chooses an integration method. The selector inspects the
 * persisted referral evidence: if a usable GTV token exists, the token variant
 * is used and the customer is not asked to present the card again; otherwise the
 * Commerce Engine For Cloud variant runs against the merchant-owned reader.
 * There is no fallback between them after dispatch, and no automatic retry.
 *
 * SECURITY: the authorization code is validated, uppercased, and passed to the
 * adapter. It is never written to a general log, never returned to a browser,
 * and never attached to an error. The card token is resolved server-side and is
 * likewise never returned or logged.
 */

import { classifyShift4Device } from "@/providers/shift4/commerce-engine/cloud"

import { buildShift4PurchaseCardData, type Shift4PurchaseCardData } from "./purchaseCardData"

/** Shift4 documents a referral as `transaction.responseCode` of `R`. */
export const SHIFT4_REFERRAL_RESPONSE_CODE = "R" as const

/** Six alphanumeric characters, no special characters. */
const AUTHORIZATION_CODE_PATTERN = /^[A-Za-z0-9]{6}$/

export class Shift4ManualAuthorizationError extends Error {
  readonly code:
    | "invalid_authorization_code"
    | "attempt_not_found"
    | "not_a_referral"
    | "connection_mismatch"
    | "invoice_mismatch"
    | "amount_mismatch"
    | "variant_unavailable"
    | "caller_input_not_accepted"

  constructor(message: string, code: Shift4ManualAuthorizationError["code"]) {
    super(message)
    this.name = "Shift4ManualAuthorizationError"
    this.code = code
  }
}

/**
 * Validate and normalize a voice approval code.
 *
 * Rejects anything that is not exactly six alphanumeric characters — including
 * spaces, punctuation and any other special character — then uppercases it.
 * The rejected value is never echoed back.
 */
export function normalizeShift4AuthorizationCode(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : ""
  if (!AUTHORIZATION_CODE_PATTERN.test(value)) {
    throw new Shift4ManualAuthorizationError(
      "The authorization code must be exactly six letters or digits, with no spaces or punctuation.",
      "invalid_authorization_code"
    )
  }
  return value.toUpperCase()
}

/** The persisted evidence a manual authorization must be built from. */
export type Shift4ReferralAttemptEvidence = Readonly<{
  attemptId: string
  merchantId: string
  merchantProviderConnectionId: string
  pineTreePaymentId: string
  attemptRole: string
  invoice: string
  amountMinor: number
  taxAmountMinor: number
  currency: string
  responseCode: string | null
  /** Present only when the original authorization returned a reusable token. */
  cardTokenValue?: string | null
}>

export type Shift4ManualAuthorizationVariant = "gtv_token" | "commerce_engine_cloud"

export type Shift4ManualAuthorizationPlan = Readonly<{
  variant: Shift4ManualAuthorizationVariant
  operation: "manual_authorization"
  endpoint: "/transactions/manualauthorization"
  /** Server-derived. Never taken from the request. */
  merchantId: string
  merchantProviderConnectionId: string
  pineTreePaymentId: string
  referralAttemptId: string
  invoice: string
  amountMinor: number
  taxAmountMinor: number
  currency: string
  purchaseCard: Shift4PurchaseCardData
  /** Present only for the Cloud variant. */
  device: Readonly<{ manufacturer: string; serialNumber: string }> | null
  /** Safe attempt metadata recording which documented variant was selected. */
  selectedVariantReason: string
}>

/**
 * Prove the attempt really is a referral belonging to this merchant.
 *
 * Every mismatch throws, and the messages stay generic about ownership so a
 * caller cannot use this to discover another merchant's attempts.
 */
export function assertShift4ReferralLineage(input: {
  merchantId: string
  evidence: Shift4ReferralAttemptEvidence | null
  expectedInvoice?: string | null
  expectedAmountMinor?: number | null
}): Shift4ReferralAttemptEvidence {
  const evidence = input.evidence
  if (!evidence || evidence.merchantId !== input.merchantId) {
    // Identical for "belongs to another merchant" and "does not exist".
    throw new Shift4ManualAuthorizationError(
      "No referral is available for this payment.",
      "attempt_not_found"
    )
  }

  const isReferral =
    evidence.responseCode === SHIFT4_REFERRAL_RESPONSE_CODE ||
    evidence.attemptRole === "referral_authorization"
  if (!isReferral) {
    throw new Shift4ManualAuthorizationError(
      "This transaction did not receive a referral response, so it cannot be manually authorized.",
      "not_a_referral"
    )
  }

  if (input.expectedInvoice && input.expectedInvoice !== evidence.invoice) {
    throw new Shift4ManualAuthorizationError(
      "The invoice does not match the original referral.",
      "invoice_mismatch"
    )
  }
  if (
    input.expectedAmountMinor !== undefined &&
    input.expectedAmountMinor !== null &&
    input.expectedAmountMinor !== evidence.amountMinor
  ) {
    throw new Shift4ManualAuthorizationError(
      "The amount does not match the original referral.",
      "amount_mismatch"
    )
  }

  return evidence
}

/**
 * Choose the documented variant. Deterministic, server-side, and final.
 *
 * A usable GTV token means the card does not have to be presented again, which
 * is both the better clerk experience and the certification flow's shape. Only
 * when no token was retained does the request go back to the device.
 */
export function selectShift4ManualAuthorizationVariant(input: {
  evidence: Shift4ReferralAttemptEvidence
  reader?: { device_type?: string | null; serial_number?: string | null } | null
}): { variant: Shift4ManualAuthorizationVariant; reason: string } {
  const token = String(input.evidence.cardTokenValue ?? "").trim()
  if (token) {
    return {
      variant: "gtv_token",
      reason: "The original authorization retained a card token, so no second card read is required.",
    }
  }

  const classification = classifyShift4Device(input.reader?.device_type)
  const serialNumber = String(input.reader?.serial_number ?? "").trim()
  if (!classification.manufacturer || !serialNumber) {
    throw new Shift4ManualAuthorizationError(
      "No card token was retained and no addressable Shift4 reader is configured, so the manual authorization cannot be built.",
      "variant_unavailable"
    )
  }

  return {
    variant: "commerce_engine_cloud",
    reason: "No card token was retained, so the request is routed to the merchant's reader.",
  }
}

/**
 * Build the complete, validated plan for a manual authorization.
 *
 * Nothing here dispatches. The plan is what the execution path would send, and
 * every value in it is server-derived from persisted evidence.
 */
export function buildShift4ManualAuthorizationPlan(input: {
  merchantId: string
  evidence: Shift4ReferralAttemptEvidence
  reader?: { device_type?: string | null; serial_number?: string | null } | null
  purchaseCardSources: Parameters<typeof buildShift4PurchaseCardData>[0]
}): Shift4ManualAuthorizationPlan {
  const evidence = assertShift4ReferralLineage({
    merchantId: input.merchantId,
    evidence: input.evidence,
  })

  const { variant, reason } = selectShift4ManualAuthorizationVariant({
    evidence,
    reader: input.reader,
  })

  // The SAME Level 2 data as the original attempt: it is derived from the
  // payment, not from anything a browser sent with this request.
  const purchaseCard = buildShift4PurchaseCardData(input.purchaseCardSources)

  const device =
    variant === "commerce_engine_cloud"
      ? Object.freeze({
          manufacturer: classifyShift4Device(input.reader?.device_type).manufacturer as string,
          serialNumber: String(input.reader?.serial_number ?? "").trim(),
        })
      : null

  return Object.freeze({
    variant,
    operation: "manual_authorization" as const,
    endpoint: "/transactions/manualauthorization" as const,
    merchantId: evidence.merchantId,
    merchantProviderConnectionId: evidence.merchantProviderConnectionId,
    pineTreePaymentId: evidence.pineTreePaymentId,
    referralAttemptId: evidence.attemptId,
    // Invoice and amount come from the referral, never from the caller. This is
    // what stops a phone approval being attached to a different transaction.
    invoice: evidence.invoice,
    amountMinor: evidence.amountMinor,
    taxAmountMinor: evidence.taxAmountMinor,
    currency: evidence.currency,
    purchaseCard,
    device,
    selectedVariantReason: reason,
  })
}

/** Body keys a browser may never send to the manual-authorization surface. */
export const SHIFT4_MANUAL_AUTHORIZATION_FORBIDDEN_FIELDS: readonly string[] = Object.freeze([
  "merchantId",
  "invoice",
  "amount",
  "amountMinor",
  "token",
  "cardToken",
  "accessToken",
  "serialNumber",
  "manufacturer",
  "terminalId",
  "responseCode",
  "referralStatus",
  "merchantProviderConnectionId",
  "purchaseCard",
  "environment",
  "provider",
])
