import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { encryptShopifyToken, decryptShopifyToken } from "../lib/crypto"

// A valid 64-char hex key (32 bytes, all zeroes — for tests only).
const TEST_KEY = "0".repeat(64)

describe("encryptShopifyToken / decryptShopifyToken", () => {
  const originalKey = process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY

  beforeEach(() => {
    process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = TEST_KEY
  })
  afterEach(() => {
    process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = originalKey
  })

  it("round-trips a Shopify access token correctly", () => {
    const token = "shpat_abc123def456"
    expect(decryptShopifyToken(encryptShopifyToken(token))).toBe(token)
  })

  it("round-trips an empty string", () => {
    expect(decryptShopifyToken(encryptShopifyToken(""))).toBe("")
  })

  it("produces a different ciphertext on each call (random IV)", () => {
    const c1 = encryptShopifyToken("same_token")
    const c2 = encryptShopifyToken("same_token")
    expect(c1).not.toBe(c2)
  })

  it("ciphertext has three dot-separated segments (iv.body.tag)", () => {
    const enc = encryptShopifyToken("shpat_test")
    expect(enc.split(".")).toHaveLength(3)
  })

  it("throws on a truncated ciphertext", () => {
    expect(() => decryptShopifyToken("only.two")).toThrow()
  })

  it("throws on a tampered ciphertext body (auth tag mismatch)", () => {
    const enc = encryptShopifyToken("shpat_test")
    const [iv, ct, tag] = enc.split(".")
    // Flip the first base64 character — the leading char is never padding, so
    // this reliably changes actual ciphertext bytes and should fail GCM auth.
    const flipped = ct.charAt(0) === "A" ? "B" : "A"
    const tampered = [iv, flipped + ct.slice(1), tag].join(".")
    expect(() => decryptShopifyToken(tampered)).toThrow()
  })

  it("throws when SHOPIFY_TOKEN_ENCRYPTION_KEY is not set", () => {
    delete process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY
    expect(() => encryptShopifyToken("token")).toThrow(/SHOPIFY_TOKEN_ENCRYPTION_KEY/)
  })

  it("throws when SHOPIFY_TOKEN_ENCRYPTION_KEY is the wrong length", () => {
    process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = "short"
    expect(() => encryptShopifyToken("token")).toThrow(/SHOPIFY_TOKEN_ENCRYPTION_KEY/)
  })
})
