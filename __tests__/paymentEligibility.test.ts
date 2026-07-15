import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const getMerchantAvailableNetworks = vi.fn()
vi.mock("@/engine/paymentIntents", () => ({ getMerchantAvailableNetworks }))

describe("engine/paymentEligibility - fully resolved rail eligibility", () => {
  beforeEach(() => {
    getMerchantAvailableNetworks.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("Stripe-only merchant: Card is eligible, Crypto is not, Stripe never appears in the crypto category", async () => {
    getMerchantAvailableNetworks.mockResolvedValue(["stripe"])
    const { getEligiblePaymentRails } = await import("@/engine/paymentEligibility")

    const cardEligibility = await getEligiblePaymentRails({ merchantId: "m1", channel: "pos", category: "card" })
    expect(cardEligibility.find((r) => r.rail === "stripe")?.enabled).toBe(true)

    const cryptoEligibility = await getEligiblePaymentRails({ merchantId: "m1", channel: "pos", category: "crypto" })
    expect(cryptoEligibility.every((r) => !r.enabled)).toBe(true)
    expect(cryptoEligibility.some((r) => r.rail === "stripe")).toBe(false)
  })

  it("Stripe + Speed: Card and Bitcoin Lightning are independently eligible", async () => {
    getMerchantAvailableNetworks.mockResolvedValue(["stripe", "bitcoin_lightning"])
    const { getEligiblePaymentRails } = await import("@/engine/paymentEligibility")

    const all = await getEligiblePaymentRails({ merchantId: "m1", channel: "pos" })
    expect(all.find((r) => r.rail === "stripe")?.enabled).toBe(true)
    expect(all.find((r) => r.rail === "bitcoin_lightning")?.enabled).toBe(true)
    expect(all.find((r) => r.rail === "solana")?.enabled).toBe(false)
    expect(all.find((r) => r.rail === "base")?.enabled).toBe(false)
  })

  it("Dynamic/Fireblocks-style infrastructure ids never appear as eligible rails, even if somehow present in the merchant network list", async () => {
    getMerchantAvailableNetworks.mockResolvedValue(["dynamic", "fireblocks"])
    const { getEligiblePaymentRails } = await import("@/engine/paymentEligibility")

    const all = await getEligiblePaymentRails({ merchantId: "m1", channel: "pos" })
    // The PaymentNetwork type makes "dynamic"/"fireblocks" impossible values
    // for `rail` at compile time - every returned rail is necessarily one of
    // the 6 canonical ids, and none of them can be enabled by an unrelated
    // infrastructure id being present in the merchant's network list.
    const canonicalRailIds = new Set(["solana", "base", "bitcoin_lightning", "shift4", "stripe", "fluidpay"])
    expect(all.every((r) => canonicalRailIds.has(r.rail))).toBe(true)
    expect(all.every((r) => !r.enabled)).toBe(true)
  })

  it("a pending/disabled provider (absent from getMerchantAvailableNetworks) leaves its rail unavailable with a normalized reason", async () => {
    getMerchantAvailableNetworks.mockResolvedValue([])
    const { getEligiblePaymentRails } = await import("@/engine/paymentEligibility")

    const all = await getEligiblePaymentRails({ merchantId: "m1", channel: "pos", category: "crypto" })
    for (const rail of all) {
      expect(rail.enabled).toBe(false)
      expect(rail.unavailableReason).toBe("not_connected_or_not_ready")
    }
  })

  it("channel filtering excludes a rail not supported on the requested channel (shift4/fluidpay are not POS rails today)", async () => {
    getMerchantAvailableNetworks.mockResolvedValue(["stripe", "solana", "base", "bitcoin_lightning"])
    const { getEligiblePaymentRails } = await import("@/engine/paymentEligibility")

    const posRails = await getEligiblePaymentRails({ merchantId: "m1", channel: "pos" })
    expect(posRails.some((r) => r.rail === "shift4")).toBe(false)
    expect(posRails.some((r) => r.rail === "fluidpay")).toBe(false)
  })

  it("getEnabledRailsForCategory returns only the enabled rail ids for POS Crypto - never Stripe/Shift4/FluidPay", async () => {
    getMerchantAvailableNetworks.mockResolvedValue(["stripe", "solana", "base", "bitcoin_lightning"])
    const { getEnabledRailsForCategory } = await import("@/engine/paymentEligibility")

    const rails = await getEnabledRailsForCategory("m1", "crypto", "pos")
    expect(rails.sort()).toEqual(["base", "bitcoin_lightning", "solana"])
    expect(rails).not.toContain("stripe")
  })

  it("rejects a missing merchant id", async () => {
    const { getEligiblePaymentRails } = await import("@/engine/paymentEligibility")
    await expect(getEligiblePaymentRails({ merchantId: "", channel: "pos" })).rejects.toThrow()
  })
})
