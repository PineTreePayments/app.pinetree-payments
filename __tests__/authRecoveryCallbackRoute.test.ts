import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const authMocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
}))

const createServerClientMock = vi.hoisted(() => vi.fn())

vi.mock("@supabase/ssr", () => ({
  createServerClient: createServerClientMock,
}))

import { GET as confirmGet, HEAD as confirmHead, POST as confirmPost } from "@/app/auth/confirm/route"
import { GET as callbackGet } from "@/app/auth/callback/route"
import { RECOVERY_COOKIE_NAME } from "@/lib/auth/recovery"

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"

function browserRequest(url: string, init: { headers?: Record<string, string> } = {}) {
  return new NextRequest(url, {
    headers: { "user-agent": BROWSER_UA, ...(init.headers ?? {}) },
  })
}

function verifiedSession() {
  const options = createServerClientMock.mock.calls[0][2]
  options.cookies.setAll([
    { name: "sb-test-auth-token", value: "session-value", options: { path: "/" } },
  ])
  return {
    data: { session: { access_token: "redacted" }, user: { id: "user-1" } },
    error: null,
  }
}

describe("password recovery confirm route (token hash)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createServerClientMock.mockReturnValue({ auth: authMocks })
  })

  it("verifies a recovery token hash without any PKCE verifier and issues a marker", async () => {
    authMocks.verifyOtp.mockImplementation(async () => verifiedSession())

    const response = await confirmGet(
      browserRequest(
        "https://app.test/auth/confirm?token_hash=hashed&type=recovery&next=/reset-password"
      )
    )

    expect(authMocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: "hashed",
      type: "recovery",
    })
    expect(authMocks.exchangeCodeForSession).not.toHaveBeenCalled()
    expect(response.status).toBe(303)

    const location = new URL(response.headers.get("location")!)
    expect(location.pathname).toBe("/reset-password")
    expect(location.searchParams.get("recovery")).toBeTruthy()

    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain("sb-test-auth-token=session-value")
    expect(setCookie).toContain(`${RECOVERY_COOKIE_NAME}=`)
    expect(setCookie).toContain("HttpOnly")
    expect(response.headers.get("cache-control")).toBe("no-store, private, max-age=0")
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
  })

  it("reports a missing link rather than expiry when no credential is present", async () => {
    const response = await confirmGet(browserRequest("https://app.test/auth/confirm"))

    expect(authMocks.verifyOtp).not.toHaveBeenCalled()
    expect(response.headers.get("location")).toBe(
      "https://app.test/reset-password?recovery_error=missing_link"
    )
  })

  it("rejects a non-recovery token type as malformed without verifying", async () => {
    const response = await confirmGet(
      browserRequest("https://app.test/auth/confirm?token_hash=hashed&type=magiclink")
    )

    expect(authMocks.verifyOtp).not.toHaveBeenCalled()
    expect(response.headers.get("location")).toBe(
      "https://app.test/reset-password?recovery_error=malformed_link"
    )
  })

  it("does not claim expiry for Supabase otp_expired, which also covers reuse", async () => {
    authMocks.verifyOtp.mockResolvedValue({
      data: { session: null, user: null },
      error: { code: "otp_expired", status: 403, name: "AuthApiError" },
    })

    const response = await confirmGet(
      browserRequest("https://app.test/auth/confirm?token_hash=spent&type=recovery", {
        headers: { cookie: `${RECOVERY_COOKIE_NAME}=stale-marker` },
      })
    )

    expect(response.headers.get("location")).toBe(
      "https://app.test/reset-password?recovery_error=link_unusable"
    )
    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain(`${RECOVERY_COOKIE_NAME}=`)
    expect(setCookie).toContain("Max-Age=0")
  })

  it("never consumes the credential on a HEAD probe", async () => {
    const response = await confirmHead()

    expect(authMocks.verifyOtp).not.toHaveBeenCalled()
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store, private, max-age=0")
  })

  it("never consumes the credential on a prefetch", async () => {
    const response = await confirmGet(
      browserRequest("https://app.test/auth/confirm?token_hash=hashed&type=recovery", {
        headers: { "sec-purpose": "prefetch;prerender" },
      })
    )

    expect(authMocks.verifyOtp).not.toHaveBeenCalled()
    expect(response.status).toBe(204)
  })

  it("serves an interstitial instead of spending the credential for a link scanner", async () => {
    const response = await confirmGet(
      new NextRequest("https://app.test/auth/confirm?token_hash=hashed&type=recovery", {
        headers: { "user-agent": "Mozilla/5.0 (compatible; Slackbot-LinkExpanding 1.0)" },
      })
    )

    expect(authMocks.verifyOtp).not.toHaveBeenCalled()
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toContain('method="POST"')
    expect(body).toContain("Confirm your password reset")
    expect(response.headers.get("x-robots-tag")).toContain("noindex")
  })

  it("verifies when the interstitial is submitted, which a scanner does not do", async () => {
    authMocks.verifyOtp.mockImplementation(async () => verifiedSession())

    const form = new FormData()
    form.set("token_hash", "hashed")
    form.set("type", "recovery")
    form.set("next", "/reset-password")

    const response = await confirmPost(
      new NextRequest("https://app.test/auth/confirm", {
        method: "POST",
        body: form,
        headers: { "user-agent": "Mozilla/5.0 (compatible; Slackbot-LinkExpanding 1.0)" },
      })
    )

    expect(authMocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: "hashed",
      type: "recovery",
    })
    expect(response.status).toBe(303)
  })

  it("refuses to redirect a recovery link off-origin", async () => {
    authMocks.verifyOtp.mockImplementation(async () => verifiedSession())

    const response = await confirmGet(
      browserRequest(
        "https://app.test/auth/confirm?token_hash=hashed&type=recovery&next=https%3A%2F%2Fevil.example.com%2Fsteal"
      )
    )

    const location = new URL(response.headers.get("location")!)
    expect(location.origin).toBe("https://app.test")
    expect(location.pathname).toBe("/reset-password")
  })

  it("refuses protocol-relative redirect targets", async () => {
    authMocks.verifyOtp.mockImplementation(async () => verifiedSession())

    const response = await confirmGet(
      browserRequest(
        "https://app.test/auth/confirm?token_hash=hashed&type=recovery&next=%2F%2Fevil.example.com"
      )
    )

    const location = new URL(response.headers.get("location")!)
    expect(location.origin).toBe("https://app.test")
    expect(location.pathname).toBe("/reset-password")
  })
})

describe("legacy password recovery callback route (PKCE)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createServerClientMock.mockReturnValue({ auth: authMocks })
  })

  it("still exchanges a PKCE code from an already-delivered email", async () => {
    authMocks.exchangeCodeForSession.mockImplementation(async () => verifiedSession())

    const response = await callbackGet(
      browserRequest("https://app.test/auth/callback?code=one-time-code")
    )

    expect(authMocks.exchangeCodeForSession).toHaveBeenCalledWith("one-time-code")
    expect(response.status).toBe(303)
    expect(new URL(response.headers.get("location")!).pathname).toBe("/reset-password")
  })

  it("reports an unavailable verifier instead of claiming the link expired", async () => {
    authMocks.exchangeCodeForSession.mockResolvedValue({
      data: { session: null, user: null },
      error: {
        code: "pkce_code_verifier_not_found",
        status: 400,
        name: "AuthPKCECodeVerifierMissingError",
      },
    })

    const response = await callbackGet(
      browserRequest("https://app.test/auth/callback?code=one-time-code")
    )

    expect(response.headers.get("location")).toBe(
      "https://app.test/reset-password?recovery_error=verifier_unavailable"
    )
  })
})
