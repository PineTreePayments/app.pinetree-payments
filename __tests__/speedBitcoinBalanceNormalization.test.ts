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
})
