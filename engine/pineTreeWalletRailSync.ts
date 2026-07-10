import { getPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"
import { getWalletRailSyncs, upsertWalletRailSync, type WalletRailSyncRecord } from "@/database/pineTreeWalletRailSyncs"
import { getMerchantLightningProfile } from "@/database/merchantLightningProfiles"
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

export type RailSyncFailureCode =
  | "profile_missing"
  | "database_error"
  | "invalid_profile_state"
  | "lightning_sync_failed"
  | "unknown_error"

export type RailSyncStage =
  | "rail_sync_started"
  | "rail_sync_profile_loaded"
  | "rail_sync_base_checked"
  | "rail_sync_solana_checked"
  | "rail_sync_lightning_checked"
  | "rail_sync_persist_started"
  | "rail_sync_complete"
  | "rail_sync_failed"

/**
 * Thrown only for a genuine, unrecoverable failure - never for "no profile
 * yet" or "Lightning isn't configured", both of which are normal states the
 * engine resolves into a 200 result with per-rail skipped/failed entries.
 */
export class RailSyncEngineError extends Error {
  stage: RailSyncStage
  code: RailSyncFailureCode

  constructor(stage: RailSyncStage, code: RailSyncFailureCode, message: string) {
    super(message)
    this.name = "RailSyncEngineError"
    this.stage = stage
    this.code = code
  }
}

function logRailSyncStage(stage: RailSyncStage, merchantId: string, details?: Record<string, unknown>) {
  console.info(`[pinetree-wallets] ${stage}`, { merchantId, ...details })
}

/**
 * Idempotent: reads the merchant's PineTree Wallet profile and writes the
 * base_address and solana_address into the provider rows that drive checkout
 * availability. Lightning readiness is Speed-managed and is never inferred from
 * btc_address placeholders. Skips a rail when the address in the DB already
 * matches the profile address.
 *
 * Resilient by design: a ready Base/Solana profile must never turn into a 500
 * because Lightning is unavailable, or because the rail-sync dedup table
 * (pinetree_wallet_rail_syncs) is temporarily unreadable - both are treated as
 * non-fatal and logged, not thrown. Only an unexpected exception escaping this
 * function raises RailSyncEngineError for the route to map to a real failure.
 */
export async function syncPineTreeWalletRailsEngine(
  merchantId: string
): Promise<PineTreeWalletRailSyncResult> {
  logRailSyncStage("rail_sync_started", merchantId)

  try {
    const profile = await getPineTreeWalletProfile(merchantId)
    logRailSyncStage("rail_sync_profile_loaded", merchantId, { profileExists: Boolean(profile) })

    if (!profile) {
      logRailSyncStage("rail_sync_complete", merchantId, { profileExists: false })
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

    // The dedup table is an optimization (skip re-syncing an unchanged address),
    // never a correctness requirement - saveProviderEngine/upsertWalletRailSync
    // are themselves idempotent against merchant_wallets. A read failure here
    // (RLS hiccup, transient connection issue) must not block provisioning; fall
    // back to treating every address as needing a (safe, idempotent) resync.
    let syncByRail = new Map<string, WalletRailSyncRecord>()
    try {
      const existingSyncs = await getWalletRailSyncs(merchantId)
      syncByRail = new Map(existingSyncs.map((s) => [s.rail, s]))
    } catch (error) {
      console.warn("[pinetree-wallets] rail_sync_existing_syncs_lookup_failed", {
        merchantId,
        error: error instanceof Error ? error.message : "unknown_error",
      })
    }

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
        logRailSyncStage(rail === "base" ? "rail_sync_base_checked" : "rail_sync_solana_checked", merchantId, {
          addressPresent: false,
        })
        continue
      }

      const existing = syncByRail.get(rail)
      const alreadySynced = existing?.synced_address === address
      logRailSyncStage(rail === "base" ? "rail_sync_base_checked" : "rail_sync_solana_checked", merchantId, {
        addressPresent: true,
        alreadySynced,
      })

      if (alreadySynced) {
        results.push({ rail, status: "skipped", address, reason: "Already synced" })
        continue
      }

      try {
        logRailSyncStage("rail_sync_persist_started", merchantId, { rail })
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

    // Lightning readiness check is purely informational here - Speed manages
    // its own status via ensureManagedLightningForMerchant, and a failure or
    // missing profile must never fail rail sync or change its HTTP outcome.
    let lightningConfigured = false
    let lightningStatus: string | null = null
    try {
      const lightningProfile = await getMerchantLightningProfile(merchantId)
      lightningConfigured = Boolean(lightningProfile)
      lightningStatus = lightningProfile?.status ?? null
    } catch (error) {
      console.warn("[pinetree-wallets] rail_sync_lightning_lookup_failed", {
        merchantId,
        error: error instanceof Error ? error.message : "unknown_error",
      })
    }
    logRailSyncStage("rail_sync_lightning_checked", merchantId, { lightningConfigured, lightningStatus })

    results.push({
      rail: "bitcoin_lightning",
      status: "skipped",
      address: null,
      reason: "Lightning readiness is managed by Speed account status",
    })

    logRailSyncStage("rail_sync_complete", merchantId, { profileExists: true })
    return { merchantId, rails: results, syncedAt: new Date().toISOString() }
  } catch (error) {
    if (error instanceof RailSyncEngineError) throw error
    console.warn("[pinetree-wallets] rail_sync_failed", {
      merchantId,
      error: error instanceof Error ? error.message : "unknown_error",
    })
    throw new RailSyncEngineError(
      "rail_sync_failed",
      "unknown_error",
      error instanceof Error ? error.message : "Rail sync failed"
    )
  }
}
