import { supabase, supabaseAdmin } from "./supabase"

const db = supabaseAdmin || supabase
const TABLE = "merchant_wallet_send_sessions"

export type SendSessionStatus =
  | "created"
  | "opened"
  | "wallet_connecting"
  | "wallet_connected"
  | "approval_requested"
  | "approved"
  | "submitted"
  | "rejected"
  | "expired"
  | "failed"

export type MerchantWalletSendSession = {
  id: string
  merchant_id: string
  wallet_id: string
  rail: string
  wallet_type: string
  wallet_address: string
  asset: string
  network: string
  destination_address: string
  destination_label: string | null
  amount: string
  prepared_payload: Record<string, unknown>
  status: SendSessionStatus
  tx_hash: string | null
  signature: string | null
  error: string | null
  expires_at: string
  created_at: string
  updated_at: string
}

export type CreateSendSessionInput = {
  merchantId: string
  walletId: string
  rail: string
  walletType: string
  walletAddress: string
  asset: string
  network: string
  destinationAddress: string
  destinationLabel?: string | null
  amount: string
  preparedPayload: Record<string, unknown>
  expiresAt?: Date
}

const ALLOWED_STATUS_VALUES: SendSessionStatus[] = [
  "created", "opened", "wallet_connecting", "wallet_connected",
  "approval_requested", "approved", "submitted", "rejected", "expired", "failed"
]

function normalize(row: Record<string, unknown>): MerchantWalletSendSession {
  return {
    id:                  String(row.id || ""),
    merchant_id:         String(row.merchant_id || ""),
    wallet_id:           String(row.wallet_id || ""),
    rail:                String(row.rail || ""),
    wallet_type:         String(row.wallet_type || ""),
    wallet_address:      String(row.wallet_address || ""),
    asset:               String(row.asset || ""),
    network:             String(row.network || ""),
    destination_address: String(row.destination_address || ""),
    destination_label:   row.destination_label != null ? String(row.destination_label) : null,
    amount:              String(row.amount || ""),
    prepared_payload:    (row.prepared_payload as Record<string, unknown>) || {},
    status:              (ALLOWED_STATUS_VALUES.includes(row.status as SendSessionStatus)
      ? row.status : "created") as SendSessionStatus,
    tx_hash:    row.tx_hash    != null ? String(row.tx_hash)    : null,
    signature:  row.signature  != null ? String(row.signature)  : null,
    error:      row.error      != null ? String(row.error)      : null,
    expires_at: String(row.expires_at || ""),
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
  }
}

export async function createSendSession(
  input: CreateSendSessionInput
): Promise<MerchantWalletSendSession> {
  const expiresAt = input.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000) // 15 min
  const now = new Date().toISOString()

  const { data, error } = await db
    .from(TABLE)
    .insert({
      merchant_id:         input.merchantId,
      wallet_id:           input.walletId,
      rail:                input.rail,
      wallet_type:         input.walletType,
      wallet_address:      input.walletAddress,
      asset:               input.asset,
      network:             input.network,
      destination_address: input.destinationAddress,
      destination_label:   input.destinationLabel || null,
      amount:              input.amount,
      prepared_payload:    input.preparedPayload,
      status:              "created",
      expires_at:          expiresAt.toISOString(),
      updated_at:          now,
    })
    .select("*")
    .single()

  if (error || !data) {
    throw new Error(`Failed to create send session: ${error?.message || "No data"}`)
  }

  return normalize(data as Record<string, unknown>)
}

/** Public lookup — usable without merchant auth (session ID is unguessable). */
export async function getSendSession(id: string): Promise<MerchantWalletSendSession | null> {
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle()

  if (error) throw new Error(`Failed to get send session: ${error.message}`)
  return data ? normalize(data as Record<string, unknown>) : null
}

/** Merchant-scoped lookup (requires matching merchant_id). */
export async function getSendSessionForMerchant(
  merchantId: string,
  id: string
): Promise<MerchantWalletSendSession | null> {
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("id", id)
    .maybeSingle()

  if (error) throw new Error(`Failed to get send session: ${error.message}`)
  return data ? normalize(data as Record<string, unknown>) : null
}

/** Update status and optional fields. No private key or signing material is stored. */
export async function updateSendSessionStatus(
  id: string,
  status: SendSessionStatus,
  opts?: {
    txHash?: string | null
    signature?: string | null
    error?: string | null
  }
): Promise<MerchantWalletSendSession> {
  const now = new Date().toISOString()
  const update: Record<string, unknown> = { status, updated_at: now }

  if (opts?.txHash    !== undefined) update.tx_hash   = opts.txHash
  if (opts?.signature !== undefined) update.signature = opts.signature
  if (opts?.error     !== undefined) update.error     = opts.error

  const { data, error } = await db
    .from(TABLE)
    .update(update)
    .eq("id", id)
    .select("*")
    .single()

  if (error || !data) {
    throw new Error(`Failed to update send session: ${error?.message || "Not found"}`)
  }

  return normalize(data as Record<string, unknown>)
}
