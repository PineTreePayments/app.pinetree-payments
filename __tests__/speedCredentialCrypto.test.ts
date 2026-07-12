import { afterEach, beforeEach, describe, expect, it } from "vitest"

const VALID_KEY = "a".repeat(64)
const OTHER_VALID_KEY = "b".repeat(64)

describe("speedCredentialCrypto", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    process.env.SPEED_CREDENTIAL_ENCRYPTION_KEY = VALID_KEY
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it("round-trips a plaintext password through encrypt/decrypt", async () => {
    const { encryptSpeedAccountPassword, decryptSpeedAccountPassword } = await import(
      "@/providers/lightning/speedCredentialCrypto"
    )
    const plaintext = "Correct-Horse-Battery-Staple-9!"
    const encrypted = encryptSpeedAccountPassword(plaintext)
    expect(decryptSpeedAccountPassword(encrypted)).toBe(plaintext)
  })

  it("never stores the plaintext password in the encrypted output", async () => {
    const { encryptSpeedAccountPassword } = await import("@/providers/lightning/speedCredentialCrypto")
    const plaintext = "Correct-Horse-Battery-Staple-9!"
    const encrypted = encryptSpeedAccountPassword(plaintext)
    expect(encrypted.encryptedPassword).not.toContain(plaintext)
    expect(encrypted.encryptedPassword).not.toBe(plaintext)
  })

  it("uses a fresh random IV per encryption, so the same plaintext produces different ciphertext", async () => {
    const { encryptSpeedAccountPassword, decryptSpeedAccountPassword } = await import(
      "@/providers/lightning/speedCredentialCrypto"
    )
    const plaintext = "Same-Password-Twice-9!"
    const first = encryptSpeedAccountPassword(plaintext)
    const second = encryptSpeedAccountPassword(plaintext)
    expect(first.encryptionIv).not.toBe(second.encryptionIv)
    expect(first.encryptedPassword).not.toBe(second.encryptedPassword)
    expect(decryptSpeedAccountPassword(first)).toBe(plaintext)
    expect(decryptSpeedAccountPassword(second)).toBe(plaintext)
  })

  it("fails decryption when the ciphertext is tampered with", async () => {
    const { encryptSpeedAccountPassword, decryptSpeedAccountPassword } = await import(
      "@/providers/lightning/speedCredentialCrypto"
    )
    const encrypted = encryptSpeedAccountPassword("tamper-test-password")
    const tampered = {
      ...encrypted,
      encryptedPassword: Buffer.from("this-is-not-the-real-ciphertext").toString("base64"),
    }
    expect(() => decryptSpeedAccountPassword(tampered)).toThrow()
  })

  it("fails decryption when the IV is tampered with", async () => {
    const { encryptSpeedAccountPassword, decryptSpeedAccountPassword } = await import(
      "@/providers/lightning/speedCredentialCrypto"
    )
    const encrypted = encryptSpeedAccountPassword("tamper-test-password")
    const tampered = { ...encrypted, encryptionIv: Buffer.alloc(12, 7).toString("base64") }
    expect(() => decryptSpeedAccountPassword(tampered)).toThrow()
  })

  it("fails decryption when the auth tag is tampered with", async () => {
    const { encryptSpeedAccountPassword, decryptSpeedAccountPassword } = await import(
      "@/providers/lightning/speedCredentialCrypto"
    )
    const encrypted = encryptSpeedAccountPassword("tamper-test-password")
    const tampered = { ...encrypted, encryptionAuthTag: Buffer.alloc(16, 9).toString("base64") }
    expect(() => decryptSpeedAccountPassword(tampered)).toThrow()
  })

  it("fails decryption when ciphertext and auth tag are swapped between two different encryptions", async () => {
    const { encryptSpeedAccountPassword, decryptSpeedAccountPassword } = await import(
      "@/providers/lightning/speedCredentialCrypto"
    )
    const a = encryptSpeedAccountPassword("password-a")
    const b = encryptSpeedAccountPassword("password-b")
    const mixed = { ...a, encryptionAuthTag: b.encryptionAuthTag }
    expect(() => decryptSpeedAccountPassword(mixed)).toThrow()
  })

  it("throws a clear configuration error when SPEED_CREDENTIAL_ENCRYPTION_KEY is missing", async () => {
    delete process.env.SPEED_CREDENTIAL_ENCRYPTION_KEY
    const { encryptSpeedAccountPassword } = await import("@/providers/lightning/speedCredentialCrypto")
    expect(() => encryptSpeedAccountPassword("password")).toThrow(/SPEED_CREDENTIAL_ENCRYPTION_KEY/)
  })

  it("throws a clear configuration error when the key is too short", async () => {
    process.env.SPEED_CREDENTIAL_ENCRYPTION_KEY = "abcd"
    const { encryptSpeedAccountPassword } = await import("@/providers/lightning/speedCredentialCrypto")
    expect(() => encryptSpeedAccountPassword("password")).toThrow(/64-char hex/)
  })

  it("throws a clear configuration error when the key is not valid hex", async () => {
    process.env.SPEED_CREDENTIAL_ENCRYPTION_KEY = "z".repeat(64)
    const { encryptSpeedAccountPassword } = await import("@/providers/lightning/speedCredentialCrypto")
    expect(() => encryptSpeedAccountPassword("password")).toThrow(/64-char hex/)
  })

  it("fails to decrypt with the wrong key even when the ciphertext shape is valid", async () => {
    const { encryptSpeedAccountPassword, decryptSpeedAccountPassword } = await import(
      "@/providers/lightning/speedCredentialCrypto"
    )
    const encrypted = encryptSpeedAccountPassword("password-under-key-a")
    process.env.SPEED_CREDENTIAL_ENCRYPTION_KEY = OTHER_VALID_KEY
    expect(() => decryptSpeedAccountPassword(encrypted)).toThrow()
  })
})
