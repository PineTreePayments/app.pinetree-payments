import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regression coverage for the Alchemy eth_getLogs 429 volume fix in
 * engine/paymentMaintenance.ts. Production evidence: a single maintenance
 * sweep tick can hold up to 10 watcher-recheck candidates and up to 25 Base
 * self-heal candidates; once Alchemy starts rate-limiting, blindly moving
 * on to the next candidate re-hammers the same already-429'd endpoint.
 *
 * The fix adds a process-local circuit breaker: the first 429 observed in a
 * tick schedules a bounded exponential-backoff-with-jitter cooldown, and
 * every remaining EVM candidate (in this tick and any tick that starts
 * before the cooldown elapses) is skipped without making an RPC call at
 * all — never a Solana candidate, since the cooldown is EVM-specific.
 */

const mocks = vi.hoisted(() => ({
  getPaymentById: vi.fn(),
  getPaymentEvents: vi.fn(),
  getTransactionByPaymentId: vi.fn(),
  getPaymentMaintenanceCandidates: vi.fn(),
  getTerminalPaymentMaintenanceCandidates: vi.fn(),
  getLightningReconciliationCandidates: vi.fn(),
  getConfirmedLightningFeeSettlementCandidates: vi.fn(),
  getIncompleteBasePaymentReconciliationCandidates: vi.fn(),
  claimPaymentMaintenanceRun: vi.fn(),
  recoverPayment: vi.fn(),
  reconcileBasePaymentFromChain: vi.fn(),
  reconcileSpeedLightningPayment: vi.fn(),
  reconcileConfirmedLightningFeeSettlement: vi.fn(),
  markPaymentIncomplete: vi.fn(),
  reconcileTransactionForPayment: vi.fn(),
  sweepStalePayments: vi.fn(),
}))

vi.mock("@/database", () => ({ getPaymentById: mocks.getPaymentById }))
vi.mock("@/database/paymentEvents", () => ({ getPaymentEvents: mocks.getPaymentEvents }))
vi.mock("@/database/transactions", () => ({ getTransactionByPaymentId: mocks.getTransactionByPaymentId }))
vi.mock("@/database/paymentMaintenance", () => ({
  getPaymentMaintenanceCandidates: mocks.getPaymentMaintenanceCandidates,
  getTerminalPaymentMaintenanceCandidates: mocks.getTerminalPaymentMaintenanceCandidates,
  getLightningReconciliationCandidates: mocks.getLightningReconciliationCandidates,
  getConfirmedLightningFeeSettlementCandidates: mocks.getConfirmedLightningFeeSettlementCandidates,
  getIncompleteBasePaymentReconciliationCandidates: mocks.getIncompleteBasePaymentReconciliationCandidates,
  claimPaymentMaintenanceRun: mocks.claimPaymentMaintenanceRun,
}))
vi.mock("@/engine/paymentRecovery", () => ({
  recoverPayment: mocks.recoverPayment,
  usesNativePaymentWatcher: (payment: { provider?: string; network?: string }) => {
    const provider = String(payment.provider || "").toLowerCase()
    const network = String(payment.network || "").toLowerCase()
    return ((network === "base" || network === "ethereum") && (!provider || provider === "base" || provider === "base_pay")) ||
      (network === "solana" && (!provider || provider === "solana"))
  },
}))
vi.mock("@/engine/baseChainReconciliation", () => ({
  reconcileBasePaymentFromChain: mocks.reconcileBasePaymentFromChain,
}))
vi.mock("@/engine/lightningSpeedReconciliation", () => ({
  reconcileSpeedLightningPayment: mocks.reconcileSpeedLightningPayment,
  reconcileConfirmedLightningFeeSettlement: mocks.reconcileConfirmedLightningFeeSettlement,
}))
vi.mock("@/engine/paymentStateActions", () => ({ markPaymentIncomplete: mocks.markPaymentIncomplete }))
vi.mock("@/engine/reconcileTransaction", () => ({
  reconcileTransactionForPayment: mocks.reconcileTransactionForPayment,
}))
vi.mock("@/engine/stalePaymentSweep", () => ({ sweepStalePayments: mocks.sweepStalePayments }))

import {
  runPaymentMaintenanceTick,
  resetPaymentMaintenanceLeaseForTests,
  resetRpc429CooldownForTests,
} from "@/engine/paymentMaintenance"
import { RpcTransportError } from "@/engine/paymentWatcher"

function evmCandidate(id: string, overrides: Record<string, unknown> = {}) {
  return { id, status: "PROCESSING", network: "base", ...overrides } as never
}

function solanaCandidate(id: string, overrides: Record<string, unknown> = {}) {
  return { id, status: "PROCESSING", network: "solana", ...overrides } as never
}

const emptySweep = {
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
  cutoff: "2026-06-08T00:00:00.000Z",
}

describe("runPaymentMaintenanceTick — EVM 429 backoff and circuit breaker", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getPaymentEvents.mockResolvedValue([])
    mocks.getTransactionByPaymentId.mockResolvedValue(null)
    mocks.getPaymentMaintenanceCandidates.mockResolvedValue([])
    mocks.getTerminalPaymentMaintenanceCandidates.mockResolvedValue([])
    mocks.getLightningReconciliationCandidates.mockResolvedValue([])
    mocks.getConfirmedLightningFeeSettlementCandidates.mockResolvedValue([])
    mocks.getIncompleteBasePaymentReconciliationCandidates.mockResolvedValue([])
    mocks.claimPaymentMaintenanceRun.mockResolvedValue({ claimed: true, reason: "claimed" })
    mocks.recoverPayment.mockResolvedValue({ checked: true, detected: false })
    mocks.sweepStalePayments.mockResolvedValue(emptySweep)
    resetPaymentMaintenanceLeaseForTests()
    resetRpc429CooldownForTests()
  })

  it("10a. a 429 from the Base self-heal sweep stops further candidates in the SAME tick instead of hammering the next one immediately", async () => {
    mocks.getIncompleteBasePaymentReconciliationCandidates.mockResolvedValue([
      evmCandidate("base-1"),
      evmCandidate("base-2"),
      evmCandidate("base-3"),
    ])
    mocks.reconcileBasePaymentFromChain.mockRejectedValueOnce(
      new RpcTransportError("eth_getLogs RPC error: rate limited", 429)
    )

    const result = await runPaymentMaintenanceTick({ now: 1_000, throttleMs: 0 })

    // Only the first candidate was actually attempted — the 429 stopped the loop.
    expect(mocks.reconcileBasePaymentFromChain).toHaveBeenCalledTimes(1)
    expect(result.baseReconcileErrors).toBe(1)
  })

  it("10b. once a 429 is scheduled, a LATER tick's EVM candidates are skipped without any RPC call while the cooldown is active", async () => {
    mocks.getIncompleteBasePaymentReconciliationCandidates.mockResolvedValue([evmCandidate("base-1")])
    mocks.reconcileBasePaymentFromChain.mockRejectedValueOnce(
      new RpcTransportError("eth_getLogs RPC error: rate limited", 429)
    )
    await runPaymentMaintenanceTick({ now: 1_000, throttleMs: 0 })
    expect(mocks.reconcileBasePaymentFromChain).toHaveBeenCalledTimes(1)

    // A second tick starts after the lease throttle's 1s floor has elapsed —
    // the still-active (real-wall-clock) cooldown must skip this candidate entirely.
    mocks.getIncompleteBasePaymentReconciliationCandidates.mockResolvedValue([evmCandidate("base-2")])
    await runPaymentMaintenanceTick({ now: 2_100, throttleMs: 0 })

    expect(mocks.reconcileBasePaymentFromChain).toHaveBeenCalledTimes(1)
  })

  it("a non-429 error never schedules a cooldown — the next candidate still runs normally", async () => {
    mocks.getIncompleteBasePaymentReconciliationCandidates.mockResolvedValue([
      evmCandidate("base-1"),
      evmCandidate("base-2"),
    ])
    mocks.reconcileBasePaymentFromChain
      .mockRejectedValueOnce(new Error("transient database read failure"))
      .mockResolvedValueOnce({ detected: false })

    await runPaymentMaintenanceTick({ now: 1_000, throttleMs: 0 })

    expect(mocks.reconcileBasePaymentFromChain).toHaveBeenCalledTimes(2)
  })

  it("8. the EVM cooldown never skips a Solana candidate in the watcher-recheck sweep — only Base/EVM candidates are gated", async () => {
    mocks.getPaymentMaintenanceCandidates.mockResolvedValue([
      evmCandidate("base-1"),
      solanaCandidate("sol-1"),
    ])
    // Prime the cooldown from a PRIOR 429 on the base-reconcile sweep.
    mocks.getIncompleteBasePaymentReconciliationCandidates.mockResolvedValueOnce([evmCandidate("base-0")])
    mocks.reconcileBasePaymentFromChain.mockRejectedValueOnce(
      new RpcTransportError("eth_getLogs RPC error: rate limited", 429)
    )
    await runPaymentMaintenanceTick({ now: 1_000, watcherLimit: 2, throttleMs: 0 })

    // The Solana candidate must always be checked — the EVM cooldown must
    // never suppress it. The Base candidate in the SAME tick may or may not
    // run depending on ordering, but Solana is never gated by it.
    const solanaCalls = mocks.recoverPayment.mock.calls.filter(([payment]) => payment.id === "sol-1")
    expect(solanaCalls).toHaveLength(1)
  })

  it("does not apply the native EVM cooldown to a provider-managed payment on Base", async () => {
    mocks.getIncompleteBasePaymentReconciliationCandidates.mockResolvedValueOnce([evmCandidate("base-native")])
    mocks.reconcileBasePaymentFromChain.mockRejectedValueOnce(
      new RpcTransportError("eth_getLogs RPC error: rate limited", 429)
    )
    await runPaymentMaintenanceTick({ now: 1_000, throttleMs: 0 })

    mocks.getPaymentMaintenanceCandidates.mockResolvedValueOnce([
      evmCandidate("coinbase-base", { provider: "coinbase" }),
    ])
    mocks.getIncompleteBasePaymentReconciliationCandidates.mockResolvedValueOnce([])
    await runPaymentMaintenanceTick({ now: 2_100, throttleMs: 0 })

    expect(mocks.recoverPayment).toHaveBeenCalledWith(
      expect.objectContaining({ id: "coinbase-base", provider: "coinbase", network: "base" })
    )
  })

  it("scheduling a 429 backoff logs the required structured line", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      mocks.getIncompleteBasePaymentReconciliationCandidates.mockResolvedValue([evmCandidate("base-1")])
      mocks.reconcileBasePaymentFromChain.mockRejectedValueOnce(
        new RpcTransportError("eth_getLogs RPC error: rate limited", 429)
      )

      await runPaymentMaintenanceTick({ now: 1_000, throttleMs: 0 })

      const backoffLog = warnSpy.mock.calls.find((call) => call[0] === "[watcher:evm] 429 backoff scheduled")
      expect(backoffLog).toBeDefined()
      expect(backoffLog?.[1]).toMatchObject({ delayMs: expect.any(Number), consecutive429s: 1 })
    } finally {
      warnSpy.mockRestore()
    }
  })

  it("a skipped-due-to-cooldown candidate logs the required structured line", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      mocks.getIncompleteBasePaymentReconciliationCandidates.mockResolvedValueOnce([evmCandidate("base-1")])
      mocks.reconcileBasePaymentFromChain.mockRejectedValueOnce(
        new RpcTransportError("eth_getLogs RPC error: rate limited", 429)
      )
      await runPaymentMaintenanceTick({ now: 1_000, throttleMs: 0 })

      mocks.getIncompleteBasePaymentReconciliationCandidates.mockResolvedValueOnce([evmCandidate("base-2")])
      // The lease throttle floor is clamped to 1s regardless of the throttleMs
      // option (see paymentMaintenance.ts's Math.max(1_000, ...)), so the second
      // tick's `now` must be >=1s past the first tick's lastStartedAt or it gets
      // skipped as "recently_run" before ever reaching the cooldown check. The
      // 429 cooldown itself is keyed off real wall-clock Date.now(), not this
      // `now` option, so it remains active regardless of this gap.
      await runPaymentMaintenanceTick({ now: 2_100, throttleMs: 0 })

      const skippedLog = warnSpy.mock.calls.find(
        (call) => call[0] === "[payment-recovery]" &&
          (call[1] as { reason?: string } | undefined)?.reason === "rpc_rate_limit_cooldown"
      )
      expect(skippedLog).toBeDefined()
      expect(skippedLog?.[1]).toMatchObject({ paymentId: "base-2", reason: "rpc_rate_limit_cooldown" })
    } finally {
      warnSpy.mockRestore()
    }
  })
})
