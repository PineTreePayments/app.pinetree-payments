import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regression coverage for Part 8 of the Base USDC approval-prompt fix:
 * separating GET /api/payments/status (a canonical DB read) from expensive
 * EVM eth_getLogs reconciliation. Production logs showed repeated
 * [watcher:evm] eth_getLogs 429s directly alongside GET /api/payments/status
 * calls — root cause: engine/paymentMaintenance.ts's ensurePaymentFresh
 * (called by the status route on every poll) invoked runPaymentWatcher with
 * no txHash unconditionally whenever a Base payment was PROCESSING, so every
 * ~3s poll tick re-ran the full chunked eth_getLogs fallback scan.
 *
 * engine/checkPaymentOnce.ts now throttles how often a *sequential* series of
 * no-txHash scans for the same payment may actually start a new scan — a
 * caller that already has (or the DB already has stored) a txHash is never
 * affected, since that always uses the cheap receipt fast-path instead.
 */

const mocks = vi.hoisted(() => ({
  getPaymentById: vi.fn(),
  watchPaymentOnce: vi.fn(),
  markPaymentIncompleteIfAbandoned: vi.fn(),
  getTransactionByPaymentId: vi.fn(),
}))

vi.mock("@/database", () => ({ getPaymentById: mocks.getPaymentById }))
vi.mock("@/database/transactions", () => ({
  getTransactionByPaymentId: mocks.getTransactionByPaymentId,
}))
vi.mock("@/engine/paymentWatcher", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/engine/paymentWatcher")>()
  return { ...actual, watchPaymentOnce: mocks.watchPaymentOnce }
})
vi.mock("@/engine/paymentStateActions", () => ({
  markPaymentIncompleteIfAbandoned: mocks.markPaymentIncompleteIfAbandoned,
}))
vi.mock("@/database/merchantProviders", () => ({ SPEED_PROVIDER_NAME: "lightning_speed" }))

function basePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: "pay-1",
    merchant_id: "merchant-1",
    status: "PROCESSING",
    provider: "base",
    network: "base",
    merchant_amount: 10,
    pinetree_fee: 0.15,
    metadata: { split: { feeCaptureMethod: "contract_split" } },
    ...overrides,
  } as never
}

function solanaPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: "pay-sol-1",
    merchant_id: "merchant-1",
    status: "PROCESSING",
    provider: "solana",
    network: "solana",
    merchant_amount: 10,
    pinetree_fee: 0.15,
    metadata: { split: { feeCaptureMethod: "direct" } },
    ...overrides,
  } as never
}

describe("runPaymentWatcher — no-hash Base scan cooldown (status-poll RPC pressure fix)", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.getTransactionByPaymentId.mockResolvedValue(null)
    const { resetNoHashEvmScanCooldownForTests } = await import("@/engine/checkPaymentOnce")
    resetNoHashEvmScanCooldownForTests()
  })

  it("GET /api/payments/status for Base without a stored txHash: a second immediate no-hash call is skipped, not scanned again", async () => {
    mocks.getPaymentById.mockResolvedValue(basePayment())
    mocks.watchPaymentOnce.mockResolvedValue(false)
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined)

    const { runPaymentWatcher } = await import("@/engine/checkPaymentOnce")
    await runPaymentWatcher("pay-1")
    await runPaymentWatcher("pay-1")

    expect(mocks.watchPaymentOnce).toHaveBeenCalledTimes(1)
    expect(
      infoSpy.mock.calls.some((call) => call[0] === "[watcher:evm] scan skipped: no-hash scan cooldown active")
    ).toBe(true)
  })

  it("a different paymentId is never throttled by another payment's cooldown", async () => {
    mocks.getPaymentById.mockImplementation(async (id: string) => basePayment({ id }))
    mocks.watchPaymentOnce.mockResolvedValue(false)

    const { runPaymentWatcher } = await import("@/engine/checkPaymentOnce")
    await runPaymentWatcher("pay-1")
    await runPaymentWatcher("pay-2")

    expect(mocks.watchPaymentOnce).toHaveBeenCalledTimes(2)
  })

  it("POST /api/payments/{id}/detect with an explicit txHash always runs immediately — the targeted fast path is never throttled by a prior no-hash scan", async () => {
    mocks.getPaymentById.mockResolvedValue(basePayment())
    mocks.watchPaymentOnce.mockResolvedValue(false)

    const { runPaymentWatcher } = await import("@/engine/checkPaymentOnce")
    // Prime the cooldown with a no-hash scan first.
    await runPaymentWatcher("pay-1")
    // A caller with its own txHash (the customer-facing /detect route) must
    // still run immediately afterward, uninterrupted by the cooldown just
    // started above.
    await runPaymentWatcher("pay-1", { txHash: "0xabc", maxAttempts: 1 })

    expect(mocks.watchPaymentOnce).toHaveBeenCalledTimes(2)
    expect(mocks.watchPaymentOnce).toHaveBeenLastCalledWith(
      expect.objectContaining({ txHash: "0xabc" })
    )
  })

  it("a Base payment whose txHash is already stored is never subject to the no-hash cooldown at all — the stored hash always wins", async () => {
    mocks.getPaymentById.mockResolvedValue(basePayment())
    mocks.getTransactionByPaymentId.mockResolvedValue({
      id: "txn-1",
      provider_transaction_id: "0xstoredhash",
    })
    mocks.watchPaymentOnce.mockResolvedValue(false)

    const { runPaymentWatcher } = await import("@/engine/checkPaymentOnce")
    await runPaymentWatcher("pay-1", { maxAttempts: 1 })
    await runPaymentWatcher("pay-1", { maxAttempts: 1 })

    expect(mocks.watchPaymentOnce).toHaveBeenCalledTimes(2)
    for (const [input] of mocks.watchPaymentOnce.mock.calls) {
      expect(input).toMatchObject({ txHash: "0xstoredhash" })
    }
  })

  it("GET /api/payments/status for Solana never enters the EVM watcher path (no [watcher:evm] log, network passed through as solana)", async () => {
    mocks.getPaymentById.mockResolvedValue(solanaPayment())
    mocks.watchPaymentOnce.mockResolvedValue(false)
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined)

    const { runPaymentWatcher } = await import("@/engine/checkPaymentOnce")
    await runPaymentWatcher("pay-sol-1")
    await runPaymentWatcher("pay-sol-1")

    // Solana is never gated by the Base/EVM cooldown — both calls proceed.
    expect(mocks.watchPaymentOnce).toHaveBeenCalledTimes(2)
    for (const [input] of mocks.watchPaymentOnce.mock.calls) {
      expect(input).toMatchObject({ network: "solana" })
    }
    expect(infoSpy.mock.calls.some((call) => call[0] === "[watcher:evm] scan started")).toBe(false)
  })
})
