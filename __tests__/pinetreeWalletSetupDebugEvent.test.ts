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

  it("accepts the orchestrator/Speed/native-fallback events added for concurrent wallet setup", async () => {
    const { POST } = await import("@/app/api/debug/pinetree-wallet/setup-event/route")
    for (const event of [
      "wallet_setup_orchestrator_started",
      "wallet_core_setup_started",
      "wallet_speed_setup_started",
      "wallet_dynamic_external_jwt_rejected",
      "wallet_dynamic_external_identity_conflict_suspected",
      "wallet_dynamic_native_fallback_started",
      "wallet_dynamic_native_user_detected",
      "wallet_core_profile_post_started",
      "wallet_core_profile_post_success",
      "wallet_speed_setup_success",
      "wallet_speed_setup_pending",
      "wallet_speed_setup_failed",
      "wallet_setup_orchestrator_settled",
      "wallet_setup_ready",
      "wallet_setup_pending_lightning",
      "wallet_setup_failed_core",
      "wallet_setup_lightning_needs_attention",
    ]) {
      vi.clearAllMocks()
      mocks.requireMerchantAuthFromRequest.mockResolvedValue({ merchantId, email: null, source: "supabase" })
      vi.spyOn(console, "info").mockImplementation(() => undefined)
      const response = await POST(request({ event, details: { core: "started", lightning: "pending" } }))
      expect(response.status).toBe(200)
    }
  })

  it("accepts the native-auth resume events added for the resume-after-email-signin fix", async () => {
    const { POST } = await import("@/app/api/debug/pinetree-wallet/setup-event/route")
    for (const event of [
      "wallet_native_auth_resume_started",
      "wallet_native_auth_resume_timeout_reset",
      "wallet_native_auth_resume_profile_get_started",
      "wallet_native_auth_resume_profile_existing_ready",
      "wallet_native_auth_resume_core_started",
      "wallet_core_create_success",
      "wallet_wallet_page_opened_after_create",
      "wallet_setup_timeout_suppressed",
    ]) {
      vi.clearAllMocks()
      mocks.requireMerchantAuthFromRequest.mockResolvedValue({ merchantId, email: null, source: "supabase" })
      vi.spyOn(console, "info").mockImplementation(() => undefined)
      const response = await POST(request({ event, details: { reason: "needs_user_auth", phase: "failure_timer" } }))
      expect(response.status).toBe(200)
    }
  })

  it("logs the full classified wallet_dynamic_signin_failed payload (reason/errorName/errorCode/status/messageHint) safely", async () => {
    const { POST } = await import("@/app/api/debug/pinetree-wallet/setup-event/route")
    const response = await POST(request({
      event: "wallet_dynamic_signin_failed",
      details: {
        reason: "dynamic_signin_threw",
        errorName: "SecurityError",
        errorCode: "storage_denied",
        status: 0,
        messageHint: "popup_or_storage_blocked",
      },
    }))

    expect(response.status).toBe(200)
    const loggedDetails = (console.info as ReturnType<typeof vi.fn>).mock.calls[0][1].details
    expect(loggedDetails).toEqual({
      reason: "dynamic_signin_threw",
      errorName: "SecurityError",
      errorCode: "storage_denied",
      status: 0,
      messageHint: "popup_or_storage_blocked",
    })
  })

  it("drops a raw error message or stack if one is accidentally passed as a detail", async () => {
    const { POST } = await import("@/app/api/debug/pinetree-wallet/setup-event/route")
    const response = await POST(request({
      event: "wallet_dynamic_signin_failed",
      details: {
        reason: "dynamic_signin_threw",
        messageHint: "unknown_dynamic_signin_throw",
        rawMessage: "Failed to execute 'setItem' on 'Storage': at https://app.pinetree-payments.com/secret-internal-path",
        stack: "Error: boom\n    at generateAndSaveSessionKey (/app/internal.js:42:11)",
      },
    }))

    expect(response.status).toBe(200)
    const loggedDetails = (console.info as ReturnType<typeof vi.fn>).mock.calls[0][1].details
    expect(loggedDetails).toEqual({
      reason: "dynamic_signin_threw",
      messageHint: "unknown_dynamic_signin_throw",
    })
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
