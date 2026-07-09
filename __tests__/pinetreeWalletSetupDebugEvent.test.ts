import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const merchantId = "71478b11-ed12-4dbf-8466-52807995bac0"

const mocks = vi.hoisted(() => ({
  requireMerchantAuthFromRequest: vi.fn(),
  getRouteErrorStatus: vi.fn(),
}))

vi.mock("@/lib/api/merchantAuth", () => ({
  requireMerchantAuthFromRequest: mocks.requireMerchantAuthFromRequest,
  getRouteErrorStatus: mocks.getRouteErrorStatus,
}))

function request(body: unknown) {
  return new NextRequest("https://app.test/api/debug/pinetree-wallet/setup-event", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

describe("POST /api/debug/pinetree-wallet/setup-event", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mocks.requireMerchantAuthFromRequest.mockResolvedValue({ merchantId, email: null, source: "supabase" })
    mocks.getRouteErrorStatus.mockReturnValue(500)
    vi.spyOn(console, "info").mockImplementation(() => undefined)
    vi.stubEnv("NODE_ENV", "test")
    vi.stubEnv("NEXT_PUBLIC_WALLET_DEBUG_EVENTS", "true")
  })

  it("requires an authenticated merchant request", async () => {
    mocks.requireMerchantAuthFromRequest.mockRejectedValue(Object.assign(new Error("Missing bearer token"), { status: 401 }))
    mocks.getRouteErrorStatus.mockReturnValue(401)

    const { POST } = await import("@/app/api/debug/pinetree-wallet/setup-event/route")
    const response = await POST(request({ event: "wallet_page_loaded" }))

    expect(response.status).toBe(401)
  })

  it("logs whitelisted safe events with the resolved merchant id", async () => {
    const { POST } = await import("@/app/api/debug/pinetree-wallet/setup-event/route")
    const response = await POST(request({
      event: "wallet_dynamic_wallets_detected_count",
      details: { count: 0, sdkLoaded: true },
    }))

    expect(response.status).toBe(200)
    expect(console.info).toHaveBeenCalledWith(
      "[pinetree-wallets] wallet_setup_client_event",
      expect.objectContaining({
        merchantId,
        event: "wallet_dynamic_wallets_detected_count",
        details: { count: 0, sdkLoaded: true },
      })
    )
  })

  it("rejects an event name that is not on the whitelist", async () => {
    const { POST } = await import("@/app/api/debug/pinetree-wallet/setup-event/route")
    const response = await POST(request({ event: "some_arbitrary_event" }))

    expect(response.status).toBe(400)
    expect(console.info).not.toHaveBeenCalled()
  })

  it("strips emails, wallet addresses, JWT-shaped strings, long strings, and secret-looking keys", async () => {
    const { POST } = await import("@/app/api/debug/pinetree-wallet/setup-event/route")
    const response = await POST(request({
      event: "wallet_dynamic_jwt_authenticated",
      details: {
        merchantEmail: "merchant@example.com",
        walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
        solanaAddress: "5FHwkrdxntdK24hgQU8qgBjn35Y1zwhz1GZwCiK1HL7v",
        jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
        rawSecret: "sk_live_do_not_expose_this_secret_value",
        longNote: "x".repeat(200),
        token: "some-token-value",
        privateKey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567",
        safeBoolean: true,
        safeCount: 3,
        safeReason: "missing_base_and_solana",
      },
    }))

    expect(response.status).toBe(200)
    const loggedDetails = (console.info as ReturnType<typeof vi.fn>).mock.calls[0][1].details
    expect(loggedDetails).toEqual({
      safeBoolean: true,
      safeCount: 3,
      safeReason: "missing_base_and_solana",
    })
  })

  it("keeps boolean presence flags like tokenPresent even though the key contains 'token'", async () => {
    // Regression: the key-based unsafe-pattern check must only gate string values -
    // a boolean can never leak the token itself, so tokenPresent/expiresAtPresent
    // must survive sanitization even though "token" matches the unsafe key pattern.
    const { POST } = await import("@/app/api/debug/pinetree-wallet/setup-event/route")
    const response = await POST(request({
      event: "wallet_dynamic_jwt_response_received",
      details: { ok: true, tokenPresent: true, expiresAtPresent: true },
    }))

    expect(response.status).toBe(200)
    const loggedDetails = (console.info as ReturnType<typeof vi.fn>).mock.calls[0][1].details
    expect(loggedDetails).toEqual({ ok: true, tokenPresent: true, expiresAtPresent: true })
  })

  it("accepts the Dynamic sign-in checkpoint events added for the external JWT fix", async () => {
    const { POST } = await import("@/app/api/debug/pinetree-wallet/setup-event/route")
    for (const event of [
      "wallet_dynamic_jwt_response_received",
      "wallet_dynamic_signin_started",
      "wallet_dynamic_signin_returned",
      "wallet_dynamic_signin_failed",
    ]) {
      vi.clearAllMocks()
      mocks.requireMerchantAuthFromRequest.mockResolvedValue({ merchantId, email: null, source: "supabase" })
      vi.spyOn(console, "info").mockImplementation(() => undefined)
      const response = await POST(request({ event, details: { reason: "dynamic_signin_threw" } }))
      expect(response.status).toBe(200)
    }
  })

  it("drops nested objects and arrays instead of logging them raw", async () => {
    const { POST } = await import("@/app/api/debug/pinetree-wallet/setup-event/route")
    await POST(request({
      event: "wallet_profile_post_response",
      details: {
        status: 200,
        rawWallet: { address: "0xabc", chain: "EVM" },
        addressList: ["0xabc", "0xdef"],
      },
    }))

    const loggedDetails = (console.info as ReturnType<typeof vi.fn>).mock.calls[0][1].details
    expect(loggedDetails).toEqual({ status: 200 })
  })

  it("is disabled in production unless NEXT_PUBLIC_WALLET_DEBUG_EVENTS is true", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_WALLET_DEBUG_EVENTS", "false")

    const { POST } = await import("@/app/api/debug/pinetree-wallet/setup-event/route")
    const response = await POST(request({ event: "wallet_page_loaded" }))

    expect(response.status).toBe(404)
    expect(mocks.requireMerchantAuthFromRequest).not.toHaveBeenCalled()
  })

  it("stays enabled in production when NEXT_PUBLIC_WALLET_DEBUG_EVENTS is true", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_WALLET_DEBUG_EVENTS", "true")

    const { POST } = await import("@/app/api/debug/pinetree-wallet/setup-event/route")
    const response = await POST(request({ event: "wallet_page_loaded" }))

    expect(response.status).toBe(200)
  })

  it("never returns secrets or the raw request body back to the caller", async () => {
    const { POST } = await import("@/app/api/debug/pinetree-wallet/setup-event/route")
    const response = await POST(request({
      event: "wallet_dynamic_jwt_authenticated",
      details: { rawSecret: "sk_live_do_not_expose_this_secret_value" },
    }))
    const body = await response.json()

    expect(JSON.stringify(body)).not.toContain("sk_live")
    expect(body).toEqual({ ok: true })
  })
})
