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

export type RailSyncDbOperation = "select" | "upsert"

export class WalletRailSyncSchemaError extends Error {
  code = "database_schema_missing" as const
  /** The table/relation this failure was attributed to. */
  relation: string
  /** The specific column named by the underlying Postgres error, when one is present. */
  column: string | null
  operation: RailSyncDbOperation
  missing: string[]
  migration: string
  /** The real, sanitized Postgres/PostgREST error code and message that triggered
   *  this classification - kept so a misclassification is diagnosable from logs
   *  instead of collapsing into an opaque "database_schema_missing". */
  underlyingCode: string | null
  underlyingMessage: string | null

  constructor(
    operation: RailSyncDbOperation,
    underlying?: { code?: string | null; message?: string | null },
    message = "PineTree Wallet rail-sync database schema is missing."
  ) {
    super(message)
    this.name = "WalletRailSyncSchemaError"
    this.operation = operation
    this.relation = TABLE
    this.column = extractColumnName(underlying?.message || null)
    this.missing = [`table:${TABLE}`]
    this.migration = "database/migrations/20260623_create_pinetree_wallet_rail_syncs.sql and database/migrations/20260624_expand_pinetree_wallet_rail_syncs_bitcoin.sql"
    this.underlyingCode = underlying?.code || null
    this.underlyingMessage = underlying?.message ? underlying.message.slice(0, 300) : null
  }
}

function extractColumnName(message: string | null): string | null {
  if (!message) return null
  const match = message.match(/column\s+"?([a-zA-Z0-9_.]+)"?/i)
  return match ? match[1] : null
}

/**
 * Only classifies an error as a genuinely missing table/column/relation when
 * Postgres or PostgREST itself says so via an unambiguous error code
 * (undefined-table, undefined-column, invalid ON CONFLICT target, or a
 * PostgREST schema-cache miss), or - lacking one of those codes - when the
 * message explicitly names a relation/table/column/schema-cache alongside
 * "does not exist". A bare "does not exist" substring is NOT enough on its
 * own: connection-pooler errors like `prepared statement "s0" does not
 * exist` (a known Supabase/PgBouncer transaction-pooling artifact, entirely
 * unrelated to schema) also match that phrase, and misclassifying one as
 * database_schema_missing turns a transient hiccup into a hard 500 instead
 * of the safe fallback path other callers in this module already rely on.
 */
function isSchemaMissingError(error: unknown): boolean {
  const row = error as { code?: unknown; message?: unknown; details?: unknown } | null
  const code = String(row?.code || "")
  if (code === "42P01" || code === "42P10" || code === "PGRST205" || code === "42703") return true

  const message = `${String(row?.message || "")} ${String(row?.details || "")}`.toLowerCase()
  const namesSchemaObject = /\b(relation|table|column|schema cache)\b/.test(message)
  if (!namesSchemaObject) return false
  return message.includes("does not exist") || message.includes("schema cache")
}

function railSyncSchemaError(error: unknown, operation: RailSyncDbOperation): Error {
  const row = error as { code?: unknown; message?: unknown } | null
  const underlying = {
    code: row?.code != null ? String(row.code) : null,
    message: row?.message != null ? String(row.message) : null,
  }
  if (isSchemaMissingError(error)) return new WalletRailSyncSchemaError(operation, underlying)
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
    throw railSyncSchemaError(error, "select")
  }

  return { ok: true, code: "ok", missing: [], migration: null }
}

export async function getWalletRailSyncs(merchantId: string): Promise<WalletRailSyncRecord[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)

  if (error) throw railSyncSchemaError(error, "select")
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
    throw railSyncSchemaError(error, "upsert")
  }

  if (!data) {
    throw new Error(`Failed to upsert rail sync for ${input.rail}: unknown`)
  }

  return data as WalletRailSyncRecord
}
