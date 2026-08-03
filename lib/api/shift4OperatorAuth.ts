/**
 * Shift4 sandbox operator authorization.
 *
 * The Shift4 credential-exchange and raw readiness surfaces are internal
 * testing tools. They expose credential-presence, fingerprints, correlation
 * IDs, and certification blockers, and they can spend a single-use merchant
 * Auth Token. Access is therefore narrower than "admin": it requires BOTH
 *
 *   A. PineTree's existing admin authorization, AND
 *   B. an exact match between the account's CONFIRMED primary email and the
 *      server-only `SHIFT4_OPERATOR_EMAIL`.
 *
 * Neither condition alone is sufficient. A merchant cannot pass. Another
 * PineTree admin cannot pass. The configured address without the admin role
 * cannot pass.
 *
 * ── Disclosure rules ─────────────────────────────────────────────────────────
 * The configured address is never returned to a browser, never logged, and
 * never placed in an error. Callers receive a single boolean, and unauthorized
 * requests receive one generic status that does not reveal which condition
 * failed - so the route cannot be used to probe for the operator's address or
 * to enumerate admins.
 *
 * SERVER-ONLY. `SHIFT4_OPERATOR_EMAIL` must never be exposed through
 * NEXT_PUBLIC_*.
 */

import { NextRequest } from "next/server"

import { getAdminStatusFromRequest } from "./adminAuth"

/**
 * Normalize an address for comparison.
 *
 * Trim plus lowercase only. No domain, prefix, or substring logic exists here
 * by design: authorization is exact normalized equality and nothing else.
 */
export function normalizeOperatorEmail(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase()
}

/**
 * The configured operator address, or "" when unset or blank.
 *
 * Read through a function so the value is never captured at module load and
 * never becomes part of a bundle.
 */
function configuredOperatorEmail(): string {
  return normalizeOperatorEmail(process.env.SHIFT4_OPERATOR_EMAIL)
}

/**
 * True when a Shift4 operator has been configured at all.
 *
 * Reports presence only. Environment validation uses this to require the
 * variable without ever reading its value.
 */
export function isShift4OperatorConfigured(): boolean {
  return configuredOperatorEmail().length > 0
}

/**
 * Compare a candidate address to the configured operator.
 *
 * Fails closed when the variable is missing or blank, when the candidate is
 * absent, and for anything other than exact normalized equality.
 */
export function matchesShift4Operator(candidateEmail: string | null | undefined): boolean {
  const configured = configuredOperatorEmail()
  if (!configured) return false

  const candidate = normalizeOperatorEmail(candidateEmail)
  if (!candidate) return false

  return candidate === configured
}

export type Shift4OperatorStatus = {
  /** The only fact a browser may learn. */
  authorized: boolean
  /** Present only when authorized, so a caller cannot probe for identity. */
  merchantId: string | null
}

/**
 * Resolve operator status without throwing.
 *
 * Used by the admin "who am I" surface so the client can decide whether to
 * render the operator section at all, without ever receiving the configured
 * address or learning which condition failed.
 */
export async function getShift4OperatorStatusFromRequest(
  req: NextRequest
): Promise<Shift4OperatorStatus> {
  try {
    const status = await getAdminStatusFromRequest(req)

    // Both conditions, evaluated together. `verifiedEmail` is null for API
    // keys and for accounts whose primary address is unconfirmed.
    const authorized = status.isAdmin && matchesShift4Operator(status.verifiedEmail)

    return {
      authorized,
      merchantId: authorized ? status.merchantId : null,
    }
  } catch {
    // An unauthenticated or failed lookup is simply not authorized. The
    // underlying error is swallowed so nothing about the configuration or the
    // account leaks through this path.
    return { authorized: false, merchantId: null }
  }
}

/**
 * One generic rejection for every unauthorized case.
 *
 * 404 rather than 403: to anyone who is not the configured operator these
 * surfaces should not appear to exist, and a distinguishable 403 would confirm
 * that the route is real and that some other account can reach it.
 */
function notFound(): Error & { status: number; code: string } {
  return Object.assign(new Error("Not found"), { status: 404, code: "not_found" })
}

/**
 * Require Shift4 operator authorization.
 *
 * Returns the authenticated operator's own merchant id, which is the merchant a
 * credential exchange is performed for. The identity always comes from the
 * verified session - a request body can never select a merchant or an email.
 *
 * Throws a generic 404 for every failure: not signed in, not an admin, no
 * verified email, a different address, or an unconfigured deployment.
 */
export async function requireShift4OperatorFromRequest(req: NextRequest): Promise<string> {
  const status = await getShift4OperatorStatusFromRequest(req)
  if (!status.authorized || !status.merchantId) throw notFound()
  return status.merchantId
}
