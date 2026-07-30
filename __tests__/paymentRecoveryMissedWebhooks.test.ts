import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Payment } from "@/database/payments"

const mocks = vi.hoisted(() => ({
  payments: new Map<string, Payment>(),
  providerStatuses: new Map<string, string>(),
  providerFailures: new Map<string, Error>(),
  getPaymentById: vi.fn(),
  updatePaymentMetadata: vi.fn(),
  updatePaymentStatus: vi.fn(),
  advancePaymentToTargetStatus: vi.fn(),
  runPaymentWatcher: vi.fn(),
  reconcileSpeedLightningPayment: vi.fn(),
  getProvider: vi.fn(),
  getPaymentStatus: vi.fn(),
  loadProviders: vi.fn(),
  getLatestEvmWatcherTransactionHash: vi.fn(),
}))

vi.mock("@/database", () => ({
  getPaymentById: mocks.getPaymentById,
}))

vi.mock("@/database/payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/database/payments")>()
  return {
    ...actual,
    updatePaymentMetadata: mocks.updatePaymentMetadata,
  }
})

vi.mock("@/engine/updatePaymentStatus", () => ({
  updatePaymentStatus: mocks.updatePaymentStatus,
}))

vi.mock("@/engine/eventProcessor", () => ({
  advancePaymentToTargetStatus: mocks.advancePaymentToTargetStatus,
}))

vi.mock("@/engine/checkPaymentOnce", () => ({
  runPaymentWatcher: mocks.runPaymentWatcher,
}))

vi.mock("@/engine/lightningSpeedReconciliation", () => ({
  reconcileSpeedLightningPayment: mocks.reconcileSpeedLightningPayment,
}))

vi.mock("@/providers/registry", () => ({
  getProvider: mocks.getProvider,
}))

vi.mock("@/engine/loadProviders", () => ({
  loadProviders: mocks.loadProviders,
}))

vi.mock("@/database/paymentMaintenance", () => ({
  isPaymentRecoverySchemaReady: vi.fn().mockResolvedValue(true),
}))

vi.mock("@/database/paymentEvents", () => ({
  getLatestEvmWatcherTransactionHash: mocks.getLatestEvmWatcherTransactionHash,
}))

import { recoverPayment } from "@/engine/paymentRecovery"
import { canTransition } from "@/engine/paymentStateMachine"
import { isPaymentRecoverySchemaReady } from "@/database/paymentMaintenance"

function payment(input: {
  id: string
  provider: string
  network: string
  providerReference?: string
  status?: Payment["status"]
  metadata?: unknown
  createdAt?: string
}): Payment {
  return {
    id: input.id,
    merchant_id: "merchant-1",
    merchant_amount: 10,
    pinetree_fee: 0.15,
    gross_amount: 10.15,
    currency: "USD",
    provider: input.provider,
    provider_reference: input.providerReference,
    status: input.status || "PROCESSING",
    network: input.network,
    metadata: input.metadata || {
      split: {
        merchantWallet: "merchant-wallet",
        pinetreeWallet: "pinetree-wallet",
        feeCaptureMethod: input.network === "stripe"
          ? "collection_then_settle"
          : input.network === "shift4" || input.network === "bitcoin_lightning"
            ? "invoice_split"
            : "atomic_split",
      },
    },
    created_at: input.createdAt || "2026-07-29T16:00:00.000Z",
    updated_at: input.createdAt || "2026-07-29T16:00:00.000Z",
  }
}

describe("missed-webhook payment recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.payments.clear()
    mocks.providerStatuses.clear()
    mocks.providerFailures.clear()
    mocks.getLatestEvmWatcherTransactionHash.mockResolvedValue(null)
    vi.mocked(isPaymentRecoverySchemaReady).mockResolvedValue(true)

    mocks.getPaymentById.mockImplementation(async (id: string) => mocks.payments.get(id) || null)
    mocks.updatePaymentMetadata.mockImplementation(async (id: string, patch: Record<string, unknown>) => {
      const current = mocks.payments.get(id)
      if (!current) throw new Error("Payment not found")
      const metadata = current.metadata && typeof current.metadata === "object"
        ? current.metadata as Record<string, unknown>
        : {}
      const updated = { ...current, metadata: { ...metadata, ...patch } }
      mocks.payments.set(id, updated)
      return updated
    })
    mocks.updatePaymentStatus.mockImplementation(async (id: string, status: Payment["status"]) => {
      const current = mocks.payments.get(id)
      if (!current) throw new Error("Payment not found")
      const updated = { ...current, status }
      mocks.payments.set(id, updated)
      return updated
    })
    mocks.advancePaymentToTargetStatus.mockImplementation(async (id: string, status: Payment["status"]) => {
      const current = mocks.payments.get(id)
      if (!current) throw new Error("Payment not found")
      mocks.payments.set(id, { ...current, status })
    })
    mocks.runPaymentWatcher.mockImplementation(async (id: string) => {
      const current = mocks.payments.get(id)
      if (!current) return false
      mocks.payments.set(id, { ...current, status: "CONFIRMED" })
      return true
    })
    mocks.reconcileSpeedLightningPayment.mockImplementation(async (candidate: Payment) => {
      const current = mocks.payments.get(candidate.id)!
      mocks.payments.set(candidate.id, { ...current, status: "CONFIRMED" })
      return { checked: true, detected: true, speedStatus: "paid", status: "CONFIRMED" }
    })
    mocks.getPaymentStatus.mockImplementation(async (providerReference: string, merchantId?: string) => {
      void providerReference
      void merchantId
      const provider = mocks.getProvider.mock.calls.at(-1)?.[0] as string
      const failure = mocks.providerFailures.get(provider)
      if (failure) throw failure
      return { status: mocks.providerStatuses.get(provider) || "CONFIRMED" }
    })
    mocks.getProvider.mockImplementation(() => ({
      getPaymentStatus: mocks.getPaymentStatus,
    }))
  })

  it.each([
    ["Base Pay", payment({ id: "base-1", provider: "base", network: "base", providerReference: "base-1" }), "watcher"],
    ["Solana Pay", payment({ id: "solana-1", provider: "solana", network: "solana", providerReference: "solana-1" }), "watcher"],
    ["Bitcoin Lightning (Speed)", payment({ id: "speed-1", provider: "lightning_speed", network: "bitcoin_lightning", providerReference: "speed-pay-1" }), "speed"],
    ["Stripe", payment({ id: "stripe-1", provider: "stripe", network: "stripe", providerReference: "pi_1" }), "provider"],
    ["Shift4", payment({ id: "shift4-1", provider: "shift4", network: "shift4", providerReference: "chse_1" }), "provider"],
  ] as const)("confirms %s from authoritative evidence without a webhook", async (_name, candidate, source) => {
    mocks.payments.set(candidate.id, candidate)
    mocks.providerStatuses.set(candidate.provider, "CONFIRMED")

    const result = await recoverPayment(candidate, { now: Date.parse("2026-07-29T17:00:00.000Z") })

    expect(result.status).toBe("CONFIRMED")
    expect(mocks.payments.get(candidate.id)?.status).toBe("CONFIRMED")
    if (source === "watcher") expect(mocks.runPaymentWatcher).toHaveBeenCalledWith(candidate.id, undefined)
    if (source === "speed") expect(mocks.reconcileSpeedLightningPayment).toHaveBeenCalledWith(candidate)
    if (source === "provider") {
      expect(mocks.getProvider).toHaveBeenCalledWith(candidate.provider)
      expect(mocks.getPaymentStatus).toHaveBeenCalledWith(candidate.provider_reference, "merchant-1")
      expect(mocks.advancePaymentToTargetStatus).toHaveBeenCalledWith(
        candidate.id,
        "CONFIRMED",
        expect.objectContaining({ providerEvent: "payment_recovery.provider_status.confirmed" })
      )
    }
  })

  it("reuses prior watcher transaction evidence for an older PROCESSING Base payment", async () => {
    const candidate = payment({ id: "base-prior-evidence", provider: "base", network: "base" })
    const txHash = `0x${"a".repeat(64)}`
    mocks.payments.set(candidate.id, candidate)
    mocks.getLatestEvmWatcherTransactionHash.mockResolvedValueOnce(txHash)

    const result = await recoverPayment(candidate)

    expect(result.status).toBe("CONFIRMED")
    expect(mocks.runPaymentWatcher).toHaveBeenCalledWith(candidate.id, {
      txHash,
      maxAttempts: 1,
      sessionAttemptId: undefined,
      rejectMismatchedEvidence: true,
    })
  })

  it("fails PROCESSING when replayed Base evidence is authoritatively mismatched", async () => {
    const candidate = payment({
      id: "base-rejected-evidence",
      provider: "base",
      network: "base",
      createdAt: "2026-07-29T16:00:00.000Z",
    })
    const txHash = `0x${"c".repeat(64)}`
    mocks.payments.set(candidate.id, candidate)
    mocks.getLatestEvmWatcherTransactionHash.mockResolvedValueOnce(txHash)
    mocks.runPaymentWatcher.mockImplementationOnce(async (id: string, options) => {
      expect(options).toMatchObject({ txHash, rejectMismatchedEvidence: true })
      const current = mocks.payments.get(id)!
      mocks.payments.set(id, { ...current, status: "FAILED" })
      return true
    })

    const result = await recoverPayment(candidate, {
      now: Date.parse("2026-07-29T16:06:00.000Z"),
    })

    expect(result).toMatchObject({
      status: "FAILED",
      reason: "provider_or_network_evidence_applied",
    })
    expect(mocks.payments.get(candidate.id)?.status).toBe("FAILED")
    expect(mocks.updatePaymentStatus).not.toHaveBeenCalled()
  })

  it("keeps missing-reference PROCESSING retryable with diagnostics", async () => {
    const candidate = payment({ id: "stripe-missing", provider: "stripe", network: "stripe" })
    mocks.payments.set(candidate.id, candidate)

    const result = await recoverPayment(candidate)

    expect(result).toMatchObject({ status: "PROCESSING", reason: "missing_provider_reference" })
    expect(mocks.payments.get(candidate.id)?.status).toBe("PROCESSING")
    expect(mocks.updatePaymentStatus).not.toHaveBeenCalled()
  })

  it("does not run recovery before the recovery infrastructure is committed", async () => {
    const candidate = payment({ id: "stripe-pre-migration", provider: "stripe", network: "stripe" })
    mocks.payments.set(candidate.id, candidate)
    vi.mocked(isPaymentRecoverySchemaReady).mockResolvedValueOnce(false)

    const result = await recoverPayment(candidate)

    expect(result).toMatchObject({ status: "PROCESSING", reason: "recovery_schema_not_ready" })
    expect(mocks.updatePaymentStatus).not.toHaveBeenCalled()
    expect(mocks.getProvider).not.toHaveBeenCalled()
  })

  it("keeps lookup failures retryable after the limit and later recovers", async () => {
    const candidate = payment({
      id: "stripe-retry",
      provider: "stripe",
      network: "stripe",
      providerReference: "pi_retry",
    })
    mocks.payments.set(candidate.id, candidate)
    mocks.providerFailures.set("stripe", new Error("Stripe timeout"))

    const first = await recoverPayment(candidate, { maxLookupFailures: 2 })
    const second = await recoverPayment(mocks.payments.get(candidate.id)!, { maxLookupFailures: 2 })

    expect(first).toMatchObject({ status: "PROCESSING", reason: "provider_lookup_failed" })
    expect(second).toMatchObject({ status: "PROCESSING", reason: "lookup_retry_limit_reached" })
    expect(mocks.payments.get(candidate.id)?.status).toBe("PROCESSING")

    mocks.providerFailures.delete("stripe")
    mocks.providerStatuses.set("stripe", "CONFIRMED")
    const recovered = await recoverPayment(mocks.payments.get(candidate.id)!, { maxLookupFailures: 2 })

    expect(recovered.status).toBe("CONFIRMED")
    expect(mocks.payments.get(candidate.id)?.status).toBe("CONFIRMED")
  })

  it("keeps over-age PROCESSING canonical and records investigation metadata", async () => {
    const candidate = payment({
      id: "stripe-too-old",
      provider: "stripe",
      network: "stripe",
      providerReference: "pi_too_old",
      createdAt: "2026-07-29T16:00:00.000Z",
    })
    mocks.payments.set(candidate.id, candidate)
    mocks.providerStatuses.set("stripe", "PROCESSING")

    const result = await recoverPayment(candidate, {
      now: Date.parse("2026-07-29T16:02:00.000Z"),
      maxProcessingAgeMs: 60_000,
    })

    expect(result).toMatchObject({
      status: "PROCESSING",
      reason: "processing_age_limit_reached",
      providerStatus: "PROCESSING",
    })
    expect(mocks.payments.get(candidate.id)?.status).toBe("PROCESSING")
  })

  it("records rejected Engine transitions without inventing a payment status", async () => {
    const candidate = payment({
      id: "shift4-transition-rejected",
      provider: "shift4",
      network: "shift4",
      providerReference: "chse_transition_rejected",
    })
    mocks.payments.set(candidate.id, candidate)
    mocks.providerStatuses.set("shift4", "CONFIRMED")
    mocks.advancePaymentToTargetStatus.mockRejectedValueOnce(
      new Error("Invalid payment transition: PROCESSING -> CONFIRMED")
    )

    const result = await recoverPayment(candidate)

    expect(result).toMatchObject({ status: "PROCESSING", reason: "engine_transition_rejected" })
    expect(mocks.payments.get(candidate.id)?.status).toBe("PROCESSING")
  })

  it("enforces the canonical payment transition graph", () => {
    expect(canTransition("CREATED", "PENDING")).toBe(true)
    expect(canTransition("CREATED", "CANCELED")).toBe(true)
    expect(canTransition("PENDING", "PROCESSING")).toBe(true)
    expect(canTransition("PENDING", "EXPIRED")).toBe(true)
    expect(canTransition("PENDING", "CANCELED")).toBe(true)
    expect(canTransition("PENDING", "INCOMPLETE")).toBe(true)
    expect(canTransition("PROCESSING", "CONFIRMED")).toBe(true)
    expect(canTransition("PROCESSING", "FAILED")).toBe(true)
    expect(canTransition("PROCESSING", "EXPIRED")).toBe(false)
    expect(canTransition("PROCESSING", "CANCELED")).toBe(false)
    expect(canTransition("PROCESSING", "INCOMPLETE")).toBe(false)
  })
})
