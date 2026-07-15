import { describe, expect, it } from "vitest"
import {
  formatWalletBaseUnitsAsDecimal,
  isSupportedWalletAsset,
  parseWalletAmountToBaseUnits,
} from "@/engine/wallet/walletMoney"

describe("parseWalletAmountToBaseUnits", () => {
  it("parses a whole SATS amount to an integer base unit with zero decimals", () => {
    expect(parseWalletAmountToBaseUnits("1000", "SATS")).toBe(BigInt(1000))
  })

  it("rejects a fractional SATS amount - SATS has zero decimal places", () => {
    expect(parseWalletAmountToBaseUnits("1000.5", "SATS")).toBeNull()
  })

  it("parses a USDC decimal amount into 6-decimal base units", () => {
    expect(parseWalletAmountToBaseUnits("12.5", "USDC")).toBe(BigInt(12_500_000))
  })

  it("normalizes a leading-dot amount", () => {
    expect(parseWalletAmountToBaseUnits(".5", "USDC")).toBe(BigInt(500_000))
  })

  it("rejects zero", () => {
    expect(parseWalletAmountToBaseUnits("0", "SATS")).toBeNull()
  })

  it("rejects negative amounts", () => {
    expect(parseWalletAmountToBaseUnits("-5", "SATS")).toBeNull()
  })

  it("rejects scientific notation", () => {
    expect(parseWalletAmountToBaseUnits("1e5", "SATS")).toBeNull()
  })

  it("rejects too many fractional digits for the asset", () => {
    expect(parseWalletAmountToBaseUnits("1.1234567", "USDC")).toBeNull()
  })

  it("rejects non-numeric input", () => {
    expect(parseWalletAmountToBaseUnits("abc", "SATS")).toBeNull()
  })

  it("rejects an empty string", () => {
    expect(parseWalletAmountToBaseUnits("", "SATS")).toBeNull()
  })
})

describe("formatWalletBaseUnitsAsDecimal", () => {
  it("round-trips a USDC amount", () => {
    const baseUnits = parseWalletAmountToBaseUnits("12.5", "USDC")!
    expect(formatWalletBaseUnitsAsDecimal(baseUnits, "USDC")).toBe("12.5")
  })

  it("formats SATS with no decimal point", () => {
    expect(formatWalletBaseUnitsAsDecimal(BigInt(1000), "SATS")).toBe("1000")
  })

  it("strips trailing zeros without dropping the whole part", () => {
    expect(formatWalletBaseUnitsAsDecimal(BigInt(10_000_000), "USDC")).toBe("10")
  })
})

describe("isSupportedWalletAsset", () => {
  it("accepts SATS, USDT, USDC", () => {
    expect(isSupportedWalletAsset("SATS")).toBe(true)
    expect(isSupportedWalletAsset("USDT")).toBe(true)
    expect(isSupportedWalletAsset("USDC")).toBe(true)
  })

  it("rejects unsupported assets", () => {
    expect(isSupportedWalletAsset("BTC")).toBe(false)
    expect(isSupportedWalletAsset("")).toBe(false)
  })
})
