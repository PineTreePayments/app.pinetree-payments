/**
 * Shared password-recovery contract.
 *
 * This module is imported by both server routes and client components, so it
 * must stay free of Node-only imports.
 *
 * Diagnostics rule for everything in this file and its callers: log metadata
 * only. Never log authorization codes, token hashes, cookies, sessions,
 * access/refresh tokens, passwords, or email addresses.
 */

export const RECOVERY_COOKIE_NAME = "pinetree-password-recovery"

/** The only destination a recovery link is allowed to land on. */
export const RECOVERY_DEFAULT_NEXT = "/reset-password"
const RECOVERY_NEXT_ALLOWLIST = new Set<string>([RECOVERY_DEFAULT_NEXT])

/**
 * Controlled failure categories.
 *
 * `link_unusable` deliberately merges "already used" and "expired": Supabase
 * returns the same `otp_expired` code with the message "Email link is invalid
 * or has expired" for a consumed token, an expired token, and a token that
 * never existed. We only claim expiry or reuse when evidence is specific.
 */
export type RecoveryErrorCode =
  | "missing_link"
  | "malformed_link"
  | "link_unusable"
  | "link_expired"
  | "link_used"
  | "verification_failed"
  | "verifier_unavailable"
  | "rate_limited"

export const RECOVERY_ERROR_MESSAGES: Record<RecoveryErrorCode, string> = {
  missing_link:
    "This password reset link is missing its verification details. Request a new reset email.",
  malformed_link:
    "This link is not a valid PineTree password reset link. Request a new reset email.",
  link_unusable:
    "This reset link is no longer usable. It was either already used or it has expired. Request a new reset email.",
  link_expired: "This reset link has expired. Request a new reset email.",
  link_used:
    "This reset link has already been used. Request a new reset email to set your password.",
  verification_failed:
    "We could not complete the reset verification. Request a new reset email and try again.",
  verifier_unavailable:
    "This browser did not have the verification data needed to finish the reset. Request a new reset email and open it in this browser.",
  rate_limited:
    "Too many reset requests were made recently. Wait a few minutes, then request a new reset email.",
}

export function isRecoveryErrorCode(value: unknown): value is RecoveryErrorCode {
  return typeof value === "string" && value in RECOVERY_ERROR_MESSAGES
}

export function recoveryErrorMessage(value: unknown): string {
  return isRecoveryErrorCode(value)
    ? RECOVERY_ERROR_MESSAGES[value]
    : RECOVERY_ERROR_MESSAGES.verification_failed
}

/**
 * Resolves the post-verification destination against a strict allowlist so a
 * recovery link can never be turned into an open redirect. Anything that is not
 * an exact allowlisted same-origin path falls back to the default.
 */
export function sanitizeRecoveryNext(value: unknown): string {
  if (typeof value !== "string") return RECOVERY_DEFAULT_NEXT
  // Reject protocol-relative ("//host"), absolute ("https://host"), and
  // backslash-obfuscated ("/\host") targets before allowlisting.
  if (!value.startsWith("/")) return RECOVERY_DEFAULT_NEXT
  if (value.startsWith("//") || value.startsWith("/\\")) return RECOVERY_DEFAULT_NEXT
  if (value.includes("\\")) return RECOVERY_DEFAULT_NEXT
  return RECOVERY_NEXT_ALLOWLIST.has(value) ? value : RECOVERY_DEFAULT_NEXT
}

/**
 * Maps a Supabase auth error onto a controlled category.
 *
 * `otp_expired` is intentionally NOT reported as "expired" — see the note on
 * RecoveryErrorCode. Callers may pass explicit evidence when they have it.
 */
export function classifyRecoveryError(error: {
  code?: string | null
  status?: number | null
  name?: string | null
} | null): RecoveryErrorCode {
  if (!error) return "verification_failed"

  const code = error.code ?? ""

  if (code === "pkce_code_verifier_not_found" || error.name === "AuthPKCECodeVerifierMissingError") {
    return "verifier_unavailable"
  }
  if (code === "flow_state_not_found" || code === "flow_state_expired") {
    // The PKCE flow state is single-use and short-lived; a missing one means
    // the code was already redeemed or the state aged out.
    return "link_unusable"
  }
  if (code === "otp_expired" || code === "otp_disabled") {
    return "link_unusable"
  }
  if (code === "validation_failed" || code === "bad_json" || code === "bad_jwt") {
    return "malformed_link"
  }
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || error.status === 429) {
    return "rate_limited"
  }
  return "verification_failed"
}

export type RecoveryUserAgentClass = "browser" | "automated" | "unknown"

/**
 * Patterns for link scanners, mail-security rewriters, chat unfurlers and
 * scripted clients. Requests classified "automated" are never allowed to spend
 * the single-use recovery credential.
 */
const AUTOMATED_USER_AGENT_PATTERNS: RegExp[] = [
  /bot\b/i,
  /crawler/i,
  /spider/i,
  /preview/i,
  /scanner/i,
  /monitoring/i,
  /facebookexternalhit/i,
  /slack/i,
  /discord/i,
  /telegram/i,
  /whatsapp/i,
  /skypeuripreview/i,
  /google-?(web-preview|safety)/i,
  /yandex/i,
  /applebot/i,
  /ahrefs|semrush|mj12|dotbot/i,
  /safelinks|urldefense|proofpoint|mimecast|barracuda|symantec|forcepoint|trendmicro|fireeye|zscaler|netskope/i,
  /microsoft office|ms-office|office existence discovery|officeuser/i,
  /curl\//i,
  /wget/i,
  /python-requests|aiohttp|httpx/i,
  /okhttp|go-http-client|java\/|libwww|lwp::|axios\//i,
  /headlesschrome|phantomjs|puppeteer|playwright|selenium/i,
]

export function classifyRecoveryUserAgent(userAgent: string | null): RecoveryUserAgentClass {
  if (!userAgent || !userAgent.trim()) return "unknown"
  return AUTOMATED_USER_AGENT_PATTERNS.some((pattern) => pattern.test(userAgent))
    ? "automated"
    : "browser"
}

/**
 * Detects framework/browser prefetch and preview fetches, which must never
 * consume a recovery credential.
 */
export function isRecoveryPrefetch(headers: {
  get(name: string): string | null
}): boolean {
  const secPurpose = headers.get("sec-purpose") ?? ""
  if (/prefetch|prerender|preview/i.test(secPurpose)) return true
  const purpose = headers.get("purpose") ?? headers.get("x-purpose") ?? ""
  if (/prefetch|preview/i.test(purpose)) return true
  if (headers.get("x-moz") === "prefetch") return true
  // Next.js router prefetches.
  if (headers.get("next-router-prefetch")) return true
  if (headers.get("x-middleware-prefetch")) return true
  return false
}

export function newRecoveryCorrelationId(): string {
  const cryptoRef = globalThis.crypto
  if (cryptoRef && typeof cryptoRef.randomUUID === "function") {
    return cryptoRef.randomUUID()
  }
  return `rec_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

type RecoveryDiagnosticDetails = Record<string, boolean | number | string | null | undefined>

/**
 * Structured, production-safe recovery diagnostics.
 *
 * Unlike the previous implementation this runs in production — recovery
 * failures are only debuggable from deployed logs. Suppressed under test to
 * keep runner output clean.
 *
 * Keep the payload metadata-only. Never add URLs with credentials, codes,
 * token hashes, cookies, sessions, tokens, passwords, or email addresses.
 */
export function logRecoveryDiagnostic(
  stage: string,
  details: RecoveryDiagnosticDetails = {}
) {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return

  const payload: Record<string, unknown> = { scope: "auth-recovery", stage }
  for (const [key, value] of Object.entries(details)) {
    if (value !== undefined) payload[key] = value
  }
  console.info(JSON.stringify(payload))
}
