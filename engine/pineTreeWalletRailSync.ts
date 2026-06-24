import { getPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"
import { SPEED_PROVIDER_NAME } from "@/database/merchantProviders"
import { getWalletRailSyncs, upsertWalletRailSync } from "@/database/pineTreeWalletRailSyncs"
import { saveProviderEngine } from "./providersDashboard"

export type RailSyncResult = {
  rail: "solana" | "base" | "bitcoin_lightning"
  status: "synced" | "skipped" | "failed"
  address: string | null
  reason?: string
}

export type PineTreeWalletRailSyncResult = {
  merchantId: string
  rails: RailSyncResult[]
  syncedAt: string
}

/**
 * Idempotent: reads the merchant's PineTree Wallet profile and writes the
 * base_address, solana_address, and btc_address into the provider rows that
 * drive checkout availability. Skips a rail when the address in the DB already
 * matches the profile address.
 */
export async function syncPineTreeWalletRailsEngine(
  merchantId: string
): Promise<PineTreeWalletRailSyncResult> {
  const profile = await getPineTreeWalletProfile(merchantId)

  if (!profile) {
    return {
      merchantId,
      rails: [
        { rail: "solana", status: "skipped", address: null, reason: "No PineTree Wallet profile" },
        { rail: "base", status: "skipped", address: null, reason: "No PineTree Wallet profile" },
        { rail: "bitcoin_lightning", status: "skipped", address: null, reason: "No PineTree Wallet profile" },
      ],
      syncedAt: new Date().toISOString(),
    }
  }

  const existingSyncs = await getWalletRailSyncs(merchantId)
  const syncByRail = new Map(existingSyncs.map((s) => [s.rail, s]))

  const railConfigs: Array<{
    rail: RailSyncResult["rail"]
    provider: string
    address: string | null
    walletType: string
  }> = [
    { rail: "solana", provider: "solana", address: profile.solana_address, walletType: "PINETREE" },
    { rail: "base", provider: "base", address: profile.base_address, walletType: "PINETREE" },
    { rail: "bitcoin_lightning", provider: SPEED_PROVIDER_NAME, address: profile.btc_address, walletType: "PINETREE_BTC" },
  ]

  const results: RailSyncResult[] = []

  for (const { rail, provider, address, walletType } of railConfigs) {
    if (!address) {
      results.push({ rail, status: "skipped", address: null, reason: "Address not provisioned" })
      continue
    }

    const existing = syncByRail.get(rail)
    if (existing?.synced_address === address) {
      results.push({ rail, status: "skipped", address, reason: "Already synced" })
      continue
    }

    try {
      await saveProviderEngine({
        merchantId,
        provider,
        walletAddress: address,
        walletType,
      })

      await upsertWalletRailSync({ merchantId, rail, syncedAddress: address })

      results.push({ rail, status: "synced", address })
    } catch (error) {
      results.push({
        rail,
        status: "failed",
        address,
        reason: error instanceof Error ? error.message : "Unknown error",
      })
    }
  }

  return { merchantId, rails: results, syncedAt: new Date().toISOString() }
}
