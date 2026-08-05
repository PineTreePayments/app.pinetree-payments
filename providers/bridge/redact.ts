/**
 * Bridge (by Stripe) - centralized redaction.
 *
 * This is the ONLY place Bridge request/response material is prepared for
 * logging or diagnostics. No route, engine module, or component may log a
 * Bridge request or response object directly.
 *
 * Bridge onboarding carries KYB material PineTree deliberately never stores:
 * legal names, personal emails, addresses, tax identifiers, dates of birth,
 * identification documents, and beneficial-owner records. Those keys are
 * redacted here as defense in depth so that if such a field ever reaches this
 * layer it still cannot reach a log.
 *
 * The hosted `kyc_link` and `tos_link` URLs are ALSO redacted: they are
 * bearer-capability URLs into a merchant's onboarding session, so a log line
 * containing one is a credential leak.
 *
 * Redaction is key-name based and recursive, so it holds even when Bridge adds
 * fields PineTree does not yet model.
 */

export const BRIDGE_REDACTED = "[redacted]" as const

/** Header names whose values must never appear in a log. */
const REDACTED_HEADER_NAMES = new Set([
  "api-key",
  "apikey",
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-webhook-signature",
])

/**
 * Field names redacted anywhere in a request or response tree.
 *
 * Grouped by why they are sensitive:
 *  - credentials:     api_key, secret, signature, public_key
 *  - capability URLs: kyc_link, tos_link, persona/hosted onboarding URLs
 *  - identity:        names, email, phone, addresses
 *  - KYB documents:   tax id, SSN, EIN, DOB, identifying information, files
 *
 * `status`, `kyc_status`, `tos_status`, `endorsements`, `requirements_due`,
 * and `rejection_reasons[].reason` are deliberately NOT redacted: they are
 * non-sensitive state PineTree must be able to diagnose.
 */
const REDACTED_FIELD_NAMES = new Set([
  // Credentials and verification material
  "apikey", "api_key", "secret", "clientsecret", "signature", "publickey", "privatekey",
  // Bearer-capability onboarding URLs
  "kyclink", "toslink", "hostedurl", "redirecturi", "url", "link",
  // Personal and business identity.
  // A BARE `name` is deliberately not redacted: in Bridge payloads it is the
  // endorsement/requirement identifier ("base", "sepa"), which is required
  // diagnostic material. Every key that actually carries a person's or a
  // business's name is listed explicitly below.
  "fullname", "firstname", "middlename", "lastname", "legalname",
  "businesslegalname", "transliteratedfirstname", "transliteratedmiddlename",
  "transliteratedlastname", "transliteratedbusinesslegalname",
  "email", "phone", "phonenumber",
  // Government identifiers and dates of birth
  "taxid", "taxidentificationnumber", "ssn", "ein", "birthdate", "dateofbirth", "dob",
  "idnumber", "identificationnumber", "registrationnumber", "nationalid",
  // Address material
  "address", "streetline1", "streetline2", "postalcode", "city", "subdivision",
  // Raw transport material
  "rawpayload", "requestbody", "responsebody",
])

/**
 * Objects whose entire subtree is replaced rather than walked, because every
 * leaf inside is sensitive and the shape may change as Bridge evolves.
 */
const REDACTED_SUBTREE_NAMES = new Set([
  "identifyinginformation", "documents", "document", "address", "registeredaddress",
  "physicaladdress", "ultimatebeneficialowners", "associatedpersons", "owners",
  "accountowner", "signedagreement", "headers", "rawpayload", "requestbody", "responsebody",
])

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "")
}

/**
 * Redact a header map. Returns the real value only for non-sensitive headers,
 * so a log can still prove which headers were sent without exposing any.
 */
export function redactBridgeHeaders(
  headers: Record<string, string> | Headers | undefined
): Record<string, string> {
  const output: Record<string, string> = {}
  if (!headers) return output

  const entries: [string, string][] =
    headers instanceof Headers ? Array.from(headers.entries()) : Object.entries(headers)

  for (const [name, value] of entries) {
    output[name] = REDACTED_HEADER_NAMES.has(name.toLowerCase()) ? BRIDGE_REDACTED : String(value)
  }
  return output
}

/**
 * Recursively redact a Bridge request or response payload.
 *
 * Depth and breadth are bounded so a hostile or malformed payload cannot turn
 * redaction into an expensive or non-terminating walk.
 */
export function redactBridgePayload(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]"
  if (value === null || value === undefined) return value
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) {
    return value.slice(0, 25).map((entry) => redactBridgePayload(entry, depth + 1))
  }
  if (typeof value !== "object") return "[unsupported]"

  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalized = normalizeKey(key)

    if (REDACTED_SUBTREE_NAMES.has(normalized) || REDACTED_FIELD_NAMES.has(normalized)) {
      output[key] = BRIDGE_REDACTED
      continue
    }
    output[key] = redactBridgePayload(entry, depth + 1)
  }
  return output
}

/**
 * Bounded, redacted text summary of a response body for diagnostics.
 *
 * Email-shaped and long-digit-run text is masked before truncation so a
 * malformed non-JSON body cannot leak an address or a tax identifier.
 */
export function bridgeSafeBodySummary(body: string | null | undefined, maxLength = 400): string | null {
  const text = String(body ?? "").trim()
  if (!text) return null

  let masked: string
  try {
    masked = JSON.stringify(redactBridgePayload(JSON.parse(text) as unknown))
  } catch {
    // Not JSON: fall back to pattern masking on the raw text.
    masked = text
      .replace(/[^\s@]+@[^\s@]+\.[^\s@]{2,}/g, BRIDGE_REDACTED)
      .replace(/\b\d{9,}\b/g, BRIDGE_REDACTED)
  }

  return masked.length > maxLength ? `${masked.slice(0, maxLength)}...[truncated]` : masked
}

/**
 * Assert that a string carries no configured secret. Used by tests and before
 * attaching any text to an error.
 */
export function containsBridgeSecret(text: string, secrets: (string | null | undefined)[]): boolean {
  const haystack = String(text || "")
  if (!haystack) return false
  return secrets.some((secret) => {
    const needle = String(secret || "").trim()
    return needle.length >= 8 && haystack.includes(needle)
  })
}
