import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/database/walletSweepJobs", () => ({
  claimWalletSweepJobs: vi.fn(),
  resetStalledWalletSweepJobs: vi.fn(),
}))
vi.mock("@/engine/withdrawals/walletSweepExecution", () => ({
  processClaimedSweepJobs: vi.fn(),
}))
vi.mock("@/engine/withdrawals/walletSweepEvaluation", () => ({
  evaluateThresholdSweepRules: vi.fn(),
  evaluateDailySweepRules: vi.fn(),
}))

import { POST } from "@/app/api/cron/process-wallet-sweeps/route"
import { claimWalletSweepJobs, resetStalledWalletSweepJobs } from "@/database/walletSweepJobs"
import { processClaimedSweepJobs } from "@/engine/withdrawals/walletSweepExecution"
import { evaluateThresholdSweepRules, evaluateDailySweepRules } from "@/engine/withdrawals/walletSweepEvaluation"

function request(token?: string) {
  return new NextRequest("https://app.pinetree-payments.com/api/cron/process-wallet-sweeps", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  })
}

describe("process-wallet-sweeps cron route", () => {
  const previousSecret = process.env.CRON_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.CRON_SECRET
  })

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = previousSecret
  })

  it("fails closed when CRON_SECRET is absent", async () => {
    const response = await POST(request())

    expect(response.status).toBe(401)
    expect(claimWalletSweepJobs).not.toHaveBeenCalled()
  })

  it("rejects an invalid bearer token", async () => {
    process.env.CRON_SECRET = "expected-secret"

    const response = await POST(request("wrong-secret"))

    expect(response.status).toBe(401)
    expect(claimWalletSweepJobs).not.toHaveBeenCalled()
  })

  it("reclaims stalled jobs, evaluates rules, claims a batch, and processes it", async () => {
    process.env.CRON_SECRET = "expected-secret"
    vi.mocked(resetStalledWalletSweepJobs).mockResolvedValue(2)
    vi.mocked(evaluateThresholdSweepRules).mockResolvedValue([{ queued: true, reason: "queued" }, { queued: false, reason: "below_threshold" }])
    vi.mocked(evaluateDailySweepRules).mockResolvedValue([{ queued: true, reason: "queued" }])
    vi.mocked(claimWalletSweepJobs).mockResolvedValue([{ id: "job_1" } as never])
    vi.mocked(processClaimedSweepJobs).mockResolvedValue({
      confirmed: 1,
      failed: 0,
      awaitingClientSignature: 0,
      awaitingGas: 0,
      stillProcessing: 0,
    })

    const response = await POST(request("expected-secret"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(resetStalledWalletSweepJobs).toHaveBeenCalledWith(600)
    expect(claimWalletSweepJobs).toHaveBeenCalledWith(25)
    expect(processClaimedSweepJobs).toHaveBeenCalledWith([{ id: "job_1" }])
    expect(body).toMatchObject({
      reclaimedStalledJobs: 2,
      thresholdQueued: 1,
      dailyQueued: 1,
      claimed: 1,
      confirmed: 1,
      failed: 0,
    })
  })

  it("returns 500 and does not throw when the underlying claim call fails", async () => {
    process.env.CRON_SECRET = "expected-secret"
    vi.mocked(resetStalledWalletSweepJobs).mockResolvedValue(0)
    vi.mocked(evaluateThresholdSweepRules).mockResolvedValue([])
    vi.mocked(evaluateDailySweepRules).mockResolvedValue([])
    vi.mocked(claimWalletSweepJobs).mockRejectedValue(new Error("db unavailable"))

    const response = await POST(request("expected-secret"))

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toBe("db unavailable")
  })
})
