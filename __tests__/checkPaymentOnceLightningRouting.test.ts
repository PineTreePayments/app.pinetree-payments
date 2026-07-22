import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getPaymentById: vi.fn(),
  reconcileSpeedLightningPayment: vi.fn(),
  checkNwcPaymentOnce: vi.fn(),
}))

vi.mock("@/database", () => ({ getPaymentById: mocks.getPaymentById }))
vi.mock("@/engine/lightningSpeedReconciliation", () => ({
  reconcileSpeedLightningPayment: mocks.reconcileSpeedLightningPayment,
}))
vi.mock("@/engine/checkNwcPayment", () => ({ checkNwcPaymentOnce: mocks.checkNwcPaymentOnce }))
vi.mock("@/engine/paymentStateActions", () => ({ markPaymentIncompleteIfAbandoned: vi.fn() }))

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: "pay-1",
    merchant_id: "merchant-1",
    status: "PROCESSING",
    provider: "lightning_speed",
    network: "bitcoin_lightning",
    provider_reference: "speed_pay_123",
    merchant_amount: 10,
    pinetree_fee: 0.15,
    ...overrides,
  } as never
}

describe("runPaymentWatcher - bitcoin_lightning routing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("routes NWC Lightning payments to the NWC checker, never the Speed reconciliation helper", async () => {
    mocks.getPaymentById.mockResolvedValue(payment({ provider: "lightning_nwc" }))
    mocks.checkNwcPaymentOnce.mockResolvedValue(true)

    const { runPaymentWatcher } = await import("@/engine/checkPaymentOnce")
    await expect(runPaymentWatcher("pay-1")).resolves.toBe(true)

    expect(mocks.checkNwcPaymentOnce).toHaveBeenCalledWith("pay-1")
    expect(mocks.reconcileSpeedLightningPayment).not.toHaveBeenCalled()
  }, 15_000)

  it("routes Speed Lightning payments through the shared reconciliation helper", async () => {
    mocks.getPaymentById.mockResolvedValue(payment())
    mocks.reconcileSpeedLightningPayment.mockResolvedValue({
      checked: true,
      detected: true,
      speedStatus: "paid",
      status: "CONFIRMED",
    })

    const { runPaymentWatcher } = await import("@/engine/checkPaymentOnce")
    await expect(runPaymentWatcher("pay-1")).resolves.toBe(true)

    expect(mocks.reconcileSpeedLightningPayment).toHaveBeenCalledWith(payment())
  }, 15_000)

  it("never crashes the caller when Speed reconciliation throws", async () => {
    mocks.getPaymentById.mockResolvedValue(payment())
    mocks.reconcileSpeedLightningPayment.mockRejectedValue(new Error("speed unavailable"))
    vi.spyOn(console, "error").mockImplementation(() => undefined)

    const { runPaymentWatcher } = await import("@/engine/checkPaymentOnce")
    await expect(runPaymentWatcher("pay-1")).resolves.toBe(false)
  })
})
