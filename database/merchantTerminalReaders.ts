import { supabase, supabaseAdmin } from "./supabase"

const db = supabaseAdmin || supabase

/**
 * Provider terminal readers (card readers), one row per merchant per
 * provider reader. Registration codes are NEVER stored here — only the
 * provider's reader ID and safe metadata. `active_payment_id` is the
 * concurrency claim: a reader processes at most one PineTree payment at a
 * time, enforced with a conditional update. Service-role access only.
 */
export type MerchantTerminalReader = {
  id: string
  merchant_id: string
  terminal_location_id: string | null
  provider: string
  provider_reader_id: string
  label: string
  device_type: string
  serial_number: string | null
  status: string
  simulated: boolean
  is_default: boolean
  active_payment_id: string | null
  last_seen_at: string | null
  created_at?: string
  updated_at?: string
}

export async function listMerchantTerminalReaders(
  merchantId: string,
  provider = "stripe"
): Promise<MerchantTerminalReader[]> {
  const { data, error } = await db
    .from("merchant_terminal_readers")
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("provider", provider)
    .order("created_at", { ascending: true })

  if (error) throw new Error(`Failed to list terminal readers: ${error.message}`)
  return (data || []) as MerchantTerminalReader[]
}

export async function getMerchantTerminalReaderById(
  merchantId: string,
  readerId: string
): Promise<MerchantTerminalReader | null> {
  const { data, error } = await db
    .from("merchant_terminal_readers")
    .select("*")
    .eq("id", readerId)
    .eq("merchant_id", merchantId)
    .maybeSingle()

  if (error) throw new Error(`Failed to load terminal reader: ${error.message}`)
  return (data as MerchantTerminalReader) || null
}

export async function upsertMerchantTerminalReader(input: {
  merchantId: string
  provider?: string
  providerReaderId: string
  terminalLocationId?: string | null
  label: string
  deviceType: string
  serialNumber?: string | null
  status: string
  simulated: boolean
  lastSeenAt?: string | null
}): Promise<MerchantTerminalReader> {
  const now = new Date().toISOString()
  const { data, error } = await db
    .from("merchant_terminal_readers")
    .upsert(
      {
        merchant_id: input.merchantId,
        provider: input.provider || "stripe",
        provider_reader_id: input.providerReaderId,
        ...(input.terminalLocationId !== undefined ? { terminal_location_id: input.terminalLocationId } : {}),
        label: input.label,
        device_type: input.deviceType,
        serial_number: input.serialNumber ?? null,
        status: input.status,
        simulated: input.simulated,
        last_seen_at: input.lastSeenAt ?? now,
        updated_at: now
      },
      { onConflict: "merchant_id,provider,provider_reader_id" }
    )
    .select("*")
    .single()

  if (error || !data) throw new Error(`Failed to save terminal reader: ${error?.message || "unknown error"}`)
  return data as MerchantTerminalReader
}

/**
 * Replaces one existing reader's configuration IN PLACE, addressed by its
 * PineTree row id.
 *
 * Distinct from `upsertMerchantTerminalReader`, which conflicts on
 * `(merchant_id, provider, provider_reader_id)` and therefore INSERTS a second
 * row when the provider reader id changes — exactly the silent duplicate an
 * "edit the terminal ID" action must not create.
 *
 * `provider` is part of the filter, not just the payload, so a call scoped to
 * one provider can never rewrite another provider's reader even if given its id.
 */
export async function replaceMerchantTerminalReaderById(input: {
  merchantId: string
  readerId: string
  provider: string
  providerReaderId: string
  terminalLocationId: string | null
  label: string
  deviceType: string
  serialNumber: string | null
  status: string
}): Promise<MerchantTerminalReader> {
  const { data, error } = await db
    .from("merchant_terminal_readers")
    .update({
      provider_reader_id: input.providerReaderId,
      terminal_location_id: input.terminalLocationId,
      label: input.label,
      device_type: input.deviceType,
      serial_number: input.serialNumber,
      status: input.status,
      updated_at: new Date().toISOString()
    })
    .eq("id", input.readerId)
    .eq("merchant_id", input.merchantId)
    .eq("provider", input.provider)
    .select("*")
    .maybeSingle()

  if (error) throw new Error(`Failed to replace terminal reader: ${error.message}`)
  if (!data) throw new Error("Reader not found for this merchant and provider")
  return data as MerchantTerminalReader
}

/** Marks one reader as the merchant default (clears any previous default). */
export async function setMerchantDefaultTerminalReader(
  merchantId: string,
  readerId: string,
  provider = "stripe"
): Promise<void> {
  const now = new Date().toISOString()

  const { error: clearError } = await db
    .from("merchant_terminal_readers")
    .update({ is_default: false, updated_at: now })
    .eq("merchant_id", merchantId)
    .eq("provider", provider)
    .eq("is_default", true)

  if (clearError) throw new Error(`Failed to clear default reader: ${clearError.message}`)

  const { data, error } = await db
    .from("merchant_terminal_readers")
    .update({ is_default: true, updated_at: now })
    .eq("id", readerId)
    .eq("merchant_id", merchantId)
    .eq("provider", provider)
    .select("id")

  if (error) throw new Error(`Failed to set default reader: ${error.message}`)
  if (!data || data.length === 0) throw new Error("Reader not found for this merchant")
}

/**
 * Atomically claims a reader for one PineTree payment. Succeeds only when
 * the reader currently has no active payment (or already holds this
 * payment, making retries idempotent). Returns false when the reader is
 * busy with a different payment.
 */
export async function claimTerminalReaderForPayment(
  merchantId: string,
  readerId: string,
  paymentId: string
): Promise<boolean> {
  const now = new Date().toISOString()

  const { data: reclaimed, error: reclaimError } = await db
    .from("merchant_terminal_readers")
    .update({ updated_at: now })
    .eq("id", readerId)
    .eq("merchant_id", merchantId)
    .eq("active_payment_id", paymentId)
    .select("id")

  if (reclaimError) throw new Error(`Failed to claim reader: ${reclaimError.message}`)
  if (reclaimed && reclaimed.length > 0) return true

  const { data, error } = await db
    .from("merchant_terminal_readers")
    .update({ active_payment_id: paymentId, updated_at: now })
    .eq("id", readerId)
    .eq("merchant_id", merchantId)
    .is("active_payment_id", null)
    .select("id")

  if (error) throw new Error(`Failed to claim reader: ${error.message}`)
  return Boolean(data && data.length > 0)
}

/** Releases a reader claim. Scoped to the payment so stale releases are no-ops. */
export async function releaseTerminalReaderClaim(paymentId: string): Promise<void> {
  const { error } = await db
    .from("merchant_terminal_readers")
    .update({ active_payment_id: null, updated_at: new Date().toISOString() })
    .eq("active_payment_id", paymentId)

  if (error) throw new Error(`Failed to release reader claim: ${error.message}`)
}

/** Finds the reader currently claimed by a payment, if any. */
export async function getTerminalReaderByActivePayment(
  paymentId: string
): Promise<MerchantTerminalReader | null> {
  const { data, error } = await db
    .from("merchant_terminal_readers")
    .select("*")
    .eq("active_payment_id", paymentId)
    .maybeSingle()

  if (error) throw new Error(`Failed to load reader by payment: ${error.message}`)
  return (data as MerchantTerminalReader) || null
}

/**
 * Records provider status evidence for ONE reader owned by ONE merchant.
 *
 * Distinct from `updateTerminalReaderStatusByProviderId`, which matches on
 * `provider_reader_id` across every merchant — safe for a provider webhook that
 * carries no merchant, unsafe for an operator-initiated check where the
 * merchant is known and must be enforced. `merchant_id` and `provider` are part
 * of the filter, so an id belonging to another tenant updates nothing and
 * returns null rather than throwing something a caller could distinguish.
 *
 * `last_seen_at` is the evidence timestamp used for freshness. No migration is
 * needed: both columns already exist.
 */
export async function recordTerminalReaderProviderStatus(input: {
  merchantId: string
  readerId: string
  provider: string
  status: string
  observedAt: string
}): Promise<MerchantTerminalReader | null> {
  const { data, error } = await db
    .from("merchant_terminal_readers")
    .update({
      status: input.status,
      last_seen_at: input.observedAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.readerId)
    .eq("merchant_id", input.merchantId)
    .eq("provider", input.provider)
    .select("*")
    .maybeSingle()

  if (error) throw new Error(`Failed to record reader status: ${error.message}`)
  return (data as MerchantTerminalReader) || null
}

/** Updates reader status from a provider webhook/sync (by provider reader id). */
export async function updateTerminalReaderStatusByProviderId(
  providerReaderId: string,
  status: string,
  provider = "stripe"
): Promise<void> {
  const { error } = await db
    .from("merchant_terminal_readers")
    .update({ status, last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("provider", provider)
    .eq("provider_reader_id", providerReaderId)

  if (error) throw new Error(`Failed to update reader status: ${error.message}`)
}
