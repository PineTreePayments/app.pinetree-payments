/**
 * Reusable serializer for wallet/provider errors surfaced by the POS-owned
 * Base WalletConnect flow (components/pos/POSLayout.tsx).
 *
 * Root cause this replaces: `String(error)` on a non-Error WalletConnect
 * JSON-RPC error object (the common shape wallets actually reject with —
 * `{code, message, data}`, not an `Error` instance) collapses to the literal
 * string "[object Object]", which is exactly what production logs showed for
 * the failed EIP-3009 signature request on payment 54ca9536-a94d-438f-853c-
 * dbd6ee089da8 — destroying the one piece of evidence (code/message) needed
 * to classify the failure. This module extracts every useful field instead,
 * never throws, and redacts anything that could leak a secret, a full
 * account address, a signature, typed-data contents, or a WalletConnect URI.
 */

export type SerializedWalletError = {
  name: string | null
  message: string | null
  code: number | string | null
  data: unknown
  cause: SerializedWalletError | string | null
  stack: string | null
  walletName: string | null
  walletFamily: string | null
  requestedMethod: string | null
  chainId: string | null
  paymentId: string | null
  intentId: string | null
  attemptId: number | null
}

export type WalletErrorContext = {
  walletName?: string | null
  walletFamily?: string | null
  requestedMethod?: string | null
  chainId?: string | null
  paymentId?: string | null
  intentId?: string | null
  attemptId?: number | null
}

const MAX_STACK_LENGTH = 800
const MAX_NESTED_DEPTH = 3

// Full EVM address (40 hex chars) — masked to a short prefix/suffix rather
// than fully dropped, matching the maskedAddress convention already used
// elsewhere in this file's caller (POSLayout.tsx).
const EVM_ADDRESS_RE = /0x[a-fA-F0-9]{40}\b/g
// EIP-3009 / secp256k1 signatures (65-byte hex, 130 hex chars after 0x).
const SIGNATURE_RE = /0x[a-fA-F0-9]{130}\b/g
// WalletConnect pairing/session URIs carry the symmetric session key.
const WC_URI_RE = /wc:[^\s"']+/g

function redactString(value: string): string {
  return value
    .replace(WC_URI_RE, "[redacted-wc-uri]")
    .replace(SIGNATURE_RE, "[redacted-signature]")
    .replace(EVM_ADDRESS_RE, (addr) => `${addr.slice(0, 6)}…${addr.slice(-4)}`)
}

// Typed-data payloads (EIP-712 domain/types/message) must never be logged —
// they aren't secret in the cryptographic sense, but they're large, PII-
// adjacent (can include amounts, addresses), and never useful for
// classifying a signing *failure*. Dropped by key name wherever they appear
// in a nested error/data object, not just at the top level.
const REDACT_KEY_NAMES = new Set([
  "domain",
  "types",
  "primarytype",
  "message", // EIP-712 "message" (the typed-data body), not Error.message —
  // only stripped from nested data/cause objects below, never from the
  // top-level message field, which is extracted separately via extractMessage().
  "signature",
  "authorization",
  "privatekey",
  "secret",
])

function redactUnknown(value: unknown, depth: number): unknown {
  if (depth > MAX_NESTED_DEPTH) return "[max-depth-reached]"
  if (value === null || value === undefined) return null
  if (typeof value === "string") return redactString(value)
  if (typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => redactUnknown(entry, depth + 1))
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
      if (REDACT_KEY_NAMES.has(key.toLowerCase())) {
        out[key] = "[redacted]"
        continue
      }
      out[key] = redactUnknown(entry, depth + 1)
    }
    return out
  }
  // function, symbol, bigint, etc. — never useful, never risky to name.
  return `[${typeof value}]`
}

function extractMessage(err: unknown): string | null {
  if (err instanceof Error) return err.message || null
  if (typeof err === "string") return err || null
  if (typeof err === "object" && err !== null) {
    const direct = (err as { message?: unknown }).message
    if (typeof direct === "string" && direct) return direct
    // WalletConnect JSON-RPC envelopes sometimes nest the real message under
    // .error.message or .data.message rather than the top level.
    const nestedError = (err as { error?: { message?: unknown } }).error
    if (nestedError && typeof nestedError.message === "string" && nestedError.message) {
      return nestedError.message
    }
    const nestedData = (err as { data?: { message?: unknown } }).data
    if (nestedData && typeof nestedData.message === "string" && nestedData.message) {
      return nestedData.message
    }
  }
  return null
}

function extractCode(err: unknown): number | string | null {
  if (typeof err !== "object" || err === null) return null
  const direct = (err as { code?: unknown }).code
  if (typeof direct === "number" || typeof direct === "string") return direct
  const nestedError = (err as { error?: { code?: unknown } }).error
  if (nestedError && (typeof nestedError.code === "number" || typeof nestedError.code === "string")) {
    return nestedError.code
  }
  const nestedData = (err as { data?: { code?: unknown } }).data
  if (nestedData && (typeof nestedData.code === "number" || typeof nestedData.code === "string")) {
    return nestedData.code
  }
  return null
}

function extractName(err: unknown): string | null {
  if (err instanceof Error) return err.name || null
  if (typeof err === "object" && err !== null) {
    const name = (err as { name?: unknown }).name
    if (typeof name === "string" && name) return name
  }
  return null
}

function extractStack(err: unknown): string | null {
  if (err instanceof Error && typeof err.stack === "string") {
    return err.stack.slice(0, MAX_STACK_LENGTH)
  }
  return null
}

function extractData(err: unknown, depth: number): unknown {
  if (typeof err !== "object" || err === null) return null
  const data = (err as { data?: unknown }).data
  if (data === undefined) return null
  try {
    return redactUnknown(data, depth)
  } catch {
    return "[unserializable-data]"
  }
}

function extractCauseRaw(err: unknown): unknown {
  if (typeof err !== "object" || err === null) return null
  const cause = (err as { cause?: unknown }).cause
  return cause === undefined ? null : cause
}

/**
 * Serialize any thrown value (Error, WalletConnect JSON-RPC error object,
 * nested cause chain, or an entirely unknown shape) into a flat, redacted,
 * loggable object. Never throws.
 */
export function serializeWalletError(
  error: unknown,
  context: WalletErrorContext = {}
): SerializedWalletError {
  try {
    const causeRaw = extractCauseRaw(error)
    let cause: SerializedWalletError | string | null = null
    if (causeRaw !== null) {
      try {
        cause = serializeWalletError(causeRaw, {})
      } catch {
        cause = "[unserializable-cause]"
      }
    }

    let data: unknown = null
    try {
      data = extractData(error, 0)
    } catch {
      data = "[unserializable-data]"
    }

    // Genuinely unknown / opaque values (not an Error, not an object with
    // any recognizable field) still get a best-effort structural dump rather
    // than being collapsed to String(error) — the exact failure mode this
    // module exists to fix.
    let message = extractMessage(error)
    if (message !== null) message = redactString(message)
    if (message === null && typeof error !== "object" && typeof error !== "string") {
      message = `[${typeof error} value]`
    }
    if (message === null && typeof error === "object" && error !== null) {
      try {
        const keys = Object.keys(error as Record<string, unknown>)
        message = keys.length > 0 ? `[object with keys: ${keys.slice(0, 10).join(", ")}]` : "[empty object]"
      } catch {
        message = "[unserializable object]"
      }
    }

    return {
      name: extractName(error),
      message,
      code: extractCode(error),
      data,
      cause,
      stack: extractStack(error),
      walletName: context.walletName ?? null,
      walletFamily: context.walletFamily ?? null,
      requestedMethod: context.requestedMethod ?? null,
      chainId: context.chainId ?? null,
      paymentId: context.paymentId ?? null,
      intentId: context.intentId ?? null,
      attemptId: context.attemptId ?? null,
    }
  } catch {
    // Serialization itself must never throw or block the payment flow.
    return {
      name: null,
      message: "[error serialization failed]",
      code: null,
      data: null,
      cause: null,
      stack: null,
      walletName: context.walletName ?? null,
      walletFamily: context.walletFamily ?? null,
      requestedMethod: context.requestedMethod ?? null,
      chainId: context.chainId ?? null,
      paymentId: context.paymentId ?? null,
      intentId: context.intentId ?? null,
      attemptId: context.attemptId ?? null,
    }
  }
}
