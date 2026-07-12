import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const VALID_KEY = "c".repeat(64)

const mocks = vi.hoisted(() => ({
  upserts: [] as Array<{ table: string; row: Record<string, unknown>; options?: Record<string, unknown> }>,
  upsertError: null as { message: string } | null,
  upsertSelectData: null as Record<string, unknown> | null,
  selectEqEqData: null as Record<string, unknown> | null,
  selectEqEqError: null as { message: string } | null,
}))

vi.mock("@/database/supabase", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      upsert: (row: Record<string, unknown>, options?: Record<string, unknown>) => {
        mocks.upserts.push({ table, row, options })
        return {
          select: () => ({
            single: async () => ({ data: mocks.upsertSelectData, error: mocks.upsertError }),
          }),
        }
      },
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: mocks.selectEqEqData, error: mocks.selectEqEqError }),
          }),
        }),
      }),
    }),
  },
  supabase: null,
}))

import {
  deriveSpeedCredentialStatus,
  getMerchantSpeedCredentialMetadata,
  resolveSpeedCredentialEnvironment,
  revealMerchantSpeedCredential,
  upsertMerchantSpeedCredential,
} from "@/database/merchantSpeedCredentials"

describe("merchantSpeedCredentials", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    process.env.SPEED_CREDENTIAL_ENCRYPTION_KEY = VALID_KEY
    mocks.upserts = []
    mocks.upsertError = null
    mocks.upsertSelectData = null
    mocks.selectEqEqData = null
    mocks.selectEqEqError = null
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe("resolveSpeedCredentialEnvironment", () => {
    it("resolves to production only when NODE_ENV is production", () => {
      process.env = { ...process.env, NODE_ENV: "production" }
      expect(resolveSpeedCredentialEnvironment()).toBe("production")
    })

    it("resolves to non_production for test/dev/staging", () => {
      process.env = { ...process.env, NODE_ENV: "test" }
      expect(resolveSpeedCredentialEnvironment()).toBe("non_production")
      process.env = { ...process.env, NODE_ENV: "development" }
      expect(resolveSpeedCredentialEnvironment()).toBe("non_production")
    })
  })

  describe("deriveSpeedCredentialStatus", () => {
    it("is storage_error whenever credentialStoreFailed is true, regardless of a stored row", () => {
      expect(deriveSpeedCredentialStatus({ hasStoredCredential: true, credentialStoreFailed: true })).toBe(
        "storage_error"
      )
      expect(deriveSpeedCredentialStatus({ hasStoredCredential: false, credentialStoreFailed: true })).toBe(
        "storage_error"
      )
    })

    it("is available when a credential row exists and storage did not fail", () => {
      expect(deriveSpeedCredentialStatus({ hasStoredCredential: true, credentialStoreFailed: false })).toBe(
        "available"
      )
    })

    it("is unavailable when there is no stored credential and no failure on record", () => {
      expect(deriveSpeedCredentialStatus({ hasStoredCredential: false, credentialStoreFailed: false })).toBe(
        "unavailable"
      )
    })
  })

  describe("upsertMerchantSpeedCredential", () => {
    it("encrypts the password before it ever reaches the database row", async () => {
      mocks.upsertSelectData = {
        id: "cred_1",
        merchant_id: "merchant_1",
        speed_connected_account_id: "acct_1",
        speed_login_email: "merchant@example.test",
        environment: "non_production",
        created_at: "2026-07-12T00:00:00.000Z",
        updated_at: "2026-07-12T00:00:00.000Z",
        rotated_at: null,
      }

      const plaintext = "S3curePassword!!"
      await upsertMerchantSpeedCredential({
        merchantId: "merchant_1",
        speedConnectedAccountId: "acct_1",
        speedLoginEmail: "merchant@example.test",
        password: plaintext,
        environment: "non_production",
      })

      expect(mocks.upserts).toHaveLength(1)
      const { row, options } = mocks.upserts[0]
      expect(row.encrypted_password).not.toBe(plaintext)
      expect(String(row.encrypted_password)).not.toContain(plaintext)
      expect(row).toHaveProperty("encryption_iv")
      expect(row).toHaveProperty("encryption_auth_tag")
      expect(row).not.toHaveProperty("password")
      expect(options).toEqual({ onConflict: "merchant_id,environment" })
    })

    it("upserts on (merchant_id, environment) so a retry updates rather than duplicates", async () => {
      mocks.upsertSelectData = {
        id: "cred_1",
        merchant_id: "merchant_1",
        speed_connected_account_id: "acct_1",
        speed_login_email: "merchant@example.test",
        environment: "non_production",
        created_at: "2026-07-12T00:00:00.000Z",
        updated_at: "2026-07-12T00:00:00.000Z",
        rotated_at: null,
      }

      await upsertMerchantSpeedCredential({
        merchantId: "merchant_1",
        speedConnectedAccountId: "acct_1",
        speedLoginEmail: "merchant@example.test",
        password: "first-password",
        environment: "non_production",
      })
      await upsertMerchantSpeedCredential({
        merchantId: "merchant_1",
        speedConnectedAccountId: "acct_1",
        speedLoginEmail: "merchant@example.test",
        password: "second-password",
        environment: "non_production",
      })

      expect(mocks.upserts).toHaveLength(2)
      for (const { options } of mocks.upserts) {
        expect(options).toEqual({ onConflict: "merchant_id,environment" })
      }
    })

    it("throws (never silently swallows) when the database write fails", async () => {
      mocks.upsertError = { message: "connection reset" }
      mocks.upsertSelectData = null
      await expect(
        upsertMerchantSpeedCredential({
          merchantId: "merchant_1",
          speedConnectedAccountId: "acct_1",
          speedLoginEmail: "merchant@example.test",
          password: "some-password",
        })
      ).rejects.toThrow(/Failed to store Speed account credential/)
    })
  })

  describe("getMerchantSpeedCredentialMetadata", () => {
    it("never returns encrypted_password, encryption_iv, or encryption_auth_tag", async () => {
      mocks.selectEqEqData = {
        id: "cred_1",
        merchant_id: "merchant_1",
        speed_connected_account_id: "acct_1",
        speed_login_email: "merchant@example.test",
        environment: "non_production",
        created_at: "2026-07-12T00:00:00.000Z",
        updated_at: "2026-07-12T00:00:00.000Z",
        rotated_at: null,
      }
      const metadata = await getMerchantSpeedCredentialMetadata("merchant_1", "non_production")
      expect(metadata).not.toBeNull()
      expect(metadata).not.toHaveProperty("encrypted_password")
      expect(metadata).not.toHaveProperty("encryption_iv")
      expect(metadata).not.toHaveProperty("encryption_auth_tag")
    })

    it("returns null when no row exists", async () => {
      mocks.selectEqEqData = null
      const metadata = await getMerchantSpeedCredentialMetadata("merchant_missing", "non_production")
      expect(metadata).toBeNull()
    })
  })

  describe("revealMerchantSpeedCredential", () => {
    it("decrypts and returns the original password only for an authorized caller", async () => {
      const { encryptSpeedAccountPassword } = await import("@/providers/lightning/speedCredentialCrypto")
      const encrypted = encryptSpeedAccountPassword("the-real-speed-password")
      mocks.selectEqEqData = {
        speed_connected_account_id: "acct_1",
        speed_login_email: "merchant@example.test",
        encrypted_password: encrypted.encryptedPassword,
        encryption_iv: encrypted.encryptionIv,
        encryption_auth_tag: encrypted.encryptionAuthTag,
      }
      const revealed = await revealMerchantSpeedCredential("merchant_1", "non_production")
      expect(revealed).toEqual({
        speedConnectedAccountId: "acct_1",
        speedLoginEmail: "merchant@example.test",
        speedPassword: "the-real-speed-password",
      })
    })

    it("returns null when there is no retained credential to reveal", async () => {
      mocks.selectEqEqData = null
      const revealed = await revealMerchantSpeedCredential("merchant_missing", "non_production")
      expect(revealed).toBeNull()
    })
  })
})
