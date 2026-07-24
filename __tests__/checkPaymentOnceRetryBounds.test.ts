import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regression coverage for the customer-facing blocking-detect fix.
 *
 * engine/checkPaymentOnce.ts's runPaymentWatcher retries watchPaymentOnce up
 * to 5 times with a 3s sleep between attempts when an EVM txHash is present —
 * meant for background/cron callers, never for a request a customer's browser
 * is waiting on. engine/paymentMaintenance.ts's ensurePaymentFresh now passes
 * maxAttempts: 1 for its customer-facing forced-detect path (see
 * engine/paymentDetect.ts -> POST /api/payments/[paymentId]/detect), so a
 * single call performs exactly one bounded RPC check with no internal sleep.
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

describe("runPaymentWatcher - retry bounds", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("without maxAttempts, retries an EVM txHash check up to 5 times with a 3s sleep between attempts", async () => {
    mocks.getPaymentById.mockResolvedValue(payment())
    mocks.watchPaymentOnce.mockResolvedValue(false)

    const { runPaymentWatcher } = await import("@/engine/checkPaymentOnce")
    const resultPromise = runPaymentWatcher("pay-1", { txHash: "0xabc" })

    // Let all 5 attempts (4 intervening 3s sleeps) play out.
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(3_000)
    }

    await expect(resultPromise).resolves.toBe(false)
    expect(mocks.watchPaymentOnce).toHaveBeenCalledTimes(5)
  })

  it("with maxAttempts: 1, performs exactly one bounded check and never sleeps", async () => {
    mocks.getPaymentById.mockResolvedValue(payment())
    mocks.watchPaymentOnce.mockResolvedValue(false)

    const { runPaymentWatcher } = await import("@/engine/checkPaymentOnce")
    const result = await runPaymentWatcher("pay-1", { txHash: "0xabc", maxAttempts: 1 })

    expect(result).toBe(false)
    expect(mocks.watchPaymentOnce).toHaveBeenCalledTimes(1)
  })

  it("with maxAttempts: 1, still returns true immediately on the first detected match", async () => {
    mocks.getPaymentById.mockResolvedValue(payment())
    mocks.watchPaymentOnce.mockResolvedValue(true)

    const { runPaymentWatcher } = await import("@/engine/checkPaymentOnce")
    const result = await runPaymentWatcher("pay-1", { txHash: "0xabc", maxAttempts: 1 })

    expect(result).toBe(true)
    expect(mocks.watchPaymentOnce).toHaveBeenCalledTimes(1)
  })

  it("re-throws RpcTransportError when every attempt fails with a real RPC failure, and never marks the payment abandoned", async () => {
    const { RpcTransportError } = await import("@/engine/paymentWatcher")
    mocks.getPaymentById.mockResolvedValue(payment())
    mocks.watchPaymentOnce.mockRejectedValue(new RpcTransportError("Must be authenticated!"))

    const { runPaymentWatcher } = await import("@/engine/checkPaymentOnce")
    const resultPromise = runPaymentWatcher("pay-1", { txHash: "0xabc", maxAttempts: 1 })

    await expect(resultPromise).rejects.toThrow("Must be authenticated!")
    expect(mocks.markPaymentIncompleteIfAbandoned).not.toHaveBeenCalled()
  })

  it("does not throw when a later clean check resets the failure after an earlier RPC error", async () => {
    const { RpcTransportError } = await import("@/engine/paymentWatcher")
    mocks.getPaymentById.mockResolvedValue(payment())
    mocks.watchPaymentOnce.mockResolvedValue(false)
    mocks.watchPaymentOnce.mockRejectedValueOnce(new RpcTransportError("Must be authenticated!"))

    const { runPaymentWatcher } = await import("@/engine/checkPaymentOnce")
    const resultPromise = runPaymentWatcher("pay-1", { txHash: "0xabc" })

    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(3_000)
    }

    await expect(resultPromise).resolves.toBe(false)
    expect(mocks.watchPaymentOnce).toHaveBeenCalledTimes(5)
    expect(mocks.markPaymentIncompleteIfAbandoned).toHaveBeenCalledTimes(1)
  })
})

/**
 * Regression coverage for the live incident where the routine watcher path
 * ignored an already-persisted transaction hash and fell through to the
 * (at the time, unbounded) eth_getLogs fallback scan on every periodic
 * re-check. Callers like engine/paymentMaintenance.ts's routine
 * PENDING/PROCESSING sweep call runPaymentWatcher(paymentId) with no options
 * at all — the stored transactions.provider_transaction_id must still be
 * treated as authoritative in that case, not just when a caller explicitly
 * threads a fresh txHash through (e.g. the customer-facing /detect route).
 */
describe("runPaymentWatcher - stored tx hash fast-path authority", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("looks up and uses the stored transaction hash when the caller passes none", async () => {
    mocks.getPaymentById.mockResolvedValue(payment())
    mocks.getTransactionByPaymentId.mockResolvedValue({
      id: "txn-1",
      provider_transaction_id: "0xstoredhash",
    })
    mocks.watchPaymentOnce.mockResolvedValue(true)

    const { runPaymentWatcher } = await import("@/engine/checkPaymentOnce")
    const result = await runPaymentWatcher("pay-1")

    expect(result).toBe(true)
    expect(mocks.getTransactionByPaymentId).toHaveBeenCalledWith("pay-1")
    expect(mocks.watchPaymentOnce).toHaveBeenCalledWith(
      expect.objectContaining({ txHash: "0xstoredhash" })
    )
  })

  it("uses the stored hash's fast-path attempt budget (single check) even though it wasn't caller-supplied, matching the routine sweep's expectations", async () => {
    // maxAttempts defaults to 5 for EVM+txHash callers that don't override
    // it; the point under test is that a STORED hash counts as "has a
    // txHash" for that decision, exactly like a caller-supplied one would.
    mocks.getPaymentById.mockResolvedValue(payment())
    mocks.getTransactionByPaymentId.mockResolvedValue({
      id: "txn-1",
      provider_transaction_id: "0xstoredhash",
    })
    mocks.watchPaymentOnce.mockResolvedValue(false)

    const { runPaymentWatcher } = await import("@/engine/checkPaymentOnce")
    const resultPromise = runPaymentWatcher("pay-1")

    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(3_000)
    }

    await expect(resultPromise).resolves.toBe(false)
    expect(mocks.watchPaymentOnce).toHaveBeenCalledTimes(5)
    for (const [input] of mocks.watchPaymentOnce.mock.calls) {
      expect(input).toMatchObject({ txHash: "0xstoredhash" })
    }
  })

  it("a caller-supplied tx hash takes precedence over any stored hash and skips the DB lookup entirely", async () => {
    mocks.getPaymentById.mockResolvedValue(payment())
    mocks.watchPaymentOnce.mockResolvedValue(true)

    const { runPaymentWatcher } = await import("@/engine/checkPaymentOnce")
    await runPaymentWatcher("pay-1", { txHash: "0xfreshhash" })

    expect(mocks.getTransactionByPaymentId).not.toHaveBeenCalled()
    expect(mocks.watchPaymentOnce).toHaveBeenCalledWith(
      expect.objectContaining({ txHash: "0xfreshhash" })
    )
  })

  it("falls through to the chunked-log-fallback path (no txHash at all) when nothing is stored either", async () => {
    mocks.getPaymentById.mockResolvedValue(payment())
    mocks.getTransactionByPaymentId.mockResolvedValue(null)
    mocks.watchPaymentOnce.mockResolvedValue(false)

    const { runPaymentWatcher } = await import("@/engine/checkPaymentOnce")
    const result = await runPaymentWatcher("pay-1")

    expect(result).toBe(false)
    expect(mocks.watchPaymentOnce).toHaveBeenCalledWith(
      expect.objectContaining({ txHash: undefined })
    )
  })

  it("never fails the watcher run if the stored-hash lookup itself throws — falls back to no txHash", async () => {
    mocks.getPaymentById.mockResolvedValue(payment())
    mocks.getTransactionByPaymentId.mockRejectedValue(new Error("db unavailable"))
    mocks.watchPaymentOnce.mockResolvedValue(false)

    const { runPaymentWatcher } = await import("@/engine/checkPaymentOnce")
    const result = await runPaymentWatcher("pay-1")

    expect(result).toBe(false)
    expect(mocks.watchPaymentOnce).toHaveBeenCalledWith(
      expect.objectContaining({ txHash: undefined })
    )
  })
})
