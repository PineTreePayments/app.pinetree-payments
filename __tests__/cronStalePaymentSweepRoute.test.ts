import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/engine/stalePaymentSweep", () => ({
  sweepStalePayments: vi.fn()
}))

import { POST } from "@/app/api/cron/sweep-stale-payments/route"
import { sweepStalePayments } from "@/engine/stalePaymentSweep"

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
    expect(sweepStalePayments).not.toHaveBeenCalled()
  })

  it("rejects an invalid bearer token", async () => {
    process.env.CRON_SECRET = "expected-secret"

    const response = await POST(request("wrong-secret"))

    expect(response.status).toBe(401)
    expect(sweepStalePayments).not.toHaveBeenCalled()
  })

  it("preserves the POST endpoint and returns aggregate run diagnostics", async () => {
    process.env.CRON_SECRET = "expected-secret"
    vi.mocked(sweepStalePayments).mockResolvedValue({
      runId: "run-1",
      durationMs: 24,
      scanned: 2,
      markedIncomplete: 2,
      expired: 2,
      incomplete: 0,
      expiredIntents: 2,
      skipped: 0,
      skippedSubmittedEvidence: 0,
      skippedTerminal: 0,
      skippedConcurrent: 0,
      failures: 0,
      cutoff: "2026-07-15T20:45:00.000Z"
    })

    const response = await POST(request("expected-secret"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(sweepStalePayments).toHaveBeenCalledWith({
      maxRows: 250,
      staleAfterMs: 5 * 60 * 1000
    })
    expect(body).toMatchObject({
      runId: "run-1",
      durationMs: 24,
      scanned: 2,
      markedIncomplete: 2,
      expiredIntents: 2,
      skipped: 0
    })
  })
})
