import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const supabase = supabaseAdmin || supabaseAnon

const TABLE = "pinetree_wallet_rail_syncs"

export type PineTreeWalletSyncedRail = "solana" | "base" | "bitcoin_lightning"

export type WalletRailSyncRecord = {
  id: string
  merchant_id: string
  rail: PineTreeWalletSyncedRail
  synced_address: string
  synced_at: string
}

export type WalletRailSyncSchemaContract = {
  ok: boolean
  code: "ok" | "database_schema_missing"
  missing: string[]
  migration: string | null
}

export class WalletRailSyncSchemaError extends Error {
  code = "database_schema_missing" as const
  missing: string[]
  migration: string
  /** The real, sanitized Postgres/PostgREST error code and message that triggered
   *  this classification - kept so a misclassification is diagnosable from logs
   *  instead of collapsing into an opaque "database_schema_missing". */
  underlyingCode: string | null
  underlyingMessage: string | null

  constructor(
    missing: string[],
    underlying?: { code?: string | null; message?: string | null },
    message = "PineTree Wallet rail-sync database schema is missing."
  ) {
    super(message)
    this.name = "WalletRailSyncSchemaError"
    this.missing = missing
    this.migration = "database/migrations/20260623_create_pinetree_wallet_rail_syncs.sql and database/migrations/20260624_expand_pinetree_wallet_rail_syncs_bitcoin.sql"
    this.underlyingCode = underlying?.code || null
    this.underlyingMessage = underlying?.message ? underlying.message.slice(0, 300) : null
  }
}

/**
 * Only classifies an error as a genuinely missing table/relation when Postgres
 * or PostgREST itself says so (undefined-table / unknown-relation codes, or a
 * "does not exist"/"schema cache" message). Deliberately does NOT match on the
 * table name alone - a permission-denied, RLS, or FK-violation error can
 * legitimately mention "pinetree_wallet_rail_syncs" in its message while having
 * nothing to do with a missing migration, and misclassifying it as
 * database_schema_missing would silently hide the real cause (and turn a
 * transient/permissions problem into a hard 500 instead of the safe fallback
 * path other callers in this module already rely on).
 */
function isSchemaMissingError(error: unknown): boolean {
  const row = error as { code?: unknown; message?: unknown; details?: unknown } | null
  const code = String(row?.code || "")
  const message = `${String(row?.message || "")} ${String(row?.details || "")}`.toLowerCase()
  return (
    code === "42P01" ||
    code === "42P10" ||
    code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("no unique or exclusion constraint")
  )
}

function railSyncSchemaError(error: unknown, missing: string[]): Error {
  const row = error as { code?: unknown; message?: unknown } | null
  const underlying = {
    code: row?.code != null ? String(row.code) : null,
    message: row?.message != null ? String(row.message) : null,
  }
  if (isSchemaMissingError(error)) return new WalletRailSyncSchemaError(missing, underlying)
  if (error instanceof Error) return error
  console.warn("[pinetree-wallets] rail_sync_db_error_unclassified", underlying)
  return new Error("Rail sync database operation failed")
}

export function isWalletRailSyncSchemaError(error: unknown): error is WalletRailSyncSchemaError {
  return error instanceof WalletRailSyncSchemaError
}

export async function checkWalletRailSyncSchemaContract(): Promise<WalletRailSyncSchemaContract> {
  const { error } = await supabase
    .from(TABLE)
    .select("merchant_id,rail,synced_address,synced_at", { count: "exact", head: true })
    .limit(0)

  if (error) {
    throw railSyncSchemaError(error, ["table:pinetree_wallet_rail_syncs"])
  }

  return { ok: true, code: "ok", missing: [], migration: null }
}

export async function getWalletRailSyncs(merchantId: string): Promise<WalletRailSyncRecord[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)

  if (error) throw railSyncSchemaError(error, ["table:pinetree_wallet_rail_syncs"])
  return (data || []) as WalletRailSyncRecord[]
}

export async function upsertWalletRailSync(input: {
  merchantId: string
  rail: PineTreeWalletSyncedRail
  syncedAddress: string
}): Promise<WalletRailSyncRecord> {
  const row = {
    merchant_id: input.merchantId,
    rail: input.rail,
    synced_address: input.syncedAddress,
    synced_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from(TABLE)
    .upsert(row, { onConflict: "merchant_id,rail" })
    .select()
    .single()

  if (error) {
    throw railSyncSchemaError(error, ["unique:pinetree_wallet_rail_syncs(merchant_id,rail)"])
  }

  if (!data) {
    throw new Error(`Failed to upsert rail sync for ${input.rail}: unknown`)
  }

  return data as WalletRailSyncRecord
}
