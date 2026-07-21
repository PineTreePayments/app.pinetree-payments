import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The atomic-claim guarantee (SKIP LOCKED, no double-claim across concurrent
 * cron invocations) lives entirely inside the Postgres function
 * claim_wallet_sweep_jobs (database/migrations/20260721_create_claim_wallet_sweep_jobs_fn.sql).
 * This repo has no raw psql/pg driver/DATABASE_URL - only PostgREST via
 * @supabase/supabase-js - so real row-locking concurrency cannot be
 * exercised from a mocked vitest environment; that guarantee can only be
 * verified against a live Postgres instance. What IS verified here: the
 * database layer calls supabase.rpc with the exact function name and
 * parameters the migration defines, uses the admin (service-role) client
 * (never anon), and correctly propagates both success and error results -
 * i.e. everything on this side of the RPC boundary.
 */

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}))

vi.mock("@/database/supabase", () => ({
  supabaseAdmin: { rpc: mocks.rpc },
  supabase: { rpc: vi.fn() },
}))

import { claimWalletSweepJobs, resetStalledWalletSweepJobs } from "@/database/walletSweepJobs"

describe("wallet sweep job claiming", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("claims jobs via the claim_wallet_sweep_jobs RPC function with the requested limit", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: "job_1" }, { id: "job_2" }], error: null })

    const jobs = await claimWalletSweepJobs(25)

    expect(mocks.rpc).toHaveBeenCalledWith("claim_wallet_sweep_jobs", { p_limit: 25 })
    expect(jobs).toHaveLength(2)
    expect(jobs[0].id).toBe("job_1")
  })

  it("returns an empty array when nothing is eligible to claim", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })

    const jobs = await claimWalletSweepJobs(25)

    expect(jobs).toEqual([])
  })

  it("throws (never silently swallows) when the RPC call itself errors", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } })

    await expect(claimWalletSweepJobs(25)).rejects.toThrow("Failed to claim sweep jobs: function does not exist")
  })

  it("reclaims stalled jobs via reset_stalled_wallet_sweep_jobs with the configured timeout", async () => {
    mocks.rpc.mockResolvedValue({ data: 3, error: null })

    const reclaimed = await resetStalledWalletSweepJobs(600)

    expect(mocks.rpc).toHaveBeenCalledWith("reset_stalled_wallet_sweep_jobs", { p_stalled_after_seconds: 600 })
    expect(reclaimed).toBe(3)
  })
})
