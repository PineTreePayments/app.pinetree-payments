/**
 * Server-side LNURL-pay Lightning Address verifier (LUD-16).
 *
 * Verification steps:
 *  1. Parse user@domain from the address.
 *  2. GET https://domain/.well-known/lnurlp/user
 *  3. Require HTTP 200.
 *  4. Require valid JSON.
 *  5. Require a valid LNURL-pay descriptor:
 *       - callback: non-empty string starting with http
 *       - tag: "payRequest" if present
 *       - minSendable / maxSendable: positive numbers and consistent if present
 */

const VERIFY_TIMEOUT_MS = 7000

export type LnurlPayVerificationResult =
  | { verified: true; domain: string; callbackUrl: string }
  | { verified: false; reason: string }

export async function verifyLightningAddress(
  address: string
): Promise<LnurlPayVerificationResult> {
  const trimmed = address.trim()

  // Parse user@domain — caller already validated format, but be defensive.
  const atIndex = trimmed.lastIndexOf("@")
  if (atIndex < 1 || atIndex >= trimmed.length - 1) {
    return { verified: false, reason: "Invalid Lightning Address format." }
  }

  const user = trimmed.slice(0, atIndex)
  const domain = trimmed.slice(atIndex + 1)
  const endpoint = `https://${domain}/.well-known/lnurlp/${encodeURIComponent(user)}`

  // Fetch with a hard timeout.
  let response: Response
  try {
    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS)

    try {
      response = await fetch(endpoint, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal
      })
    } finally {
      clearTimeout(timeoutHandle)
    }
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "AbortError"
    return {
      verified: false,
      reason: isTimeout
        ? "Lightning Address verification timed out. Check the address and try again."
        : "Could not reach the Lightning Address provider. Check the address or try another."
    }
  }

  if (!response.ok) {
    return {
      verified: false,
      reason: `Lightning Address verification failed (HTTP ${response.status}). Check the address or try another Lightning wallet.`
    }
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    return {
      verified: false,
      reason: "Lightning Address returned an invalid response. Check the address or try another Lightning wallet."
    }
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {
      verified: false,
      reason: "Lightning Address returned an unexpected response format."
    }
  }

  const payload = data as Record<string, unknown>

  // callback is required per LUD-16
  const callback = payload["callback"]
  if (!callback || typeof callback !== "string" || !callback.startsWith("http")) {
    return {
      verified: false,
      reason: "Lightning Address did not return a valid payment callback. Check the address or try another Lightning wallet."
    }
  }

  // tag must be "payRequest" if present
  const tag = payload["tag"]
  if (tag !== undefined && tag !== "payRequest") {
    return {
      verified: false,
      reason: "Lightning Address is not a payRequest endpoint. Check the address or try another Lightning wallet."
    }
  }

  // minSendable / maxSendable must be valid numbers if present
  const minSendable = payload["minSendable"]
  const maxSendable = payload["maxSendable"]

  if (minSendable !== undefined && (typeof minSendable !== "number" || minSendable <= 0)) {
    return {
      verified: false,
      reason: "Lightning Address returned invalid payment amount limits."
    }
  }

  if (
    maxSendable !== undefined &&
    minSendable !== undefined &&
    typeof maxSendable === "number" &&
    typeof minSendable === "number" &&
    maxSendable < minSendable
  ) {
    return {
      verified: false,
      reason: "Lightning Address returned inconsistent payment amount range."
    }
  }

  return { verified: true, domain, callbackUrl: callback }
}
