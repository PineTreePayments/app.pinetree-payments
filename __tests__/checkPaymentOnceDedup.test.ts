import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regression coverage for deduplicating concurrent EVM eth_getLogs scans of
 * the SAME payment — part of the Alchemy 429 volume fix. Production
 * evidence: the customer's own hosted-checkout poll, the POS terminal's
 * status poll, and an opportunistic maintenance-tick sweep can all
 * independently trigger runPaymentWatcher for the exact same paymentId
 * around the same time, each starting its own (expensive, no-txHash)
 * chunked eth_getLogs scan with no coordination.
 *
 * engine/checkPaymentOnce.ts's runPaymentWatcher now dedupes concurrent
 * no-txHash calls for the same paymentId within one process — a second
 * caller reuses the first call's in-flight promise instead of starting a
 * new RPC scan. A caller that supplies its OWN txHash always runs
 * immediately and standalone, so the fast receipt-check path customer-
 * facing callers depend on is never delayed behind dedup.
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

function payment(overrides: Record<string, unknown> = {}) {
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

describe("runPaymentWatcher — same-process scan deduplication (no txHash)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("9. two concurrent no-txHash calls for the same paymentId share one underlying scan instead of running two", async () => {
    mocks.getPaymentById.mockResolvedValue(payment())
    mocks.getTransactionByPaymentId.mockResolvedValue(null)
    let resolveWatch: (value: boolean) => void = () => {}
    mocks.watchPaymentOnce.mockImplementation(
      () => new Promise<boolean>((resolve) => { resolveWatch = resolve })
    )

    const { runPaymentWatcher } = await import("@/engine/checkPaymentOnce")
    const first = runPaymentWatcher("pay-1")
    const second = runPaymentWatcher("pay-1")

    // Give both calls a chance to reach the RPC layer before resolving.
    await Promise.resolve()
    await Promise.resolve()
    resolveWatch(true)

    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult).toBe(true)
    expect(secondResult).toBe(true)
    expect(mocks.watchPaymentOnce).toHaveBeenCalledTimes(1)
  })

  it("a THIRD call for a DIFFERENT paymentId is never deduped against the first two", async () => {
    mocks.getPaymentById.mockResolvedValue(payment())
    mocks.getTransactionByPaymentId.mockResolvedValue(null)
    mocks.watchPaymentOnce.mockResolvedValue(false)

    const { runPaymentWatcher } = await import("@/engine/checkPaymentOnce")
    await Promise.all([
      runPaymentWatcher("pay-1"),
      runPaymentWatcher("pay-1"),
      runPaymentWatcher("pay-2"),
    ])

    // pay-1's two concurrent calls collapse to one scan; pay-2 gets its own.
    expect(mocks.watchPaymentOnce).toHaveBeenCalledTimes(2)
  })

  it("after the in-flight scan resolves, a later call for the same paymentId starts a genuinely new scan (not deduped forever)", async () => {
    mocks.getPaymentById.mockResolvedValue(payment())
    mocks.getTransactionByPaymentId.mockResolvedValue(null)
    mocks.watchPaymentOnce.mockResolvedValue(false)

    const { runPaymentWatcher } = await import("@/engine/checkPaymentOnce")
    await runPaymentWatcher("pay-1")
    await runPaymentWatcher("pay-1")

    expect(mocks.watchPaymentOnce).toHaveBeenCalledTimes(2)
  })

  it("11. a caller with its OWN txHash is never deduped against an in-flight no-txHash scan for the same payment — the fast receipt path always runs standalone and immediately", async () => {
    mocks.getPaymentById.mockResolvedValue(payment())
    mocks.getTransactionByPaymentId.mockResolvedValue(null)
    let resolveSlowScan: (value: boolean) => void = () => {}
    mocks.watchPaymentOnce.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => { resolveSlowScan = resolve })
    )
    mocks.watchPaymentOnce.mockResolvedValueOnce(true) // the txHash-equipped call

    const { runPaymentWatcher } = await import("@/engine/checkPaymentOnce")
    const slowNoHashCall = runPaymentWatcher("pay-1")
    await Promise.resolve()

    // A second caller with its own txHash must resolve immediately, without
    // waiting on the slow no-txHash scan still in flight.
    const fastResult = await runPaymentWatcher("pay-1", { txHash: "0xabc" })
    expect(fastResult).toBe(true)
    expect(mocks.watchPaymentOnce).toHaveBeenCalledTimes(2)

    resolveSlowScan(false)
    await slowNoHashCall
  })

  it("a caller with its own txHash never registers itself as the in-flight scan for later no-txHash callers to dedupe against", async () => {
    mocks.getPaymentById.mockResolvedValue(payment())
    mocks.getTransactionByPaymentId.mockResolvedValue(null)
    mocks.watchPaymentOnce.mockResolvedValue(true)

    const { runPaymentWatcher } = await import("@/engine/checkPaymentOnce")
    await runPaymentWatcher("pay-1", { txHash: "0xabc" })
    await runPaymentWatcher("pay-1")

    // Both ran — the txHash call didn't get "cached" for the no-txHash call to reuse.
    expect(mocks.watchPaymentOnce).toHaveBeenCalledTimes(2)
  })
})
