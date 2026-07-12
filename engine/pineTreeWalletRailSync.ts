import { getPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"
import {
  checkWalletRailSyncSchemaContract,
  getWalletRailSyncs,
  isWalletRailSyncSchemaError,
  upsertWalletRailSync,
  type RailSyncDbOperation,
  type WalletRailSyncRecord,
  type WalletRailSyncSchemaError,
} from "@/database/pineTreeWalletRailSyncs"
import { deriveLightningReadiness, getMerchantLightningProfile } from "@/database/merchantLightningProfiles"
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
  coreStatus: "ready" | "needs_attention" | "not_created"
  lightningStatus: "ready" | "pending" | "needs_attention" | "not_configured"
  warnings: string[]
}

export type RailSyncFailureCode =
  | "profile_missing"
  | "database_schema_missing"
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
  migration?: string
  missing?: string[]

  constructor(
    stage: RailSyncStage,
    code: RailSyncFailureCode,
    message: string,
    details?: { migration?: string; missing?: string[] }
  ) {
    super(message)
    this.name = "RailSyncEngineError"
    this.stage = stage
    this.code = code
    this.migration = details?.migration
    this.missing = details?.missing
  }
}

function logRailSyncStage(stage: RailSyncStage, merchantId: string, details?: Record<string, unknown>) {
  console.info(`[pinetree-wallets] ${stage}`, { merchantId, ...details })
}

/**
 * Single structured diagnostic for any schema-classified failure against the
 * rail-sync dedup table, so the exact underlying Postgres code/relation/column
 * is always preserved instead of collapsing into an opaque
 * "database_schema_missing" - safe fields only (no addresses, credentials, or
 * raw SQL).
 */
function logRailSyncSchemaFailure(params: {
  merchantId: string
  stage: RailSyncStage
  operation: RailSyncDbOperation
  error: WalletRailSyncSchemaError
  elapsedMs: number
}) {
  console.warn("[pinetree-wallets] rail_sync_schema_failure", {
    merchant_id: params.merchantId,
    stage: params.stage,
    postgres_code: params.error.underlyingCode,
    relation: params.error.relation,
    column: params.error.column,
    operation: params.operation,
    elapsed_ms: params.elapsedMs,
  })
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
 * (pinetree_wallet_rail_syncs) is unreadable/unwritable - reading or writing
 * that table is an optimization (skip re-syncing an unchanged address; avoid a
 * duplicate saveProviderEngine call), never a correctness requirement, since
 * saveProviderEngine itself is idempotent against merchant_wallets. Any
 * failure against that table - schema-missing or otherwise - is logged with
 * full diagnostics and degrades gracefully rather than failing the route.
 * Only a genuine failure writing the real routing tables (merchant_wallets /
 * merchant_providers via saveProviderEngine) raises RailSyncEngineError.
 */
export async function syncPineTreeWalletRailsEngine(
  merchantId: string
): Promise<PineTreeWalletRailSyncResult> {
  logRailSyncStage("rail_sync_started", merchantId)
  const warnings: string[] = []

  try {
    const schemaCheckStartedAt = Date.now()
    try {
      await checkWalletRailSyncSchemaContract()
    } catch (error) {
      if (isWalletRailSyncSchemaError(error)) {
        logRailSyncSchemaFailure({
          merchantId,
          stage: "rail_sync_started",
          operation: "select",
          error,
          elapsedMs: Date.now() - schemaCheckStartedAt,
        })
      } else {
        console.warn("[pinetree-wallets] rail_sync_schema_contract_check_failed", {
          merchantId,
          error: error instanceof Error ? error.message : "unknown_error",
        })
      }
      warnings.push("rail_sync_dedup_table_unavailable")
    }

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
        coreStatus: "not_created",
        lightningStatus: "not_configured",
        warnings: ["profile_missing"],
      }
    }

    // A read failure here (missing table, RLS hiccup, transient connection
    // issue, pooler "prepared statement does not exist" artifact) must not
    // block provisioning; fall back to treating every address as needing a
    // (safe, idempotent) resync.
    let syncByRail = new Map<string, WalletRailSyncRecord>()
    const existingSyncsStartedAt = Date.now()
    try {
      const existingSyncs = await getWalletRailSyncs(merchantId)
      syncByRail = new Map(existingSyncs.map((s) => [s.rail, s]))
    } catch (error) {
      if (isWalletRailSyncSchemaError(error)) {
        logRailSyncSchemaFailure({
          merchantId,
          stage: "rail_sync_profile_loaded",
          operation: "select",
          error,
          elapsedMs: Date.now() - existingSyncsStartedAt,
        })
      } else {
        console.warn("[pinetree-wallets] rail_sync_existing_syncs_lookup_failed", {
          merchantId,
          error: error instanceof Error ? error.message : "unknown_error",
        })
      }
      warnings.push("rail_sync_dedup_table_unavailable")
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

      // saveProviderEngine writes the real routing state (merchant_wallets /
      // merchant_providers) that checkout actually depends on - a failure here
      // is a genuine sync failure and must surface as one.
      try {
        logRailSyncStage("rail_sync_persist_started", merchantId, { rail })
        await saveProviderEngine({
          merchantId,
          provider,
          walletAddress: address,
          walletType,
        })
      } catch (error) {
        console.warn("[pinetree-wallets] rail_sync_persist_failed", {
          merchantId,
          rail,
          code: "database_error",
        })
        throw new RailSyncEngineError(
          "rail_sync_persist_started",
          "database_error",
          `Failed to sync ${rail} rail`
        )
      }

      // upsertWalletRailSync only records dedup/idempotency bookkeeping - the
      // real routing write above already succeeded, so a failure here (schema
      // or otherwise) must never undo that or fail the route.
      const dedupWriteStartedAt = Date.now()
      try {
        await upsertWalletRailSync({ merchantId, rail, syncedAddress: address })
      } catch (error) {
        if (isWalletRailSyncSchemaError(error)) {
          logRailSyncSchemaFailure({
            merchantId,
            stage: "rail_sync_persist_started",
            operation: "upsert",
            error,
            elapsedMs: Date.now() - dedupWriteStartedAt,
          })
        } else {
          console.warn("[pinetree-wallets] rail_sync_dedup_write_failed", {
            merchantId,
            rail,
            error: error instanceof Error ? error.message : "unknown_error",
          })
        }
        warnings.push(`rail_sync_dedup_write_failed:${rail}`)
      }

      results.push({ rail, status: "synced", address })
    }

    // Lightning readiness check is purely informational here - Speed manages
    // its own status via ensureManagedLightningForMerchant, and a failure or
    // missing profile must never fail rail sync or change its HTTP outcome.
    let lightningConfigured = false
    let lightningStatus: PineTreeWalletRailSyncResult["lightningStatus"] = "not_configured"
    try {
      const lightningProfile = await getMerchantLightningProfile(merchantId)
      lightningConfigured = Boolean(lightningProfile)
      lightningStatus = deriveLightningReadiness(lightningProfile).status
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
    return {
      merchantId,
      rails: results,
      syncedAt: new Date().toISOString(),
      coreStatus: profile.status === "ready" ? "ready" : profile.status === "needs_attention" ? "needs_attention" : "not_created",
      lightningStatus,
      warnings,
    }
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
