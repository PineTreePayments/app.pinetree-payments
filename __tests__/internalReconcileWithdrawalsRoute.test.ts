import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  reconcileProcessingWithdrawals: vi.fn(),
}))

vi.mock("@/engine/withdrawals/walletWithdrawalReconciliation", () => ({
  reconcileProcessingWithdrawals: mocks.reconcileProcessingWithdrawals,
}))

import { POST } from "@/app/api/internal/wallets/pinetree/reconcile-withdrawals/route"

function makeRequest(body: unknown, authorized = true): Request {
  return new Request("https://example.test/api/internal/wallets/pinetree/reconcile-withdrawals", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorized ? { authorization: `Bearer ${process.env.INTERNAL_API_SECRET}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

describe("POST /api/internal/wallets/pinetree/reconcile-withdrawals", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.INTERNAL_API_SECRET = "test-internal-secret"
    delete process.env.CRON_SECRET
    mocks.reconcileProcessingWithdrawals.mockResolvedValue({
      candidates: 1,
      checked: 1,
      missingProviderReference: 0,
      confirmed: 1,
      failed: 0,
      stillProcessing: 0,
      still_processing: 0,
      skipped: 0,
      errors: 0,
    })
  })

  it("rejects an unauthorized request without calling reconciliation", async () => {
    const res = await POST(makeRequest({}, false) as never)

    expect(res.status).toBe(401)
    expect(mocks.reconcileProcessingWithdrawals).not.toHaveBeenCalled()
  })

  it("defaults to a global sweep (no merchantId) when the body omits one", async () => {
    const res = await POST(makeRequest({}) as never)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.candidates).toBe(1)
    expect(body.confirmed).toBe(1)
    expect(body.missingProviderReference).toBe(0)
    expect(body.stillProcessing).toBe(0)
    expect(body.errors).toBe(0)
    expect(mocks.reconcileProcessingWithdrawals).toHaveBeenCalledWith({ limit: 50, merchantId: undefined })
  })

  it("scopes the historical backfill to a single merchant when merchantId is provided - the safe repair path for a stuck withdrawal", async () => {
    const res = await POST(makeRequest({ merchantId: "merch-stuck-1", limit: 5 }) as never)

    expect(res.status).toBe(200)
    expect(mocks.reconcileProcessingWithdrawals).toHaveBeenCalledWith({ limit: 5, merchantId: "merch-stuck-1" })
  })

  it("ignores a blank/whitespace merchantId and falls back to a global sweep", async () => {
    await POST(makeRequest({ merchantId: "   " }) as never)

    expect(mocks.reconcileProcessingWithdrawals).toHaveBeenCalledWith({ limit: 50, merchantId: undefined })
  })
})
