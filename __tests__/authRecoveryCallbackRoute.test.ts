import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const authMocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  signOut: vi.fn(),
}))

const createServerClientMock = vi.hoisted(() => vi.fn())

vi.mock("@supabase/ssr", () => ({
  createServerClient: createServerClientMock,
}))

import { GET } from "@/app/auth/callback/route"
import { RECOVERY_COOKIE_NAME } from "@/lib/auth/recovery"

describe("password recovery callback route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMocks.signOut.mockResolvedValue({ error: null })
    createServerClientMock.mockReturnValue({ auth: authMocks })
  })

  it("rejects a callback without a PKCE code and disables caching", async () => {
    const response = await GET(new NextRequest("https://app.test/auth/callback"))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      "https://app.test/reset-password?recovery_error=invalid"
    )
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0")
    expect(authMocks.exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it("exchanges the code, forwards auth cookies, and issues a recovery marker", async () => {
    authMocks.exchangeCodeForSession.mockImplementation(async () => {
      const options = createServerClientMock.mock.calls[0][2]
      options.cookies.setAll([
        { name: "sb-test-auth-token", value: "session-value", options: { path: "/" } },
      ])
      return {
        data: { session: { access_token: "redacted" }, user: { id: "user-1" } },
        error: null,
      }
    })

    const response = await GET(
      new NextRequest("https://app.test/auth/callback?code=one-time-code")
    )

    expect(authMocks.exchangeCodeForSession).toHaveBeenCalledWith("one-time-code")
    expect(response.status).toBe(307)
    const location = new URL(response.headers.get("location")!)
    expect(location.pathname).toBe("/reset-password")
    expect(location.searchParams.get("recovery")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain("sb-test-auth-token=session-value")
    expect(setCookie).toContain(`${RECOVERY_COOKIE_NAME}=`)
    expect(setCookie).toContain("HttpOnly")
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0")
  })

  it("clears a stale marker when a recovery code is invalid or reused", async () => {
    authMocks.exchangeCodeForSession.mockResolvedValue({
      data: { session: null, user: null },
      error: { code: "flow_state_expired", status: 400 },
    })

    const response = await GET(
      new NextRequest("https://app.test/auth/callback?code=used-code", {
        headers: { cookie: `${RECOVERY_COOKIE_NAME}=stale-marker` },
      })
    )

    expect(authMocks.signOut).toHaveBeenCalledWith({ scope: "local" })
    expect(response.headers.get("location")).toBe(
      "https://app.test/reset-password?recovery_error=invalid"
    )
    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain(`${RECOVERY_COOKIE_NAME}=`)
    expect(setCookie).toContain("Max-Age=0")
  })
})
