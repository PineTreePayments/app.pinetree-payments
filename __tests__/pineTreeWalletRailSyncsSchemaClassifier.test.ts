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

  it("does not misclassify a connection-pooler 'prepared statement does not exist' error as a missing schema", async () => {
    // A known Supabase/PgBouncer transaction-pooling artifact: unrelated to the
    // table's schema, but its message contains "does not exist" just like a
    // genuine undefined-relation error. This is the exact shape that produced
    // production's "rail_sync_route_failed { stage: 'rail_sync_profile_loaded',
    // code: 'database_schema_missing' }" even though the schema-contract HEAD
    // check moments earlier had already passed for the same table.
    const preparedStatementError = {
      code: "26000",
      message: 'prepared statement "s0" does not exist',
    }
    vi.doMock("@/database/supabase", () => ({
      supabase: { from: () => fluentQuery({ data: null, error: preparedStatementError }) },
      supabaseAdmin: null,
    }))

    const { getWalletRailSyncs, isWalletRailSyncSchemaError } = await import("@/database/pineTreeWalletRailSyncs")

    await expect(getWalletRailSyncs("merchant-1")).rejects.toSatisfy((error: unknown) => {
      expect(isWalletRailSyncSchemaError(error)).toBe(false)
      return true
    })
  })

  it("classifies a genuine undefined-column Postgres error (42703) as database_schema_missing and extracts the column name", async () => {
    const undefinedColumnError = {
      code: "42703",
      message: 'column "synced_address" does not exist',
    }
    vi.doMock("@/database/supabase", () => ({
      supabase: { from: () => fluentQuery({ data: null, error: undefinedColumnError }) },
      supabaseAdmin: null,
    }))

    const { getWalletRailSyncs, isWalletRailSyncSchemaError } = await import("@/database/pineTreeWalletRailSyncs")

    await expect(getWalletRailSyncs("merchant-1")).rejects.toSatisfy((error: unknown) => {
      expect(isWalletRailSyncSchemaError(error)).toBe(true)
      if (isWalletRailSyncSchemaError(error)) {
        expect(error.column).toBe("synced_address")
        expect(error.relation).toBe("pinetree_wallet_rail_syncs")
        expect(error.operation).toBe("select")
      }
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
