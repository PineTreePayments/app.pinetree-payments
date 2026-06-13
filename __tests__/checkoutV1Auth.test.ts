import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const { verifyMerchantApiKey } = vi.hoisted(() => ({
  verifyMerchantApiKey: vi.fn(),
}))

vi.mock("@/engine/merchantApiKeys", () => ({
  verifyMerchantApiKey,
}))

import {
  requireV1MerchantApiKey,
  requireV1MerchantApiKeyWithAnyPermission,
} from "@/lib/api/v1/auth"

function request(token?: string) {
  return new NextRequest("https://example.test/api/v1/checkout/sessions", {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
}

describe("v1 API key authentication", () => {
  beforeEach(() => {
    verifyMerchantApiKey.mockReset()
  })

  it("rejects a missing API key", async () => {
    await expect(
      requireV1MerchantApiKey(request(), "checkout.sessions:create")
    ).rejects.toMatchObject({
      status: 401,
      code: "missing_api_key",
      type: "authentication_error",
    })
  })

  it("rejects an invalid API key", async () => {
    verifyMerchantApiKey.mockResolvedValue(null)

    await expect(
      requireV1MerchantApiKey(request("pt_live_invalid"), "checkout.sessions:create")
    ).rejects.toMatchObject({
      status: 401,
      code: "invalid_api_key",
    })
  })

  it("rejects an API key without the required scope", async () => {
    verifyMerchantApiKey.mockResolvedValue({
      merchantId: "merchant-1",
      keyId: "key-1",
      permissions: ["webhooks:read"],
    })

    await expect(
      requireV1MerchantApiKey(request("pt_live_valid"), "checkout.sessions:create")
    ).rejects.toMatchObject({
      status: 403,
      code: "missing_permission",
      type: "authorization_error",
    })
  })

  it("accepts the dedicated checkout session read scope", async () => {
    verifyMerchantApiKey.mockResolvedValue({
      merchantId: "merchant-1",
      keyId: "key-1",
      permissions: ["checkout.sessions:read"],
    })

    await expect(
      requireV1MerchantApiKeyWithAnyPermission(request("pt_live_valid"), [
        "checkout.sessions:read",
        "checkout.sessions:create",
      ])
    ).resolves.toMatchObject({ merchantId: "merchant-1" })
  })

  it("accepts the create scope as a transitional read fallback", async () => {
    verifyMerchantApiKey.mockResolvedValue({
      merchantId: "merchant-1",
      keyId: "key-1",
      permissions: ["checkout.sessions:create"],
    })

    await expect(
      requireV1MerchantApiKeyWithAnyPermission(request("pt_live_valid"), [
        "checkout.sessions:read",
        "checkout.sessions:create",
      ])
    ).resolves.toMatchObject({ merchantId: "merchant-1" })
  })

  it("rejects retrieval when neither read nor fallback create scope is present", async () => {
    verifyMerchantApiKey.mockResolvedValue({
      merchantId: "merchant-1",
      keyId: "key-1",
      permissions: ["webhooks:read"],
    })

    await expect(
      requireV1MerchantApiKeyWithAnyPermission(request("pt_live_valid"), [
        "checkout.sessions:read",
        "checkout.sessions:create",
      ])
    ).rejects.toMatchObject({
      status: 403,
      code: "missing_permission",
    })
  })

  it("accepts checkout.sessions:write for lifecycle operations", async () => {
    verifyMerchantApiKey.mockResolvedValue({
      merchantId: "merchant-1",
      keyId: "key-1",
      permissions: ["checkout.sessions:write"],
    })

    await expect(
      requireV1MerchantApiKeyWithAnyPermission(request("pt_live_valid"), [
        "checkout.sessions:write",
        "checkout.sessions:create",
      ])
    ).resolves.toMatchObject({ merchantId: "merchant-1" })
  })
})
