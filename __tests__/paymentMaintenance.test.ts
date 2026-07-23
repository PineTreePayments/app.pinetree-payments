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
  getTerminalPaymentMaintenanceCandidates: vi.fn().mockResolvedValue([]),
  getLightningReconciliationCandidates: vi.fn().mockResolvedValue([]),
  getConfirmedLightningFeeSettlementCandidates: vi.fn().mockResolvedValue([]),
  getIncompleteBasePaymentReconciliationCandidates: vi.fn().mockResolvedValue([])
}))

vi.mock("@/engine/checkPaymentOnce", () => ({
  runPaymentWatcher: vi.fn().mockResolvedValue(false)
}))

vi.mock("@/engine/baseChainReconciliation", () => ({
  reconcileBasePaymentFromChain: vi.fn().mockResolvedValue({ detected: false })
}))

vi.mock("@/engine/lightningSpeedReconciliation", () => ({
  reconcileSpeedLightningPayment: vi.fn(),
  reconcileConfirmedLightningFeeSettlement: vi.fn()
}))

vi.mock("@/engine/paymentStateActions", () => ({
  markPaymentIncomplete: vi.fn().mockResolvedValue(false)
}))

vi.mock("@/engine/reconcileTransaction", () => ({
  reconcileTransactionForPayment: vi.fn().mockResolvedValue({ skipped: true })
}))

vi.mock("@/engine/stalePaymentSweep", () => ({
  sweepStalePayments: vi.fn().mockResolvedValue({
    runId: "sweep-1",
    durationMs: 1,
    scanned: 0,
    markedIncomplete: 0,
    expired: 0,
    incomplete: 0,
    expiredIntents: 0,
    skipped: 0,
    skippedSubmittedEvidence: 0,
    skippedTerminal: 0,
    skippedConcurrent: 0,
    failures: 0,
    cutoff: "2026-06-08T00:00:00.000Z"
  })
}))

import { getPaymentById } from "@/database"
import {
  getPaymentMaintenanceCandidates,
  getTerminalPaymentMaintenanceCandidates,
  getLightningReconciliationCandidates
} from "@/database/paymentMaintenance"
import { getPaymentEvents } from "@/database/paymentEvents"
import { getTransactionByPaymentId } from "@/database/transactions"
import { runPaymentWatcher } from "@/engine/checkPaymentOnce"
import { reconcileSpeedLightningPayment } from "@/engine/lightningSpeedReconciliation"
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

describe("payment maintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getPaymentById).mockReset()
    vi.mocked(getPaymentEvents).mockResolvedValue([])
    vi.mocked(getTransactionByPaymentId).mockResolvedValue(null)
    vi.mocked(getPaymentMaintenanceCandidates).mockResolvedValue([])
    vi.mocked(getTerminalPaymentMaintenanceCandidates).mockResolvedValue([])
    vi.mocked(getLightningReconciliationCandidates).mockResolvedValue([])
    vi.mocked(runPaymentWatcher).mockResolvedValue(false)
    vi.mocked(reconcileSpeedLightningPayment).mockReset()
    vi.mocked(markPaymentIncomplete).mockResolvedValue(false)
    vi.mocked(reconcileTransactionForPayment).mockResolvedValue({ skipped: true } as never)
    vi.mocked(sweepStalePayments).mockResolvedValue({
      runId: "sweep-1",
      durationMs: 1,
      scanned: 0,
      markedIncomplete: 0,
      expired: 0,
      incomplete: 0,
      expiredIntents: 0,
      skipped: 0,
      skippedSubmittedEvidence: 0,
      skippedTerminal: 0,
      skippedConcurrent: 0,
      failures: 0,
      cutoff: "2026-06-08T00:00:00.000Z"
    })
    resetPaymentMaintenanceLeaseForTests()
  })

  it("does not define a duplicate Vercel scheduler", () => {
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
        runId: "sweep-1",
        durationMs: 1,
        scanned: 0,
        markedIncomplete: 0,
        expired: 0,
        incomplete: 0,
        expiredIntents: 0,
        skipped: 0,
        skippedSubmittedEvidence: 0,
        skippedTerminal: 0,
        skippedConcurrent: 0,
        failures: 0,
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
      .mockResolvedValueOnce(payment("PENDING"))
      .mockResolvedValueOnce(payment("PROCESSING"))
    vi.mocked(getTransactionByPaymentId).mockResolvedValue({
      provider_transaction_id: "sig-123"
    } as never)
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
    vi.mocked(getPaymentEvents).mockResolvedValue([{ event_type: "payment.cancelled" }] as never)
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
      reconciled: 1,
      transactionSnapshotsReconciled: 1,
      canceledReconciled: 1,
      failures: 0
    })
    expect(runPaymentWatcher).toHaveBeenCalledWith("pay-processing")
    expect(reconcileTransactionForPayment).toHaveBeenCalledWith("pay-confirmed", "CONFIRMED")
  })

  it("reconciles stuck Speed Lightning payments during a tick, independent of local evidence", async () => {
    const lightningPayment = payment("PENDING", {
      id: "pay-lightning",
      provider: "lightning_speed",
      network: "bitcoin_lightning",
      provider_reference: "speed_pay_123"
    })
    vi.mocked(getLightningReconciliationCandidates).mockResolvedValue([lightningPayment] as never)
    vi.mocked(reconcileSpeedLightningPayment).mockResolvedValue({
      checked: true,
      detected: true,
      speedStatus: "paid",
      status: "CONFIRMED"
    })

    const result = await runPaymentMaintenanceTick({ now: 120_000 })

    expect(reconcileSpeedLightningPayment).toHaveBeenCalledWith(lightningPayment)
    expect(getLightningReconciliationCandidates).toHaveBeenCalledWith({
      limit: expect.any(Number),
      cutoff: expect.any(String)
    })
    expect(result).toMatchObject({
      lightningCandidates: 1,
      lightningReconciled: 1,
      lightningErrors: 0,
      failures: 0
    })
  })

  it("counts a failed Lightning reconciliation attempt without aborting the rest of the tick", async () => {
    vi.mocked(getLightningReconciliationCandidates).mockResolvedValue([
      payment("PROCESSING", { id: "pay-lightning-1", provider: "lightning_speed", network: "bitcoin_lightning" }),
      payment("PROCESSING", { id: "pay-lightning-2", provider: "lightning_speed", network: "bitcoin_lightning" })
    ] as never)
    vi.mocked(reconcileSpeedLightningPayment)
      .mockRejectedValueOnce(new Error("speed unavailable"))
      .mockResolvedValueOnce({ checked: true, detected: false, speedStatus: "processing", status: "PROCESSING" })

    const result = await runPaymentMaintenanceTick({ now: 120_000 })

    expect(reconcileSpeedLightningPayment).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      lightningCandidates: 2,
      lightningReconciled: 1,
      lightningErrors: 1,
      failures: 1
    })
  })

  it("throttles concurrent watcher rechecks for the same payment into one underlying call", async () => {
    vi.mocked(getPaymentById).mockResolvedValue(payment("PROCESSING"))
    vi.mocked(runPaymentWatcher).mockResolvedValue(true)

    // Both calls are structurally identical async functions with the same
    // number of prior awaits, so they interleave deterministically: the
    // first to start is always the first to reach the watcher-throttle
    // check and register the in-flight promise the second one then reuses.
    const [firstResult, secondResult] = await Promise.all([
      ensurePaymentFresh("pay-1"),
      ensurePaymentFresh("pay-1"),
    ])

    expect(runPaymentWatcher).toHaveBeenCalledTimes(1)
    expect(firstResult).toMatchObject({ action: "watcher_recheck", detected: true })
    expect(secondResult).toMatchObject({ action: "watcher_recheck", detected: true })
  })

  it("skips a fresh watcher call when one just ran a moment ago for the same payment", async () => {
    vi.mocked(getPaymentById).mockResolvedValue(payment("PROCESSING"))
    vi.mocked(runPaymentWatcher).mockResolvedValue(true)

    const first = await ensurePaymentFresh("pay-1")
    expect(first).toMatchObject({ action: "watcher_recheck", detected: true })

    const second = await ensurePaymentFresh("pay-1")
    expect(second).toMatchObject({ action: "watcher_recheck", detected: false })

    expect(runPaymentWatcher).toHaveBeenCalledTimes(1)
  })

  it("does not throttle a different payment even while one payment's watcher is cooling down", async () => {
    vi.mocked(getPaymentById).mockImplementation(async (id: string) =>
      payment("PROCESSING", { id })
    )
    vi.mocked(runPaymentWatcher).mockResolvedValue(false)

    await ensurePaymentFresh("pay-1")
    await ensurePaymentFresh("pay-2")

    expect(runPaymentWatcher).toHaveBeenCalledTimes(2)
    expect(runPaymentWatcher).toHaveBeenCalledWith("pay-1", undefined)
    expect(runPaymentWatcher).toHaveBeenCalledWith("pay-2", undefined)
  })

  it("never throttles an explicit forceWatcher recheck (e.g. a customer-submitted tx hash)", async () => {
    const freshTimestamp = new Date().toISOString()
    vi.mocked(getPaymentById).mockResolvedValue(
      payment("PENDING", { created_at: freshTimestamp, updated_at: freshTimestamp })
    )
    vi.mocked(runPaymentWatcher).mockResolvedValue(true)

    await ensurePaymentFresh("pay-1", { txHash: "0xabc", forceWatcher: true })
    await ensurePaymentFresh("pay-1", { txHash: "0xdef", forceWatcher: true })

    expect(runPaymentWatcher).toHaveBeenCalledTimes(2)
    expect(runPaymentWatcher).toHaveBeenCalledWith("pay-1", { txHash: "0xabc" })
    expect(runPaymentWatcher).toHaveBeenCalledWith("pay-1", { txHash: "0xdef" })
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

  it("does not create a duplicate repository scheduler", () => {
    const config = fs.readFileSync(path.join(repoRoot, "vercel.json"), "utf8")

    expect(config).not.toMatch(/\*\/5|0\/5|\* \* \* \* \*/)
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
