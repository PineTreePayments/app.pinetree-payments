/**
 * Shift4 readiness - the browser-side read client.
 *
 * Extracted from the readiness card so the refetch behavior (one request per
 * call, session re-read every time, no polling, no Shift4 contact) is a pure
 * function that can be tested directly.
 *
 * This is a READ of PineTree's own authenticated endpoint. It never contacts
 * Shift4, and it neither sends nor receives an Auth Token, Access Token, Client
 * GUID, encrypted envelope, or provider request detail - the server projection
 * already reduces the stored credential to booleans, states, and fingerprints.
 */

/** The only endpoint this client calls. */
export const SHIFT4_READINESS_PATH = "/api/internal/shift4/readiness"

export type Shift4CapabilityView = { state: string; ready: boolean; reason: string }

export type Shift4ReadinessSnapshot = {
  authenticated: boolean
  credentialPresent: boolean
  authenticatedChannels: { retail: boolean; ecommerce: boolean }
  processingEnabled: boolean
  flags: { restApi: boolean }
  capabilities: Record<string, Shift4CapabilityView>
}

export type FetchShift4ReadinessDeps = {
  /**
   * Resolves the CURRENT PineTree session token. Called on every fetch rather
   * than captured once, so a refetch after a token refresh uses the new one.
   */
  getBearerToken: () => Promise<string | null>
  fetchImpl?: typeof fetch
}

/**
 * Fetch one readiness snapshot.
 *
 * Returns null when there is no session, the request fails, or the REST gate is
 * off - the card renders nothing in each of those cases rather than showing a
 * partial or stale projection. Exactly one request is issued per call; there is
 * no retry and no polling.
 */
export async function fetchShift4Readiness(
  deps: FetchShift4ReadinessDeps
): Promise<Shift4ReadinessSnapshot | null> {
  const token = await deps.getBearerToken().catch(() => null)
  if (!token) return null

  const fetchImpl = deps.fetchImpl ?? fetch

  try {
    const response = await fetchImpl(SHIFT4_READINESS_PATH, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    })
    if (!response.ok) return null

    const body = (await response.json().catch(() => null)) as
      | { ok?: boolean; data?: Shift4ReadinessSnapshot }
      | null

    // The REST gate being off means there is nothing meaningful to display.
    if (!body?.data?.flags?.restApi) return null
    return body.data
  } catch {
    // A failed read leaves the previous snapshot in place; it must never throw
    // into a render.
    return null
  }
}
