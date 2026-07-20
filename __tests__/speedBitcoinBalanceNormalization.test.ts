import { describe, expect, it } from "vitest"
import { normalizeSpeedBitcoinBalance, satsToBtcDecimal } from "@/engine/pineTreeWalletSync"

describe("canonical Bitcoin Lightning balance", () => {
  it("converts satoshis to BTC with bigint precision, including exact zero", () => {
    expect(satsToBtcDecimal("0")).toBe("0")
    expect(satsToBtcDecimal("2217713")).toBe("0.02217713")
    expect(satsToBtcDecimal("2100000000000000")).toBe("21000000")
  })

  it("normalizes provider asset variants without duplicating or mixing SATS and BTC", () => {
    expect(normalizeSpeedBitcoinBalance([{ amount: "25", target_currency: "SATS" }])).toBe("0.00000025")
    expect(normalizeSpeedBitcoinBalance([{ amount: "1.25", target_currency: "btc" }])).toBe("1.25")
    expect(normalizeSpeedBitcoinBalance([{ amount: "1.25", target_currency: "bitcoin_lightning" }])).toBe("1.25")
    expect(normalizeSpeedBitcoinBalance([
      { amount: "25", target_currency: "SATS" },
      { amount: "999", target_currency: "BTC" },
    ])).toBe("0.00000025")
  })

  it("rounds a fractional-sats amount to the nearest whole satoshi instead of rejecting it (observed live against a real Speed connected account: 1596.27 SATS)", () => {
    // Speed's live /balances response can carry a sub-satoshi remainder even
    // though a satoshi is Bitcoin's actual smallest spendable unit. Before
    // this fix, satsToBtcDecimal's integer-only regex silently rejected any
    // decimal amount, which made normalizeSpeedBitcoinBalance return null and
    // permanently failed the sync for every merchant whose Speed ledger had
    // a fractional-sats remainder - reproduced against a real merchant.
    expect(satsToBtcDecimal(1596.27)).toBe("0.00001596")
    expect(satsToBtcDecimal("1596.27")).toBe("0.00001596")
    expect(satsToBtcDecimal("1596.5")).toBe("0.00001597")
    expect(satsToBtcDecimal("1596.49")).toBe("0.00001596")
    expect(normalizeSpeedBitcoinBalance([{ amount: 1596.27, target_currency: "SATS" }])).toBe("0.00001596")
  })

  it("never returns null for a well-formed decimal SATS amount (the actual production failure mode)", () => {
    expect(satsToBtcDecimal("0.4")).not.toBeNull()
    expect(satsToBtcDecimal("123456789.999")).not.toBeNull()
  })
})
