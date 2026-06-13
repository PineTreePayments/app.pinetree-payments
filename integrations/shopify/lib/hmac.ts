import { createHmac, timingSafeEqual } from "node:crypto"

// Verify the X-Shopify-Hmac-Sha256 header on incoming webhook requests.
//
// Shopify signs the raw request body with the app's client secret via
// HMAC-SHA256 and base64-encodes the result. The rawBody argument MUST be
// the original bytes before any JSON parsing — parsing can change whitespace
// and will produce a different digest.
export function verifyShopifyWebhook(
  rawBody: string | Buffer,
  hmacHeader: string,
  clientSecret: string
): boolean {
  if (!hmacHeader) return false
  try {
    const digest = createHmac("sha256", clientSecret)
      .update(rawBody)
      .digest("base64")
    return timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader))
  } catch {
    // timingSafeEqual throws when buffer lengths differ — that means invalid.
    return false
  }
}

// Verify the HMAC on OAuth callback query parameters.
//
// Shopify signs all query params (excluding `hmac` itself), sorted
// alphabetically and joined as `key=value&key=value`, using the client
// secret. The resulting digest is hex-encoded (not base64).
export function verifyShopifyOAuthCallback(
  query: Record<string, string>,
  clientSecret: string
): boolean {
  const hmac = query["hmac"]
  if (!hmac) return false

  const message = Object.entries(query)
    .filter(([k]) => k !== "hmac")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&")

  try {
    const digest = createHmac("sha256", clientSecret)
      .update(message)
      .digest("hex")
    return timingSafeEqual(Buffer.from(digest), Buffer.from(hmac))
  } catch {
    return false
  }
}
