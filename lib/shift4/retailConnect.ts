/**
 * Shift4 Retail sandbox connection - the browser-side exchange client.
 *
 * Extracted from the React card so the security-critical behavior (single
 * dispatch, no automatic retry, auth-token lifetime, error narrowing) is a pure
 * function that can be tested directly instead of inferred from a component.
 *
 * ── Auth Token lifetime ──────────────────────────────────────────────────────
 * The token is a parameter. It is never returned, never logged, never attached
 * to an error, and never written to any storage. `onTokenConsumed` fires BEFORE
 * the request is dispatched, so the caller can clear its own state while the
 * value survives only inside this function's closure.
 *
 * ── No automatic retry ───────────────────────────────────────────────────────
 * Exactly one request is dispatched per call, for any outcome. An Auth Token is
 * single-use in production and a timed-out exchange may still have succeeded,
 * so a retry is an operator decision, never an automatic one.
 */

/** The only channel this client can request. There is no selector. */
export const RETAIL_CHANNEL = "retail" as const

/** The acknowledgement the operator must tick before the button enables. */
export const RETAIL_CONFIRMATION_TEXT =
  "I understand this will send one Retail sandbox credential exchange request to Shift4."

/**
 * A single exchange is never retried, so the client waits comfortably longer
 * than the server's own Global Timer rather than abandoning a request Shift4
 * may still be answering.
 */
export const RETAIL_CONNECT_TIMEOUT_MS = 90_000

export const SHIFT4_CONNECT_PATH = "/api/internal/shift4/connect"

/** Exactly the fields the route is permitted to return. */
export type RetailConnectResult = {
  connectionId: string
  environment: string
  channel: string
  accessTokenFingerprint: string
  connectedAt: string
  correlationId: string
}

export type RetailConnectFailure = {
  message: string
  correlationId: string | null
  /** True when the outcome is genuinely unknown and must not be retried blindly. */
  outcomeUnclear: boolean
}

export type RetailConnectOutcome =
  | { status: "success"; result: RetailConnectResult }
  | { status: "failure"; failure: RetailConnectFailure }

export type RetailConnectDeps = {
  authToken: string
  merchantTimeZone: string
  getBearerToken: () => Promise<string | null>
  /** Called once, before dispatch, so the caller can clear its own state. */
  onTokenConsumed: () => void
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/**
 * The exact request body. Channel is the module constant, never an argument, so
 * no caller can aim this at E-commerce or production.
 */
export function buildRetailConnectBody(input: {
  authToken: string
  merchantTimeZone: string
}): { authToken: string; channel: typeof RETAIL_CHANNEL; merchantTimeZone: string } {
  return {
    authToken: input.authToken,
    channel: RETAIL_CHANNEL,
    merchantTimeZone: input.merchantTimeZone,
  }
}

/** Whether the operator has satisfied every precondition for the button. */
export function canSubmitRetailConnection(state: {
  enabled: boolean
  merchantTimeZoneValid: boolean
  confirmed: boolean
  authToken: string
  submitting: boolean
  formVisible: boolean
}): boolean {
  return (
    state.enabled &&
    state.formVisible &&
    state.merchantTimeZoneValid &&
    state.confirmed &&
    !state.submitting &&
    state.authToken.trim().length > 0
  )
}

/**
 * Perform one Retail sandbox exchange.
 *
 * Returns a discriminated outcome rather than throwing, so no rejection value
 * carrying request detail can escape to a caller that might render it.
 */
export async function submitRetailConnection(
  deps: RetailConnectDeps
): Promise<RetailConnectOutcome> {
  const authToken = String(deps.authToken || "").trim()
  const merchantTimeZone = String(deps.merchantTimeZone || "").trim()

  // Consumed before anything else can fail, so the caller's state is cleared on
  // every path including an early return.
  deps.onTokenConsumed()

  if (!authToken || !merchantTimeZone) {
    return {
      status: "failure",
      failure: {
        message: "An Auth Token and a merchant time zone are both required.",
        correlationId: null,
        outcomeUnclear: false,
      },
    }
  }

  const bearer = await deps.getBearerToken().catch(() => null)
  if (!bearer) {
    return {
      status: "failure",
      failure: {
        message: "Your session has expired. Sign in again before connecting.",
        correlationId: null,
        outcomeUnclear: false,
      },
    }
  }

  const fetchImpl = deps.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? RETAIL_CONNECT_TIMEOUT_MS)

  try {
    const response = await fetchImpl(SHIFT4_CONNECT_PATH, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify(buildRetailConnectBody({ authToken, merchantTimeZone })),
    })

    const body = (await response.json().catch(() => null)) as
      | {
          ok?: boolean
          data?: RetailConnectResult
          error?: { message?: string; correlationId?: string }
        }
      | null

    if (response.ok && body?.ok && body.data) {
      // Rebuilt field by field so a future server addition cannot widen what the
      // interface displays.
      return {
        status: "success",
        result: {
          connectionId: String(body.data.connectionId ?? ""),
          environment: String(body.data.environment ?? ""),
          channel: String(body.data.channel ?? ""),
          accessTokenFingerprint: String(body.data.accessTokenFingerprint ?? ""),
          connectedAt: String(body.data.connectedAt ?? ""),
          correlationId: String(body.data.correlationId ?? ""),
        },
      }
    }

    // Only the standard envelope's operator-safe message and correlation ID are
    // surfaced. The provider body, headers, and internals never reach here.
    return {
      status: "failure",
      failure: {
        message: body?.error?.message || "The Shift4 connection request did not succeed.",
        correlationId: body?.error?.correlationId ?? null,
        outcomeUnclear: response.status >= 500,
      },
    }
  } catch (error) {
    // The thrown value is deliberately inspected only for abort, never
    // stringified: a transport failure must not become a channel for detail.
    const aborted = error instanceof Error && error.name === "AbortError"
    return {
      status: "failure",
      failure: {
        message: aborted
          ? "The request timed out before Shift4 answered."
          : "The connection request could not be completed.",
        correlationId: null,
        outcomeUnclear: true,
      },
    }
  } finally {
    clearTimeout(timer)
  }
}
