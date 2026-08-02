/**
 * Service-role access to `shift4_payment_attempts`.
 *
 * Every mutation goes through a SECURITY DEFINER function that re-verifies
 * tenancy in the database, so a caller cannot drive another merchant's payment
 * by passing its id. Reads are merchant-filtered here as well; the table itself
 * has RLS enabled with no policy, so `anon` and `authenticated` reach nothing.
 *
 * SECURITY: nothing in this module accepts, returns, or persists an auth token,
 * access token, client GUID, raw card token, PAN, CVV/CSC input, track data, PIN
 * data, unredacted provider payload, or a plaintext idempotency key. The
 * idempotency key is hashed before it ever leaves the Engine.
 */

import { createHash } from "node:crypto"

import { supabaseAdmin } from "./supabase"

/** Provider key for the internal Shift4 REST connection row. */
export const SHIFT4_REST_PROVIDER_KEY = "shift4_rest"

/**
 * The ONLY database handle in this module.
 *
 * There is deliberately no `supabaseAdmin || supabaseAnon` fallback. The
 * attempts table revokes everything from `anon`, so an anon read would not fail
 * loudly - it would return an empty result set, and a missing attempt reads as
 * "no such attempt" rather than "misconfigured deployment". Recovery would then
 * silently do nothing. Failing closed here is the only safe behavior.
 */
function serviceRoleDb() {
  if (!supabaseAdmin) {
    throw new Error(
      "Shift4 attempt storage requires the service-role Supabase client. " +
        "SUPABASE_SERVICE_ROLE_KEY is not configured."
    )
  }
  return supabaseAdmin
}

/* ── Money safety ─────────────────────────────────────────────────────────── */

/**
 * Validate a minor-unit amount on its way TO PostgreSQL.
 *
 * The column is `bigint`, which spans far more than JavaScript can represent
 * exactly. Anything outside the safe-integer range, fractional, negative, NaN,
 * or infinite is rejected rather than silently rounded into a different amount.
 */
export function assertSafeMinorUnits(value: number, label: string): number {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number of minor currency units.`)
  }
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be a whole number of minor currency units, not ${value}.`)
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error(
      `${label} exceeds JavaScript's safe integer range and cannot be represented exactly.`
    )
  }
  if (value < 0) {
    throw new Error(`${label} must not be negative.`)
  }
  return value
}

/** Same rule, but tolerating an absent value. */
export function assertOptionalSafeMinorUnits(
  value: number | null | undefined,
  label: string
): number | null {
  if (value === null || value === undefined) return null
  return assertSafeMinorUnits(value, label)
}

/**
 * Parse a minor-unit amount coming BACK from PostgREST.
 *
 * A `bigint` column may arrive as a number or as a decimal string depending on
 * driver and magnitude. Both are parsed exactly; anything that would lose
 * precision is rejected instead of being quietly coerced by `Number(...)`.
 */
export function parseMinorUnits(value: unknown, label: string): number {
  if (typeof value === "number") {
    return assertSafeMinorUnits(value, label)
  }
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!/^-?\d+$/.test(trimmed)) {
      throw new Error(`${label} is not an integer string: ${JSON.stringify(value)}`)
    }
    // Compare round-tripped text so a value that lost precision on the way
    // through Number() is caught rather than accepted.
    const parsed = Number(trimmed)
    if (!Number.isSafeInteger(parsed) || String(parsed) !== trimmed.replace(/^\+/, "")) {
      throw new Error(
        `${label} exceeds JavaScript's safe integer range and cannot be represented exactly: ${trimmed}`
      )
    }
    return assertSafeMinorUnits(parsed, label)
  }
  throw new Error(`${label} must be a number or an integer string, received ${typeof value}.`)
}

/** Same rule, but tolerating a null/absent column. */
export function parseOptionalMinorUnits(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null
  return parseMinorUnits(value, label)
}

/**
 * Hash a PineTree idempotency key for storage.
 *
 * The plaintext key never reaches the database: it can be attacker-supplied and
 * is a replay handle, so only its digest is persisted.
 */
export function hashIdempotencyKey(key: string): string {
  return createHash("sha256").update(String(key)).digest("hex")
}

export type Shift4AttemptOperation = "sale" | "authorization" | "capture" | "refund" | "void"

/**
 * The PineTree/Shift4 step inside a transaction chain.
 *
 * Distinct from the endpoint. A referral authorization and the manual (voice)
 * authorization that resolves it both use POST /transactions/authorization, so
 * `operation` alone cannot tell them apart — which is exactly why the earlier
 * operation-scoped invoice index rejected the manual authorization that retail
 * certification requires.
 *
 * `referral_authorization` and `partial_authorization` are RESOLVED roles:
 * Shift4's response produces them, and a caller may not request them directly.
 */
export type Shift4AttemptRole =
  | "sale"
  | "authorization"
  | "referral_authorization"
  | "manual_authorization"
  | "partial_authorization"
  | "capture"
  | "void"
  | "refund"
export type Shift4AttemptChannel = "retail" | "ecommerce"

export type Shift4AttemptState =
  | "created"
  | "dispatched"
  | "approved"
  | "declined"
  | "unresolved"
  | "action_required"
  | "reconciliation_required"
  | "abandoned"

export type Shift4AttemptRecoveryState =
  | "none"
  | "pending_lookup"
  | "resolved"
  | "exhausted"
  | "blocked"

/** A stored attempt, as the Engine reads it. Never carries a secret. */
export type Shift4PaymentAttemptRow = {
  id: string
  attempt_id: string
  merchant_id: string
  payment_id: string
  merchant_provider_connection_id: string
  operation: Shift4AttemptOperation
  channel: Shift4AttemptChannel
  attempt_number: number
  chain_id: string
  root_attempt_id: string
  attempt_role: Shift4AttemptRole
  related_attempt_id: string | null
  authorization_attempt_id: string | null
  refund_id: string | null
  tender_sequence: number
  remaining_amount_minor: number | null
  voice_center_account_number: string | null
  voice_center_phone_number: string | null
  // `manual_authorization_code` is deliberately absent: it is written once at
  // creation and never needs reading back, so it stays out of SAFE_COLUMNS and
  // out of this shape. `attempt_role === "manual_authorization"` is the signal
  // the Engine actually uses.
  request_fingerprint: string
  correlation_id: string
  invoice: string
  amount_minor: number
  approved_amount_minor: number | null
  authorized_amount_minor: number | null
  currency: string
  state: Shift4AttemptState
  recovery_state: Shift4AttemptRecoveryState
  timeout_classification: "timeout" | "communication_failure" | "invalid_response" | null
  resolution_reason: string | null
  lookup_attempt_count: number
  resend_count: number
  version: number
  response_code: string | null
  primary_code: number | null
  secondary_code: number | null
  authorization_code: string | null
  retrieval_reference: string | null
  sale_flag: string | null
  card_on_file_transaction_id: string | null
  avs_result: string | null
  csc_result: string | null
  entry_mode: string | null
  entry_channel: string | null
  card_token_fingerprint: string | null
  raw_response_ref: string | null
  evidence_source: string | null
  request_started_at: string
  request_dispatched_at: string | null
  provider_occurred_at: string | null
  received_at: string | null
  first_unknown_at: string | null
  next_check_at: string | null
  last_lookup_at: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
  lease_owner: string | null
  lease_expires_at: string | null
}

/**
 * Columns safe to select. `idempotency_key_hash` is deliberately excluded: the
 * Engine never needs to read it back, and not selecting it keeps it out of logs
 * and error payloads.
 */
const SAFE_COLUMNS = [
  "id", "attempt_id", "merchant_id", "payment_id", "merchant_provider_connection_id",
  "operation", "channel", "attempt_number",
  "chain_id", "root_attempt_id", "attempt_role",
  "related_attempt_id", "authorization_attempt_id", "refund_id",
  "tender_sequence", "remaining_amount_minor",
  "voice_center_account_number", "voice_center_phone_number",
  "request_fingerprint", "correlation_id", "invoice",
  "amount_minor", "approved_amount_minor", "authorized_amount_minor", "currency",
  "state", "recovery_state", "timeout_classification", "resolution_reason",
  "lookup_attempt_count", "resend_count", "version",
  "response_code", "primary_code", "secondary_code", "authorization_code",
  "retrieval_reference", "sale_flag", "card_on_file_transaction_id",
  "avs_result", "csc_result", "entry_mode", "entry_channel",
  "card_token_fingerprint", "raw_response_ref", "evidence_source",
  "request_started_at", "request_dispatched_at", "provider_occurred_at", "received_at",
  "first_unknown_at", "next_check_at", "last_lookup_at", "resolved_at",
  "created_at", "updated_at", "lease_owner", "lease_expires_at",
].join(", ")

/* ── Creation ─────────────────────────────────────────────────────────────── */

export type CreateShift4AttemptInput = {
  attemptId: string
  merchantId: string
  paymentId: string
  merchantProviderConnectionId: string
  operation: Shift4AttemptOperation
  channel: Shift4AttemptChannel
  invoice: string
  amountMinor: number
  currency: string
  idempotencyKeyHash: string
  requestFingerprint: string
  correlationId: string
  authorizationAttemptId?: string | null
  /** Generic transaction-chain parent: the authorization a capture closes, or
   *  the originating transaction a void reverses. */
  relatedAttemptId?: string | null
  /** Defaults from the endpoint. Required to distinguish manual authorization. */
  attemptRole?: Shift4AttemptRole
  /** Required for manual authorization: the code obtained by voice. */
  manualAuthorizationCode?: string | null
  refundId?: string | null
  authorizedAmountMinor?: number | null
  cardTokenFingerprint?: string | null
  attemptNumber?: number
}

export type CreateShift4AttemptResult = {
  outcome: "created" | "resumed" | "idempotency_conflict" | "invoice_collision" | "rejected"
  attemptId: string
  attemptRowId: string | null
  invoice: string | null
  state: Shift4AttemptState | null
  recoveryState: Shift4AttemptRecoveryState | null
  version: number | null
  conflictReason: string | null
}

/**
 * Create an attempt BEFORE the provider request is transmitted.
 *
 * The database is the authority on invoice collision and idempotency identity,
 * so a collision fails here rather than after a transaction has been sent.
 */
export async function createShift4PaymentAttempt(
  input: CreateShift4AttemptInput
): Promise<CreateShift4AttemptResult> {
  const { data, error } = await serviceRoleDb().rpc("create_shift4_payment_attempt", {
    p_attempt_id: input.attemptId,
    p_merchant_id: input.merchantId,
    p_payment_id: input.paymentId,
    p_merchant_provider_connection_id: input.merchantProviderConnectionId,
    p_operation: input.operation,
    p_channel: input.channel,
    p_invoice: input.invoice,
    p_amount_minor: assertSafeMinorUnits(input.amountMinor, "amountMinor"),
    p_currency: input.currency,
    p_idempotency_key_hash: input.idempotencyKeyHash,
    p_request_fingerprint: input.requestFingerprint,
    p_correlation_id: input.correlationId,
    p_authorization_attempt_id: input.authorizationAttemptId ?? null,
    p_refund_id: input.refundId ?? null,
    p_authorized_amount_minor: assertOptionalSafeMinorUnits(
      input.authorizedAmountMinor,
      "authorizedAmountMinor"
    ),
    p_card_token_fingerprint: input.cardTokenFingerprint ?? null,
    p_attempt_number: input.attemptNumber ?? 1,
    p_related_attempt_id:
      input.relatedAttemptId ?? input.authorizationAttemptId ?? null,
    p_attempt_role: input.attemptRole ?? null,
    p_manual_authorization_code: input.manualAuthorizationCode ?? null,
  })

  if (error) {
    throw new Error(`Failed to create Shift4 payment attempt: ${error.message}`)
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row) {
    throw new Error("create_shift4_payment_attempt returned no result")
  }

  return {
    outcome: row.outcome,
    attemptId: row.attempt_id,
    attemptRowId: row.attempt_row_id ?? null,
    invoice: row.invoice ?? null,
    state: row.state ?? null,
    recoveryState: row.recovery_state ?? null,
    version: row.version ?? null,
    conflictReason: row.conflict_reason ?? null,
  }
}

/* ── Evidence, transition, and ledger ─────────────────────────────────────── */

export type ApplyShift4EvidenceInput = {
  merchantId: string
  attemptId: string
  /** The version the caller read. A mismatch rejects the write as stale. */
  expectedVersion: number
  state: Shift4AttemptState
  recoveryState: Shift4AttemptRecoveryState
  /** Canonical status to advance to, or null to record evidence only. */
  targetStatus?: string | null
  shift4Event?: string
  responseCode?: string | null
  primaryCode?: number | null
  secondaryCode?: number | null
  authorizationCode?: string | null
  retrievalReference?: string | null
  saleFlag?: string | null
  cardOnFileTransactionId?: string | null
  avsResult?: string | null
  cscResult?: string | null
  entryMode?: string | null
  entryChannel?: string | null
  cardTokenFingerprint?: string | null
  rawResponseRef?: string | null
  evidenceSource?: string
  approvedAmountMinor?: number | null
  authorizedAmountMinor?: number | null
  providerOccurredAt?: string | null
  receivedAt?: string | null
  timeoutClassification?: "timeout" | "communication_failure" | "invalid_response" | null
  resolutionReason?: string | null
  nextCheckAt?: string | null
  firstUnknownAt?: string | null
  incrementLookupCount?: boolean
  incrementResendCount?: boolean
  releaseLease?: boolean
  markDispatched?: boolean
  /**
   * Required when the attempt is currently leased.
   *
   * Claiming does not bump `version`, so two workers can hold the same version
   * number. The database makes the lease authoritative for who may write, and
   * rejects a non-holder with `lease_conflict`.
   */
  leaseOwner?: string | null
  /** Referral evidence. Non-secret operational contact details only. */
  voiceCenterAccountNumber?: string | null
  voiceCenterPhoneNumber?: string | null
}

export type ApplyShift4EvidenceResult = {
  outcome:
    | "applied"
    | "evidence_recorded"
    | "already_applied"
    | "reconciliation_required"
    | "version_conflict"
    | "lease_conflict"
    | "lease_expired"
    | "rejected"
  attemptId: string
  version: number | null
  previousStatus: string | null
  appliedStatus: string | null
  ledgerPosted: boolean
  reconciliationRequired: boolean
  conflictReason: string | null
  attemptState: Shift4AttemptState | null
  attemptRecoveryState: Shift4AttemptRecoveryState | null
  attemptResolutionReason: string | null
  attemptNextCheckAt: string | null
  tenderGroupState: "open" | "settled" | "closed" | "reconciliation_required" | null
}

/**
 * Apply evidence, transition the payment, and post the ledger entry atomically.
 *
 * All three commit together or not at all, so a payment can never reach
 * CONFIRMED with a posted ledger entry and no durable evidence of why.
 */
export async function applyShift4AttemptEvidence(
  input: ApplyShift4EvidenceInput
): Promise<ApplyShift4EvidenceResult> {
  const { data, error } = await serviceRoleDb().rpc("apply_shift4_attempt_evidence", {
    p_merchant_id: input.merchantId,
    p_attempt_id: input.attemptId,
    p_expected_version: input.expectedVersion,
    p_state: input.state,
    p_recovery_state: input.recoveryState,
    p_target_status: input.targetStatus ?? null,
    p_shift4_event: input.shift4Event ?? "shift4.response_received",
    p_response_code: input.responseCode ?? null,
    p_primary_code: input.primaryCode ?? null,
    p_secondary_code: input.secondaryCode ?? null,
    p_authorization_code: input.authorizationCode ?? null,
    p_retrieval_reference: input.retrievalReference ?? null,
    p_sale_flag: input.saleFlag ?? null,
    p_card_on_file_transaction_id: input.cardOnFileTransactionId ?? null,
    p_avs_result: input.avsResult ?? null,
    p_csc_result: input.cscResult ?? null,
    p_entry_mode: input.entryMode ?? null,
    p_entry_channel: input.entryChannel ?? null,
    p_card_token_fingerprint: input.cardTokenFingerprint ?? null,
    p_raw_response_ref: input.rawResponseRef ?? null,
    p_evidence_source: input.evidenceSource ?? "provider_response",
    p_approved_amount_minor: assertOptionalSafeMinorUnits(
      input.approvedAmountMinor,
      "approvedAmountMinor"
    ),
    p_authorized_amount_minor: assertOptionalSafeMinorUnits(
      input.authorizedAmountMinor,
      "authorizedAmountMinor"
    ),
    p_provider_occurred_at: input.providerOccurredAt ?? null,
    p_received_at: input.receivedAt ?? null,
    p_timeout_classification: input.timeoutClassification ?? null,
    p_resolution_reason: input.resolutionReason ?? null,
    p_next_check_at: input.nextCheckAt ?? null,
    p_first_unknown_at: input.firstUnknownAt ?? null,
    p_increment_lookup_count: input.incrementLookupCount === true,
    p_increment_resend_count: input.incrementResendCount === true,
    p_release_lease: input.releaseLease !== false,
    p_mark_dispatched: input.markDispatched === true,
    p_lease_owner: input.leaseOwner ?? null,
    p_voice_center_account_number: input.voiceCenterAccountNumber ?? null,
    p_voice_center_phone_number: input.voiceCenterPhoneNumber ?? null,
  })

  if (error) {
    // Business-critical evidence: never downgraded to a warning.
    throw new Error(`Failed to apply Shift4 attempt evidence: ${error.message}`)
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row) {
    throw new Error("apply_shift4_attempt_evidence returned no result")
  }

  return {
    outcome: row.outcome,
    attemptId: row.attempt_id,
    version: row.version ?? null,
    previousStatus: row.previous_status ?? null,
    appliedStatus: row.applied_status ?? null,
    ledgerPosted: row.ledger_posted === true,
    reconciliationRequired: row.reconciliation_required === true,
    conflictReason: row.conflict_reason ?? null,
    attemptState: row.attempt_state ?? null,
    attemptRecoveryState: row.attempt_recovery_state ?? null,
    attemptResolutionReason: row.attempt_resolution_reason ?? null,
    attemptNextCheckAt: row.attempt_next_check_at ?? null,
    tenderGroupState: row.tender_group_state ?? null,
  }
}

/* ── Due-work claiming ────────────────────────────────────────────────────── */

export type ClaimDueShift4AttemptsInput = {
  leaseOwner: string
  leaseSeconds?: number
  limit?: number
  merchantId?: string | null
  merchantProviderConnectionId?: string | null
  paymentId?: string | null
  attemptId?: string | null
  now?: string
}

export type ClaimedShift4Attempt = {
  attemptId: string
  attemptRowId: string
  merchantId: string
  paymentId: string
  merchantProviderConnectionId: string
  operation: Shift4AttemptOperation
  channel: Shift4AttemptChannel
  invoice: string
  amountMinor: number
  authorizedAmountMinor: number | null
  currency: string
  state: Shift4AttemptState
  recoveryState: Shift4AttemptRecoveryState
  responseCode: string | null
  authorizationCode: string | null
  retrievalReference: string | null
  resolutionReason: string | null
  lookupAttemptCount: number
  resendCount: number
  version: number
  correlationId: string
  firstUnknownAt: string | null
  nextCheckAt: string | null
  leaseExpiresAt: string | null
}

/**
 * Claim a bounded batch of due, unresolved attempts.
 *
 * `FOR UPDATE SKIP LOCKED` inside the function means two workers can never take
 * the same row - the loser skips it rather than blocking.
 */
export async function claimDueShift4PaymentAttempts(
  input: ClaimDueShift4AttemptsInput
): Promise<ClaimedShift4Attempt[]> {
  const { data, error } = await serviceRoleDb().rpc("claim_due_shift4_payment_attempts", {
    p_lease_owner: input.leaseOwner,
    p_lease_seconds: input.leaseSeconds ?? 120,
    p_limit: input.limit ?? 25,
    p_merchant_id: input.merchantId ?? null,
    p_merchant_provider_connection_id: input.merchantProviderConnectionId ?? null,
    p_payment_id: input.paymentId ?? null,
    p_attempt_id: input.attemptId ?? null,
    p_now: input.now ?? new Date().toISOString(),
  })

  if (error) {
    throw new Error(`Failed to claim due Shift4 attempts: ${error.message}`)
  }

  return (data || []).map((row: Record<string, unknown>) => ({
    attemptId: String(row.attempt_id),
    attemptRowId: String(row.attempt_row_id),
    merchantId: String(row.merchant_id),
    paymentId: String(row.payment_id),
    merchantProviderConnectionId: String(row.merchant_provider_connection_id),
    operation: row.operation as Shift4AttemptOperation,
    channel: row.channel as Shift4AttemptChannel,
    invoice: String(row.invoice),
    amountMinor: parseMinorUnits(row.amount_minor, "amountMinor"),
    authorizedAmountMinor: parseOptionalMinorUnits(
      row.authorized_amount_minor,
      "authorizedAmountMinor"
    ),
    currency: String(row.currency),
    state: row.state as Shift4AttemptState,
    recoveryState: row.recovery_state as Shift4AttemptRecoveryState,
    responseCode: (row.response_code as string | null) ?? null,
    authorizationCode: (row.authorization_code as string | null) ?? null,
    retrievalReference: (row.retrieval_reference as string | null) ?? null,
    resolutionReason: (row.resolution_reason as string | null) ?? null,
    lookupAttemptCount: Number(row.lookup_attempt_count ?? 0),
    resendCount: Number(row.resend_count ?? 0),
    version: Number(row.version ?? 1),
    correlationId: String(row.correlation_id ?? ""),
    firstUnknownAt: (row.first_unknown_at as string | null) ?? null,
    nextCheckAt: (row.next_check_at as string | null) ?? null,
    leaseExpiresAt: (row.lease_expires_at as string | null) ?? null,
  }))
}

/** Hand a claimed attempt back without producing evidence. */
export async function releaseShift4AttemptLease(input: {
  merchantId: string
  attemptId: string
  leaseOwner: string
  nextCheckAt?: string | null
}): Promise<boolean> {
  const { data, error } = await serviceRoleDb().rpc("release_shift4_attempt_lease", {
    p_merchant_id: input.merchantId,
    p_attempt_id: input.attemptId,
    p_lease_owner: input.leaseOwner,
    p_next_check_at: input.nextCheckAt ?? null,
  })

  if (error) {
    throw new Error(`Failed to release Shift4 attempt lease: ${error.message}`)
  }
  return data === true
}

/* ── Reads ────────────────────────────────────────────────────────────────── */

/** Load one attempt, merchant-scoped. */
export async function getShift4PaymentAttempt(
  merchantId: string,
  attemptId: string
): Promise<Shift4PaymentAttemptRow | null> {
  const { data, error } = await serviceRoleDb()
    .from("shift4_payment_attempts")
    .select(SAFE_COLUMNS)
    .eq("merchant_id", merchantId)
    .eq("attempt_id", attemptId)
    .maybeSingle()

  if (error) throw new Error(`Failed to load Shift4 attempt: ${error.message}`)
  return (data ?? null) as Shift4PaymentAttemptRow | null
}

/** Load one safe attempt by provider invoice, always merchant scoped. */
export async function getShift4PaymentAttemptByInvoice(
  merchantId: string,
  invoice: string
): Promise<Shift4PaymentAttemptRow | null> {
  const { data, error } = await serviceRoleDb()
    .from("shift4_payment_attempts")
    .select(SAFE_COLUMNS)
    .eq("merchant_id", merchantId)
    .eq("invoice", invoice)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Failed to load Shift4 attempt by invoice: ${error.message}`)
  return (data ?? null) as Shift4PaymentAttemptRow | null
}

/** Every attempt on one payment, merchant-scoped, oldest first. */
export async function listShift4PaymentAttempts(
  merchantId: string,
  paymentId: string
): Promise<Shift4PaymentAttemptRow[]> {
  const { data, error } = await serviceRoleDb()
    .from("shift4_payment_attempts")
    .select(SAFE_COLUMNS)
    .eq("merchant_id", merchantId)
    .eq("payment_id", paymentId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })

  if (error) throw new Error(`Failed to list Shift4 attempts: ${error.message}`)
  return (data || []) as unknown as Shift4PaymentAttemptRow[]
}

/**
 * Due, unresolved attempts WITHOUT claiming them.
 *
 * Used only by reconciliation's dry run, which must not mutate anything. The
 * ordering matches the claim function and the partial index exactly.
 */
export async function listDueShift4PaymentAttempts(input: {
  now: string
  limit: number
  merchantId?: string | null
  merchantProviderConnectionId?: string | null
  paymentId?: string | null
  attemptId?: string | null
}): Promise<Shift4PaymentAttemptRow[]> {
  let query = serviceRoleDb()
    .from("shift4_payment_attempts")
    .select(SAFE_COLUMNS)
    .eq("recovery_state", "pending_lookup")
    .not("next_check_at", "is", null)
    .lte("next_check_at", input.now)
    .order("next_check_at", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(Math.max(1, Math.min(input.limit, 200)))

  if (input.merchantId) query = query.eq("merchant_id", input.merchantId)
  if (input.merchantProviderConnectionId) {
    query = query.eq("merchant_provider_connection_id", input.merchantProviderConnectionId)
  }
  if (input.paymentId) query = query.eq("payment_id", input.paymentId)
  if (input.attemptId) query = query.eq("attempt_id", input.attemptId)

  const { data, error } = await query
  if (error) throw new Error(`Failed to list due Shift4 attempts: ${error.message}`)
  return (data || []) as unknown as Shift4PaymentAttemptRow[]
}
