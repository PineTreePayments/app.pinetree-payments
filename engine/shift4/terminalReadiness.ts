/**
 * Shift4 terminal readiness — the pure projection from evidence to a state.
 *
 * Separated from `readiness.ts` because the honesty rule this file enforces is
 * worth stating once, in isolation, and testing directly:
 *
 *   A terminal is "online" ONLY when a provider status operation produced
 *   current evidence saying so. A row in `merchant_terminal_readers` is
 *   PineTree's own configuration. Its `status` column is a locally written
 *   string — `configureDevice` writes "ready" for a simulated device — and it is
 *   therefore NOT evidence of anything Shift4 knows.
 *
 * Before this module, `resolveShift4Readiness` read that column directly and
 * treated the literals "online" / "active" / "connected" / "ready" as proof that
 * "A Shift4 terminal is registered and online". Locally typed configuration was
 * being reported as live provider connectivity.
 *
 * ── Why "online" is unreachable today ────────────────────────────────────────
 * The Shift4 Payment Platform REST API this integration is built on documents
 * nine operations (`SHIFT4_OPERATION_ENDPOINTS`); none of them reports terminal
 * or device status. `device.terminalId` appears only inside a TRANSACTION
 * result, which this phase must never produce. The Commerce Engine transport —
 * where a device session would live — is `DocumentBlockedShift4CommerceEngine-
 * Client`, which throws `documentation_required` because no official endpoint,
 * authentication, device-session, or payload schema was available.
 *
 * So PineTree has no way to obtain connectivity evidence, and this module says
 * so explicitly rather than inferring one. The projector still models `online`
 * and `offline` fully, so the day a documented status operation exists only the
 * EVIDENCE RESOLVER changes — not the state machine, and not its tests.
 */

/** What PineTree currently knows about a terminal's availability at Shift4. */
export type Shift4TerminalConnectivityState = "unverified" | "offline" | "online"

/** Where a connectivity claim came from. Attached to every claim, never implied. */
export type Shift4TerminalEvidenceSource =
  /** PineTree holds no provider evidence at all. */
  | "none"
  /** PineTree checked its OWN stored configuration. Says nothing about Shift4. */
  | "pinetree_local_configuration"
  /** A documented Shift4 status operation answered. Not reachable in this phase. */
  | "shift4_status_operation"

export type Shift4TerminalConnectivityEvidence = Readonly<{
  state: Shift4TerminalConnectivityState
  source: Shift4TerminalEvidenceSource
  /** When the evidence was observed; null when there is none to date. */
  observedAt: string | null
}>

/**
 * The only evidence PineTree can produce today.
 *
 * `unverified` is deliberately not `offline`: PineTree has not been told the
 * terminal is unavailable, it simply has no way to ask. Reporting "offline"
 * would be as dishonest as reporting "online".
 */
export const SHIFT4_TERMINAL_CONNECTIVITY_UNVERIFIED: Shift4TerminalConnectivityEvidence =
  Object.freeze({ state: "unverified", source: "none", observedAt: null })

/**
 * Resolve live terminal connectivity for a merchant.
 *
 * Returns "unverified" unconditionally and performs NO provider request, because
 * no documented Shift4 terminal-status operation exists in the sources this
 * integration is built from. Implemented as a function rather than a constant so
 * the seam is explicit: a future phase replaces this body, and everything
 * downstream — projector, Engine, route, UI, tests — already handles `online`
 * and `offline`.
 */
export async function resolveShift4TerminalConnectivity(
  _merchantId: string
): Promise<Shift4TerminalConnectivityEvidence> {
  void _merchantId
  return SHIFT4_TERMINAL_CONNECTIVITY_UNVERIFIED
}

/** The states the terminal capability may report. A subset of Shift4CapabilityState. */
export type Shift4TerminalReadinessState =
  | "not_configured"
  | "configured"
  | "offline"
  | "online"
  | "disabled"
  | "certification_required"
  | "blocked"
  | "enabled"

export type Shift4TerminalReadinessProjection = Readonly<{
  state: Shift4TerminalReadinessState
  ready: boolean
  reason: string
}>

export type Shift4TerminalReadinessInput = Readonly<{
  /** How many Shift4 terminal rows this merchant has configured in PineTree. */
  configuredCount: number
  /**
   * False when the configuration could not be read (a database failure).
   * Reported as its own blocked state — "not configured" would be a claim
   * PineTree cannot support when it does not actually know.
   */
  configurationAvailable: boolean
  restApiEnabled: boolean
  retailEnabled: boolean
  connectivity: Shift4TerminalConnectivityEvidence
  certified: boolean
  productionAllowed: boolean
}>

const projection = (
  state: Shift4TerminalReadinessState,
  ready: boolean,
  reason: string
): Shift4TerminalReadinessProjection => Object.freeze({ state, ready, reason })

/**
 * Project the terminal capability.
 *
 * Ordering is the contract, and each step is the ONE fact that blocks:
 *
 *   1. REST gate off              -> disabled
 *   2. configuration unreadable   -> blocked   (never "not configured")
 *   3. no terminal row            -> not_configured
 *   4. Retail gate off            -> disabled
 *   5. proved unavailable         -> offline
 *   6. no provider evidence       -> configured   <- local configuration only
 *   7. proved available, uncertified -> certification_required
 *   8. proved available, production not permitted -> blocked
 *   9. everything passes          -> enabled
 *
 * Only step 9 sets `ready`. A locally configured terminal stops at step 6 and
 * can never advance, which is the entire point.
 */
export function projectShift4TerminalReadiness(
  input: Shift4TerminalReadinessInput
): Shift4TerminalReadinessProjection {
  if (!input.restApiEnabled) {
    return projection("disabled", false, "SHIFT4_REST_ENABLED is off")
  }

  if (!input.configurationAvailable) {
    return projection("blocked", false, "Shift4 terminal configuration could not be read")
  }

  if (input.configuredCount < 1) {
    return projection("not_configured", false, "No Shift4 terminal is configured for this merchant")
  }

  if (!input.retailEnabled) {
    return projection("disabled", false, "Retail feature gate is off")
  }

  if (input.connectivity.state === "offline") {
    return projection("offline", false, "Shift4 reported this terminal as unavailable")
  }

  if (input.connectivity.state !== "online") {
    // The honest terminal state for this phase: PineTree holds the identifiers
    // and nothing more.
    return projection(
      "configured",
      false,
      "Terminal is configured in PineTree; Shift4 connectivity has not been verified"
    )
  }

  if (!input.certified) {
    return projection("certification_required", false, "Shift4 certification is not verified")
  }

  if (!input.productionAllowed) {
    return projection("blocked", false, "Production processing is not explicitly enabled")
  }

  return projection("enabled", true, "Shift4 reports this terminal available and every gate passes")
}

/**
 * Whether the terminal may be treated as a Retail processing prerequisite.
 *
 * True only for proven-online evidence. Retail card processing must not become
 * reachable because an operator typed a terminal ID into an admin form.
 */
export function isShift4TerminalOnline(
  connectivity: Shift4TerminalConnectivityEvidence
): boolean {
  return connectivity.state === "online" && connectivity.source === "shift4_status_operation"
}
