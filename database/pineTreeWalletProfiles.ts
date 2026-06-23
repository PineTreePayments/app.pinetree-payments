import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const supabase = supabaseAdmin || supabaseAnon

const PROFILES_TABLE = "pinetree_wallet_profiles"

export type PineTreeWalletProfileStatus = "not_created" | "needs_attention" | "ready"

export type PineTreeWalletProfile = {
  id: string
  merchant_id: string
  dynamic_user_id: string | null
  base_address: string | null
  solana_address: string | null
  bitcoin_lightning_address: string | null
  bitcoin_onchain_address: string | null
  status: PineTreeWalletProfileStatus
  created_at: string
  updated_at: string
}

export type UpsertWalletProfileInput = {
  merchantId: string
  dynamicUserId?: string | null
  baseAddress?: string | null
  solanaAddress?: string | null
  bitcoinLightningAddress?: string | null
  bitcoinOnchainAddress?: string | null
}

function deriveProfileStatus(fields: {
  base_address: string | null | undefined
  solana_address: string | null | undefined
  bitcoin_lightning_address: string | null | undefined
}): PineTreeWalletProfileStatus {
  const hasBase = Boolean(fields.base_address)
  const hasSolana = Boolean(fields.solana_address)
  const hasLightning = Boolean(fields.bitcoin_lightning_address)
  if (!hasBase && !hasSolana && !hasLightning) return "not_created"
  if (hasBase && hasSolana && hasLightning) return "ready"
  return "needs_attention"
}

export async function getPineTreeWalletProfile(
  merchantId: string
): Promise<PineTreeWalletProfile | null> {
  const { data, error } = await supabase
    .from(PROFILES_TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .maybeSingle()

  if (error || !data) return null
  return data as PineTreeWalletProfile
}

/**
 * Create or update the PineTree Wallet profile for a merchant.
 * Only the fields provided in the input are updated; omitted fields keep their current value.
 */
export async function upsertPineTreeWalletProfile(
  input: UpsertWalletProfileInput
): Promise<PineTreeWalletProfile> {
  const existing = await getPineTreeWalletProfile(input.merchantId)
  const now = new Date().toISOString()

  const merged = {
    dynamic_user_id: input.dynamicUserId !== undefined ? input.dynamicUserId : existing?.dynamic_user_id ?? null,
    base_address: input.baseAddress !== undefined ? input.baseAddress : existing?.base_address ?? null,
    solana_address: input.solanaAddress !== undefined ? input.solanaAddress : existing?.solana_address ?? null,
    bitcoin_lightning_address: input.bitcoinLightningAddress !== undefined ? input.bitcoinLightningAddress : existing?.bitcoin_lightning_address ?? null,
    bitcoin_onchain_address: input.bitcoinOnchainAddress !== undefined ? input.bitcoinOnchainAddress : existing?.bitcoin_onchain_address ?? null,
  }

  const status = deriveProfileStatus(merged)

  const row = {
    merchant_id: input.merchantId,
    ...merged,
    status,
    updated_at: now,
    ...(existing ? {} : { created_at: now }),
  }

  const { data, error } = await supabase
    .from(PROFILES_TABLE)
    .upsert(row, { onConflict: "merchant_id" })
    .select()
    .single()

  if (error || !data) {
    throw new Error(`Failed to save PineTree Wallet profile: ${error?.message ?? "unknown error"}`)
  }

  return data as PineTreeWalletProfile
}

export type WalletWithdrawalRequest = {
  id: string
  merchant_id: string
  wallet_profile_id: string | null
  rail: string
  destination_address: string
  amount: number
  status: "draft" | "pending_review" | "disabled" | "failed" | "completed"
  created_at: string
  updated_at: string
}
