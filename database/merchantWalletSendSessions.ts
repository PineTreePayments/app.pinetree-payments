import { createClient } from "@supabase/supabase-js"

const TABLE = "merchant_wallet_send_sessions"

/**
 * Creates a Supabase client that uses the service role key when available
 * so it bypasses RLS for server-side reads/writes. Falls back to the anon
 * key only if SUPABASE_SERVICE_ROLE_KEY is not configured (dev/test).
 *
 * Called inside each function (not at module level) so env vars are read
 * at request time, not at cold-start, avoiding any module-init ordering issues.
 */
function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured")
  if (!anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is not configured")
  if (!serviceKey) {
    console.warn("[merchantWalletSendSessions] SUPABASE_SERVICE_ROLE_KEY is not set — falling back to anon key. RLS-protected tables may not be readable.")
  }
  return createClient(url, serviceKey ?? anonKey)
}

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

  const { data, error } = await getDb()
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
    throw new Error(`Failed to create send session: ${error?.message || "No data returned"}`)
  }

  const session = normalize(data as Record<string, unknown>)

  console.log("[send-session] created", {
    id:         session.id,
    merchant_id: session.merchant_id,
    wallet_id:  session.wallet_id,
    rail:       session.rail,
    wallet_type: session.wallet_type,
    status:     session.status,
    expires_at: session.expires_at,
  })

  return session
}

/** Public lookup — usable without merchant auth (session ID is an unguessable UUID). */
export async function getSendSession(id: string): Promise<MerchantWalletSendSession | null> {
  const { data, error } = await getDb()
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle()

  if (error) {
    console.error("[send-session] getSendSession error", { id, message: error.message, code: error.code })
    throw new Error(`Failed to get send session: ${error.message}`)
  }
  return data ? normalize(data as Record<string, unknown>) : null
}

/** Merchant-scoped lookup (requires matching merchant_id). */
export async function getSendSessionForMerchant(
  merchantId: string,
  id: string
): Promise<MerchantWalletSendSession | null> {
  const { data, error } = await getDb()
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

  const { data, error } = await getDb()
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
