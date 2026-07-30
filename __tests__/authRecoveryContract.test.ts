import { describe, expect, it } from "vitest"
import {
  classifyRecoveryError,
  classifyRecoveryUserAgent,
  isRecoveryErrorCode,
  isRecoveryPrefetch,
  RECOVERY_DEFAULT_NEXT,
  RECOVERY_ERROR_MESSAGES,
  recoveryErrorMessage,
  sanitizeRecoveryNext,
} from "@/lib/auth/recovery"

describe("recovery redirect allowlist", () => {
  it("keeps the only allowlisted destination", () => {
    expect(sanitizeRecoveryNext("/reset-password")).toBe("/reset-password")
  })

  it.each([
    "https://evil.example.com/steal",
    "//evil.example.com",
    "/\\evil.example.com",
    "/dashboard",
    "/reset-password/../admin",
    "javascript:alert(1)",
    "",
    null,
    undefined,
    123,
  ])("falls back to the default for %p", (candidate) => {
    expect(sanitizeRecoveryNext(candidate)).toBe(RECOVERY_DEFAULT_NEXT)
  })
})

describe("recovery error classification", () => {
  it("never claims expiry for Supabase's conflated otp_expired code", () => {
    // Supabase returns otp_expired with "Email link is invalid or has expired"
    // for consumed, expired, and never-existent tokens alike.
    expect(classifyRecoveryError({ code: "otp_expired", status: 403 })).toBe("link_unusable")
    expect(RECOVERY_ERROR_MESSAGES.link_unusable).not.toMatch(/^This reset link has expired/)
  })

  it("identifies a missing PKCE verifier distinctly", () => {
    expect(
      classifyRecoveryError({
        code: "pkce_code_verifier_not_found",
        status: 400,
        name: "AuthPKCECodeVerifierMissingError",
      })
    ).toBe("verifier_unavailable")
    expect(
      classifyRecoveryError({ code: null, name: "AuthPKCECodeVerifierMissingError" })
    ).toBe("verifier_unavailable")
  })

  it("maps spent or aged PKCE flow state to an unusable link", () => {
    expect(classifyRecoveryError({ code: "flow_state_not_found" })).toBe("link_unusable")
    expect(classifyRecoveryError({ code: "flow_state_expired" })).toBe("link_unusable")
  })

  it("maps malformed input and rate limits to their own categories", () => {
    expect(classifyRecoveryError({ code: "validation_failed", status: 400 })).toBe("malformed_link")
    expect(classifyRecoveryError({ code: "over_email_send_rate_limit", status: 429 })).toBe(
      "rate_limited"
    )
    expect(classifyRecoveryError({ code: "something_new", status: 500 })).toBe(
      "verification_failed"
    )
    expect(classifyRecoveryError(null)).toBe("verification_failed")
  })

  it("resolves copy for known codes and degrades safely for unknown ones", () => {
    expect(isRecoveryErrorCode("link_unusable")).toBe(true)
    expect(isRecoveryErrorCode("expired")).toBe(false)
    expect(recoveryErrorMessage("link_used")).toBe(RECOVERY_ERROR_MESSAGES.link_used)
    expect(recoveryErrorMessage("nonsense")).toBe(RECOVERY_ERROR_MESSAGES.verification_failed)
  })
})

describe("automated request detection", () => {
  it("classifies real browsers as browsers", () => {
    expect(
      classifyRecoveryUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
      )
    ).toBe("browser")
    expect(
      classifyRecoveryUserAgent(
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36"
      )
    ).toBe("browser")
  })

  it.each([
    "Mozilla/5.0 (compatible; Slackbot-LinkExpanding 1.0)",
    "Mozilla/5.0 (compatible; Googlebot/2.1)",
    "facebookexternalhit/1.1",
    "Microsoft Office Existence Discovery",
    "curl/8.4.0",
    "python-requests/2.32.3",
    "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/128.0",
    "Barracuda Sentinel (EE)",
  ])("classifies %p as automated", (agent) => {
    expect(classifyRecoveryUserAgent(agent)).toBe("automated")
  })

  it("treats an absent user agent as unknown rather than a browser", () => {
    expect(classifyRecoveryUserAgent(null)).toBe("unknown")
    expect(classifyRecoveryUserAgent("   ")).toBe("unknown")
  })
})

describe("prefetch detection", () => {
  function headers(values: Record<string, string>) {
    return new Headers(values)
  }

  it.each([
    { "sec-purpose": "prefetch;prerender" },
    { purpose: "prefetch" },
    { "x-purpose": "preview" },
    { "x-moz": "prefetch" },
    { "next-router-prefetch": "1" },
    { "x-middleware-prefetch": "1" },
  ])("detects %p", (value) => {
    expect(isRecoveryPrefetch(headers(value))).toBe(true)
  })

  it("does not flag an ordinary navigation", () => {
    expect(
      isRecoveryPrefetch(headers({ "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" }))
    ).toBe(false)
  })
})
