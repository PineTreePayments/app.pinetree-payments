import { getPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"
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
 * base_address and solana_address into the provider rows that drive checkout
 * availability. Lightning readiness is Speed-managed and is never inferred from
 * btc_address placeholders. Skips a rail when the address in the DB already
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

  results.push({
    rail: "bitcoin_lightning",
    status: "skipped",
    address: null,
    reason: "Lightning readiness is managed by Speed account status",
  })

  return { merchantId, rails: results, syncedAt: new Date().toISOString() }
}
