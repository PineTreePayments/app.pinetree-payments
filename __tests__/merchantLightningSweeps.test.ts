import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  insertError: null as { message: string } | null,
}))

function findByIdempotencyKey(key: string) {
  return mocks.rows.find((row) => row.idempotency_key === key) || null
}

vi.mock("@/database/supabase", () => ({
  supabaseAdmin: {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        if (mocks.insertError) {
          return { select: () => ({ single: async () => ({ data: null, error: mocks.insertError }) }) }
        }
        // Simulate the DB unique constraint on idempotency_key.
        const conflict = findByIdempotencyKey(String(row.idempotency_key))
        if (conflict) {
          return {
            select: () => ({
              single: async () => ({ data: null, error: { message: "duplicate key value violates unique constraint" } }),
            }),
          }
        }
        const stored = {
          id: `sweep_${mocks.rows.length + 1}`,
          attempt_count: 0,
          status: "queued",
          fee_reserve_sats: 0,
          ...row,
        }
        mocks.rows.push(stored)
        return { select: () => ({ single: async () => ({ data: stored, error: null }) }) }
      },
      select: () => {
        const builder = {
          _filters: [] as Array<(row: Record<string, unknown>) => boolean>,
          eq(field: string, value: unknown) {
            this._filters.push((row) => row[field] === value)
            return this
          },
          in(field: string, values: unknown[]) {
            this._filters.push((row) => values.includes(row[field]))
            return this
          },
          or() {
            // Accept everything for the "next_attempt_at is null or due" OR
            // clause in tests - individual tests seed rows accordingly.
            return this
          },
          order() {
            return this
          },
          limit(n: number) {
            this._limitN = n
            return this
          },
          _limitN: undefined as number | undefined,
          async maybeSingle() {
            const match = mocks.rows.filter((row) => this._filters.every((f) => f(row)))[0] || null
            return { data: match, error: null }
          },
          async single() {
            const match = mocks.rows.filter((row) => this._filters.every((f) => f(row)))[0]
            return match ? { data: match, error: null } : { data: null, error: { message: "not found" } }
          },
          then(resolve: (value: { data: Record<string, unknown>[]; error: null }) => void) {
            let match = mocks.rows.filter((row) => this._filters.every((f) => f(row)))
            if (this._limitN != null) match = match.slice(0, this._limitN)
            resolve({ data: match, error: null })
          },
        }
        return builder
      },
      update: (patch: Record<string, unknown>) => {
        const builder = {
          _filters: [] as Array<(row: Record<string, unknown>) => boolean>,
          eq(field: string, value: unknown) {
            this._filters.push((row) => row[field] === value)
            return this
          },
          in(field: string, values: unknown[]) {
            this._filters.push((row) => values.includes(row[field]))
            return this
          },
          select() {
            return this
          },
          async maybeSingle() {
            const index = mocks.rows.findIndex((row) => this._filters.every((f) => f(row)))
            if (index === -1) return { data: null, error: null }
            mocks.rows[index] = { ...mocks.rows[index], ...patch }
            return { data: mocks.rows[index], error: null }
          },
          async single() {
            const index = mocks.rows.findIndex((row) => this._filters.every((f) => f(row)))
            if (index === -1) return { data: null, error: { message: "not found" } }
            mocks.rows[index] = { ...mocks.rows[index], ...patch }
            return { data: mocks.rows[index], error: null }
          },
        }
        return builder
      },
    }),
  },
  supabase: null,
}))

import {
  buildLightningSweepIdempotencyKey,
  claimLightningSweepForProcessing,
  createLightningSweepIfMissing,
  getLightningSweepByIdempotencyKey,
  incrementLightningSweepAttempt,
  LIGHTNING_SWEEP_CLAIMABLE_STATUSES,
  updateLightningSweep,
} from "@/database/merchantLightningSweeps"

describe("merchantLightningSweeps", () => {
  beforeEach(() => {
    mocks.rows = []
    mocks.insertError = null
  })

  describe("buildLightningSweepIdempotencyKey", () => {
    it("is stable for the same (merchant, payment) and includes a sweep version", () => {
      const a = buildLightningSweepIdempotencyKey({ merchantId: "m1", sourcePaymentId: "p1" })
      const b = buildLightningSweepIdempotencyKey({ merchantId: "m1", sourcePaymentId: "p1" })
      expect(a).toBe(b)
      expect(a).toContain("m1")
      expect(a).toContain("p1")
      expect(a).toMatch(/^lightning-sweep:v\d+:/)
    })

    it("differs for a different merchant or payment", () => {
      const a = buildLightningSweepIdempotencyKey({ merchantId: "m1", sourcePaymentId: "p1" })
      const b = buildLightningSweepIdempotencyKey({ merchantId: "m2", sourcePaymentId: "p1" })
      const c = buildLightningSweepIdempotencyKey({ merchantId: "m1", sourcePaymentId: "p2" })
      expect(a).not.toBe(b)
      expect(a).not.toBe(c)
    })
  })

  describe("createLightningSweepIfMissing", () => {
    it("creates exactly one row and returns the same row on a repeated call", async () => {
      const input = {
        merchantId: "merchant_1",
        sourcePaymentId: "payment_1",
        speedConnectedAccountId: "acct_1",
        requestedAmountSats: 5000,
      }

      const first = await createLightningSweepIfMissing(input)
      const second = await createLightningSweepIfMissing(input)

      expect(first.id).toBe(second.id)
      expect(mocks.rows.length).toBe(1)
      expect(first.status).toBe("queued")
    })

    it("recovers via a re-read when a concurrent insert wins the unique-constraint race", async () => {
      const input = {
        merchantId: "merchant_1",
        sourcePaymentId: "payment_1",
        speedConnectedAccountId: "acct_1",
        requestedAmountSats: 5000,
      }
      // Simulate a concurrent creator having already inserted the row.
      const key = buildLightningSweepIdempotencyKey({ merchantId: input.merchantId, sourcePaymentId: input.sourcePaymentId })
      mocks.rows.push({
        id: "sweep_raced",
        merchant_id: input.merchantId,
        source_payment_id: input.sourcePaymentId,
        idempotency_key: key,
        status: "queued",
        attempt_count: 0,
      })

      const result = await createLightningSweepIfMissing(input)
      expect(result.id).toBe("sweep_raced")
      expect(mocks.rows.length).toBe(1)
    })
  })

  describe("claimLightningSweepForProcessing", () => {
    it("claims a queued sweep and moves it to processing", async () => {
      mocks.rows.push({
        id: "sweep_1",
        status: "queued",
        attempt_count: 0,
        idempotency_key: "key-1",
      })
      const claimed = await claimLightningSweepForProcessing("sweep_1")
      expect(claimed?.status).toBe("processing")
    })

    it("refuses to claim a sweep already in processing (no overlapping attempts)", async () => {
      mocks.rows.push({
        id: "sweep_1",
        status: "processing",
        attempt_count: 1,
        idempotency_key: "key-1",
      })
      const claimed = await claimLightningSweepForProcessing("sweep_1")
      expect(claimed).toBeNull()
    })

    it("refuses to claim a terminal sweep", async () => {
      mocks.rows.push({ id: "sweep_1", status: "confirmed", attempt_count: 1, idempotency_key: "key-1" })
      expect(await claimLightningSweepForProcessing("sweep_1")).toBeNull()
    })

    it("does not itself increment attempt_count - only incrementLightningSweepAttempt does", async () => {
      mocks.rows.push({ id: "sweep_1", status: "queued", attempt_count: 2, idempotency_key: "key-1" })
      const claimed = await claimLightningSweepForProcessing("sweep_1")
      expect(claimed?.attempt_count).toBe(2)
    })

    it("every claimable status listed can actually be claimed", async () => {
      for (const status of LIGHTNING_SWEEP_CLAIMABLE_STATUSES) {
        mocks.rows = [{ id: "sweep_x", status, attempt_count: 0, idempotency_key: "key-x" }]
        const claimed = await claimLightningSweepForProcessing("sweep_x")
        expect(claimed, `expected ${status} to be claimable`).not.toBeNull()
      }
    })
  })

  describe("incrementLightningSweepAttempt", () => {
    it("increments attempt_count by exactly one", async () => {
      mocks.rows.push({ id: "sweep_1", status: "processing", attempt_count: 1, idempotency_key: "key-1" })
      const updated = await incrementLightningSweepAttempt("sweep_1")
      expect(updated.attempt_count).toBe(2)
    })
  })

  describe("updateLightningSweep", () => {
    it("only writes the fields explicitly provided", async () => {
      mocks.rows.push({
        id: "sweep_1",
        status: "queued",
        attempt_count: 0,
        idempotency_key: "key-1",
        last_error_code: "old_code",
      })
      const updated = await updateLightningSweep("sweep_1", { status: "awaiting_balance" })
      expect(updated.status).toBe("awaiting_balance")
      expect(updated.last_error_code).toBe("old_code")
    })
  })

  describe("getLightningSweepByIdempotencyKey", () => {
    it("returns null when no row matches", async () => {
      expect(await getLightningSweepByIdempotencyKey("nope")).toBeNull()
    })
  })
})
