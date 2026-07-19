import { afterEach, beforeEach, describe, expect, it } from "vitest"

describe("confirmed Speed connected-account capability model", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.SPEED_API_KEY
    delete process.env.SPEED_WEBHOOK_SECRET
    delete process.env.SPEED_CONNECT_ENABLED
  })

  afterEach(() => { process.env = originalEnv })

  it("fails closed when platform credentials are absent", async () => {
    const { getSpeedWalletCapabilities } = await import("@/providers/lightning/speedWalletCapabilities")
    const result = getSpeedWalletCapabilities()
    expect(result.capabilities.balances).toBe(false)
    expect(result.capabilities.transactions).toBe(false)
    expect(result.capabilities.withdrawals).toBe(false)
    expect(result.details.balances.reason).toBe("speed_not_configured")
  })

  it("fails closed when Connect is disabled", async () => {
    process.env.SPEED_API_KEY = "sk_test_abc"
    process.env.SPEED_WEBHOOK_SECRET = "wsec_abc"
    const { getSpeedWalletCapabilities } = await import("@/providers/lightning/speedWalletCapabilities")
    expect(getSpeedWalletCapabilities().details.withdrawals.reason).toBe("speed_connect_disabled")
  })

  it("enables confirmed reads and user-triggered withdrawals without obsolete contract flags", async () => {
    process.env.SPEED_API_KEY = "sk_test_abc"
    process.env.SPEED_WEBHOOK_SECRET = "wsec_abc"
    process.env.SPEED_CONNECT_ENABLED = "true"
    const { getSpeedWalletCapabilities } = await import("@/providers/lightning/speedWalletCapabilities")
    const result = getSpeedWalletCapabilities()
    expect(result.accountScopingConfirmed).toBe(true)
    expect(result.capabilities.balances).toBe(true)
    expect(result.capabilities.transactions).toBe(true)
    expect(result.capabilities.withdrawals).toBe(true)
    expect(result.capabilities.payoutStatus).toBe(true)
  })

  it("keeps payouts, manual swaps, AutoPayout, and AutoSwap unavailable", async () => {
    process.env.SPEED_API_KEY = "sk_test_abc"
    process.env.SPEED_WEBHOOK_SECRET = "wsec_abc"
    process.env.SPEED_CONNECT_ENABLED = "true"
    const { getSpeedWalletCapabilities } = await import("@/providers/lightning/speedWalletCapabilities")
    const capabilities = getSpeedWalletCapabilities().capabilities
    expect(capabilities.payouts).toBe(false)
    expect(capabilities.manualSwap).toBe(false)
    expect(capabilities.automaticPayouts).toBe(false)
    expect(capabilities.automaticSwap).toBe(false)
  })

  it("only accepts exact true for Connect", async () => {
    process.env.SPEED_API_KEY = "sk_test_abc"
    process.env.SPEED_WEBHOOK_SECRET = "wsec_abc"
    process.env.SPEED_CONNECT_ENABLED = "TRUE"
    const { getSpeedWalletCapabilities } = await import("@/providers/lightning/speedWalletCapabilities")
    expect(getSpeedWalletCapabilities().speedConnectEnabled).toBe(false)
  })
})
