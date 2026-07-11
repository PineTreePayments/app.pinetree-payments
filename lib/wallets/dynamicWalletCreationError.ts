// Safe classification for Dynamic WaaS wallet-creation errors (createWalletAccount).
//
// Dynamic's own error classes (DynamicError extends CustomError extends Error) never
// override `.name`, so `error.name` is the literal string "Error" for every failure
// mode - that is why the prior diagnostic (`errorName: "Error"`) carried no signal.
// The only place real information lives is `error.message`, which this module matches
// against a fixed list of Dynamic's own known, non-sensitive validation/configuration
// message constants (verified against the installed @dynamic-labs/sdk-react-core
// source) - never logging the raw message itself, since it can have arbitrary
// provider-supplied text appended (e.g. a chain list or nested error text).
export type DynamicWalletCreationSafeReason =
  | "no_enabled_chains"
  | "connector_not_found"
  | "invalid_chains"
  | "wallet_creation_failed"
  | "auth_required"
  | "network_error"
  | "unknown"

export type DynamicWalletCreationErrorClassification = {
  errorName: string | null
  errorCode: string | null
  errorType: string | null
  providerStatus: string | number | null
  safeReason: DynamicWalletCreationSafeReason
}

const MAX_ENUM_LEN = 40
const ENUM_LIKE_PATTERN = /^[A-Za-z0-9_.:-]+$/

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function sanitizeEnumLike(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_ENUM_LEN) return null
  if (!ENUM_LIKE_PATTERN.test(trimmed)) return null
  return trimmed
}

function sanitizeStatus(value: unknown): string | number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  const enumLike = sanitizeEnumLike(value)
  if (enumLike && /^[0-9]{3}$/.test(enumLike)) return enumLike
  return null
}

function firstDefined(sources: Record<string, unknown>[], key: string): unknown {
  for (const source of sources) {
    if (source[key] !== undefined && source[key] !== null) return source[key]
  }
  return undefined
}

// Exact (case-insensitive) matches against Dynamic's own constants in
// @dynamic-labs/sdk-react-core's useDynamicWaas/constants.js - INVALID_CHAINS_ERROR and
// WALLET_CREATION_FAILED_ERROR are prefixes (Dynamic appends chain names/nested error
// text after a colon), so those match on prefix only.
const SAFE_MESSAGE_RULES: Array<{ pattern: RegExp; reason: DynamicWalletCreationSafeReason }> = [
  { pattern: /^no enabled embedded wallet chains/i, reason: "no_enabled_chains" },
  { pattern: /^dynamic waas connector not found/i, reason: "connector_not_found" },
  { pattern: /^the following chains are not enabled for embedded wallets/i, reason: "invalid_chains" },
  { pattern: /^failed to create wallet account for the following chains/i, reason: "wallet_creation_failed" },
  { pattern: /auth(entication)?\s*(token|required)/i, reason: "auth_required" },
  { pattern: /network|timeout|fetch failed|connection/i, reason: "network_error" },
]

function classifySafeReasonFromMessage(message: unknown): DynamicWalletCreationSafeReason {
  if (typeof message !== "string" || !message) return "unknown"
  for (const rule of SAFE_MESSAGE_RULES) {
    if (rule.pattern.test(message)) return rule.reason
  }
  return "unknown"
}

/**
 * Walks error -> cause -> cause.cause looking for code/errorCode/error_code/name/
 * status/statusCode/type/reason, sanitizes every value to a short enum-like string or
 * bounded numeric status, and classifies the message (never logged verbatim) against a
 * fixed safe-reason enum. Nothing here can emit an email, address, JWT, token, user id,
 * merchant id, private key, full error object, stack, or arbitrary provider response.
 */
export function classifyDynamicWalletCreationError(error: unknown): DynamicWalletCreationErrorClassification {
  const level0 = toRecord(error)
  const level1 = toRecord(level0.cause)
  const level2 = toRecord(level1.cause)
  const sources = [level0, level1, level2]

  const name = firstDefined(sources, "name")
  const code = firstDefined(sources, "code") ?? firstDefined(sources, "errorCode") ?? firstDefined(sources, "error_code")
  const type = firstDefined(sources, "type") ?? firstDefined(sources, "reason")
  const status = firstDefined(sources, "status") ?? firstDefined(sources, "statusCode")
  const message = typeof level0.message === "string" ? level0.message : null

  return {
    errorName: sanitizeEnumLike(name),
    errorCode: sanitizeEnumLike(code),
    errorType: sanitizeEnumLike(type),
    providerStatus: sanitizeStatus(status),
    safeReason: classifySafeReasonFromMessage(message),
  }
}
