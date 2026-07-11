import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Exercises the REAL isSchemaMissingError/WalletRailSyncSchemaError classifier
 * in database/pineTreeWalletRailSyncs.ts (pineTreeWalletRailSync.test.ts mocks
 * this module entirely, so the classifier itself is never exercised there).
 *
 * Production showed a rail-sync 500 with stage "rail_sync_profile_loaded" and
 * code "database_schema_missing" even though the schema-contract HEAD check at
 * "rail_sync_started" had already passed for the same table. The only way that
 * combination is possible is if a non-schema error (permission/RLS/FK/transient)
 * got misclassified as database_schema_missing - which the old classifier could
 * do, because it matched on the bare table name appearing anywhere in a
 * Postgres error message.
 */

function fluentQuery(result: { data: unknown; error: unknown }) {
  const query: Record<string, unknown> = {}
  query.select = vi.fn(() => query)
  query.eq = vi.fn(() => query)
  query.upsert = vi.fn(() => query)
  query.limit = vi.fn(() => Promise.resolve(result))
  query.single = vi.fn(() => Promise.resolve(result))
  // eq(...) is awaited directly by getWalletRailSyncs (no .single()/.limit() after it)
  query.then = (resolve: (value: { data: unknown; error: unknown }) => void) => resolve(result)
  return query
}

describe("pineTreeWalletRailSyncs schema-error classifier (real module, mocked Supabase client)", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("does not misclassify a permission-denied error that happens to mention the table name", async () => {
    const permissionError = {
      code: "42501",
      message: 'permission denied for table "pinetree_wallet_rail_syncs"',
    }
    vi.doMock("@/database/supabase", () => ({
      supabase: { from: () => fluentQuery({ data: null, error: permissionError }) },
      supabaseAdmin: null,
    }))

    const { getWalletRailSyncs, isWalletRailSyncSchemaError } = await import("@/database/pineTreeWalletRailSyncs")

    await expect(getWalletRailSyncs("merchant-1")).rejects.toSatisfy((error: unknown) => {
      expect(isWalletRailSyncSchemaError(error)).toBe(false)
      expect(error).toBeInstanceOf(Error)
      return true
    })
  })

  it("classifies a genuine undefined-table Postgres error as database_schema_missing and preserves the underlying code/message", async () => {
    const undefinedTableError = {
      code: "42P01",
      message: 'relation "pinetree_wallet_rail_syncs" does not exist',
    }
    vi.doMock("@/database/supabase", () => ({
      supabase: { from: () => fluentQuery({ data: null, error: undefinedTableError }) },
      supabaseAdmin: null,
    }))

    const { getWalletRailSyncs, isWalletRailSyncSchemaError } = await import("@/database/pineTreeWalletRailSyncs")

    await expect(getWalletRailSyncs("merchant-1")).rejects.toSatisfy((error: unknown) => {
      expect(isWalletRailSyncSchemaError(error)).toBe(true)
      if (isWalletRailSyncSchemaError(error)) {
        expect(error.underlyingCode).toBe("42P01")
        expect(error.underlyingMessage).toContain("does not exist")
      }
      return true
    })
  })

  it("classifies a PostgREST schema-cache miss as database_schema_missing", async () => {
    const schemaCacheError = { code: "PGRST205", message: "Could not find the table in the schema cache" }
    vi.doMock("@/database/supabase", () => ({
      supabase: { from: () => fluentQuery({ data: null, error: schemaCacheError }) },
      supabaseAdmin: null,
    }))

    const { checkWalletRailSyncSchemaContract, isWalletRailSyncSchemaError } = await import(
      "@/database/pineTreeWalletRailSyncs"
    )

    await expect(checkWalletRailSyncSchemaContract()).rejects.toSatisfy((error: unknown) => {
      expect(isWalletRailSyncSchemaError(error)).toBe(true)
      return true
    })
  })

  it("classifies a missing ON CONFLICT unique constraint (42P10) as database_schema_missing", async () => {
    const noConflictTargetError = {
      code: "42P10",
      message: "there is no unique or exclusion constraint matching the ON CONFLICT specification",
    }
    vi.doMock("@/database/supabase", () => ({
      supabase: { from: () => fluentQuery({ data: null, error: noConflictTargetError }) },
      supabaseAdmin: null,
    }))

    const { upsertWalletRailSync, isWalletRailSyncSchemaError } = await import("@/database/pineTreeWalletRailSyncs")

    await expect(
      upsertWalletRailSync({ merchantId: "merchant-1", rail: "base", syncedAddress: "0xabc" })
    ).rejects.toSatisfy((error: unknown) => {
      expect(isWalletRailSyncSchemaError(error)).toBe(true)
      return true
    })
  })

  it("does not misclassify a transient/unknown database error", async () => {
    const transientError = { code: "57014", message: "canceling statement due to statement timeout" }
    vi.doMock("@/database/supabase", () => ({
      supabase: { from: () => fluentQuery({ data: null, error: transientError }) },
      supabaseAdmin: null,
    }))

    const { getWalletRailSyncs, isWalletRailSyncSchemaError } = await import("@/database/pineTreeWalletRailSyncs")

    await expect(getWalletRailSyncs("merchant-1")).rejects.toSatisfy((error: unknown) => {
      expect(isWalletRailSyncSchemaError(error)).toBe(false)
      return true
    })
  })
})
