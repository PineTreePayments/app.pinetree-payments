/**
 * Strict classifier for a failed Base USDC EIP-3009 `eth_signTypedData_v4`
 * request.
 *
 * Root cause this replaces: the POS-owned Base flow (components/pos/POSLayout.tsx
 * runPosBaseFlow) used to treat every non-rejection signing failure the same
 * way — "not a rejection" was sufficient to silently start the allowance
 * two-step fallback (a second, then a third, wallet prompt) with no attempt
 * to prove the wallet actually lacked eth_signTypedData_v4 support. The
 * production incident (payment 54ca9536-a94d-438f-853c-dbd6ee089da8) failed
 * with the generic wallet message "Failed to sign message" — genuinely
 * ambiguous, not proof of anything — and got auto-fallback treatment anyway.
 *
 * Only a conclusively-classified `method_unsupported` result may trigger the
 * automatic allowance fallback. Every other non-rejection outcome must stop
 * and surface a recoverable state instead of guessing.
 */

export type BaseUsdcSigningErrorKind =
  | "user_rejected"
  | "method_unsupported"
  | "typed_data_invalid"
  | "chain_or_account_mismatch"
  | "session_disconnected"
  | "transport_error"
  | "timeout"
  | "unknown"

function readString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function collectCandidateCodes(error: unknown): Array<number | string> {
  const codes: Array<number | string> = []
  if (typeof error !== "object" || error === null) return codes
  const obj = error as Record<string, unknown>
  const push = (v: unknown) => {
    if (typeof v === "number" || typeof v === "string") codes.push(v)
  }
  push(obj.code)
  if (obj.error && typeof obj.error === "object") push((obj.error as Record<string, unknown>).code)
  if (obj.data && typeof obj.data === "object") push((obj.data as Record<string, unknown>).code)
  if (obj.cause && typeof obj.cause === "object") {
    codes.push(...collectCandidateCodes(obj.cause))
  }
  return codes
}

function collectCandidateMessages(error: unknown): string[] {
  const messages: string[] = []
  if (error instanceof Error) {
    messages.push(error.message)
    if (error.cause !== undefined) messages.push(...collectCandidateMessages(error.cause))
  } else if (typeof error === "string") {
    messages.push(error)
  } else if (typeof error === "object" && error !== null) {
    const obj = error as Record<string, unknown>
    messages.push(readString(obj.message))
    messages.push(readString(obj.shortMessage))
    if (obj.error && typeof obj.error === "object") {
      messages.push(readString((obj.error as Record<string, unknown>).message))
    }
    if (obj.data && typeof obj.data === "object") {
      messages.push(readString((obj.data as Record<string, unknown>).message))
    }
    if (obj.cause !== undefined) messages.push(...collectCandidateMessages(obj.cause))
  }
  return messages.filter(Boolean)
}

const USER_REJECTED_CODES = new Set<number | string>([4001])
// EIP-1193 "unrecognized method" plus the common JSON-RPC "method not found"
// code — both mean the wallet genuinely does not implement the method.
const METHOD_UNSUPPORTED_CODES = new Set<number | string>([-32601, 4200])
const CHAIN_MISMATCH_CODES = new Set<number | string>([4901, 4902])
const INVALID_PARAMS_CODES = new Set<number | string>([-32602])

const USER_REJECTED_PATTERNS = [
  /user rejected/i,
  /user denied/i,
  /request rejected/i,
  /\bdenied\b/i,
  /\brejected\b/i,
  /\bcancell?ed\b/i,
]

const METHOD_UNSUPPORTED_PATTERNS = [
  /method not found/i,
  /method not supported/i,
  /unsupported method/i,
  /does not support/i,
  /not implemented/i,
  /unrecognized method/i,
]

const TYPED_DATA_INVALID_PATTERNS = [
  /invalid typed ?data/i,
  /malformed/i,
  /invalid domain/i,
  /invalid types?\b/i,
  /invalid params/i,
  /could not sign/i,
  /invalid signature request/i,
]

const CHAIN_OR_ACCOUNT_MISMATCH_PATTERNS = [
  /chain mismatch/i,
  /wrong chain/i,
  /unrecognized chain/i,
  /unsupported chain/i,
  /account mismatch/i,
  /unauthorized account/i,
  /does not match (the )?(connected|active) account/i,
]

const SESSION_DISCONNECTED_PATTERNS = [
  /session (expired|disconnected|not found|topic)/i,
  /no matching key/i,
  /pending session not found/i,
  /disconnected/i,
  /pairing expired/i,
]

const TRANSPORT_ERROR_PATTERNS = [
  /network ?error/i,
  /fetch failed/i,
  /websocket/i,
  /relay/i,
  /econnreset/i,
  /failed to fetch/i,
  /socket/i,
]

const TIMEOUT_PATTERNS = [/timed? ?out/i]

function matchesAny(patterns: RegExp[], messages: string[]): boolean {
  return messages.some((message) => patterns.some((pattern) => pattern.test(message)))
}

/**
 * Classify a failed EIP-3009 `eth_signTypedData_v4` request. Pure function —
 * inspects the error's own code/message plus one level of nesting under
 * `.error`, `.data`, and `.cause` (WalletConnect JSON-RPC envelopes commonly
 * nest the real code/message under one of these).
 */
export function classifyBaseUsdcSigningError(error: unknown): BaseUsdcSigningErrorKind {
  const codes = collectCandidateCodes(error)
  const messages = collectCandidateMessages(error)

  // Definitive signals first — a numeric code is unambiguous evidence and
  // must win over word-matching on a possibly-misleading message string.
  if (codes.some((code) => USER_REJECTED_CODES.has(code))) return "user_rejected"
  if (codes.some((code) => METHOD_UNSUPPORTED_CODES.has(code))) return "method_unsupported"
  if (codes.some((code) => CHAIN_MISMATCH_CODES.has(code))) return "chain_or_account_mismatch"

  if (matchesAny(USER_REJECTED_PATTERNS, messages)) return "user_rejected"
  if (matchesAny(METHOD_UNSUPPORTED_PATTERNS, messages)) return "method_unsupported"
  if (matchesAny(SESSION_DISCONNECTED_PATTERNS, messages)) return "session_disconnected"
  if (matchesAny(CHAIN_OR_ACCOUNT_MISMATCH_PATTERNS, messages)) return "chain_or_account_mismatch"
  if (
    codes.some((code) => INVALID_PARAMS_CODES.has(code)) ||
    matchesAny(TYPED_DATA_INVALID_PATTERNS, messages)
  ) {
    return "typed_data_invalid"
  }
  if (matchesAny(TIMEOUT_PATTERNS, messages)) return "timeout"
  if (matchesAny(TRANSPORT_ERROR_PATTERNS, messages)) return "transport_error"

  // A generic, non-specific wallet failure ("Failed to sign message" and
  // similar) is NOT proof of anything — it must not be treated as
  // method_unsupported just because it isn't a rejection. This is the exact
  // production failure mode this classifier exists to stop auto-falling-back on.
  return "unknown"
}
