import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { classifyBitcoinWithdrawalDestination } from "@/providers/wallets/bitcoinWithdrawalDestination"

const MAINNET_LEGACY = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
const MAINNET_P2SH = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy"
const MAINNET_SEGWIT = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"
const TESTNET_SEGWIT = "tb1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjaq5ayy"
const MAINNET_BOLT11 = "lnbc10u1p3xnhl2sp5jctpcz4nkfjzaqwsjssjfw0abcdefghijklmnopqrstuvwxyz"
const TESTNET_BOLT11 = "lntb10u1p3xnhl2sp5jctpcz4nkfjzaqwsjssjfw0abcdefghijklmnopqrstuvwxyz"

describe("classifyBitcoinWithdrawalDestination", () => {
  beforeEach(() => {
    process.env.BITCOIN_NETWORK = "mainnet"
  })
  afterEach(() => {
    delete process.env.BITCOIN_NETWORK
  })

  it("classifies a legacy P2PKH address as onchain", () => {
    expect(classifyBitcoinWithdrawalDestination(MAINNET_LEGACY)).toEqual({
      valid: true, method: "onchain", kind: "bitcoin_address", normalized: MAINNET_LEGACY,
    })
  })

  it("classifies a P2SH address as onchain", () => {
    const result = classifyBitcoinWithdrawalDestination(MAINNET_P2SH)
    expect(result).toMatchObject({ valid: true, method: "onchain", kind: "bitcoin_address" })
  })

  it("classifies a native segwit (bech32) address as onchain", () => {
    const result = classifyBitcoinWithdrawalDestination(MAINNET_SEGWIT)
    expect(result).toMatchObject({ valid: true, method: "onchain", kind: "bitcoin_address" })
  })

  it("rejects a testnet address when configured for mainnet", () => {
    const result = classifyBitcoinWithdrawalDestination(TESTNET_SEGWIT)
    expect(result.valid).toBe(false)
  })

  it("classifies a BOLT11 invoice matching the configured network as lightning", () => {
    const result = classifyBitcoinWithdrawalDestination(MAINNET_BOLT11)
    expect(result).toMatchObject({ valid: true, method: "lightning", kind: "bolt11_invoice" })
  })

  it("rejects a BOLT11 invoice for the wrong network", () => {
    const result = classifyBitcoinWithdrawalDestination(TESTNET_BOLT11)
    expect(result).toMatchObject({ valid: false })
  })

  it("classifies a Lightning Address as lightning", () => {
    expect(classifyBitcoinWithdrawalDestination("merchant@speed.app")).toEqual({
      valid: true, method: "lightning", kind: "lightning_address", normalized: "merchant@speed.app",
    })
  })

  it("normalizes a Lightning Address and BOLT11 invoice to lowercase", () => {
    expect(classifyBitcoinWithdrawalDestination("Merchant@Speed.App").valid).toBe(true)
    const upperInvoice = MAINNET_BOLT11.toUpperCase()
    const result = classifyBitcoinWithdrawalDestination(upperInvoice)
    expect(result).toMatchObject({ valid: true, kind: "bolt11_invoice", normalized: MAINNET_BOLT11.toLowerCase() })
  })

  it("rejects an empty destination", () => {
    expect(classifyBitcoinWithdrawalDestination("").valid).toBe(false)
    expect(classifyBitcoinWithdrawalDestination("   ").valid).toBe(false)
  })

  it("rejects garbage that matches neither an address, a Lightning Address, nor a BOLT11 invoice", () => {
    expect(classifyBitcoinWithdrawalDestination("not-a-real-destination").valid).toBe(false)
    expect(classifyBitcoinWithdrawalDestination("0x1234567890abcdef1234567890abcdef12345678").valid).toBe(false)
  })

  it("never classifies a Bitcoin address as a Lightning destination", () => {
    const result = classifyBitcoinWithdrawalDestination(MAINNET_SEGWIT)
    expect(result).toMatchObject({ method: "onchain" })
  })

  it("never classifies a Lightning invoice or Lightning Address as an onchain destination", () => {
    expect(classifyBitcoinWithdrawalDestination(MAINNET_BOLT11)).toMatchObject({ method: "lightning" })
    expect(classifyBitcoinWithdrawalDestination("merchant@speed.app")).toMatchObject({ method: "lightning" })
  })
})
