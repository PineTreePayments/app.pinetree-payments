import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const supabase = supabaseAdmin || supabaseAnon

const PROFILES_TABLE = "pinetree_wallet_profiles"

export type PineTreeWalletProfileStatus = "not_created" | "needs_attention" | "ready"
export type BtcAddressType = "taproot" | "native_segwit" | "legacy" | "nested_segwit" | "unknown"

export type PineTreeWalletProfile = {
  id: string
  merchant_id: string
  dynamic_user_id: string | null
  dynamic_email: string | null
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
  btc_wallet_provider_ref: string | null
  btc_wallet_last_provisioned_at: string | null
  btc_wallet_provisioning_status: string | null
  btc_wallet_provisioning_error: string | null
  btc_payout_enabled: boolean
  btc_payout_verified_at: string | null
  status: PineTreeWalletProfileStatus
  created_at: string
  updated_at: string
}

export type UpsertWalletProfileInput = {
  merchantId: string
  dynamicUserId?: string | null
  dynamicEmail?: string | null
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
  btcWalletProviderRef?: string | null
  btcWalletLastProvisionedAt?: string | null
  btcWalletProvisioningStatus?: string | null
  btcWalletProvisioningError?: string | null
  btcPayoutEnabled?: boolean
  btcPayoutVerifiedAt?: string | null
}

export function deriveProfileStatus(fields: {
  base_address: string | null | undefined
  solana_address: string | null | undefined
  bitcoin_lightning_status: string | null | undefined
}): PineTreeWalletProfileStatus {
  const hasBase = Boolean(fields.base_address)
  const hasSolana = Boolean(fields.solana_address)

  if (!hasBase && !hasSolana) return "not_created"
  if (hasBase && hasSolana) return "ready"
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

export function normalizeWalletIdentityEmail(value?: string | null): string | null {
  const normalized = String(value || "").trim().toLowerCase()
  return normalized || null
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

export async function findPineTreeWalletProfileByAddress(input: {
  baseAddress?: string | null
  solanaAddress?: string | null
}): Promise<{
  baseProfile: PineTreeWalletProfile | null
  solanaProfile: PineTreeWalletProfile | null
}> {
  const baseAddress = String(input.baseAddress || "").trim()
  const solanaAddress = String(input.solanaAddress || "").trim()
  const [baseResult, solanaResult] = await Promise.all([
    baseAddress
      ? supabase
          .from(PROFILES_TABLE)
          .select("*")
          .eq("base_address", baseAddress)
          .limit(1)
      : Promise.resolve({ data: null, error: null }),
    solanaAddress
      ? supabase
          .from(PROFILES_TABLE)
          .select("*")
          .eq("solana_address", solanaAddress)
          .limit(1)
      : Promise.resolve({ data: null, error: null }),
  ])
  const baseProfile = Array.isArray(baseResult.data)
    ? (baseResult.data[0] as PineTreeWalletProfile | undefined) ?? null
    : null
  const solanaProfile = Array.isArray(solanaResult.data)
    ? (solanaResult.data[0] as PineTreeWalletProfile | undefined) ?? null
    : null

  return {
    baseProfile: baseResult.error ? null : baseProfile,
    solanaProfile: solanaResult.error ? null : solanaProfile,
  }
}

export async function pineTreeWalletProfileHasProtectedHistory(profileId?: string | null): Promise<boolean> {
  const id = String(profileId || "").trim()
  if (!id) return false

  const { count, error } = await supabase
    .from("wallet_withdrawal_requests")
    .select("id", { count: "exact", head: true })
    .eq("wallet_profile_id", id)

  if (error) {
    // Fail closed: if the financial-history check cannot be evaluated, do not
    // allow address replacement that might detach real withdrawal history.
    return true
  }
  return Number(count || 0) > 0
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
    dynamic_email: input.dynamicEmail !== undefined ? normalizeWalletIdentityEmail(input.dynamicEmail) : existing?.dynamic_email ?? null,
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
    btc_wallet_provider_ref: input.btcWalletProviderRef !== undefined ? input.btcWalletProviderRef : existing?.btc_wallet_provider_ref ?? null,
    btc_wallet_last_provisioned_at: input.btcWalletLastProvisionedAt !== undefined ? input.btcWalletLastProvisionedAt : existing?.btc_wallet_last_provisioned_at ?? null,
    btc_wallet_provisioning_status: input.btcWalletProvisioningStatus !== undefined ? input.btcWalletProvisioningStatus : existing?.btc_wallet_provisioning_status ?? null,
    btc_wallet_provisioning_error: input.btcWalletProvisioningError !== undefined ? input.btcWalletProvisioningError : existing?.btc_wallet_provisioning_error ?? null,
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
