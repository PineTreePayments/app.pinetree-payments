/**
 * PineTree Engine - Shift4 attempt identity, money, and evidence projection.
 *
 * Attempts live in `public.shift4_payment_attempts` and are mutated only through
 * the SECURITY DEFINER functions in `database/shift4PaymentAttempts.ts`. The
 * previous `payments.metadata.shift4` storage is gone: it was a read-modify-write
 * over a whole JSON namespace, so two writers could silently erase each other's
 * attempts.
 *
 * This module is now pure. It derives identities, converts money to integer
 * minor units, and projects a normalized provider result onto the evidence
 * fields the database function accepts. It performs no I/O.
 *
 * SECURITY: nothing produced here may contain an auth token, access token, raw
 * card token, PAN, CVV/CSC input, track data, PIN data, encrypted card blob,
 * i4Go access block, unredacted provider payload, or a plaintext idempotency key.
 */

import { createHash } from "node:crypto"

import type { Shift4NormalizedOperationResult } from "@/providers/shift4/rest"
import type { ApplyShift4EvidenceInput } from "@/database/shift4PaymentAttempts"

import type { Shift4AttemptState, Shift4EngineOperation } from "./types"

/**
 * Shift4 step names recorded in `payment_events.provider_event`.
 * `event_type` stays canonical; these are the Phase 2 audit vocabulary.
 */
export type Shift4EventName =
  | "shift4.attempt_created"
  | "shift4.request_dispatched"
  | "shift4.response_received"
  | "shift4.approved"
  | "shift4.declined"
  | "shift4.partial_approval"
  | "shift4.referral_required"
  | "shift4.timeout_unknown"
  | "shift4.communication_failure_unknown"
  | "shift4.invoice_lookup_started"
  | "shift4.invoice_lookup_result"
  | "shift4.lookup_retry"
  | "shift4.resend_eligible"
  | "shift4.resend_blocked"
  | "shift4.reconciliation_required"
  | "shift4.final_resolution"

/* ── Money ────────────────────────────────────────────────────────────────── */

/**
 * Convert a decimal major-unit amount to integer minor units.
 *
 * The Financial Ledger, Money, and Reconciliation Standard requires integer
 * minor units; floating point is never authoritative for money. Rounding here is
 * the single conversion point, so a comparison downstream is always integer.
 */
/* ── Identity ─────────────────────────────────────────────────────────────── */

/**
 * Deterministic attempt identity.
 *
 * Derived from the payment, operation, and idempotency key, so the same logical
 * request always resolves to the same attempt - which is what makes duplicate
 * submissions collapse and timeout recovery reuse one invoice.
 */
export function deriveAttemptId(input: {
  paymentId: string
  operation: Shift4EngineOperation
  idempotencyKey: string
}): string {
  return createHash("sha256")
    .update(`pinetree.shift4.attempt.v1|${input.paymentId}|${input.operation}|${input.idempotencyKey}`)
    .digest("hex")
    .slice(0, 32)
}

/**
 * Fingerprint of the semantically material request fields.
 *
 * Reusing one idempotency key with a different amount, currency, operation, or
 * card token is a conflict, not a retry.
 */
export function buildRequestFingerprint(input: {
  merchantId: string
  merchantProviderConnectionId: string
  paymentId: string
  operation: Shift4EngineOperation
  channel: string
  amountMinor: number
  currency: string
  cardTokenValue?: string
}): string {
  return createHash("sha256")
    .update(
      [
        "pinetree.shift4.fingerprint.v1",
        input.merchantId,
        input.merchantProviderConnectionId,
        input.paymentId,
        input.operation,
        input.channel,
        input.amountMinor,
        String(input.currency).toUpperCase(),
        // The token is hashed, never stored or compared in the clear.
        input.cardTokenValue ? fingerprintCardToken(input.cardTokenValue) : "",
      ].join("|")
    )
    .digest("hex")
}

/**
 * Non-reversible fingerprint of a Shift4 card token.
 *
 * Correlation only. It cannot be replayed to Shift4 and is NOT a substitute for
 * the encrypted card-on-file token storage that a later phase must design.
 */
export function fingerprintCardToken(token: string): string {
  return createHash("sha256").update(String(token)).digest("hex").slice(0, 12)
}

/* ── Evidence projection ──────────────────────────────────────────────────── */

/**
 * Project a normalized Shift4 result onto the database evidence fields.
 *
 * Only non-secret values cross this boundary. `cardTokenValue` is reduced to a
 * fingerprint and `rawResponseRef` is already a digest of the REDACTED payload,
 * so neither the token nor the response can be reconstructed from storage.
 */
export function projectEvidence(
  result: Shift4NormalizedOperationResult
): Pick<
  ApplyShift4EvidenceInput,
  | "responseCode"
  | "primaryCode"
  | "secondaryCode"
  | "authorizationCode"
  | "retrievalReference"
  | "saleFlag"
  | "cardOnFileTransactionId"
  | "avsResult"
  | "cscResult"
  | "entryMode"
  | "entryChannel"
  | "cardTokenFingerprint"
  | "rawResponseRef"
  | "approvedAmountMinor"
  | "providerOccurredAt"
  | "receivedAt"
> {
  return {
    responseCode: result.responseCode ?? null,
    primaryCode: result.primaryCode ?? null,
    secondaryCode: result.secondaryCode ?? null,
    authorizationCode: result.authorizationCode ?? null,
    retrievalReference: result.retrievalReference ?? null,
    saleFlag: result.saleFlag ?? null,
    cardOnFileTransactionId: result.cardOnFileTransactionId ?? null,
    avsResult: result.avsResult ?? null,
    cscResult: result.cscResult ?? null,
    entryMode: result.entryMode ?? null,
    entryChannel: result.entryChannel ?? null,
    cardTokenFingerprint: result.cardTokenValue
      ? fingerprintCardToken(result.cardTokenValue)
      : null,
    rawResponseRef: result.rawResponseRef ?? null,
    approvedAmountMinor: result.approvedAmountMinor ?? null,
    providerOccurredAt: result.providerDateTime ?? null,
    receivedAt: result.requestCompletedAt,
  }
}

/** Map an attempt state to the Shift4 audit event name that best describes it. */
export function eventNameForState(state: Shift4AttemptState): Shift4EventName {
  switch (state) {
    case "approved":
      return "shift4.approved"
    case "declined":
      return "shift4.declined"
    case "action_required":
      return "shift4.referral_required"
    case "reconciliation_required":
      return "shift4.reconciliation_required"
    case "unresolved":
      return "shift4.timeout_unknown"
    default:
      return "shift4.response_received"
  }
}
