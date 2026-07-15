import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/database/paymentMaintenance", () => ({
  getStalePaymentMaintenanceCandidates: vi.fn()
}))

vi.mock("@/database/paymentIntents", () => ({
  getPaymentIntentByPaymentId: vi.fn().mockResolvedValue(null),
  expirePaymentIntent: vi.fn().mockResolvedValue(undefined)
}))

vi.mock("@/engine/paymentStateActions", () => ({
  getPaymentIncompleteEligibility: vi.fn(),
  markPaymentIncomplete: vi.fn()
}))

import { getStalePaymentMaintenanceCandidates } from "@/database/paymentMaintenance"
import { expirePaymentIntent, getPaymentIntentByPaymentId } from "@/database/paymentIntents"
import { getPaymentIncompleteEligibility, markPaymentIncomplete } from "@/engine/paymentStateActions"
import { sweepStalePayments } from "@/engine/stalePaymentSweep"

const candidate = (id: string) => ({ id, updated_at: "2026-06-08T00:00:00.000Z" })

describe("stale payment sweep", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getStalePaymentMaintenanceCandidates).mockResolvedValue([])
    vi.mocked(getPaymentIncompleteEligibility).mockResolvedValue({
      eligible: true,
      status: "PENDING",
      reason: "pending_no_activity_timeout"
    })
    vi.mocked(markPaymentIncomplete).mockResolvedValue(true)
    vi.mocked(getPaymentIntentByPaymentId).mockResolvedValue(null)
  })

  it("expires stale eligible payments through the canonical lifecycle helper", async () => {
    vi.mocked(getStalePaymentMaintenanceCandidates)
      .mockResolvedValueOnce([candidate("pay-1")])
    vi.mocked(getPaymentIntentByPaymentId).mockResolvedValue({ id: "intent-1" } as never)

    const result = await sweepStalePayments({ maxRows: 10, pageSize: 5 })

    expect(markPaymentIncomplete).toHaveBeenCalledWith("pay-1", expect.objectContaining({
      providerEvent: "maintenance.checkout_timeout"
    }))
    expect(expirePaymentIntent).toHaveBeenCalledWith("intent-1")
    expect(result).toMatchObject({ scanned: 1, expired: 1, expiredIntents: 1, failures: 0 })
  })

  it("reports canonical submitted evidence and terminal races without transitioning", async () => {
    vi.mocked(getStalePaymentMaintenanceCandidates)
      .mockResolvedValueOnce([candidate("pay-evidence"), candidate("pay-terminal")])
    vi.mocked(getPaymentIncompleteEligibility)
      .mockResolvedValueOnce({
        eligible: false,
        status: "PENDING",
        reason: "payment_has_processing_evidence"
      })
      .mockResolvedValueOnce({
        eligible: false,
        status: "CONFIRMED",
        reason: "terminal_status_not_eligible"
      })

    const result = await sweepStalePayments({ maxRows: 10 })

    expect(markPaymentIncomplete).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      skippedSubmittedEvidence: 1,
      skippedTerminal: 1,
      expired: 0
    })
  })

  it("loads a bounded snapshot in pages before making transitions", async () => {
    vi.mocked(getStalePaymentMaintenanceCandidates)
      .mockResolvedValueOnce([candidate("pay-1"), candidate("pay-2")])
      .mockResolvedValueOnce([candidate("pay-3")])

    const result = await sweepStalePayments({ maxRows: 5, pageSize: 2 })

    expect(getStalePaymentMaintenanceCandidates).toHaveBeenNthCalledWith(1, expect.objectContaining({
      limit: 2,
      offset: 0
    }))
    expect(getStalePaymentMaintenanceCandidates).toHaveBeenNthCalledWith(2, expect.objectContaining({
      limit: 2,
      offset: 2
    }))
    expect(result).toMatchObject({ scanned: 3, expired: 3 })
  })

  it("continues after one candidate fails", async () => {
    vi.mocked(getStalePaymentMaintenanceCandidates)
      .mockResolvedValueOnce([candidate("pay-bad"), candidate("pay-good")])
    vi.mocked(getPaymentIncompleteEligibility)
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce({
        eligible: true,
        status: "PENDING",
        reason: "pending_no_activity_timeout"
      })

    const result = await sweepStalePayments({ maxRows: 10 })

    expect(markPaymentIncomplete).toHaveBeenCalledTimes(1)
    expect(markPaymentIncomplete).toHaveBeenCalledWith("pay-good", expect.any(Object))
    expect(result).toMatchObject({ scanned: 2, expired: 1, failures: 1 })
  })

  it("is idempotent when a concurrent or repeated transition loses compare-and-set", async () => {
    vi.mocked(getStalePaymentMaintenanceCandidates)
      .mockResolvedValueOnce([candidate("pay-1")])
    vi.mocked(markPaymentIncomplete).mockResolvedValue(false)

    const result = await sweepStalePayments({ maxRows: 10 })

    expect(result).toMatchObject({ expired: 0, skippedConcurrent: 1, failures: 0 })
    expect(expirePaymentIntent).not.toHaveBeenCalled()
  })
})
