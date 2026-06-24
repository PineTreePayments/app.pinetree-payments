import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const supabase = supabaseAdmin || supabaseAnon

const PROFILES_TABLE = "pinetree_wallet_profiles"

export type PineTreeWalletProfileStatus = "not_created" | "needs_attention" | "ready"
export type BtcAddressType = "taproot" | "native_segwit" | "legacy" | "nested_segwit" | "unknown"

export type PineTreeWalletProfile = {
  id: string
  merchant_id: string
  dynamic_user_id: string | null
  base_address: string | null
  solana_address: string | null
  bitcoin_lightning_address: string | null
  bitcoin_onchain_address: string | null
  // PineTree-managed Lightning backend fields (added via migration 20260622_add_lightning_fields_to_wallet_profile)
  bitcoin_lightning_status: "not_configured" | "pending" | "ready" | "needs_attention"
  bitcoin_lightning_provider: string | null
  bitcoin_lightning_receive_mode: string
  bitcoin_lightning_account_id: string | null
  btc_address: string | null
  btc_address_type: BtcAddressType | null
  btc_wallet_provider: string | null
  btc_payout_enabled: boolean
  btc_payout_verified_at: string | null
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
  bitcoinLightningStatus?: "not_configured" | "pending" | "ready" | "needs_attention"
  bitcoinLightningProvider?: string | null
  bitcoinLightningAccountId?: string | null
  bitcoinLightningReceiveMode?: "invoice"
  btcAddress?: string | null
  btcAddressType?: BtcAddressType | string | null
  btcWalletProvider?: string | null
  btcPayoutEnabled?: boolean
  btcPayoutVerifiedAt?: string | null
}

function deriveProfileStatus(fields: {
  base_address: string | null | undefined
  solana_address: string | null | undefined
  bitcoin_lightning_status: string | null | undefined
}): PineTreeWalletProfileStatus {
  const hasBase = Boolean(fields.base_address)
  const hasSolana = Boolean(fields.solana_address)
  const lightningReady = fields.bitcoin_lightning_status === "ready"

  if (!hasBase && !hasSolana) return "not_created"
  if (hasBase && hasSolana && lightningReady) return "ready"
  return "needs_attention"
}

export function normalizeBtcAddressType(value?: string | null): BtcAddressType {
  const normalized = String(value || "").toLowerCase().trim().replace(/[\s-]+/g, "_")
  if (normalized === "taproot" || normalized === "p2tr") return "taproot"
  if (
    normalized === "native_segwit" ||
    normalized === "segwit" ||
    normalized === "bech32" ||
    normalized === "p2wpkh"
  ) return "native_segwit"
  if (normalized === "legacy" || normalized === "p2pkh") return "legacy"
  if (
    normalized === "nested_segwit" ||
    normalized === "p2sh" ||
    normalized === "p2sh_p2wpkh"
  ) return "nested_segwit"
  return "unknown"
}

export function inferBtcAddressType(address?: string | null): BtcAddressType {
  const value = String(address || "").trim().toLowerCase()
  if (value.startsWith("bc1p") || value.startsWith("tb1p")) return "taproot"
  if (value.startsWith("bc1q") || value.startsWith("tb1q")) return "native_segwit"
  // Legacy P2PKH (starts with 1) and Nested SegWit P2SH (starts with 3) are detected
  // for completeness. Dynamic embedded wallets provision Taproot or Native SegWit.
  if (value.startsWith("1")) return "legacy"
  if (value.startsWith("3")) return "nested_segwit"
  return "unknown"
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
    bitcoin_lightning_status: input.bitcoinLightningStatus !== undefined ? input.bitcoinLightningStatus : existing?.bitcoin_lightning_status ?? "not_configured",
    bitcoin_lightning_provider: input.bitcoinLightningProvider !== undefined ? input.bitcoinLightningProvider : existing?.bitcoin_lightning_provider ?? null,
    bitcoin_lightning_account_id: input.bitcoinLightningAccountId !== undefined ? input.bitcoinLightningAccountId : existing?.bitcoin_lightning_account_id ?? null,
    bitcoin_lightning_receive_mode: input.bitcoinLightningReceiveMode !== undefined ? input.bitcoinLightningReceiveMode : existing?.bitcoin_lightning_receive_mode ?? "invoice",
    btc_address: input.btcAddress !== undefined ? input.btcAddress : existing?.btc_address ?? null,
    btc_address_type: input.btcAddressType !== undefined
      ? normalizeBtcAddressType(input.btcAddressType)
      : existing?.btc_address_type ?? null,
    btc_wallet_provider: input.btcWalletProvider !== undefined ? input.btcWalletProvider : existing?.btc_wallet_provider ?? null,
    btc_payout_enabled: input.btcPayoutEnabled !== undefined ? input.btcPayoutEnabled : existing?.btc_payout_enabled ?? false,
    btc_payout_verified_at: input.btcPayoutVerifiedAt !== undefined ? input.btcPayoutVerifiedAt : existing?.btc_payout_verified_at ?? null,
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
