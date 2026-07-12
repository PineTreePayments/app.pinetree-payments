import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("Speed Instant Send adapter - fails closed, never issues an HTTP request", () => {
  const originalEnv = { ...process.env }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
    delete process.env.SPEED_LIGHTNING_SWEEP_ENABLED
    delete process.env.SPEED_INSTANT_SEND_ENDPOINT
    delete process.env.SPEED_CONNECTED_BALANCE_ENDPOINT
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(() => {
      throw new Error("speedInstantSend must never call fetch - the provider contract is unconfirmed")
    })
  })

  afterEach(() => {
    process.env = originalEnv
    fetchSpy.mockRestore()
  })

  it("throws feature_disabled when SPEED_LIGHTNING_SWEEP_ENABLED is unset", async () => {
    const { getConnectedAccountBalance, SpeedInstantSendNotConfiguredError } = await import(
      "@/providers/lightning/speedInstantSend"
    )
    await expect(getConnectedAccountBalance({ speedHeaderAccountId: "acct_1" })).rejects.toThrow(
      SpeedInstantSendNotConfiguredError
    )
    try {
      await getConnectedAccountBalance({ speedHeaderAccountId: "acct_1" })
    } catch (error) {
      expect((error as InstanceType<typeof SpeedInstantSendNotConfiguredError>).reason).toBe("feature_disabled")
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('throws feature_disabled when SPEED_LIGHTNING_SWEEP_ENABLED is not exactly "true"', async () => {
    process.env.SPEED_LIGHTNING_SWEEP_ENABLED = "TRUE"
    const { sendToLightningInvoice, SpeedInstantSendNotConfiguredError } = await import(
      "@/providers/lightning/speedInstantSend"
    )
    await expect(
      sendToLightningInvoice({
        speedHeaderAccountId: "acct_1",
        invoice: "lnbc1...",
        amountSats: 1000,
        idempotencyKey: "key-1",
      })
    ).rejects.toBeInstanceOf(SpeedInstantSendNotConfiguredError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("throws endpoint_not_configured when the flag is on but the endpoint URL is empty", async () => {
    process.env.SPEED_LIGHTNING_SWEEP_ENABLED = "true"
    const { getConnectedAccountBalance, SpeedInstantSendNotConfiguredError } = await import(
      "@/providers/lightning/speedInstantSend"
    )
    try {
      await getConnectedAccountBalance({ speedHeaderAccountId: "acct_1" })
      throw new Error("expected getConnectedAccountBalance to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(SpeedInstantSendNotConfiguredError)
      expect((error as InstanceType<typeof SpeedInstantSendNotConfiguredError>).reason).toBe(
        "endpoint_not_configured"
      )
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("throws contract_unconfirmed - and still issues no HTTP request - even with the flag and both endpoints configured", async () => {
    process.env.SPEED_LIGHTNING_SWEEP_ENABLED = "true"
    process.env.SPEED_INSTANT_SEND_ENDPOINT = "https://api.tryspeed.com/instant-send"
    process.env.SPEED_CONNECTED_BALANCE_ENDPOINT = "https://api.tryspeed.com/connect/balance"

    const { getConnectedAccountBalance, sendToLightningInvoice, getInstantSendStatus, SpeedInstantSendNotConfiguredError } =
      await import("@/providers/lightning/speedInstantSend")

    await expect(getConnectedAccountBalance({ speedHeaderAccountId: "acct_1" })).rejects.toMatchObject({
      reason: "contract_unconfirmed",
    })
    await expect(
      sendToLightningInvoice({
        speedHeaderAccountId: "acct_1",
        invoice: "lnbc1...",
        amountSats: 1000,
        idempotencyKey: "key-1",
      })
    ).rejects.toMatchObject({ reason: "contract_unconfirmed" })
    await expect(
      getInstantSendStatus({ speedHeaderAccountId: "acct_1", providerSendId: "send_1" })
    ).rejects.toBeInstanceOf(SpeedInstantSendNotConfiguredError)

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("throws contract_unconfirmed when required call-site fields are missing, before ever reaching the network", async () => {
    process.env.SPEED_LIGHTNING_SWEEP_ENABLED = "true"
    process.env.SPEED_INSTANT_SEND_ENDPOINT = "https://api.tryspeed.com/instant-send"
    const { sendToLightningInvoice } = await import("@/providers/lightning/speedInstantSend")
    await expect(
      sendToLightningInvoice({
        speedHeaderAccountId: "",
        invoice: "lnbc1...",
        amountSats: 1000,
        idempotencyKey: "key-1",
      })
    ).rejects.toMatchObject({ reason: "contract_unconfirmed" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("isSpeedLightningSweepEnabled reflects only an exact \"true\" value", async () => {
    const { isSpeedLightningSweepEnabled } = await import("@/providers/lightning/speedInstantSend")
    expect(isSpeedLightningSweepEnabled()).toBe(false)
    process.env.SPEED_LIGHTNING_SWEEP_ENABLED = "true"
    expect(isSpeedLightningSweepEnabled()).toBe(true)
    process.env.SPEED_LIGHTNING_SWEEP_ENABLED = "1"
    expect(isSpeedLightningSweepEnabled()).toBe(false)
  })
})

describe("SpeedInstantSendProviderError", () => {
  it("carries retryable/httpStatus/providerCode for the future adapter implementation to use", async () => {
    const { SpeedInstantSendProviderError } = await import("@/providers/lightning/speedInstantSend")
    const error = new SpeedInstantSendProviderError("rate limited", {
      httpStatus: 429,
      retryable: true,
      providerCode: "rate_limited",
    })
    expect(error.httpStatus).toBe(429)
    expect(error.retryable).toBe(true)
    expect(error.providerCode).toBe("rate_limited")
    expect(error.name).toBe("SpeedInstantSendProviderError")
  })

  it("defaults httpStatus/providerCode to null when not provided", async () => {
    const { SpeedInstantSendProviderError } = await import("@/providers/lightning/speedInstantSend")
    const error = new SpeedInstantSendProviderError("deterministic rejection", { retryable: false })
    expect(error.httpStatus).toBeNull()
    expect(error.providerCode).toBeNull()
    expect(error.retryable).toBe(false)
  })
})
