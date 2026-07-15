import { describe, expect, it } from "vitest"
import {
  getPaymentRailDefinition,
  getRailsForCategory,
  getRailsForChannel,
  isCardRail,
  isCryptoRail,
  PAYMENT_RAIL_DEFINITIONS
} from "@/types/payment"

describe("PAYMENT_RAIL_DEFINITIONS - canonical single source of truth", () => {
  it("defines every PaymentNetwork exactly once", () => {
    const ids = Object.keys(PAYMENT_RAIL_DEFINITIONS)
    expect(ids.sort()).toEqual(["base", "bitcoin_lightning", "fluidpay", "shift4", "solana", "stripe"])
  })
})

describe("getRailsForCategory", () => {
  it('("crypto") returns exactly solana, base, bitcoin_lightning - never a card rail', () => {
    const rails = getRailsForCategory("crypto")
    expect(rails).toEqual(["solana", "base", "bitcoin_lightning"])
    expect(rails).not.toContain("stripe")
    expect(rails).not.toContain("shift4")
    expect(rails).not.toContain("fluidpay")
  })

  it('("card") returns only supported card rails - never a crypto rail', () => {
    const rails = getRailsForCategory("card")
    expect(rails).toEqual(["shift4", "stripe", "fluidpay"])
    expect(rails).not.toContain("solana")
    expect(rails).not.toContain("base")
    expect(rails).not.toContain("bitcoin_lightning")
  })
})

describe("isCardRail / isCryptoRail", () => {
  it("classifies each rail into exactly one category, never both", () => {
    for (const rail of Object.keys(PAYMENT_RAIL_DEFINITIONS)) {
      expect(isCardRail(rail)).toBe(!isCryptoRail(rail))
    }
  })

  it("stripe/shift4/fluidpay are card, never crypto", () => {
    expect(isCardRail("stripe")).toBe(true)
    expect(isCryptoRail("stripe")).toBe(false)
    expect(isCardRail("shift4")).toBe(true)
    expect(isCryptoRail("shift4")).toBe(false)
    expect(isCardRail("fluidpay")).toBe(true)
    expect(isCryptoRail("fluidpay")).toBe(false)
  })

  it("solana/base/bitcoin_lightning are crypto, never card", () => {
    expect(isCryptoRail("solana")).toBe(true)
    expect(isCardRail("solana")).toBe(false)
    expect(isCryptoRail("base")).toBe(true)
    expect(isCardRail("base")).toBe(false)
    expect(isCryptoRail("bitcoin_lightning")).toBe(true)
    expect(isCardRail("bitcoin_lightning")).toBe(false)
  })

  it("returns false for an unrecognized or infrastructure-only identifier (Dynamic, Fireblocks)", () => {
    expect(isCardRail("dynamic")).toBe(false)
    expect(isCryptoRail("dynamic")).toBe(false)
    expect(isCardRail("fireblocks")).toBe(false)
    expect(isCryptoRail("fireblocks")).toBe(false)
  })

  it("normalizes lightning aliases before classifying", () => {
    expect(isCryptoRail("lightning")).toBe(true)
    expect(isCryptoRail("btc_lightning")).toBe(true)
  })
})

describe("getRailsForChannel", () => {
  it('("pos") includes every rail actually wired into the POS flow', () => {
    const rails = getRailsForChannel("pos")
    expect(rails).toContain("solana")
    expect(rails).toContain("base")
    expect(rails).toContain("bitcoin_lightning")
    expect(rails).toContain("stripe")
  })

  it("a rail not supported for a channel is excluded from that channel's list", () => {
    // shift4/fluidpay are not wired into POS today - see PAYMENT_RAIL_DEFINITIONS.
    const posRails = getRailsForChannel("pos")
    expect(posRails).not.toContain("shift4")
    expect(posRails).not.toContain("fluidpay")

    const checkoutRails = getRailsForChannel("checkout")
    expect(checkoutRails).toContain("shift4")
    expect(checkoutRails).toContain("fluidpay")
  })
})

describe("getPaymentRailDefinition", () => {
  it("returns the full definition record for a rail", () => {
    const definition = getPaymentRailDefinition("bitcoin_lightning")
    expect(definition).toEqual({
      id: "bitcoin_lightning",
      category: "crypto",
      customerFacing: true,
      supportedChannels: ["pos", "checkout", "api"],
      providerCapability: "lightning"
    })
  })
})
