import { getPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"
import { getWalletRailSyncs, upsertWalletRailSync } from "@/database/pineTreeWalletRailSyncs"
import { saveProviderEngine } from "./providersDashboard"

export type RailSyncResult = {
  rail: "solana" | "base"
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
 * base_address and solana_address into merchant_wallets + merchant_providers
 * (the same tables the old manual connect flow used). Skips a rail when the
 * address in the DB already matches the profile address.
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
      ],
      syncedAt: new Date().toISOString(),
    }
  }

  const existingSyncs = await getWalletRailSyncs(merchantId)
  const syncByRail = new Map(existingSyncs.map((s) => [s.rail, s]))

  const railConfigs: Array<{ rail: "solana" | "base"; address: string | null; walletType: string }> = [
    { rail: "solana", address: profile.solana_address, walletType: "PINETREE" },
    { rail: "base", address: profile.base_address, walletType: "PINETREE" },
  ]

  const results: RailSyncResult[] = []

  for (const { rail, address, walletType } of railConfigs) {
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
        provider: rail,
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
