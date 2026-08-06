import { timingSafeEqual } from "node:crypto"

/**
 * Constant-time comparison of two hexadecimal HMAC digests.
 *
 * Server-only. Pure: no logging, no environment access, no network, no database.
 * Returns `false` for any malformed input rather than throwing, because the
 * supplied digest is attacker-controlled and a thrown error is both a different
 * response path and a timing signal.
 *
 * ── Why the explicit hex validation is load-bearing ──────────────────────────
 *
 * `Buffer.from(value, "hex")` does NOT reject invalid input — it decodes as far
 * as it can and silently truncates at the first character that is not a hex
 * digit, and it drops a trailing odd nibble. Without validation:
 *
 *   Buffer.from("<64 correct hex chars>zz", "hex")  ->  the correct 32 bytes
 *
 * That decoded buffer would match the expected digest in both length and
 * content, so a signature with appended junk would VERIFY. The same footgun
 * makes an odd-length digest ("abc") decode to a shorter buffer. Both inputs are
 * therefore rejected before any decoding happens.
 *
 * ── Case normalization contract ──────────────────────────────────────────────
 *
 * Hexadecimal is case-insensitive as an encoding: "AB" and "ab" denote the same
 * byte. Comparison is performed on decoded BYTES, so digests that differ only in
 * letter case are treated as equal. This cannot accept a wrong signature — the
 * decoded bytes must still match exactly — and it makes verification robust to a
 * proxy or client that upper-cases a header. Node's `digest("hex")` emits
 * lowercase, so in practice both sides are already lowercase.
 *
 * Surrounding whitespace is trimmed; interior whitespace is invalid and rejected.
 */

const HEX_DIGITS_ONLY = /^[0-9a-fA-F]+$/

/**
 * Validate and normalize one hexadecimal digest.
 * Returns `null` when the value cannot be a complete hex digest.
 */
function normalizeHexDigest(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null

  const trimmed = value.trim()
  if (trimmed.length === 0) return null

  // A hex digest encodes whole bytes, so its length must be even.
  if (trimmed.length % 2 !== 0) return null

  // Reject the whole value if ANY character is not a hex digit. Partial decoding
  // is what would otherwise let appended junk through.
  if (!HEX_DIGITS_ONLY.test(trimmed)) return null

  return trimmed
}

/**
 * Compare a supplied hexadecimal digest against the expected one in constant
 * time relative to their contents.
 *
 * @param expectedHex digest computed locally from the raw request body
 * @param suppliedHex digest supplied by the caller (untrusted)
 */
export function verifyHexHmac(
  expectedHex: string | null | undefined,
  suppliedHex: string | null | undefined
): boolean {
  const expected = normalizeHexDigest(expectedHex)
  const supplied = normalizeHexDigest(suppliedHex)

  if (expected === null || supplied === null) return false

  const expectedBytes = Buffer.from(expected, "hex")
  const suppliedBytes = Buffer.from(supplied, "hex")

  // An empty digest can never be a valid HMAC, and `timingSafeEqual` throws on a
  // length mismatch — so both are settled before it is called.
  if (expectedBytes.length === 0) return false
  if (expectedBytes.length !== suppliedBytes.length) return false

  return timingSafeEqual(suppliedBytes, expectedBytes)
}
