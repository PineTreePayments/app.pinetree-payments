import { afterEach, beforeEach, describe, expect, it } from "vitest"

describe("Speed wallet capability model - fails closed by default", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.SPEED_API_KEY
    delete process.env.SPEED_WEBHOOK_SECRET
    delete process.env.SPEED_CONNECT_ENABLED
    delete process.env.SPEED_WALLET_ACCOUNT_SCOPING_CONFIRMED
    delete process.env.SPEED_WALLET_BALANCES_ENABLED
    delete process.env.SPEED_WALLET_WITHDRAWALS_ENABLED
    delete process.env.SPEED_WALLET_MANUAL_SWAP_ENABLED
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it("reports every capability unavailable when Speed is not configured at all", async () => {
    const { getSpeedWalletCapabilities } = await import("@/providers/lightning/speedWalletCapabilities")
    const result = getSpeedWalletCapabilities()
    for (const value of Object.values(result.capabilities)) {
      expect(value).toBe(false)
    }
    expect(result.details.balances.reason).toBe("speed_not_configured")
  })

  it("reports speed_connect_disabled once Speed is configured but SPEED_CONNECT_ENABLED is not true", async () => {
    process.env.SPEED_API_KEY = "sk_test_abc"
    process.env.SPEED_WEBHOOK_SECRET = "wsec_abc"
    const { getSpeedWalletCapabilities } = await import("@/providers/lightning/speedWalletCapabilities")
    const result = getSpeedWalletCapabilities()
    expect(result.capabilities.balances).toBe(false)
    expect(result.details.balances.reason).toBe("speed_connect_disabled")
  })

  it("reports scoping_not_confirmed once Connect is enabled but the global scoping flag is not true", async () => {
    process.env.SPEED_API_KEY = "sk_test_abc"
    process.env.SPEED_WEBHOOK_SECRET = "wsec_abc"
    process.env.SPEED_CONNECT_ENABLED = "true"
    const { getSpeedWalletCapabilities } = await import("@/providers/lightning/speedWalletCapabilities")
    const result = getSpeedWalletCapabilities()
    expect(result.capabilities.withdrawals).toBe(false)
    expect(result.details.withdrawals.reason).toBe("scoping_not_confirmed")
  })

  it("reports capability_flag_disabled once scoping is confirmed but the specific capability flag is off", async () => {
    process.env.SPEED_API_KEY = "sk_test_abc"
    process.env.SPEED_WEBHOOK_SECRET = "wsec_abc"
    process.env.SPEED_CONNECT_ENABLED = "true"
    process.env.SPEED_WALLET_ACCOUNT_SCOPING_CONFIRMED = "true"
    const { getSpeedWalletCapabilities } = await import("@/providers/lightning/speedWalletCapabilities")
    const result = getSpeedWalletCapabilities()
    expect(result.capabilities.balances).toBe(false)
    expect(result.details.balances.reason).toBe("capability_flag_disabled")
  })

  it("only reports a capability available when every gate is satisfied for that specific capability", async () => {
    process.env.SPEED_API_KEY = "sk_test_abc"
    process.env.SPEED_WEBHOOK_SECRET = "wsec_abc"
    process.env.SPEED_CONNECT_ENABLED = "true"
    process.env.SPEED_WALLET_ACCOUNT_SCOPING_CONFIRMED = "true"
    process.env.SPEED_WALLET_BALANCES_ENABLED = "true"
    const { getSpeedWalletCapabilities } = await import("@/providers/lightning/speedWalletCapabilities")
    const result = getSpeedWalletCapabilities()
    expect(result.capabilities.balances).toBe(true)
    // Sibling capabilities remain gated independently.
    expect(result.capabilities.withdrawals).toBe(false)
    expect(result.capabilities.manualSwap).toBe(false)
  })

  it("only accepts the exact string \"true\", never a truthy-looking value", async () => {
    process.env.SPEED_API_KEY = "sk_test_abc"
    process.env.SPEED_WEBHOOK_SECRET = "wsec_abc"
    process.env.SPEED_CONNECT_ENABLED = "TRUE"
    const { getSpeedWalletCapabilities } = await import("@/providers/lightning/speedWalletCapabilities")
    const result = getSpeedWalletCapabilities()
    expect(result.speedConnectEnabled).toBe(false)
  })
})
