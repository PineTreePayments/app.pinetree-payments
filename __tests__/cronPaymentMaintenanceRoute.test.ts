import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/engine/paymentMaintenance", () => ({
  runPaymentMaintenanceTick: vi.fn()
}))

import { runPaymentMaintenanceTick } from "@/engine/paymentMaintenance"
import { GET } from "@/app/api/cron/check-payments/route"

function request(token?: string) {
  return new NextRequest("https://example.test/api/cron/check-payments", {
    headers: token ? { authorization: `Bearer ${token}` } : undefined
  })
}

describe("payment maintenance cron route", () => {
  const previousSecret = process.env.CRON_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.CRON_SECRET
  })

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = previousSecret
  })

  it("rejects requests when CRON_SECRET is missing", async () => {
    const response = await GET(request())
    expect(response.status).toBe(401)
    expect(runPaymentMaintenanceTick).not.toHaveBeenCalled()
  })

  it("rejects invalid bearer authentication", async () => {
    process.env.CRON_SECRET = "expected-secret"
    const response = await GET(request("wrong-secret"))
    expect(response.status).toBe(401)
    expect(runPaymentMaintenanceTick).not.toHaveBeenCalled()
  })

  it("accepts valid bearer authentication and returns aggregate diagnostics", async () => {
    process.env.CRON_SECRET = "expected-secret"
    vi.mocked(runPaymentMaintenanceTick).mockResolvedValue({
      runId: "run-1",
      startedAt: "2026-07-15T12:00:00.000Z",
      completedAt: "2026-07-15T12:00:01.000Z",
      skipped: false,
      sweep: null,
      candidatesScanned: 4,
      expired: 2,
      canceledReconciled: 0,
      incomplete: 0,
      transactionSnapshotsReconciled: 1,
      skippedSubmittedEvidence: 1,
      skippedTerminal: 0,
      failures: 0,
      watcherCandidates: 1,
      watcherChecks: 1,
      watcherErrors: 0,
      reconciled: 1,
      reconcileErrors: 0,
      lightningCandidates: 0,
      lightningReconciled: 0,
      lightningErrors: 0,
      feeSettlementCandidates: 0,
      feeSettlementReconciled: 0,
      feeSettlementErrors: 0
    })

    const response = await GET(request("expected-secret"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(runPaymentMaintenanceTick).toHaveBeenCalledWith(expect.objectContaining({
      throttleMs: 1_000,
      sweepLimit: 25,
      lightningReconcileLimit: 25
    }))
    expect(body).toMatchObject({
      runId: "run-1",
      candidatesScanned: 4,
      expired: 2,
      transactionSnapshotsReconciled: 1,
      failures: 0
    })
  })
})
