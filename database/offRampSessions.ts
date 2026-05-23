import { supabase, supabaseAdmin } from "./supabase"

const db = supabaseAdmin || supabase

export type OffRampSessionStatus =
  | "CREATED"
  | "SETUP_REQUIRED"
  | "QUOTE_READY"
  | "AWAITING_APPROVAL"
  | "AWAITING_CRYPTO"
  | "SUBMITTED"
  | "PROCESSING"
  | "PAYOUT_INITIATED"
  | "COMPLETED"
  | "FAILED"
  | "EXPIRED"
  | "CANCELLED"

export type OffRampSessionRecord = {
  id: string
  merchant_id: string
  provider: string
  provider_session_id: string | null
  external_transaction_id: string | null
  asset: string
  network: string
  crypto_amount: number | null
  quote_fiat_amount: number | null
  quote_fiat_currency: string
  quote_fee_amount: number | null
  platform_fee_amount: number | null
  quote_expires_at: string | null
  source_wallet_address: string | null
  refund_wallet_address: string | null
  payout_method: string | null
  status: OffRampSessionStatus
  provider_status: string | null
  crypto_tx_hash: string | null
  fiat_settled_at: string | null
  fiat_settled_amount: number | null
  error_code: string | null
  error_message: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type OffRampEventRecord = {
  id: string
  off_ramp_session_id: string
  merchant_id: string
  event_type: string
  provider: string
  provider_event_id: string | null
  provider_status: string | null
  raw_payload: Record<string, unknown>
  created_at: string
}

export type CreateOffRampSessionDraftInput = {
  merchantId: string
  provider: string
  asset: string
  network: string
  cryptoAmount?: number | null
  quoteFiatCurrency?: string | null
  sourceWalletAddress?: string | null
  refundWalletAddress?: string | null
  payoutMethod?: string | null
  status?: OffRampSessionStatus
  errorCode?: string | null
  errorMessage?: string | null
  metadata?: Record<string, unknown>
}

export type ListOffRampSessionsOptions = {
  limit?: number
  status?: OffRampSessionStatus
}

export type UpdateOffRampSessionStatusInput = {
  merchantId: string
  sessionId: string
  status: OffRampSessionStatus
  providerStatus?: string | null
  providerSessionId?: string | null
  externalTransactionId?: string | null
  cryptoTxHash?: string | null
  fiatSettledAt?: string | null
  fiatSettledAmount?: number | null
  errorCode?: string | null
  errorMessage?: string | null
  metadata?: Record<string, unknown>
}

export type UpdateOffRampSessionQuoteInput = {
  merchantId: string
  sessionId: string
  status: OffRampSessionStatus
  cryptoAmount?: number | null
  quoteFiatAmount?: number | null
  quoteFiatCurrency?: string | null
  quoteFeeAmount?: number | null
  platformFeeAmount?: number | null
  quoteExpiresAt?: string | null
  payoutMethod?: string | null
  providerStatus?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  metadata?: Record<string, unknown>
}

export type RecordOffRampEventInput = {
  sessionId: string
  merchantId: string
  eventType: string
  provider?: string | null
  providerEventId?: string | null
  providerStatus?: string | null
  rawPayload?: Record<string, unknown>
}

export type UpdateOffRampSessionFromProviderStatusInput = {
  provider: string
  sessionId: string
  status?: OffRampSessionStatus
  providerStatus?: string | null
  providerSessionId?: string | null
  externalTransactionId?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  metadata?: Record<string, unknown>
}

function requireValue(value: string, label: string) {
  const normalized = String(value || "").trim()
  if (!normalized) {
    throw new Error(`${label} is required`)
  }
  return normalized
}

function normalizeRecord(row: Record<string, unknown>): OffRampSessionRecord {
  return {
    id: String(row.id || ""),
    merchant_id: String(row.merchant_id || ""),
    provider: String(row.provider || "moonpay"),
    provider_session_id: row.provider_session_id ? String(row.provider_session_id) : null,
    external_transaction_id: row.external_transaction_id ? String(row.external_transaction_id) : null,
    asset: String(row.asset || ""),
    network: String(row.network || ""),
    crypto_amount: row.crypto_amount == null ? null : Number(row.crypto_amount),
    quote_fiat_amount: row.quote_fiat_amount == null ? null : Number(row.quote_fiat_amount),
    quote_fiat_currency: String(row.quote_fiat_currency || "USD"),
    quote_fee_amount: row.quote_fee_amount == null ? null : Number(row.quote_fee_amount),
    platform_fee_amount: row.platform_fee_amount == null ? null : Number(row.platform_fee_amount),
    quote_expires_at: row.quote_expires_at ? String(row.quote_expires_at) : null,
    source_wallet_address: row.source_wallet_address ? String(row.source_wallet_address) : null,
    refund_wallet_address: row.refund_wallet_address ? String(row.refund_wallet_address) : null,
    payout_method: row.payout_method ? String(row.payout_method) : null,
    status: String(row.status || "CREATED") as OffRampSessionStatus,
    provider_status: row.provider_status ? String(row.provider_status) : null,
    crypto_tx_hash: row.crypto_tx_hash ? String(row.crypto_tx_hash) : null,
    fiat_settled_at: row.fiat_settled_at ? String(row.fiat_settled_at) : null,
    fiat_settled_amount: row.fiat_settled_amount == null ? null : Number(row.fiat_settled_amount),
    error_code: row.error_code ? String(row.error_code) : null,
    error_message: row.error_message ? String(row.error_message) : null,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? row.metadata as Record<string, unknown>
        : {},
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || "")
  }
}

function normalizeEventRecord(row: Record<string, unknown>): OffRampEventRecord {
  return {
    id: String(row.id || ""),
    off_ramp_session_id: String(row.off_ramp_session_id || ""),
    merchant_id: String(row.merchant_id || ""),
    event_type: String(row.event_type || ""),
    provider: String(row.provider || "moonpay"),
    provider_event_id: row.provider_event_id ? String(row.provider_event_id) : null,
    provider_status: row.provider_status ? String(row.provider_status) : null,
    raw_payload:
      row.raw_payload && typeof row.raw_payload === "object" && !Array.isArray(row.raw_payload)
        ? row.raw_payload as Record<string, unknown>
        : {},
    created_at: String(row.created_at || "")
  }
}

export async function createOffRampSessionDraft(
  input: CreateOffRampSessionDraftInput
): Promise<OffRampSessionRecord> {
  const merchantId = requireValue(input.merchantId, "merchantId")
  const provider = requireValue(input.provider, "provider")
  const asset = requireValue(input.asset, "asset")
  const network = requireValue(input.network, "network")
  const now = new Date().toISOString()

  const { data, error } = await db
    .from("off_ramp_sessions")
    .insert({
      merchant_id: merchantId,
      provider,
      asset,
      network,
      crypto_amount: input.cryptoAmount ?? null,
      quote_fiat_currency: String(input.quoteFiatCurrency || "USD").trim().toUpperCase(),
      source_wallet_address: input.sourceWalletAddress || null,
      refund_wallet_address: input.refundWalletAddress || null,
      payout_method: input.payoutMethod || null,
      status: input.status || "CREATED",
      error_code: input.errorCode || null,
      error_message: input.errorMessage || null,
      metadata: input.metadata || {},
      updated_at: now
    })
    .select("*")
    .single()

  if (error) {
    throw new Error(`Failed to create off-ramp session draft: ${error.message}`)
  }

  return normalizeRecord(data as Record<string, unknown>)
}

export async function getOffRampSessionForMerchant(
  merchantId: string,
  sessionId: string
): Promise<OffRampSessionRecord | null> {
  const normalizedMerchantId = requireValue(merchantId, "merchantId")
  const normalizedSessionId = requireValue(sessionId, "sessionId")

  const { data, error } = await db
    .from("off_ramp_sessions")
    .select("*")
    .eq("merchant_id", normalizedMerchantId)
    .eq("id", normalizedSessionId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to fetch off-ramp session: ${error.message}`)
  }

  return data ? normalizeRecord(data as Record<string, unknown>) : null
}

export async function getOffRampSessionByExternalTransactionId(
  provider: string,
  externalTransactionId: string
): Promise<OffRampSessionRecord | null> {
  const normalizedProvider = requireValue(provider, "provider")
  const normalizedExternalTransactionId = requireValue(externalTransactionId, "externalTransactionId")

  const { data, error } = await db
    .from("off_ramp_sessions")
    .select("*")
    .eq("provider", normalizedProvider)
    .eq("external_transaction_id", normalizedExternalTransactionId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to fetch off-ramp session by external transaction ID: ${error.message}`)
  }

  if (data) return normalizeRecord(data as Record<string, unknown>)

  const { data: sessionData, error: sessionError } = await db
    .from("off_ramp_sessions")
    .select("*")
    .eq("provider", normalizedProvider)
    .eq("id", normalizedExternalTransactionId)
    .maybeSingle()

  if (sessionError) {
    throw new Error(`Failed to fetch off-ramp session by mapped session ID: ${sessionError.message}`)
  }

  return sessionData ? normalizeRecord(sessionData as Record<string, unknown>) : null
}

export async function getOffRampSessionByProviderSessionId(
  provider: string,
  providerSessionId: string
): Promise<OffRampSessionRecord | null> {
  const normalizedProvider = requireValue(provider, "provider")
  const normalizedProviderSessionId = requireValue(providerSessionId, "providerSessionId")

  const { data, error } = await db
    .from("off_ramp_sessions")
    .select("*")
    .eq("provider", normalizedProvider)
    .eq("provider_session_id", normalizedProviderSessionId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to fetch off-ramp session by provider session ID: ${error.message}`)
  }

  return data ? normalizeRecord(data as Record<string, unknown>) : null
}

export async function listOffRampSessionsForMerchant(
  merchantId: string,
  options: ListOffRampSessionsOptions = {}
): Promise<OffRampSessionRecord[]> {
  const normalizedMerchantId = requireValue(merchantId, "merchantId")
  const limit = Math.min(Math.max(Number(options.limit ?? 25) || 25, 1), 100)

  let query = db
    .from("off_ramp_sessions")
    .select("*")
    .eq("merchant_id", normalizedMerchantId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (options.status) {
    query = query.eq("status", options.status)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`Failed to list off-ramp sessions: ${error.message}`)
  }

  return (data || []).map((row) => normalizeRecord(row as Record<string, unknown>))
}

export async function updateOffRampSessionStatus(
  input: UpdateOffRampSessionStatusInput
): Promise<OffRampSessionRecord> {
  const merchantId = requireValue(input.merchantId, "merchantId")
  const sessionId = requireValue(input.sessionId, "sessionId")

  const update: Record<string, unknown> = {
    status: input.status,
    updated_at: new Date().toISOString()
  }

  if (input.providerStatus !== undefined) update.provider_status = input.providerStatus
  if (input.providerSessionId !== undefined) update.provider_session_id = input.providerSessionId
  if (input.externalTransactionId !== undefined) update.external_transaction_id = input.externalTransactionId
  if (input.cryptoTxHash !== undefined) update.crypto_tx_hash = input.cryptoTxHash
  if (input.fiatSettledAt !== undefined) update.fiat_settled_at = input.fiatSettledAt
  if (input.fiatSettledAmount !== undefined) update.fiat_settled_amount = input.fiatSettledAmount
  if (input.errorCode !== undefined) update.error_code = input.errorCode
  if (input.errorMessage !== undefined) update.error_message = input.errorMessage
  if (input.metadata !== undefined) update.metadata = input.metadata

  const { data, error } = await db
    .from("off_ramp_sessions")
    .update(update)
    .eq("merchant_id", merchantId)
    .eq("id", sessionId)
    .select("*")
    .single()

  if (error) {
    throw new Error(`Failed to update off-ramp session status: ${error.message}`)
  }

  return normalizeRecord(data as Record<string, unknown>)
}

export async function updateOffRampSessionFromProviderStatus(
  input: UpdateOffRampSessionFromProviderStatusInput
): Promise<OffRampSessionRecord> {
  const provider = requireValue(input.provider, "provider")
  const sessionId = requireValue(input.sessionId, "sessionId")

  const { data: existingData, error: existingError } = await db
    .from("off_ramp_sessions")
    .select("*")
    .eq("provider", provider)
    .eq("id", sessionId)
    .maybeSingle()

  if (existingError) {
    throw new Error(`Failed to fetch off-ramp session for provider status update: ${existingError.message}`)
  }

  if (!existingData) {
    throw new Error("Off-ramp session not found for provider status update")
  }

  const existing = normalizeRecord(existingData as Record<string, unknown>)

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  }

  if (input.status !== undefined) update.status = input.status
  if (input.providerStatus !== undefined) update.provider_status = input.providerStatus
  if (input.providerSessionId !== undefined) update.provider_session_id = input.providerSessionId
  if (input.externalTransactionId !== undefined) update.external_transaction_id = input.externalTransactionId
  if (input.errorCode !== undefined) update.error_code = input.errorCode
  if (input.errorMessage !== undefined) update.error_message = input.errorMessage
  if (input.metadata !== undefined) {
    update.metadata = {
      ...existing.metadata,
      ...input.metadata
    }
  }

  const { data, error } = await db
    .from("off_ramp_sessions")
    .update(update)
    .eq("provider", provider)
    .eq("id", sessionId)
    .select("*")
    .single()

  if (error) {
    throw new Error(`Failed to update off-ramp session from provider status: ${error.message}`)
  }

  return normalizeRecord(data as Record<string, unknown>)
}

export async function updateOffRampSessionQuote(
  input: UpdateOffRampSessionQuoteInput
): Promise<OffRampSessionRecord> {
  const merchantId = requireValue(input.merchantId, "merchantId")
  const sessionId = requireValue(input.sessionId, "sessionId")
  const existing = await getOffRampSessionForMerchant(merchantId, sessionId)

  if (!existing) {
    throw new Error("Off-ramp session not found")
  }

  const update: Record<string, unknown> = {
    status: input.status,
    updated_at: new Date().toISOString(),
    metadata: {
      ...existing.metadata,
      ...(input.metadata || {})
    }
  }

  if (input.cryptoAmount !== undefined) update.crypto_amount = input.cryptoAmount
  if (input.quoteFiatAmount !== undefined) update.quote_fiat_amount = input.quoteFiatAmount
  if (input.quoteFiatCurrency !== undefined) {
    update.quote_fiat_currency = String(input.quoteFiatCurrency || "USD").trim().toUpperCase()
  }
  if (input.quoteFeeAmount !== undefined) update.quote_fee_amount = input.quoteFeeAmount
  if (input.platformFeeAmount !== undefined) update.platform_fee_amount = input.platformFeeAmount
  if (input.quoteExpiresAt !== undefined) update.quote_expires_at = input.quoteExpiresAt
  if (input.payoutMethod !== undefined) update.payout_method = input.payoutMethod
  if (input.providerStatus !== undefined) update.provider_status = input.providerStatus
  if (input.errorCode !== undefined) update.error_code = input.errorCode
  if (input.errorMessage !== undefined) update.error_message = input.errorMessage

  const { data, error } = await db
    .from("off_ramp_sessions")
    .update(update)
    .eq("merchant_id", merchantId)
    .eq("id", sessionId)
    .select("*")
    .single()

  if (error) {
    throw new Error(`Failed to update off-ramp session quote: ${error.message}`)
  }

  return normalizeRecord(data as Record<string, unknown>)
}

export async function recordOffRampEvent(
  input: RecordOffRampEventInput
): Promise<OffRampEventRecord> {
  const sessionId = requireValue(input.sessionId, "sessionId")
  const merchantId = requireValue(input.merchantId, "merchantId")
  const eventType = requireValue(input.eventType, "eventType")

  const { data, error } = await db
    .from("off_ramp_events")
    .insert({
      off_ramp_session_id: sessionId,
      merchant_id: merchantId,
      event_type: eventType,
      provider: input.provider || "moonpay",
      provider_event_id: input.providerEventId || null,
      provider_status: input.providerStatus || null,
      raw_payload: input.rawPayload || {}
    })
    .select("*")
    .single()

  if (error) {
    throw new Error(`Failed to record off-ramp event: ${error.message}`)
  }

  return normalizeEventRecord(data as Record<string, unknown>)
}
