import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getBalances: vi.fn(),
  createWithdrawal: vi.fn(),
  getStatus: vi.fn(),
}))

vi.mock("@/providers/lightning/speedWalletManagement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/providers/lightning/speedWalletManagement")>()
  return {
    ...actual,
    getConnectedAccountBalances: mocks.getBalances,
    createConnectedAccountWithdrawal: mocks.createWithdrawal,
    getConnectedAccountSendStatus: mocks.getStatus,
  }
})

describe("Speed Instant Send sweep compatibility adapter", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    mocks.getBalances.mockReset()
    mocks.createWithdrawal.mockReset()
    mocks.getStatus.mockReset()
  })

  afterEach(() => { process.env = originalEnv })

  it("remains fail-closed unless the sweep feature is explicitly enabled", async () => {
    const { getConnectedAccountBalance, SpeedInstantSendNotConfiguredError } = await import("@/providers/lightning/speedInstantSend")
    await expect(getConnectedAccountBalance({ speedHeaderAccountId: "acct_1" }))
      .rejects.toBeInstanceOf(SpeedInstantSendNotConfiguredError)
    expect(mocks.getBalances).not.toHaveBeenCalled()
  })

  it("normalizes a confirmed SATS balance without exposing raw provider data", async () => {
    process.env.SPEED_LIGHTNING_SWEEP_ENABLED = "true"
    mocks.getBalances.mockResolvedValue({ object: "balance", available: [{ amount: 2500, target_currency: "SATS" }] })
    const { getConnectedAccountBalance } = await import("@/providers/lightning/speedInstantSend")
    const result = await getConnectedAccountBalance({ speedHeaderAccountId: "acct_1", merchantId: "merchant-1" })
    expect(result.availableSats).toBe(2500)
    expect(result.raw).toBeNull()
    expect(mocks.getBalances).toHaveBeenCalledWith({ merchantId: "merchant-1", speedAccountId: "acct_1" })
  })

  it("delegates send and status to the one confirmed wallet boundary", async () => {
    process.env.SPEED_LIGHTNING_SWEEP_ENABLED = "true"
    mocks.createWithdrawal.mockResolvedValue({ id: "is_1", status: "unpaid" })
    mocks.getStatus.mockResolvedValue({ id: "is_1", status: "paid" })
    const { sendToLightningInvoice, getInstantSendStatus } = await import("@/providers/lightning/speedInstantSend")
    await expect(sendToLightningInvoice({
      speedHeaderAccountId: "acct_1", merchantId: "merchant-1", invoice: "lnbc1invoice",
      amountSats: 1000, idempotencyKey: "key-1",
    })).resolves.toEqual({ providerSendId: "is_1", providerStatus: "unpaid", raw: null })
    await expect(getInstantSendStatus({
      speedHeaderAccountId: "acct_1", merchantId: "merchant-1", providerSendId: "is_1",
    })).resolves.toEqual({ providerStatus: "paid", raw: null })
  })
})
