import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  SPEED_PLATFORM_TREASURY_SWEEP_MODE,
  createSpeedConnectedAccountWebhook,
  createSpeedCustomConnectedAccount,
  createSpeedLightningPayment,
  createSpeedWithdrawRequest,
  getLightningProviderConfig,
} from "@/providers/lightning/speedClient"

const originalEnv = process.env

describe("Speed treasury-sweep invoice creation", () => {
  beforeEach(() => {
    process.env = { ...originalEnv }
    process.env.SPEED_API_KEY = "sk_test_present"
    process.env.SPEED_WEBHOOK_SECRET = "wsec_present"
    process.env.SPEED_API_BASE_URL = "https://api.tryspeed.test"
    process.env.PINE_TREE_LIGHTNING_PROVIDER = "speed"
    process.env.PINE_TREE_LIGHTNING_SETTLEMENT_MODE = SPEED_PLATFORM_TREASURY_SWEEP_MODE
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "speed_pay_1",
        status: "unpaid",
        payment_request: "lnbc1test",
        transfers: [],
      }),
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env = originalEnv
  })

  it("feature flag enables speed_platform_treasury_sweep", () => {
    expect(getLightningProviderConfig()).toMatchObject({
      provider: "speed",
      settlementMode: "speed_platform_treasury_sweep",
      speedPlatformTreasurySweepEnabled: true,
    })
  })

  it("creates a Speed Lightning invoice without Speed Connect transfer fields", async () => {
    await createSpeedLightningPayment({
      amount: 10.25,
      currency: "USD",
      merchantAmount: 10,
      pineTreeFeeAmount: 0.25,
      pineTreePaymentId: "pay_1",
      merchantId: "merchant_1",
      settlementMode: SPEED_PLATFORM_TREASURY_SWEEP_MODE,
    })

    const fetchMock = vi.mocked(fetch)
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init?.body || "{}"))

    expect(body.transfers).toBeUndefined()
    expect(body.ttl).toBe(300)
    expect(body.metadata).toMatchObject({
      merchantId: "merchant_1",
      pineTreePaymentId: "pay_1",
      platform_fee_usd: 0.25,
      merchant_net_usd: 10,
      settlement_mode: "speed_platform_treasury_sweep",
    })
  })

  it("creates a Speed Custom Connect merchant account with the official documented payload (country as the literal 'United States')", async () => {
    await createSpeedCustomConnectedAccount({
      country: "us",
      firstName: "USER",
      lastName: "CVS",
      email: "USER@example.com",
      password: "temporary-secret"
    })

    const fetchMock = vi.mocked(fetch)
    const [url, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init?.body || "{}"))

    expect(url).toBe("https://api.tryspeed.test/connect/custom")
    expect(init?.method).toBe("POST")
    expect(body).toEqual({
      country: "United States",
      account_type: "merchant",
      first_name: "USER",
      last_name: "CVS",
      email: "user@example.com",
      password: "temporary-secret"
    })
  })

  it("creates connected-account payments with account_id and fixed application_fee", async () => {
    await createSpeedLightningPayment({
      amount: 10.25,
      currency: "USD",
      merchantAmount: 10,
      pineTreeFeeAmount: 0.25,
      merchantSpeedAccountId: "acct_speed_merchant",
      pineTreePaymentId: "pay_1",
      merchantId: "merchant_1",
      settlementMode: "speed_merchant_account",
    })

    const fetchMock = vi.mocked(fetch)
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init?.body || "{}"))

    expect(body).toMatchObject({
      currency: "USD",
      amount: 10.25,
      target_currency: "SATS",
      ttl: 300,
      account_id: "acct_speed_merchant",
      application_fee: 0.25,
      statement_descriptor: "PineTree",
    })
    expect(body.transfers).toBeUndefined()
    expect(body.application_fee_percentage).toBeUndefined()
  })

  it("creates a connected-account webhook registration with connect true", async () => {
    await createSpeedConnectedAccountWebhook({
      url: "https://app.pinetree-payments.com/api/webhooks/speed",
      description: "PineTree production connected webhook"
    })

    const fetchMock = vi.mocked(fetch)
    const [url, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init?.body || "{}"))

    expect(url).toBe("https://api.tryspeed.test/webhooks")
    expect(init?.method).toBe("POST")
    expect(body).toEqual({
      enabled_events: ["payment.created", "payment.paid"],
      api_version: "2022-10-15",
      url: "https://app.pinetree-payments.com/api/webhooks/speed",
      description: "PineTree production connected webhook",
      connect: true
    })
  })

  it("creates a direct Speed instant send to the merchant BTC payout address", async () => {
    await createSpeedWithdrawRequest({
      merchantId: "merchant_1",
      paymentId: "pay_1",
      amount: 10_000,
      currency: "SATS",
      destinationBtcAddress: "bc1pmerchantpayout",
      destinationAddressType: "taproot",
      metadata: {
        settlement_mode: SPEED_PLATFORM_TREASURY_SWEEP_MODE,
      },
      idempotencyKey: "lightning-payout:job_1",
    })

    const fetchMock = vi.mocked(fetch)
    const [url, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init?.body || "{}"))

    expect(url).toBe("https://api.tryspeed.test/send")
    expect(init?.method).toBe("POST")
    expect(init?.headers).toEqual(
      expect.objectContaining({
        "Idempotency-Key": "lightning-payout:job_1",
      })
    )
    expect(body).toMatchObject({
      amount: 10_000,
      currency: "SATS",
      target_currency: "SATS",
      withdraw_method: "onchain",
      withdraw_request: "bc1pmerchantpayout",
    })
    expect(JSON.parse(body.note)).toMatchObject({
      source: "pinetree_lightning_payout",
      merchant_id: "merchant_1",
      payment_id: "pay_1",
      settlement_mode: SPEED_PLATFORM_TREASURY_SWEEP_MODE,
    })
    expect(body).not.toHaveProperty("metadata")
  })
})
