import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  insertMerchantPublicKey,
  getMerchantPublicKeys,
  getMerchantPublicKeyByPrefix,
  disableMerchantPublicKey,
  touchMerchantPublicKeyLastUsed,
} = vi.hoisted(() => ({
  insertMerchantPublicKey: vi.fn(),
  getMerchantPublicKeys: vi.fn(),
  getMerchantPublicKeyByPrefix: vi.fn(),
  disableMerchantPublicKey: vi.fn(),
  touchMerchantPublicKeyLastUsed: vi.fn(),
}))

vi.mock("@/database/merchantPublicKeys", () => ({
  insertMerchantPublicKey,
  getMerchantPublicKeys,
  getMerchantPublicKeyByPrefix,
  disableMerchantPublicKey,
  touchMerchantPublicKeyLastUsed,
}))

import {
  createMerchantPublicKey,
  listMerchantPublicKeys,
  disableMerchantPublicKeyEngine,
  verifyMerchantPublicKey,
} from "@/engine/merchantPublicKeys"

const baseRecord = {
  id: "key-1",
  merchant_id: "merchant-1",
  name: "Test Key",
  key_prefix: "pk_live_testabc123456",
  key_hash: "deadbeefhash",
  allowed_origins: [],
  enabled: true,
  last_used_at: null,
  created_at: "2026-06-13T12:00:00.000Z",
}

describe("engine/merchantPublicKeys", () => {
  beforeEach(() => {
    insertMerchantPublicKey.mockReset()
    getMerchantPublicKeys.mockReset()
    getMerchantPublicKeyByPrefix.mockReset()
    disableMerchantPublicKey.mockReset()
    touchMerchantPublicKeyLastUsed.mockReset()
    touchMerchantPublicKeyLastUsed.mockResolvedValue(undefined)
  })

  describe("createMerchantPublicKey", () => {
    it("generates a pk_live_ prefixed key with 64 hex chars after prefix", async () => {
      insertMerchantPublicKey.mockImplementation(async (input: typeof baseRecord) => ({
        ...baseRecord,
        key_prefix: input.key_prefix,
        key_hash: input.key_hash,
      }))
      const result = await createMerchantPublicKey({ merchantId: "merchant-1" })
      expect(result.key).toMatch(/^pk_live_[0-9a-f]{64}$/)
    })

    it("stores a prefix that starts with pk_live_ and has 12 trailing hex chars", async () => {
      insertMerchantPublicKey.mockImplementation(async (input: typeof baseRecord) => ({
        ...baseRecord,
        key_prefix: input.key_prefix,
        key_hash: input.key_hash,
      }))
      const result = await createMerchantPublicKey({ merchantId: "merchant-1" })
      expect(result.prefix).toMatch(/^pk_live_[0-9a-f]{12}$/)
    })

    it("passes name through to the DB layer", async () => {
      insertMerchantPublicKey.mockResolvedValue({ ...baseRecord, name: "My Browser Key" })
      await createMerchantPublicKey({ merchantId: "merchant-1", name: "My Browser Key" })
      expect(insertMerchantPublicKey).toHaveBeenCalledWith(
        expect.objectContaining({ name: "My Browser Key" })
      )
    })

    it("stores null name when no name is provided", async () => {
      insertMerchantPublicKey.mockResolvedValue({ ...baseRecord, name: null })
      await createMerchantPublicKey({ merchantId: "merchant-1" })
      expect(insertMerchantPublicKey).toHaveBeenCalledWith(
        expect.objectContaining({ name: null })
      )
    })
  })

  describe("listMerchantPublicKeys", () => {
    it("maps DB records to PublicKeyListItem shape", async () => {
      getMerchantPublicKeys.mockResolvedValue([baseRecord])
      const result = await listMerchantPublicKeys("merchant-1")
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        id: "key-1",
        name: "Test Key",
        prefix: "pk_live_testabc123456",
        lastUsedAt: null,
        createdAt: "2026-06-13T12:00:00.000Z",
      })
    })

    it("returns an empty array when there are no keys", async () => {
      getMerchantPublicKeys.mockResolvedValue([])
      const result = await listMerchantPublicKeys("merchant-1")
      expect(result).toEqual([])
    })
  })

  describe("disableMerchantPublicKeyEngine", () => {
    it("calls disableMerchantPublicKey with id and merchantId", async () => {
      disableMerchantPublicKey.mockResolvedValue(undefined)
      await disableMerchantPublicKeyEngine("key-1", "merchant-1")
      expect(disableMerchantPublicKey).toHaveBeenCalledWith("key-1", "merchant-1")
    })
  })

  describe("verifyMerchantPublicKey", () => {
    it("returns null for a token that does not start with pk_live_", async () => {
      const result = await verifyMerchantPublicKey("pt_live_abc")
      expect(result).toBeNull()
      expect(getMerchantPublicKeyByPrefix).not.toHaveBeenCalled()
    })

    it("returns null when the prefix is not found in the DB", async () => {
      getMerchantPublicKeyByPrefix.mockResolvedValue(null)
      const result = await verifyMerchantPublicKey(
        "pk_live_notfound000000000000000000000000000000000000000000000000000000"
      )
      expect(result).toBeNull()
    })

    it("returns null when the hash does not match", async () => {
      getMerchantPublicKeyByPrefix.mockResolvedValue({
        ...baseRecord,
        key_hash: "wrong_hash_that_will_not_match",
      })
      const result = await verifyMerchantPublicKey(
        "pk_live_testabc123456aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      )
      expect(result).toBeNull()
    })

    it("returns VerifiedPublicKey when token matches the stored hash", async () => {
      // Create a real key, capture the hash computed by the engine, then verify it
      let capturedHash = ""
      let capturedPrefix = ""
      insertMerchantPublicKey.mockImplementation(
        async (input: { id: string; merchant_id: string; name: string | null; key_prefix: string; key_hash: string }) => {
          capturedHash = input.key_hash
          capturedPrefix = input.key_prefix
          return {
            id: "key-new",
            merchant_id: input.merchant_id,
            name: input.name,
            key_prefix: input.key_prefix,
            key_hash: input.key_hash,
            allowed_origins: [],
            enabled: true,
            last_used_at: null,
            created_at: "2026-06-13T12:00:00.000Z",
          }
        }
      )
      const created = await createMerchantPublicKey({ merchantId: "merchant-1" })

      getMerchantPublicKeyByPrefix.mockResolvedValue({
        id: "key-new",
        merchant_id: "merchant-1",
        name: null,
        key_prefix: capturedPrefix,
        key_hash: capturedHash,
        allowed_origins: [],
        enabled: true,
        last_used_at: null,
        created_at: "2026-06-13T12:00:00.000Z",
      })

      const result = await verifyMerchantPublicKey(created.key)
      expect(result).not.toBeNull()
      expect(result?.merchantId).toBe("merchant-1")
      expect(result?.keyId).toBe("key-new")
    })
  })
})
