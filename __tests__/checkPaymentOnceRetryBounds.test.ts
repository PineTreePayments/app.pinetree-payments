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
}))

vi.mock("@/database", () => ({ getPaymentById: mocks.getPaymentById }))
vi.mock("@/engine/paymentWatcher", () => ({ watchPaymentOnce: mocks.watchPaymentOnce }))
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
})
