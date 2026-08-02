/**
 * Shift4 Payment Platform REST API - centralized redaction.
 *
 * This is the ONLY place Shift4 request/response material is prepared for
 * logging or diagnostics. No route, engine module, or wrapper may log a Shift4
 * request or response object directly.
 *
 * PineTree must never receive, proxy, persist, log, inspect, or serialize PAN,
 * CVV/CSC input, track data, PIN data, or encrypted card blobs. Raw cardholder
 * data goes from the customer browser into Shift4's i4Go iframe only. The PAN
 * and security-code keys are redacted here as defense in depth: if such a field
 * ever appears in a payload, it must not be able to reach a log.
 *
 * Redaction is key-name based and recursive, so it holds even when Shift4 adds
 * fields PineTree does not yet model.
 */

export const SHIFT4_REDACTED = "[redacted]" as const

/**
 * Header names whose values must never appear in a log.
 * `AccessToken` is the merchant credential; `Authorization` covers the
 * HMAC-SHA256 scheme.
 */
const REDACTED_HEADER_NAMES = new Set([
  "accesstoken",
  "authorization",
  "authtoken",
  "clientguid",
  "servicerolekey",
  "token",
  "proxy-authorization",
  "cookie",
  "set-cookie",
])

/**
 * Field names redacted anywhere in a request or response tree.
 *
 * Grouped by why they are sensitive:
 *  - credentials:      accessToken, authToken, clientGuid, apiPassword, apiSerialNumber
 *  - raw card data:    number, pan, maskedPAN, track1/2/3, expirationDate
 *  - verification in:  securityCode value, cvv, cvc, csc, pin/pinBlock/ksn
 *  - encrypted blobs:  extendedCardData, emv tlvData, p2pe/encrypted payloads
 *  - payment tokens:   token value, universalToken, cardBrandToken, i4Go blocks,
 *                      Apple/Google Pay wallet payloads
 *  - customer signature image data
 *
 * `securityCode.result` and `avs.result` are deliberately NOT redacted: they are
 * non-sensitive verification outcomes and are required certification evidence.
 */
const REDACTED_FIELD_NAMES = new Set([
  // Credentials
  "accesstoken", "authtoken", "clientguid", "servicerolekey", "apipassword", "apiserialnumber",
  "authorizationcode", "manualauthorizationcode", "voicecenteraccountnumber",
  // Raw cardholder data
  "number", "cardnumber", "pan", "maskedpan", "primaryaccountnumber",
  "expirationdate", "track", "track1", "track2", "track3", "trackdata",
  // Verification inputs (never the results)
  "cvv", "cvc", "csc", "cvv2", "securitycodevalue",
  "pin", "pinblock", "pinblockformat", "ksn",
  // Encrypted / device card blobs
  "extendedcarddata", "tlvdata", "encrypteddata", "encryptedcarddata",
  "p2pedata", "onguardsde", "dukpt",
  // Payment / wallet tokens
  "token", "cardtoken", "universaltoken", "cardbrandtoken", "i4go", "i4goaccessblock",
  "i4gotruetoken", "applepay", "googlepay", "paymentdata", "walletdata",
  "onlinepaymentcryptogram", "cryptogram",
  // Signature image payloads
  "signaturedata",
  // Merchant application and personal/banking data
  "applicationbody", "taxid", "ssn", "bankaccount", "routingnumber", "attachmentcontent",
  // Raw transport material
  "rawpayload", "requestbody", "responsebody",
])

/**
 * Objects whose entire subtree is replaced rather than walked, because every
 * leaf inside is sensitive and the shape may change.
 */
const REDACTED_SUBTREE_NAMES = new Set([
  "emv", "p2pe", "i4go", "applepay", "googlepay", "signature",
  "extendedcarddata", "cardbrandtoken", "headers", "rawpayload", "requestbody",
  "responsebody", "applicationbody", "attachmentcontent",
])

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "")
}

/**
 * Redact a header map. Returns presence booleans rather than values so a log
 * can still prove which headers were sent.
 */
export function redactShift4Headers(headers: Record<string, string> | Headers | undefined): Record<string, string> {
  const output: Record<string, string> = {}
  if (!headers) return output
  const entries: [string, string][] =
    headers instanceof Headers
      ? Array.from(headers.entries())
      : Object.entries(headers)

  for (const [name, value] of entries) {
    output[name] = REDACTED_HEADER_NAMES.has(name.toLowerCase())
      ? SHIFT4_REDACTED
      : String(value)
  }
  return output
}

/**
 * Recursively redact a Shift4 request or response payload.
 *
 * Depth and breadth are bounded so a hostile or malformed payload cannot turn
 * redaction into an expensive or non-terminating walk.
 */
export function redactShift4Payload(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]"
  if (value === null || value === undefined) return value
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) {
    return value.slice(0, 25).map((entry) => redactShift4Payload(entry, depth + 1))
  }
  if (typeof value !== "object") return "[unsupported]"

  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalized = normalizeKey(key)

    if (REDACTED_SUBTREE_NAMES.has(normalized)) {
      output[key] = SHIFT4_REDACTED
      continue
    }
    if (REDACTED_FIELD_NAMES.has(normalized)) {
      output[key] = SHIFT4_REDACTED
      continue
    }
    // `card.token.value` and `card.securityCode.value` are sensitive, while
    // `securityCode.result` and `avs.result` are required certification
    // evidence. Decide by the parent key instead of blanket-redacting every
    // `value` leaf, so the results survive and the secrets do not.
    if (normalized === "securitycode") {
      output[key] = redactSensitiveValueContainer(entry)
      continue
    }
    output[key] = redactShift4Payload(entry, depth + 1)
  }
  return output
}

/**
 * Redact the `value` leaf of a container while preserving non-sensitive
 * siblings such as `result` and `indicator`.
 */
function redactSensitiveValueContainer(container: unknown): unknown {
  if (!container || typeof container !== "object" || Array.isArray(container)) {
    return SHIFT4_REDACTED
  }
  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(container as Record<string, unknown>)) {
    output[key] = normalizeKey(key) === "value" ? SHIFT4_REDACTED : redactShift4Payload(entry, 1)
  }
  return output
}

/**
 * Bounded, redacted text summary of a response body for diagnostics.
 *
 * Card-number-shaped digit runs are masked before truncation so a malformed
 * non-JSON body cannot leak a PAN into a log.
 */
export function shift4SafeBodySummary(body: string | null | undefined, maxLength = 400): string | null {
  const text = String(body ?? "").trim()
  if (!text) return null

  let masked = text
  // 12-19 consecutive digits, optionally separated by spaces or hyphens.
  masked = masked.replace(/\b(?:\d[ -]?){12,19}\b/g, SHIFT4_REDACTED)

  try {
    const parsed = JSON.parse(text) as unknown
    masked = JSON.stringify(redactShift4Payload(parsed))
  } catch {
    // Not JSON. The digit mask above already applied.
  }

  return masked.length > maxLength ? `${masked.slice(0, maxLength)}...[truncated]` : masked
}

/**
 * Assert that a string carries no credential value. Used by tests and by the
 * client before attaching any text to an error.
 */
export function containsShift4Secret(text: string, secrets: (string | null | undefined)[]): boolean {
  const haystack = String(text || "")
  if (!haystack) return false
  return secrets.some((secret) => {
    const needle = String(secret || "").trim()
    return needle.length >= 8 && haystack.includes(needle)
  })
}
