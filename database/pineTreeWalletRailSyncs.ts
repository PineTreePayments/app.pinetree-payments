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

  constructor(missing: string[], message = "PineTree Wallet rail-sync database schema is missing.") {
    super(message)
    this.name = "WalletRailSyncSchemaError"
    this.missing = missing
    this.migration = "database/migrations/20260623_create_pinetree_wallet_rail_syncs.sql and database/migrations/20260624_expand_pinetree_wallet_rail_syncs_bitcoin.sql"
  }
}

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
    message.includes("no unique or exclusion constraint") ||
    message.includes("pinetree_wallet_rail_syncs")
  )
}

function railSyncSchemaError(error: unknown, missing: string[]): Error {
  if (isSchemaMissingError(error)) return new WalletRailSyncSchemaError(missing)
  return error instanceof Error ? error : new Error("Rail sync database operation failed")
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
