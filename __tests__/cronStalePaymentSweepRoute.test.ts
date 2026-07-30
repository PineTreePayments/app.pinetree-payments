import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/engine/paymentMaintenance", () => ({
  runPaymentMaintenanceTick: vi.fn()
}))

import { POST } from "@/app/api/cron/sweep-stale-payments/route"
import { runPaymentMaintenanceTick } from "@/engine/paymentMaintenance"

function request(token?: string) {
  return new NextRequest("https://app.pinetree-payments.com/api/cron/sweep-stale-payments", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : undefined
  })
}

describe("production stale-payment scheduler route", () => {
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
    expect(runPaymentMaintenanceTick).not.toHaveBeenCalled()
  })

  it("rejects an invalid bearer token", async () => {
    process.env.CRON_SECRET = "expected-secret"

    const response = await POST(request("wrong-secret"))

    expect(response.status).toBe(401)
    expect(runPaymentMaintenanceTick).not.toHaveBeenCalled()
  })

  it("preserves the POST endpoint and returns aggregate run diagnostics", async () => {
    process.env.CRON_SECRET = "expected-secret"
    vi.mocked(runPaymentMaintenanceTick).mockResolvedValue({
      runId: "run-1",
      startedAt: "2026-07-15T20:45:00.000Z",
      completedAt: "2026-07-15T20:45:24.000Z",
      skipped: false,
      sweep: { scanned: 2, markedIncomplete: 2 },
      watcherCandidates: 3,
      watcherChecks: 3,
      failures: 0
    } as never)

    const response = await POST(request("expected-secret"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(runPaymentMaintenanceTick).toHaveBeenCalledWith({
      throttleMs: 1_000,
      sweepLimit: 250,
      watcherLimit: 25,
      reconcileLimit: 25,
      watcherTimeoutMs: 8_000,
      lightningReconcileLimit: 25,
      feeSettlementReconcileLimit: 25
    })
    expect(body).toMatchObject({
      runId: "run-1",
      skipped: false,
      watcherCandidates: 3,
      watcherChecks: 3,
      failures: 0
    })
  })
})
