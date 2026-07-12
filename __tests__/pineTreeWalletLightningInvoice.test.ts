import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getMerchantNwcSetup: vi.fn(),
  makeNwcInvoice: vi.fn(),
}))

vi.mock("@/database/merchantProviders", () => ({
  getMerchantNwcSetup: mocks.getMerchantNwcSetup,
}))

vi.mock("@/providers/lightning/nwcClient", () => ({
  makeNwcInvoice: mocks.makeNwcInvoice,
}))

import {
  createMerchantLightningSweepInvoice,
  PineTreeWalletLightningReceiveNotConfiguredError,
} from "@/engine/pineTreeWalletLightningInvoice"

function readyNwcSetup(overrides: Record<string, unknown> = {}) {
  return {
    providerRowId: "provider_row_1",
    nwcUri: "nostr+walletconnect://pubkey?relay=wss://relay.test&secret=abc",
    walletLabel: "Alby",
    capabilities: { canMakeInvoice: true, canLookupInvoice: true, canPayInvoice: true, canGetBalance: true, supportedMethods: [] },
    readiness: { ready: true, missingPermissions: [], reason: null },
    lastTestedAt: null,
    status: "connected",
    ...overrides,
  }
}

describe("createMerchantLightningSweepInvoice", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("generates a fresh invoice via the merchant's own ready NWC wallet", async () => {
    mocks.getMerchantNwcSetup.mockResolvedValue(readyNwcSetup())
    mocks.makeNwcInvoice.mockResolvedValue({
      invoice: "lnbc1500n1p...",
      paymentHash: "hash-abc",
      amountMsat: 1500000,
      expiresAt: Math.floor(Date.now() / 1000) + 900,
      createdAt: Math.floor(Date.now() / 1000),
    })

    const result = await createMerchantLightningSweepInvoice({
      merchantId: "merchant_1",
      amountSats: 1500,
      sweepId: "sweep_1",
    })

    expect(mocks.getMerchantNwcSetup).toHaveBeenCalledWith("merchant_1")
    expect(mocks.makeNwcInvoice).toHaveBeenCalledWith(
      "nostr+walletconnect://pubkey?relay=wss://relay.test&secret=abc",
      1500000,
      "PineTree Lightning sweep sweep_1",
      900
    )
    expect(result.invoice).toBe("lnbc1500n1p...")
    expect(result.paymentHash).toBe("hash-abc")
    expect(result.amountSats).toBe(1500)
    expect(result.destinationWalletProfileId).toBe("provider_row_1")
    expect(typeof result.expiresAt).toBe("string")
  })

  it("scopes invoice generation to the exact merchant passed in - never a different merchant's wallet", async () => {
    mocks.getMerchantNwcSetup.mockResolvedValue(readyNwcSetup())
    mocks.makeNwcInvoice.mockResolvedValue({
      invoice: "lnbc1...",
      paymentHash: "hash-1",
      amountMsat: 1000,
      createdAt: 0,
    })

    await createMerchantLightningSweepInvoice({ merchantId: "merchant_42", amountSats: 1, sweepId: "sweep_1" })
    expect(mocks.getMerchantNwcSetup).toHaveBeenCalledWith("merchant_42")
    expect(mocks.getMerchantNwcSetup).not.toHaveBeenCalledWith("merchant_1")
  })

  it("throws PineTreeWalletLightningReceiveNotConfiguredError when the merchant has no NWC setup at all", async () => {
    mocks.getMerchantNwcSetup.mockResolvedValue(null)
    await expect(
      createMerchantLightningSweepInvoice({ merchantId: "merchant_1", amountSats: 1000, sweepId: "sweep_1" })
    ).rejects.toBeInstanceOf(PineTreeWalletLightningReceiveNotConfiguredError)
    expect(mocks.makeNwcInvoice).not.toHaveBeenCalled()
  })

  it("throws PineTreeWalletLightningReceiveNotConfiguredError when NWC is connected but not ready (missing permissions)", async () => {
    mocks.getMerchantNwcSetup.mockResolvedValue(
      readyNwcSetup({ readiness: { ready: false, missingPermissions: ["make_invoice"], reason: "missing make_invoice" } })
    )
    await expect(
      createMerchantLightningSweepInvoice({ merchantId: "merchant_1", amountSats: 1000, sweepId: "sweep_1" })
    ).rejects.toBeInstanceOf(PineTreeWalletLightningReceiveNotConfiguredError)
    expect(mocks.makeNwcInvoice).not.toHaveBeenCalled()
  })

  it("rejects a non-positive amount before ever contacting the wallet", async () => {
    await expect(
      createMerchantLightningSweepInvoice({ merchantId: "merchant_1", amountSats: 0, sweepId: "sweep_1" })
    ).rejects.toThrow(/positive amountSats/)
    expect(mocks.getMerchantNwcSetup).not.toHaveBeenCalled()
  })

  it("enforces a minimum invoice expiry even if a tiny value is requested", async () => {
    mocks.getMerchantNwcSetup.mockResolvedValue(readyNwcSetup())
    mocks.makeNwcInvoice.mockResolvedValue({ invoice: "lnbc1...", paymentHash: "hash-1", amountMsat: 1000, createdAt: 0 })

    await createMerchantLightningSweepInvoice({
      merchantId: "merchant_1",
      amountSats: 1000,
      sweepId: "sweep_1",
      expiresInSeconds: 5,
    })

    expect(mocks.makeNwcInvoice).toHaveBeenCalledWith(expect.any(String), 1000000, expect.any(String), 60)
  })
})
