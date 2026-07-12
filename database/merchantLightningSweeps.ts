/**
 * Server-only access to merchant_lightning_sweeps - the queue/state machine
 * table for automatic Speed Custom Connect -> PineTree Wallet Lightning
 * sweeps. See engine/lightningSweep.ts for the state machine itself.
 *
 * SECURITY: This table has no anon/authenticated RLS policies (see
 * database/migrations/20260712_create_merchant_lightning_sweeps.sql) - only
 * the service-role client may read or write it. Never call this module from
 * a merchant-facing route.
 */

import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const supabase = supabaseAdmin || supabaseAnon
const TABLE = "merchant_lightning_sweeps"

export type MerchantLightningSweepStatus =
  | "queued"
  | "awaiting_configuration"
  | "awaiting_balance"
  | "awaiting_invoice"
  | "invoice_created"
  | "sending"
  | "processing"
  | "confirmed"
  | "retryable_failed"
  | "failed"
  | "canceled"

export type MerchantLightningSweep = {
  id: string
  merchant_id: string
  source_payment_id: string
  speed_connected_account_id: string
  speed_header_account_id: string | null
  destination_wallet_profile_id: string | null
  destination_invoice: string | null
  destination_invoice_hash: string | null
  destination_invoice_expires_at: string | null
  requested_amount_sats: number
  fee_reserve_sats: number
  sent_amount_sats: number | null
  provider_send_id: string | null
  provider_status: string | null
  status: MerchantLightningSweepStatus
  attempt_count: number
  idempotency_key: string
  next_attempt_at: string | null
  last_attempt_at: string | null
  last_error_code: string | null
  last_error_message: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

// Terminal statuses can never transition to any other status - this list is
// the single source of truth other modules (claim/retry logic, admin
// actions) must check against.
export const LIGHTNING_SWEEP_TERMINAL_STATUSES: ReadonlySet<MerchantLightningSweepStatus> = new Set([
  "confirmed",
  "failed",
  "canceled",
])

// Statuses a processing pass is allowed to pick up and attempt to advance.
export const LIGHTNING_SWEEP_CLAIMABLE_STATUSES: MerchantLightningSweepStatus[] = [
  "queued",
  "awaiting_configuration",
  "awaiting_balance",
  "awaiting_invoice",
  "invoice_created",
  "retryable_failed",
]

const SWEEP_VERSION = 1

/**
 * Stable idempotency key: one sweep per (merchant, source payment,
 * sweep_version). A repeated payment.paid webhook - retry or duplicate
 * delivery - always resolves to this same value, so the DB unique
 * constraint on idempotency_key is the final concurrency guard even if two
 * requests race past an in-memory check.
 */
export function buildLightningSweepIdempotencyKey(input: {
  merchantId: string
  sourcePaymentId: string
  sweepVersion?: number
}): string {
  const version = input.sweepVersion ?? SWEEP_VERSION
  return `lightning-sweep:v${version}:${input.merchantId}:${input.sourcePaymentId}`
}

function normalize(row: Record<string, unknown>): MerchantLightningSweep {
  return {
    id: String(row.id || ""),
    merchant_id: String(row.merchant_id || ""),
    source_payment_id: String(row.source_payment_id || ""),
    speed_connected_account_id: String(row.speed_connected_account_id || ""),
    speed_header_account_id: row.speed_header_account_id != null ? String(row.speed_header_account_id) : null,
    destination_wallet_profile_id: row.destination_wallet_profile_id != null ? String(row.destination_wallet_profile_id) : null,
    destination_invoice: row.destination_invoice != null ? String(row.destination_invoice) : null,
    destination_invoice_hash: row.destination_invoice_hash != null ? String(row.destination_invoice_hash) : null,
    destination_invoice_expires_at: row.destination_invoice_expires_at != null ? String(row.destination_invoice_expires_at) : null,
    requested_amount_sats: Number(row.requested_amount_sats || 0),
    fee_reserve_sats: Number(row.fee_reserve_sats || 0),
    sent_amount_sats: row.sent_amount_sats != null ? Number(row.sent_amount_sats) : null,
    provider_send_id: row.provider_send_id != null ? String(row.provider_send_id) : null,
    provider_status: row.provider_status != null ? String(row.provider_status) : null,
    status: String(row.status || "queued") as MerchantLightningSweepStatus,
    attempt_count: Number(row.attempt_count || 0),
    idempotency_key: String(row.idempotency_key || ""),
    next_attempt_at: row.next_attempt_at != null ? String(row.next_attempt_at) : null,
    last_attempt_at: row.last_attempt_at != null ? String(row.last_attempt_at) : null,
    last_error_code: row.last_error_code != null ? String(row.last_error_code) : null,
    last_error_message: row.last_error_message != null ? String(row.last_error_message) : null,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
    completed_at: row.completed_at != null ? String(row.completed_at) : null,
  }
}

export async function getLightningSweepByIdempotencyKey(
  idempotencyKey: string
): Promise<MerchantLightningSweep | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle()

  if (error) throw new Error(`Failed to load Lightning sweep: ${error.message}`)
  return data ? normalize(data as Record<string, unknown>) : null
}

export async function getLightningSweepById(id: string): Promise<MerchantLightningSweep | null> {
  const { data, error } = await supabase.from(TABLE).select("*").eq("id", id).maybeSingle()
  if (error) throw new Error(`Failed to load Lightning sweep: ${error.message}`)
  return data ? normalize(data as Record<string, unknown>) : null
}

export async function getLightningSweepBySourcePayment(
  sourcePaymentId: string
): Promise<MerchantLightningSweep | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("source_payment_id", sourcePaymentId)
    .maybeSingle()

  if (error) throw new Error(`Failed to load Lightning sweep: ${error.message}`)
  return data ? normalize(data as Record<string, unknown>) : null
}

export type CreateLightningSweepInput = {
  merchantId: string
  sourcePaymentId: string
  speedConnectedAccountId: string
  requestedAmountSats: number
  feeReserveSats?: number
  status?: MerchantLightningSweepStatus
  sweepVersion?: number
}

/**
 * Idempotent creation - a repeated call with the same (merchant, source
 * payment) always returns the existing row rather than creating a second
 * one. The DB unique constraint on idempotency_key is the final guard
 * against a race between two concurrent callers (webhook retry + manual
 * admin action, etc.) - do not rely only on the check-then-insert above it.
 */
export async function createLightningSweepIfMissing(
  input: CreateLightningSweepInput
): Promise<MerchantLightningSweep> {
  const idempotencyKey = buildLightningSweepIdempotencyKey({
    merchantId: input.merchantId,
    sourcePaymentId: input.sourcePaymentId,
    sweepVersion: input.sweepVersion,
  })

  const existing = await getLightningSweepByIdempotencyKey(idempotencyKey)
  if (existing) return existing

  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      merchant_id: input.merchantId,
      source_payment_id: input.sourcePaymentId,
      speed_connected_account_id: input.speedConnectedAccountId,
      requested_amount_sats: input.requestedAmountSats,
      fee_reserve_sats: input.feeReserveSats ?? 0,
      status: input.status ?? "queued",
      idempotency_key: idempotencyKey,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single()

  if (error || !data) {
    // Unique-constraint race: another caller (concurrent webhook retry, or a
    // parallel admin action) inserted the same idempotency_key first.
    const raced = await getLightningSweepByIdempotencyKey(idempotencyKey)
    if (raced) return raced
    throw new Error(`Failed to create Lightning sweep: ${error?.message || "No data"}`)
  }
  return normalize(data as Record<string, unknown>)
}

/**
 * Compare-and-set claim: only succeeds if the row is currently in a
 * claimable (non-terminal, not-already-processing) status. Never increments
 * attempt_count itself - see incrementLightningSweepAttempt, called only
 * immediately before a real provider send attempt, not for balance/invoice
 * steps or while configuration is missing.
 */
export async function claimLightningSweepForProcessing(
  id: string
): Promise<MerchantLightningSweep | null> {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from(TABLE)
    .update({ status: "processing", last_attempt_at: now, updated_at: now })
    .eq("id", id)
    .in("status", LIGHTNING_SWEEP_CLAIMABLE_STATUSES)
    .select("*")
    .maybeSingle()

  if (error || !data) return null
  return normalize(data as Record<string, unknown>)
}

/**
 * Increments attempt_count - call this only immediately before issuing a
 * real Speed Instant Send HTTP request. Waiting for missing endpoint
 * configuration, a balance check, or invoice creation must never consume an
 * attempt.
 */
export async function incrementLightningSweepAttempt(id: string): Promise<MerchantLightningSweep> {
  const current = await getLightningSweepById(id)
  if (!current) throw new Error("Cannot increment attempt count: Lightning sweep not found")

  const { data, error } = await supabase
    .from(TABLE)
    .update({ attempt_count: current.attempt_count + 1, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single()

  if (error || !data) {
    throw new Error(`Failed to increment Lightning sweep attempt count: ${error?.message || "No data"}`)
  }
  return normalize(data as Record<string, unknown>)
}

export type UpdateLightningSweepInput = Partial<{
  status: MerchantLightningSweepStatus
  speedHeaderAccountId: string | null
  destinationWalletProfileId: string | null
  destinationInvoice: string | null
  destinationInvoiceHash: string | null
  destinationInvoiceExpiresAt: string | null
  sentAmountSats: number | null
  providerSendId: string | null
  providerStatus: string | null
  nextAttemptAt: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  completedAt: string | null
}>

export async function updateLightningSweep(
  id: string,
  input: UpdateLightningSweepInput
): Promise<MerchantLightningSweep> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input.status !== undefined) row.status = input.status
  if (input.speedHeaderAccountId !== undefined) row.speed_header_account_id = input.speedHeaderAccountId
  if (input.destinationWalletProfileId !== undefined) row.destination_wallet_profile_id = input.destinationWalletProfileId
  if (input.destinationInvoice !== undefined) row.destination_invoice = input.destinationInvoice
  if (input.destinationInvoiceHash !== undefined) row.destination_invoice_hash = input.destinationInvoiceHash
  if (input.destinationInvoiceExpiresAt !== undefined) row.destination_invoice_expires_at = input.destinationInvoiceExpiresAt
  if (input.sentAmountSats !== undefined) row.sent_amount_sats = input.sentAmountSats
  if (input.providerSendId !== undefined) row.provider_send_id = input.providerSendId
  if (input.providerStatus !== undefined) row.provider_status = input.providerStatus
  if (input.nextAttemptAt !== undefined) row.next_attempt_at = input.nextAttemptAt
  // Error fields are cleared together whenever one is written, and together
  // whenever the sweep advances past a failure - never leave a stale error
  // message attached to a status that no longer reflects it.
  if (input.lastErrorCode !== undefined) row.last_error_code = input.lastErrorCode
  if (input.lastErrorMessage !== undefined) row.last_error_message = input.lastErrorMessage
  if (input.completedAt !== undefined) row.completed_at = input.completedAt

  const { data, error } = await supabase.from(TABLE).update(row).eq("id", id).select("*").single()

  if (error || !data) {
    throw new Error(`Failed to update Lightning sweep: ${error?.message || "No data"}`)
  }
  return normalize(data as Record<string, unknown>)
}

/**
 * Sweeps ready for a processing pass right now: a claimable status, and
 * either never scheduled or due (next_attempt_at <= now).
 */
export async function listProcessableLightningSweeps(limit = 5): Promise<MerchantLightningSweep[]> {
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .in("status", LIGHTNING_SWEEP_CLAIMABLE_STATUSES)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .order("created_at", { ascending: true })
    .limit(limit)

  if (error) throw new Error(`Failed to list processable Lightning sweeps: ${error.message}`)
  return (data || []).map((row) => normalize(row as Record<string, unknown>))
}

/**
 * Used by the wallet-page-load trigger to decide whether a bounded
 * best-effort processing pass is worth scheduling for this merchant right
 * now - never used to drive client-side polling.
 */
export async function hasProcessableLightningSweepForMerchant(merchantId: string): Promise<boolean> {
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from(TABLE)
    .select("id")
    .eq("merchant_id", merchantId)
    .in("status", LIGHTNING_SWEEP_CLAIMABLE_STATUSES)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .limit(1)
    .maybeSingle()

  if (error) return false
  return Boolean(data)
}

export async function listLightningSweepsForMerchant(
  merchantId: string,
  limit = 25
): Promise<MerchantLightningSweep[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Failed to list Lightning sweeps: ${error.message}`)
  return (data || []).map((row) => normalize(row as Record<string, unknown>))
}

export async function listLightningSweepsForAdmin(limit = 50): Promise<MerchantLightningSweep[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Failed to list Lightning sweeps: ${error.message}`)
  return (data || []).map((row) => normalize(row as Record<string, unknown>))
}
