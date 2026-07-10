import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"
import { getMerchantLightningProfile } from "./merchantLightningProfiles"
import { getPineTreeWalletProfile } from "./pineTreeWalletProfiles"

const supabase = supabaseAdmin || supabaseAnon

export type PineTreeWalletSetupVerification = {
  merchantResolved: boolean
  profileExists: boolean
  profileStatus: string | null
  hasBaseAddress: boolean
  hasSolanaAddress: boolean
  lightningProfileExists: boolean
  lightningStatus: "ready" | "pending" | "needs_attention" | "not_configured"
  baseProviderRowExists: boolean
  solanaProviderRowExists: boolean
  baseRailSyncExists: boolean
  solanaRailSyncExists: boolean
  duplicateWalletProfiles: boolean
  duplicateBaseProviderRows: boolean
  duplicateSolanaProviderRows: boolean
  setupConsistent: boolean
}

async function countRows(table: string, merchantId: string, filters: Record<string, string> = {}) {
  let query = supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("merchant_id", merchantId)

  for (const [column, value] of Object.entries(filters)) {
    query = query.eq(column, value)
  }

  const { count, error } = await query
  if (error) return 0
  return Number(count || 0)
}

export async function verifyPineTreeWalletSetupState(
  merchantId: string
): Promise<PineTreeWalletSetupVerification> {
  const [
    profile,
    lightningProfile,
    profileCount,
    baseProviderCount,
    solanaProviderCount,
    baseRailSyncCount,
    solanaRailSyncCount,
  ] = await Promise.all([
    getPineTreeWalletProfile(merchantId),
    getMerchantLightningProfile(merchantId),
    countRows("pinetree_wallet_profiles", merchantId),
    countRows("merchant_providers", merchantId, { provider: "base" }),
    countRows("merchant_providers", merchantId, { provider: "solana" }),
    countRows("pinetree_wallet_rail_syncs", merchantId, { rail: "base" }),
    countRows("pinetree_wallet_rail_syncs", merchantId, { rail: "solana" }),
  ])

  const hasBaseAddress = Boolean(profile?.base_address)
  const hasSolanaAddress = Boolean(profile?.solana_address)
  const lightningStatus = lightningProfile?.status ?? "not_configured"
  const duplicateWalletProfiles = profileCount > 1
  const duplicateBaseProviderRows = baseProviderCount > 1
  const duplicateSolanaProviderRows = solanaProviderCount > 1
  const setupConsistent = Boolean(
    profileCount === 1 &&
    profile?.status === "ready" &&
    hasBaseAddress &&
    hasSolanaAddress &&
    baseProviderCount === 1 &&
    solanaProviderCount === 1 &&
    baseRailSyncCount >= 1 &&
    solanaRailSyncCount >= 1 &&
    !duplicateBaseProviderRows &&
    !duplicateSolanaProviderRows
  )

  return {
    merchantResolved: Boolean(merchantId),
    profileExists: Boolean(profile),
    profileStatus: profile?.status ?? null,
    hasBaseAddress,
    hasSolanaAddress,
    lightningProfileExists: Boolean(lightningProfile),
    lightningStatus,
    baseProviderRowExists: baseProviderCount > 0,
    solanaProviderRowExists: solanaProviderCount > 0,
    baseRailSyncExists: baseRailSyncCount > 0,
    solanaRailSyncExists: solanaRailSyncCount > 0,
    duplicateWalletProfiles,
    duplicateBaseProviderRows,
    duplicateSolanaProviderRows,
    setupConsistent,
  }
}
