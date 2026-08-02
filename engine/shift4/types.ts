/**
 * PineTree Engine - Shift4 contract types.
 *
 * The Engine owns canonical lifecycle, idempotency, attempt identity, recovery
 * decisions, and ledger orchestration. The Shift4 adapter owns authentication,
 * schemas, response classification, and redaction. These types are the seam.
 *
 * ARCHITECTURE NOTE ON STORAGE: attempts live in the dedicated
 * `public.shift4_payment_attempts` table (migration
 * 20260730_create_shift4_payment_attempts.sql) and are mutated only through
 * SECURITY DEFINER functions. The earlier `payments.metadata.shift4` design was
 * removed: it was a read-modify-write over one JSON namespace, so a live
 * response and a recovery worker could silently erase each other's attempts.
 *
 * Money crosses this seam only as validated integer minor units.
 */

import type {
  Shift4NormalizedOperationResult,
  Shift4Outcome,
} from "@/providers/shift4/rest"
import type { PaymentStatus } from "@/engine/paymentStateMachine"
import type {
  Shift4AttemptRole,
  Shift4PaymentAttemptRow,
} from "@/database/shift4PaymentAttempts"

/** Shift4 operations the Engine may drive in Phase 2. */
export type Shift4EngineOperation = "sale" | "authorization" | "capture" | "refund" | "void"

/** Which approved PineTree channel originated the request. */
export type Shift4Channel = "retail" | "ecommerce"

/**
 * Attempt lifecycle, independent of canonical payment status.
 *
 * `unresolved` is the Shift4 unknown-outcome state. It deliberately lives at
 * the ATTEMPT level: PineTree's canonical payment lifecycle has exactly eight
 * statuses and must never gain an UNKNOWN.
 */
export type Shift4AttemptState =
  | "created"
  | "dispatched"
  | "approved"
  | "declined"
  | "unresolved"
  | "action_required"
  | "reconciliation_required"
  | "abandoned"

/** How the Engine may safely proceed after an attempt. */
export type Shift4RetryClassification =
  | "terminal_no_retry"
  | "new_attempt_allowed"
  | "same_invoice_resend_candidate"
  | "lookup_required"
  | "operator_review_required"

/**
 * A persisted Shift4 provider attempt.
 *
 * The row shape is owned by `database/shift4PaymentAttempts.ts` so there is
 * exactly one definition of what durable storage looks like; this alias exists
 * so Engine callers do not have to import from the database layer directly.
 *
 * NEVER stores: auth token, access token, client GUID, PAN, CVV/CSC input,
 * track data, PIN data, encrypted card blobs, i4Go access blocks, the raw card
 * token, an unredacted provider payload, or a plaintext idempotency key. Only a
 * non-reversible token fingerprint and a hashed idempotency key are kept.
 */
export type Shift4Attempt = Shift4PaymentAttemptRow

/** Re-exported so Engine callers need not import from the database layer. */
export type { Shift4AttemptRole }

/** The Engine-facing request for one Shift4 operation. */
export type Shift4ExecuteRequest = {
  merchantId: string
  merchantProviderConnectionId: string
  paymentId: string
  /** Omit to let the Engine derive a deterministic attempt identity. */
  paymentAttemptId?: string
  operation: Shift4EngineOperation
  channel: Shift4Channel
  amountMinor: number
  /** Tax is required by Shift4's schema; a no-tax sale sends 0 deliberately. */
  taxAmountMinor?: number
  currency: string
  /** PineTree idempotency key. Two calls with this key must not double-send. */
  idempotencyKey: string

  /** i4Go / Global Token Vault token. Never a PAN. */
  cardTokenValue?: string
  /** Required for capture: the authorization attempt being closed. */
  authorizationAttemptId?: string
  /**
   * Generic transaction-chain parent. A capture settles its authorization and a
   * void reverses its originating sale, authorization, or capture; both reuse
   * that transaction`s invoice, which is how Shift4 links the chain.
   */
  relatedAttemptId?: string
  /**
   * The step inside the transaction chain. Defaults from the endpoint, so only
   * a manual (voice) authorization needs to state it explicitly — it shares the
   * authorization endpoint with the referral it resolves.
   */
  attemptRole?: Shift4AttemptRole
  /**
   * The authorization code a clerk obtained by telephone. Required for a manual
   * authorization and meaningless for anything else.
   */
  manualAuthorizationCode?: string
  /** Required literal gate for the backend-only certified referral flow. */
  certificationScopeConfirmed?: boolean
  /** Required for refund: distinguishes multiple refunds of one payment. */
  refundId?: string

  clerkNumericId?: number
  correlationId?: string
  merchantTimeZone?: string
  /** Selects the documented Global Timer (120s device / 65s other). */
  entryContext?: "device_pin_pad" | "standard"
}

/** What the Engine decided, and what a caller may safely do next. */
export type Shift4ExecuteResult = {
  attemptId: string
  invoice: string
  correlationId: string

  /** The canonical status the Engine applied, or null when unchanged. */
  appliedStatus: PaymentStatus | null
  /** The status the mapping recommended before guards were applied. */
  recommendedStatus: PaymentStatus | null

  attemptState: Shift4AttemptState
  outcome: Shift4Outcome | "not_attempted"

  terminal: boolean
  lookupRequired: boolean
  reconciliationRequired: boolean
  retryClassification: Shift4RetryClassification
  nextCheckAt: string | null

  /** Non-secret provider references worth surfacing to an operator. */
  providerReferences: {
    authorizationCode: string | null
    retrievalReference: string | null
    responseCode: string | null
    approvedAmountMinor: number | null
  }

  /** Set when the caller must act (referral, SCA, partial approval). */
  actionRequired: string | null
  /** True when this call resumed an existing attempt instead of sending. */
  resumed: boolean
}

/**
 * The mapping layer's verdict for one normalized Shift4 result.
 *
 * `status` is a RECOMMENDATION. The Engine still applies guards and the
 * canonical state machine; the mapper never writes.
 */
export type Shift4EvidenceMapping = {
  status: PaymentStatus | null
  attemptState: Shift4AttemptState
  terminal: boolean
  lookupRequired: boolean
  reconciliationRequired: boolean
  retryClassification: Shift4RetryClassification
  actionRequired: string | null
  reason: string
}

export type Shift4EvidenceInput = {
  operation: Shift4EngineOperation
  result: Omit<
    Pick<
      Shift4NormalizedOperationResult,
      "outcome" | "responseCode" | "approvedAmountMinor" | "requiresInvoiceResolution"
    >,
    "responseCode"
  > & {
    /**
     * The host response code exactly as Shift4 sent it.
     *
     * Deliberately wider than `Shift4TransactionResponseCode`. That union stays
     * limited to the documented codes and is the right type for REQUESTS and for
     * the provider's own wire schema. This field, however, carries a value that
     * originated in arbitrary provider JSON: `normalizeResponse` asserts the raw
     * value into the narrow union, so a code Shift4 adds after this build ships
     * really can reach the mapper at runtime.
     *
     * Typing it as `string` keeps the type system honest about that and matches
     * `classifyResponseCode(code: string | null | undefined)`, which already
     * routes every undocumented code to the `unknown` outcome. Narrowing here
     * would make the mapper's defensive `default` branch look unreachable while
     * the runtime hazard remained.
     */
    responseCode?: string | null
  }
  /** The amount PineTree asked Shift4 to approve. */
  requestedAmountMinor: number
}
