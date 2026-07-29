import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createSpeedLightningPayment: vi.fn(),
  upsertMerchantLightningProfile: vi.fn(),
  getMerchantLightningProfile: vi.fn(),
  resolveSpeedHeaderAccountId: vi.fn(),
}))

vi.mock("@/database/merchantLightningProfiles", () => ({
  getMerchantLightningProfile: mocks.getMerchantLightningProfile,
  upsertMerchantLightningProfile: mocks.upsertMerchantLightningProfile,
}))

vi.mock("@/providers/registry", () => ({ registerProvider: vi.fn() }))
vi.mock("@/database/merchantProviders", () => ({ SPEED_PROVIDER_NAME: "lightning_speed" }))
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async () => "data:image/png;base64,stub") } }))

vi.mock("@/providers/lightning/speedHeaderAccountResolver", () => ({
  resolveSpeedHeaderAccountId: mocks.resolveSpeedHeaderAccountId,
}))

vi.mock("@/providers/lightning/speedClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/providers/lightning/speedClient")>()
  return {
    ...actual,
    createSpeedLightningPayment: mocks.createSpeedLightningPayment,
    isSpeedPlatformTreasurySweepEnabled: () => false,
  }
})

import { speedAdapter } from "@/providers/lightning/speedAdapter"
import { SpeedApiError } from "@/providers/lightning/speedClient"

const MERCHANT = "merchant-1"

function connectedAccountMissingError() {
  return new SpeedApiError(
    "Speed API returned 400",
    400,
    "invalid_request_error",
    [{ field: null, message: "Connected account could not be found - acct_stale123456789" }],
    null,
    "req_abc"
  )
}

const invoiceRequest = {
  merchantId: MERCHANT,
  paymentId: "payment-1",
  grossAmount: 0.26,
  merchantAmount: 0.11,
  pinetreeFee: 0.15,
  currency: "USD",
  btcPriceUsd: 100_000,
  metadata: { paymentIntentId: "intent-1" },
} as unknown as Parameters<NonNullable<typeof speedAdapter.createLightningInvoice>>[0]

describe("Speed adapter readiness invalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getMerchantLightningProfile.mockResolvedValue({
      merchant_id: MERCHANT,
      status: "ready",
      speed_account_id: "acct_stale123456789",
      speed_connected_account_id: "acct_stale123456789",
    })
    mocks.resolveSpeedHeaderAccountId.mockResolvedValue("acct_stale123456789")
    mocks.upsertMerchantLightningProfile.mockResolvedValue({ merchant_id: MERCHANT, status: "needs_attention" })
  })

  it("moves the profile out of ready and rethrows the original provider error", async () => {
    mocks.createSpeedLightningPayment.mockRejectedValue(connectedAccountMissingError())

    await expect(speedAdapter.createLightningInvoice?.(invoiceRequest))
      .rejects.toBeInstanceOf(SpeedApiError)

    expect(mocks.upsertMerchantLightningProfile).toHaveBeenCalledTimes(1)
    const [payload] = mocks.upsertMerchantLightningProfile.mock.calls[0]
    expect(payload).toMatchObject({
      merchantId: MERCHANT,
      status: "needs_attention",
      providerErrorMessage: "Connected account could not be found - acct_stale123456789",
    })
    // The invalid account id is preserved for diagnosis: nothing clears it.
    expect(payload).not.toHaveProperty("speedConnectedAccountId")
    expect(payload).not.toHaveProperty("speedAccountId")
  })

  it("is idempotent across repeated identical permanent failures", async () => {
    mocks.createSpeedLightningPayment.mockRejectedValue(connectedAccountMissingError())

    await expect(speedAdapter.createLightningInvoice?.(invoiceRequest)).rejects.toThrow()
    await expect(speedAdapter.createLightningInvoice?.(invoiceRequest)).rejects.toThrow()

    expect(mocks.upsertMerchantLightningProfile).toHaveBeenCalledTimes(2)
    const [first] = mocks.upsertMerchantLightningProfile.mock.calls[0]
    const [second] = mocks.upsertMerchantLightningProfile.mock.calls[1]
    expect(second).toEqual(first)
  })

  it("does not invalidate readiness for an unrelated Speed 400", async () => {
    mocks.createSpeedLightningPayment.mockRejectedValue(
      new SpeedApiError("Speed API returned 400", 400, "invalid_request_error", [
        { field: "amount", message: "Amount must be greater than zero" },
      ])
    )

    await expect(speedAdapter.createLightningInvoice?.(invoiceRequest)).rejects.toThrow()
    expect(mocks.upsertMerchantLightningProfile).not.toHaveBeenCalled()
  })

  it("does not invalidate readiness on a transient provider failure", async () => {
    mocks.createSpeedLightningPayment.mockRejectedValue(
      new SpeedApiError("Speed API returned 503", 503, "service_unavailable", [])
    )

    await expect(speedAdapter.createLightningInvoice?.(invoiceRequest)).rejects.toThrow()
    expect(mocks.upsertMerchantLightningProfile).not.toHaveBeenCalled()
  })

  it("still surfaces the provider error when invalidation bookkeeping itself fails", async () => {
    mocks.createSpeedLightningPayment.mockRejectedValue(connectedAccountMissingError())
    mocks.upsertMerchantLightningProfile.mockRejectedValue(new Error("db unavailable"))

    await expect(speedAdapter.createLightningInvoice?.(invoiceRequest))
      .rejects.toBeInstanceOf(SpeedApiError)
  })
})
