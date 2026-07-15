import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("Speed wallet management provider boundary - fails closed, never issues an HTTP request", () => {
  const originalEnv = { ...process.env }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
    delete process.env.SPEED_CONNECT_ENABLED
    delete process.env.SPEED_WALLET_ACCOUNT_SCOPING_CONFIRMED
    delete process.env.SPEED_WALLET_BALANCES_ENABLED
    delete process.env.SPEED_WALLET_WITHDRAWALS_ENABLED
    delete process.env.SPEED_WALLET_MANUAL_SWAP_ENABLED
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(() => {
      throw new Error("speedWalletManagement must never call fetch - the provider contract is unconfirmed")
    })
  })

  afterEach(() => {
    process.env = originalEnv
    fetchSpy.mockRestore()
  })

  const context = { merchantId: "merchant-1", speedAccountId: "acct_123" }

  it("throws SpeedWalletCapabilityUnavailableError for balances when the capability flag is off", async () => {
    const { getConnectedAccountBalances, SpeedWalletCapabilityUnavailableError } = await import(
      "@/providers/lightning/speedWalletManagement"
    )
    await expect(getConnectedAccountBalances(context)).rejects.toBeInstanceOf(SpeedWalletCapabilityUnavailableError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("still refuses to call the network for withdrawals even with every capability flag set to true", async () => {
    process.env.SPEED_API_KEY = "sk_test_abc"
    process.env.SPEED_WEBHOOK_SECRET = "wsec_abc"
    process.env.SPEED_CONNECT_ENABLED = "true"
    process.env.SPEED_WALLET_ACCOUNT_SCOPING_CONFIRMED = "true"
    process.env.SPEED_WALLET_WITHDRAWALS_ENABLED = "true"

    const { createConnectedAccountWithdrawal } = await import("@/providers/lightning/speedWalletManagement")
    await expect(
      createConnectedAccountWithdrawal({
        ...context,
        amount: 1000,
        currency: "SATS",
        withdrawMethod: "lightning",
        withdrawRequest: "lnbc1...",
        idempotencyKey: "key-1",
      })
    ).rejects.toThrow(/has not documented the connected-account scoping mechanism/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("gates each capability independently - swap flag alone does not unlock withdrawals", async () => {
    process.env.SPEED_API_KEY = "sk_test_abc"
    process.env.SPEED_WEBHOOK_SECRET = "wsec_abc"
    process.env.SPEED_CONNECT_ENABLED = "true"
    process.env.SPEED_WALLET_ACCOUNT_SCOPING_CONFIRMED = "true"
    process.env.SPEED_WALLET_MANUAL_SWAP_ENABLED = "true"

    const { createConnectedAccountWithdrawal, SpeedWalletCapabilityUnavailableError } = await import(
      "@/providers/lightning/speedWalletManagement"
    )
    try {
      await createConnectedAccountWithdrawal({
        ...context,
        amount: 1000,
        currency: "SATS",
        withdrawMethod: "lightning",
        withdrawRequest: "lnbc1...",
        idempotencyKey: "key-1",
      })
      throw new Error("expected rejection")
    } catch (error) {
      expect(error).toBeInstanceOf(SpeedWalletCapabilityUnavailableError)
      expect((error as InstanceType<typeof SpeedWalletCapabilityUnavailableError>).capability).toBe("withdrawals")
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("throws for swap quote/create/status and transaction listing when unconfigured", async () => {
    const {
      createConnectedAccountSwapQuote,
      createConnectedAccountSwap,
      getConnectedAccountSwapStatus,
      listConnectedAccountTransactions,
      SpeedWalletCapabilityUnavailableError,
    } = await import("@/providers/lightning/speedWalletManagement")

    await expect(
      createConnectedAccountSwapQuote({ ...context, currency: "SATS", amount: "1000", targetCurrencySwapOut: "SATS", targetCurrencySwapIn: "USDC" })
    ).rejects.toBeInstanceOf(SpeedWalletCapabilityUnavailableError)
    await expect(
      createConnectedAccountSwap({
        ...context,
        currency: "SATS",
        amount: "1000",
        targetCurrencySwapOut: "SATS",
        targetCurrencySwapIn: "USDC",
        idempotencyKey: "key-1",
      })
    ).rejects.toBeInstanceOf(SpeedWalletCapabilityUnavailableError)
    await expect(getConnectedAccountSwapStatus({ ...context, providerSwapId: "swap_1" })).rejects.toBeInstanceOf(
      SpeedWalletCapabilityUnavailableError
    )
    await expect(listConnectedAccountTransactions({ ...context })).rejects.toBeInstanceOf(
      SpeedWalletCapabilityUnavailableError
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("SpeedWalletProviderError", () => {
  it("carries category/httpStatus/retryable/providerCode", async () => {
    const { SpeedWalletProviderError } = await import("@/providers/lightning/speedWalletManagement")
    const error = new SpeedWalletProviderError("rate limited", {
      category: "rate_limit",
      httpStatus: 429,
      retryable: true,
      providerCode: "rate_limited",
    })
    expect(error.category).toBe("rate_limit")
    expect(error.httpStatus).toBe(429)
    expect(error.retryable).toBe(true)
    expect(error.providerCode).toBe("rate_limited")
  })
})
