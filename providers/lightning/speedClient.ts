/**
 * PineTree Speed Lightning Client
 *
 * Handles Speed API authentication and connection testing for merchant accounts.
 * Merchants connect their own Speed account via secret API key.
 *
 * Authentication: HTTP Basic Auth, secret key as username, empty password.
 * Base URL: https://api.tryspeed.com (overridable via SPEED_API_BASE_URL env).
 *
 * Test endpoint used for validation: GET /v1/payments?limit=1
 * This is a harmless read-only list. Returns 401 for invalid keys.
 * If Speed changes its API paths, update TEST_ENDPOINT and the error handling below.
 *
 * SECURITY: Never log or return the secret key. Use maskSpeedKey in all logs.
 */

const SPEED_API_BASE_URL =
  (process.env.SPEED_API_BASE_URL || "https://api.tryspeed.com").replace(/\/$/, "")

const TEST_ENDPOINT = "/v1/payments?limit=1"
const REQUEST_TIMEOUT_MS = 12_000

export type SpeedMode = "test" | "live" | "unknown"

export type SpeedConnectionResult = {
  connected: boolean
  mode: SpeedMode
  accountId: string | null
  displayName: string | null
  email: string | null
  notes: string[]
}

/**
 * Infer Speed mode from key prefix.
 * sk_test_... → test, sk_live_... → live, anything else → unknown.
 */
export function inferSpeedMode(secretKey: string): SpeedMode {
  const key = String(secretKey || "").trim()
  if (key.startsWith("sk_test_")) return "test"
  if (key.startsWith("sk_live_")) return "live"
  return "unknown"
}

/**
 * Mask a Speed secret key for safe logging.
 * Never call with the raw key in a log statement — pass the masked result only.
 */
export function maskSpeedKey(secretKey: string): string {
  const key = String(secretKey || "").trim()
  if (!key) return "***"
  if (key.length <= 12) return "***"
  return `${key.slice(0, 8)}...${key.slice(-4)}`
}

/**
 * Test a merchant's Speed secret API key by calling a read-only endpoint.
 *
 * SECURITY: The secretKey parameter is a server-only secret.
 * Never pass it to the client, log it, or include it in any response.
 *
 * Returns a SpeedConnectionResult describing connection status and inferred mode.
 * Throws if the API is unreachable or the key is clearly invalid.
 */
export async function testSpeedConnection(secretKey: string): Promise<SpeedConnectionResult> {
  const key = String(secretKey || "").trim()
  if (!key) throw new Error("Speed secret key is required")

  const mode = inferSpeedMode(key)

  // Basic Auth: base64(key:)
  const authToken = Buffer.from(`${key}:`).toString("base64")

  let response: Response
  try {
    response = await fetch(`${SPEED_API_BASE_URL}${TEST_ENDPOINT}`, {
      method: "GET",
      headers: {
        Authorization: `Basic ${authToken}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(
      message.includes("timed out") || message.includes("timeout")
        ? "Speed API request timed out — check your connection and try again"
        : `Speed API unreachable: ${message}`
    )
  }

  if (response.status === 401) {
    throw new Error(
      "Speed API key is invalid — authentication failed. Check that you copied the full secret key."
    )
  }

  if (response.status === 403) {
    throw new Error(
      "Speed API key was accepted but does not have permission to list payments. Check your key's access level in Speed."
    )
  }

  // 404 can mean no payments yet, or a changed endpoint path — treat as success for auth purposes
  // Any unexpected 5xx means Speed is temporarily unavailable
  if (response.status >= 500) {
    throw new Error(
      `Speed API returned server error ${response.status} — Speed may be temporarily unavailable`
    )
  }

  if (!response.ok && response.status !== 404) {
    throw new Error(`Speed API returned ${response.status} — check credentials and try again`)
  }

  const notes: string[] = []
  if (mode === "unknown") {
    notes.push(
      "Could not detect test or live mode from key prefix. Speed test keys start with sk_test_ and live keys with sk_live_."
    )
  }

  return {
    connected: true,
    mode,
    // Account details are not available from the payments list endpoint.
    // A future /v1/account endpoint call could populate these.
    accountId: null,
    displayName: null,
    email: null,
    notes
  }
}
