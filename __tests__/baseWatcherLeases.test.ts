import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Durable, cross-Vercel-instance single-flight lease + fallback-scan resume
 * cursor for Base payment confirmation checks (database/baseWatcherLeases.ts).
 *
 * Exercises the raw insert-or-steal-if-expired claim contract directly
 * against a minimal fake Supabase query builder, independent of
 * engine/checkPaymentOnce.ts and engine/baseChainReconciliation.ts (covered
 * separately in __tests__/checkPaymentOnceRetryBounds.test.ts and
 * __tests__/baseSelfHealReconciliation.test.ts).
 */

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  select: vi.fn(),
  delete: vi.fn(),
}))

vi.mock("@/database/supabase", () => ({
  supabaseAdmin: {
    from: () => ({
      insert: mocks.insert,
      update: mocks.update,
      select: mocks.select,
      delete: mocks.delete,
    }),
  },
  supabase: {},
}))

import {
  acquireBaseWatcherLease,
  releaseBaseWatcherLease,
  getBaseReconcileScanCursor,
  setBaseReconcileScanCursor,
  clearBaseReconcileScanCursor,
} from "@/database/baseWatcherLeases"

describe("acquireBaseWatcherLease", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("acquires the lease immediately when no row exists yet", async () => {
    mocks.insert.mockResolvedValue({ error: null })

    const acquired = await acquireBaseWatcherLease("pay-1", 30_000)

    expect(acquired).toBe(true)
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ payment_id: "pay-1" })
    )
  })

  it("refuses to acquire when a live (unexpired) lease row already exists", async () => {
    mocks.insert.mockResolvedValue({ error: { code: "23505", message: "duplicate key" } })
    mocks.update.mockReturnValue({
      eq: () => ({ lt: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) }),
    })

    const acquired = await acquireBaseWatcherLease("pay-1", 30_000)

    expect(acquired).toBe(false)
  })

  it("steals the lease once the existing row's lease has expired", async () => {
    mocks.insert.mockResolvedValue({ error: { code: "23505", message: "duplicate key" } })
    mocks.update.mockReturnValue({
      eq: () => ({
        lt: () => ({
          select: () => Promise.resolve({ data: [{ payment_id: "pay-1" }], error: null }),
        }),
      }),
    })

    const acquired = await acquireBaseWatcherLease("pay-1", 30_000)

    expect(acquired).toBe(true)
  })

  it("fails open (acquires) on an unexpected DB error rather than blocking confirmation", async () => {
    mocks.insert.mockResolvedValue({ error: { code: "500", message: "connection refused" } })

    const acquired = await acquireBaseWatcherLease("pay-1", 30_000)

    expect(acquired).toBe(true)
  })

  it("fails open (acquires) if the steal-attempt update itself errors", async () => {
    mocks.insert.mockResolvedValue({ error: { code: "23505", message: "duplicate key" } })
    mocks.update.mockReturnValue({
      eq: () => ({
        lt: () => ({
          select: () => Promise.resolve({ data: null, error: { message: "timeout" } }),
        }),
      }),
    })

    const acquired = await acquireBaseWatcherLease("pay-1", 30_000)

    expect(acquired).toBe(true)
  })
})

describe("releaseBaseWatcherLease", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("deletes the lease row for this payment", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    mocks.delete.mockReturnValue({ eq })

    await releaseBaseWatcherLease("pay-1")

    expect(eq).toHaveBeenCalledWith("payment_id", "pay-1")
  })
})

describe("base reconcile scan cursor", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("reads back a stored cursor value", async () => {
    mocks.select.mockReturnValue({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data: { reconcile_scanned_to_block: 12345 }, error: null }),
      }),
    })

    const cursor = await getBaseReconcileScanCursor("pay-1")

    expect(cursor).toBe(12345)
  })

  it("returns null when no cursor row exists", async () => {
    mocks.select.mockReturnValue({
      eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
    })

    const cursor = await getBaseReconcileScanCursor("pay-1")

    expect(cursor).toBeNull()
  })

  it("updates the cursor in place without touching locked_until when a lease row already exists", async () => {
    const updateEq = vi.fn().mockReturnValue({
      select: () => Promise.resolve({ data: [{ payment_id: "pay-1" }], error: null }),
    })
    mocks.update.mockReturnValue({ eq: updateEq })

    await setBaseReconcileScanCursor("pay-1", 999)

    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ reconcile_scanned_to_block: 999 })
    )
    expect(mocks.update.mock.calls[0][0]).not.toHaveProperty("locked_until")
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("inserts a new (already-expired-lease) row when no row exists to update yet", async () => {
    const updateEq = vi.fn().mockReturnValue({
      select: () => Promise.resolve({ data: [], error: null }),
    })
    mocks.update.mockReturnValue({ eq: updateEq })
    mocks.insert.mockResolvedValue({ error: null })

    await setBaseReconcileScanCursor("pay-1", 999)

    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ payment_id: "pay-1", reconcile_scanned_to_block: 999 })
    )
  })

  it("clears the cursor column back to null", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    mocks.update.mockReturnValue({ eq })

    await clearBaseReconcileScanCursor("pay-1")

    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ reconcile_scanned_to_block: null })
    )
  })
})
