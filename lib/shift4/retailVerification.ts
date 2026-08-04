/**
 * Shift4 Retail connection verification — the browser-side client.
 *
 * Extracted from the React card so the security-critical behavior (single
 * dispatch, no automatic retry, no caller-supplied input, error narrowing) is a
 * pure function that can be tested directly instead of inferred from a
 * component.
 *
 * ── No caller input ──────────────────────────────────────────────────────────
 * The request carries no body. Merchant identity, channel and environment are
 * all decided by the server, so this module has no parameter that could select
 * any of them and no way to express one.
 *
 * ── No automatic retry ───────────────────────────────────────────────────────
 * Exactly one request is dispatched per call, for every outcome. A repeat is an
 * operator decision, never an automatic one.
 */

/** The only channel this verification can report. There is no selector. */
export const RETAIL_VERIFICATION_CHANNEL = "retail" as const

export const SHIFT4_RETAIL_VERIFICATION_PATH = "/api/internal/shift4/retail-verification"

/**
 * Comfortably longer than the server's own read-only lookup timeout, so the
 * client does not abandon a request Shift4 may still be answering.
 */
export const RETAIL_VERIFICATION_TIMEOUT_MS = 45_000

/** Exactly the fields the route is permitted to return. */
export type RetailVerificationResult = {
  connectionId: string
  environment: string
  channel: string
  credentialSource: string
  operation: string
  serverName: string | null
  providerDateTime: string | null
  verifiedAt: string
  correlationId: string
  capabilities: {
    restApiEnabled: boolean
    retailProcessingEnabled: boolean
  }
}

export type RetailVerificationFailure = {
  message: string
  correlationId: string | null
  /**
   * True when the operator should stop and review rather than click again:
   * either PineTree could not reach a conclusion, or the deployment/credential
   * state needs attention.
   */
  reviewRequired: boolean
}

export type RetailVerificationOutcome =
  | { status: "success"; result: RetailVerificationResult }
  | { status: "failure"; failure: RetailVerificationFailure }

export type RetailVerificationDeps = {
  getBearerToken: () => Promise<string | null>
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** Whether the operator may dispatch a verification right now. */
export function canSubmitRetailVerification(state: { submitting: boolean }): boolean {
  return !state.submitting
}

function readBoolean(value: unknown): boolean {
  return value === true
}

/**
 * Perform one Retail connection verification.
 *
 * Returns a discriminated outcome rather than throwing, so no rejection value
 * carrying request detail can escape to a caller that might render it.
 */
export async function submitRetailVerification(
  deps: RetailVerificationDeps
): Promise<RetailVerificationOutcome> {
  const bearer = await deps.getBearerToken().catch(() => null)
  if (!bearer) {
    return {
      status: "failure",
      failure: {
        message: "Your session has expired. Sign in again before verifying.",
        correlationId: null,
        reviewRequired: false,
      },
    }
  }

  const fetchImpl = deps.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    deps.timeoutMs ?? RETAIL_VERIFICATION_TIMEOUT_MS
  )

  try {
    const response = await fetchImpl(SHIFT4_RETAIL_VERIFICATION_PATH, {
      method: "POST",
      // No content-type and no body: the route accepts no caller input, so the
      // client has nothing to send.
      headers: { authorization: `Bearer ${bearer}` },
      cache: "no-store",
      signal: controller.signal,
    })

    const body = (await response.json().catch(() => null)) as
      | {
          ok?: boolean
          data?: Partial<RetailVerificationResult> & {
            capabilities?: { restApiEnabled?: unknown; retailProcessingEnabled?: unknown }
          }
          error?: { message?: string; correlationId?: string }
        }
      | null

    if (response.ok && body?.ok && body.data) {
      // Rebuilt field by field so a future server addition cannot widen what
      // the interface displays.
      return {
        status: "success",
        result: {
          connectionId: String(body.data.connectionId ?? ""),
          environment: String(body.data.environment ?? ""),
          channel: String(body.data.channel ?? ""),
          credentialSource: String(body.data.credentialSource ?? ""),
          operation: String(body.data.operation ?? ""),
          serverName: body.data.serverName ? String(body.data.serverName) : null,
          providerDateTime: body.data.providerDateTime
            ? String(body.data.providerDateTime)
            : null,
          verifiedAt: String(body.data.verifiedAt ?? ""),
          correlationId: String(body.data.correlationId ?? ""),
          capabilities: {
            restApiEnabled: readBoolean(body.data.capabilities?.restApiEnabled),
            retailProcessingEnabled: readBoolean(
              body.data.capabilities?.retailProcessingEnabled
            ),
          },
        },
      }
    }

    // Only the standard envelope's operator-safe message and correlation ID are
    // surfaced. The provider body, headers, and internals never reach here.
    return {
      status: "failure",
      failure: {
        message: body?.error?.message || "The Shift4 Retail verification did not succeed.",
        correlationId: body?.error?.correlationId ?? null,
        reviewRequired: response.status >= 500 || response.status === 409,
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
          ? "The verification timed out before Shift4 answered."
          : "The verification request could not be completed.",
        correlationId: null,
        reviewRequired: true,
      },
    }
  } finally {
    clearTimeout(timer)
  }
}
