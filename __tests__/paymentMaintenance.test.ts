import fs from "fs"
import path from "path"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/database", () => ({
  getPaymentById: vi.fn()
}))

vi.mock("@/database/paymentEvents", () => ({
  getPaymentEvents: vi.fn().mockResolvedValue([])
}))

vi.mock("@/database/transactions", () => ({
  getTransactionByPaymentId: vi.fn().mockResolvedValue(null)
}))

vi.mock("@/database/paymentMaintenance", () => ({
  getPaymentMaintenanceCandidates: vi.fn().mockResolvedValue([]),
  getTerminalPaymentMaintenanceCandidates: vi.fn().mockResolvedValue([])
}))

vi.mock("@/engine/checkPaymentOnce", () => ({
  runPaymentWatcher: vi.fn().mockResolvedValue(false)
}))

vi.mock("@/engine/paymentStateActions", () => ({
  markPaymentIncomplete: vi.fn().mockResolvedValue(false)
}))

vi.mock("@/engine/reconcileTransaction", () => ({
  reconcileTransactionForPayment: vi.fn().mockResolvedValue({ skipped: true })
}))

vi.mock("@/engine/stalePaymentSweep", () => ({
  sweepStalePayments: vi.fn().mockResolvedValue({
    scanned: 0,
    markedIncomplete: 0,
    expiredIntents: 0,
    skipped: 0,
    cutoff: "2026-06-08T00:00:00.000Z"
  })
}))

import { getPaymentById } from "@/database"
import {
  getPaymentMaintenanceCandidates,
  getTerminalPaymentMaintenanceCandidates
} from "@/database/paymentMaintenance"
import { getPaymentEvents } from "@/database/paymentEvents"
import { getTransactionByPaymentId } from "@/database/transactions"
import { runPaymentWatcher } from "@/engine/checkPaymentOnce"
import {
  ensurePaymentFresh,
  resetPaymentMaintenanceLeaseForTests,
  runPaymentMaintenanceTick
} from "@/engine/paymentMaintenance"
import { markPaymentIncomplete } from "@/engine/paymentStateActions"
import { reconcileTransactionForPayment } from "@/engine/reconcileTransaction"
import { sweepStalePayments } from "@/engine/stalePaymentSweep"
import type { PaymentStatus } from "@/database/payments"

const repoRoot = process.cwd()

function payment(status: PaymentStatus, overrides: Record<string, unknown> = {}) {
  return {
    id: "pay-1",
    merchant_id: "merchant-1",
    merchant_amount: 10,
    pinetree_fee: 0.15,
    gross_amount: 10.15,
    currency: "USD",
    provider: "solana",
    provider_reference: undefined,
    status,
    network: "solana",
    metadata: null,
    created_at: "2026-06-08T00:00:00.000Z",
    updated_at: "2026-06-08T00:00:00.000Z",
    ...overrides
  }
}

describe("no-cron payment maintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getPaymentById).mockReset()
    vi.mocked(getPaymentEvents).mockResolvedValue([])
    vi.mocked(getTransactionByPaymentId).mockResolvedValue(null)
    vi.mocked(getPaymentMaintenanceCandidates).mockResolvedValue([])
    vi.mocked(getTerminalPaymentMaintenanceCandidates).mockResolvedValue([])
    vi.mocked(runPaymentWatcher).mockResolvedValue(false)
    vi.mocked(markPaymentIncomplete).mockResolvedValue(false)
    vi.mocked(reconcileTransactionForPayment).mockResolvedValue({ skipped: true } as never)
    vi.mocked(sweepStalePayments).mockResolvedValue({
      scanned: 0,
      markedIncomplete: 0,
      expiredIntents: 0,
      skipped: 0,
      cutoff: "2026-06-08T00:00:00.000Z"
    })
    resetPaymentMaintenanceLeaseForTests()
  })

  it("does not require a Vercel cron schedule", () => {
    const config = JSON.parse(fs.readFileSync(path.join(repoRoot, "vercel.json"), "utf8"))
    expect(config.crons).toBeUndefined()
  })

  it("skips the maintenance tick when it ran recently", async () => {
    const first = await runPaymentMaintenanceTick({ now: 120_000, throttleMs: 60_000 })
    const second = await runPaymentMaintenanceTick({ now: 121_000, throttleMs: 60_000 })

    expect(first.skipped).toBe(false)
    expect(second).toMatchObject({ skipped: true, skipReason: "recently_run" })
    expect(sweepStalePayments).toHaveBeenCalledTimes(1)
  })

  it("skips an overlapping tick while the warm instance is already running", async () => {
    let releaseSweep: (() => void) | undefined
    vi.mocked(sweepStalePayments).mockImplementationOnce(() => new Promise((resolve) => {
      releaseSweep = () => resolve({
        scanned: 0,
        markedIncomplete: 0,
        expiredIntents: 0,
        skipped: 0,
        cutoff: "2026-06-08T00:00:00.000Z"
      })
    }))

    const first = runPaymentMaintenanceTick({ now: 120_000, throttleMs: 60_000 })
    const second = await runPaymentMaintenanceTick({ now: 120_001, throttleMs: 60_000 })

    expect(second).toMatchObject({ skipped: true, skipReason: "already_running" })
    releaseSweep?.()
    await first
    expect(sweepStalePayments).toHaveBeenCalledTimes(1)
  })

  it("marks a stale PENDING payment incomplete through markPaymentIncomplete", async () => {
    vi.mocked(getPaymentById)
      .mockResolvedValueOnce(payment("PENDING"))
      .mockResolvedValueOnce(payment("INCOMPLETE"))
    vi.mocked(markPaymentIncomplete).mockResolvedValue(true)

    const result = await ensurePaymentFresh("pay-1")

    expect(result).toMatchObject({ action: "marked_incomplete", status: "INCOMPLETE" })
    expect(markPaymentIncomplete).toHaveBeenCalledWith("pay-1", expect.objectContaining({
      providerEvent: "traffic.payment_freshness_timeout"
    }))
    expect(runPaymentWatcher).not.toHaveBeenCalled()
  })

  it("rechecks stale PENDING with evidence instead of marking incomplete", async () => {
    vi.mocked(getPaymentById)
      .mockResolvedValueOnce(payment("PENDING", { provider_reference: "sig-123" }))
      .mockResolvedValueOnce(payment("PROCESSING", { provider_reference: "sig-123" }))
    vi.mocked(runPaymentWatcher).mockResolvedValue(true)

    const result = await ensurePaymentFresh("pay-1")

    expect(result).toMatchObject({ action: "watcher_recheck", detected: true })
    expect(markPaymentIncomplete).not.toHaveBeenCalled()
    expect(runPaymentWatcher).toHaveBeenCalledWith("pay-1", undefined)
  })

  it("rechecks PROCESSING payments instead of marking incomplete", async () => {
    vi.mocked(getPaymentById)
      .mockResolvedValueOnce(payment("PROCESSING"))
      .mockResolvedValueOnce(payment("PROCESSING"))

    const result = await ensurePaymentFresh("pay-1")

    expect(result).toMatchObject({ action: "watcher_recheck", status: "PROCESSING" })
    expect(runPaymentWatcher).toHaveBeenCalledWith("pay-1", undefined)
    expect(markPaymentIncomplete).not.toHaveBeenCalled()
  })

  it("never downgrades CONFIRMED or converts FAILED to INCOMPLETE", async () => {
    vi.mocked(getPaymentById).mockResolvedValueOnce(payment("CONFIRMED"))
    await expect(ensurePaymentFresh("pay-1")).resolves.toMatchObject({
      action: "none",
      status: "CONFIRMED"
    })

    vi.mocked(getPaymentById).mockResolvedValueOnce(payment("FAILED"))
    await expect(ensurePaymentFresh("pay-1")).resolves.toMatchObject({
      action: "none",
      status: "FAILED"
    })

    expect(markPaymentIncomplete).not.toHaveBeenCalled()
    expect(runPaymentWatcher).not.toHaveBeenCalled()
  })

  it("rechecks PROCESSING and reconciles terminal rows during a tick", async () => {
    vi.mocked(getPaymentMaintenanceCandidates).mockResolvedValue([
      payment("PROCESSING", { id: "pay-processing" })
    ] as never)
    vi.mocked(getTerminalPaymentMaintenanceCandidates).mockResolvedValue([
      { id: "pay-confirmed", status: "CONFIRMED" }
    ] as never)
    vi.mocked(reconcileTransactionForPayment).mockResolvedValue({
      transactionId: "tx-1",
      previousStatus: "PENDING",
      newStatus: "CONFIRMED",
      skipped: false
    })

    const result = await runPaymentMaintenanceTick({ now: 120_000, watcherLimit: 1 })

    expect(result).toMatchObject({
      skipped: false,
      watcherChecks: 1,
      reconciled: 1
    })
    expect(runPaymentWatcher).toHaveBeenCalledWith("pay-processing")
    expect(reconcileTransactionForPayment).toHaveBeenCalledWith("pay-confirmed", "CONFIRMED")
  })

  it("keeps payment-state decisions out of route files", () => {
    const routeFiles = [
      "app/api/payments/status/route.ts",
      "app/api/payments/[paymentId]/route.ts",
      "app/api/payments/[paymentId]/detect/route.ts",
      "app/api/dashboard/overview/route.ts",
      "app/api/transactions/route.ts",
      "app/api/admin/overview/route.ts",
      "app/api/admin/transactions/route.ts"
    ]

    for (const route of routeFiles) {
      const source = fs.readFileSync(path.join(repoRoot, route), "utf8")
      expect(source).not.toMatch(/markPaymentIncomplete|updatePaymentStatus|paymentHasProcessingEvidence|CHECKOUT_TIMEOUT_MS/)
    }
  })

  it("detect route delegates lifecycle decisions to the Engine helper", () => {
    const source = fs.readFileSync(
      path.join(repoRoot, "app/api/payments/[paymentId]/detect/route.ts"),
      "utf8"
    )

    expect(source).toContain("runPaymentDetectForPayment")
    expect(source).not.toMatch(
      /CREATED|PENDING|PROCESSING|CONFIRMED|FAILED|INCOMPLETE|payment\.status|active|terminal|stale/
    )
  })
})
