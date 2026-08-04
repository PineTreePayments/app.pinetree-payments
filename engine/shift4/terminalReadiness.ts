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
 * ── How "online" became reachable ────────────────────────────────────────────
 * This module previously stated that no documented Shift4 terminal-status
 * operation existed. That is no longer true. Shift4 publishes
 * `POST /devices/getstatus` for Commerce Engine For On Premise and Commerce
 * Engine For Cloud, returning three flags: `cloudRegistered`, `cloudConnected`
 * and `offlineMode`. The state machine below was already written for that day,
 * so only the evidence resolver changed — the projector and its tests did not.
 *
 * `online` still requires the exact documented combination and nothing less.
 */

/**
 * What PineTree knows about a terminal's availability at Shift4.
 *
 * `unverified` and `unknown` are distinct on purpose: `unverified` means nobody
 * asked, `unknown` means Shift4 answered with evidence PineTree cannot read as
 * either available or unavailable (a missing flag, an undocumented string, or
 * the documented `offlineMode: "U"`).
 */
export type Shift4TerminalConnectivityState =
  | "unverified"
  | "unregistered"
  | "offline"
  | "online"
  | "unknown"

/** Where a connectivity claim came from. Attached to every claim, never implied. */
export type Shift4TerminalEvidenceSource =
  /** PineTree holds no provider evidence at all. */
  | "none"
  /** PineTree checked its OWN stored configuration. Says nothing about Shift4. */
  | "pinetree_local_configuration"
  /** A documented Shift4 status operation answered. */
  | "shift4_status_operation"

export type Shift4TerminalConnectivityEvidence = Readonly<{
  state: Shift4TerminalConnectivityState
  source: Shift4TerminalEvidenceSource
  /** When the evidence was observed; null when there is none to date. */
  observedAt: string | null
  /**
   * True when provider evidence exists but has aged past the freshness window.
   * A stale claim is never reported as current connectivity.
   */
  stale: boolean
}>

/**
 * `unverified` is deliberately not `offline`: PineTree has not been told the
 * terminal is unavailable, it simply has not asked. Reporting "offline" would
 * be as dishonest as reporting "online".
 */
export const SHIFT4_TERMINAL_CONNECTIVITY_UNVERIFIED: Shift4TerminalConnectivityEvidence =
  Object.freeze({ state: "unverified", source: "none", observedAt: null, stale: false })

/**
 * How long a `/devices/getstatus` answer may be treated as current.
 *
 * Deliberately short. A countertop terminal can lose its cloud connection
 * between one sale and the next, so an hours-old "online" is not evidence of
 * anything. Five minutes is long enough that an operator who checks the
 * terminal and then starts a sale is not re-checking constantly, and short
 * enough that a stale claim cannot survive a coffee break.
 *
 * PineTree does NOT poll to keep this fresh. Expiry downgrades the claim; it
 * does not trigger a request.
 */
export const SHIFT4_TERMINAL_EVIDENCE_FRESHNESS_MS = 5 * 60 * 1000

/**
 * Map the three documented `/devices/getstatus` flags to a connectivity state.
 *
 * The ONLY combination that yields `online` is the documented one:
 *   cloudRegistered = Y, cloudConnected = Y, offlineMode = N
 *
 * Everything else resolves to a state that blocks processing. In particular an
 * HTTP 200 with no readable flags yields `unknown`, never `online`.
 */
export function mapShift4CloudDeviceStatus(flags: {
  cloudRegistered: "Y" | "N" | null
  cloudConnected: "Y" | "N" | null
  offlineMode: "Y" | "N" | "U" | null
}): Shift4TerminalConnectivityState {
  const { cloudRegistered, cloudConnected, offlineMode } = flags

  // Any missing or unreadable flag means PineTree was not told enough.
  if (cloudRegistered === null || cloudConnected === null || offlineMode === null) {
    return "unknown"
  }
  // Not registered is a distinct, actionable provisioning state.
  if (cloudRegistered === "N") return "unregistered"
  // Registered but unreachable, or explicitly running offline.
  if (cloudConnected === "N") return "offline"
  if (offlineMode === "Y") return "offline"
  if (cloudRegistered === "Y" && cloudConnected === "Y" && offlineMode === "N") return "online"
  // Reachable only via `offlineMode: "U"`, which Shift4 documents as unknown.
  return "unknown"
}

/**
 * Downgrade provider evidence that has aged past the freshness window.
 *
 * Returns the evidence unchanged when it is fresh, has no timestamp, or did not
 * come from a provider operation. A stale claim keeps its `observedAt` (so the
 * UI can say when it was last checked) but reports `unverified`, because the
 * question "is the terminal online right now" no longer has an answer.
 */
export function applyShift4EvidenceFreshness(
  evidence: Shift4TerminalConnectivityEvidence,
  now: Date = new Date(),
  freshnessMs: number = SHIFT4_TERMINAL_EVIDENCE_FRESHNESS_MS
): Shift4TerminalConnectivityEvidence {
  if (evidence.source !== "shift4_status_operation" || !evidence.observedAt) return evidence

  const observed = Date.parse(evidence.observedAt)
  if (!Number.isFinite(observed)) {
    return Object.freeze({ ...evidence, state: "unknown" as const, stale: true })
  }
  if (now.getTime() - observed <= freshnessMs) return evidence

  return Object.freeze({ ...evidence, state: "unverified" as const, stale: true })
}

/**
 * Persisted-status encoding.
 *
 * These values are written to `merchant_terminal_readers.status` ONLY after a
 * real `/devices/getstatus` response. They are namespaced so they can never be
 * confused with the locally written configuration strings ("configured",
 * "ready") that `configureDevice` produces — the exact confusion that used to
 * let typed configuration masquerade as provider connectivity. No migration is
 * required: the column is already free-form text.
 */
export const SHIFT4_READER_STATUS_BY_STATE = {
  online: "shift4_online",
  offline: "shift4_offline",
  unregistered: "shift4_unregistered",
  unknown: "shift4_unknown",
} as const

const STATE_BY_READER_STATUS: Record<string, Shift4TerminalConnectivityState> = {
  shift4_online: "online",
  shift4_offline: "offline",
  shift4_unregistered: "unregistered",
  shift4_unknown: "unknown",
}

/**
 * Read one reader row's stored status as connectivity evidence.
 *
 * A row whose status is NOT one of the namespaced provider values carries no
 * provider evidence at all, however plausible the string looks. "ready",
 * "online", "active" and "connected" are local configuration and are treated as
 * `unverified` — that is the honesty rule this module exists to enforce.
 */
export function readShift4ReaderConnectivity(
  reader: { status?: string | null; last_seen_at?: string | null } | null | undefined,
  now: Date = new Date()
): Shift4TerminalConnectivityEvidence {
  const state = STATE_BY_READER_STATUS[String(reader?.status ?? "").trim()]
  if (!state) return SHIFT4_TERMINAL_CONNECTIVITY_UNVERIFIED

  return applyShift4EvidenceFreshness(
    Object.freeze({
      state,
      source: "shift4_status_operation" as const,
      observedAt: reader?.last_seen_at ?? null,
      stale: false,
    }),
    now
  )
}

/** The states the terminal capability may report. A subset of Shift4CapabilityState. */
export type Shift4TerminalReadinessState =
  | "not_configured"
  | "configured"
  | "unregistered"
  | "offline"
  | "unknown"
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
 *   5. not registered with cloud  -> unregistered
 *   6. proved unavailable         -> offline
 *   7. unreadable provider answer -> unknown
 *   8. no provider evidence       -> configured   <- local configuration only
 *   9. proved available, uncertified -> certification_required
 *  10. proved available, production not permitted -> blocked
 *  11. everything passes          -> enabled
 *
 * Only step 11 sets `ready`. A locally configured terminal stops at step 8 and
 * can never advance, which is the entire point. Stale provider evidence has
 * already been downgraded to `unverified` before it reaches this function, so
 * an expired "online" also stops at step 8.
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

  if (input.connectivity.state === "unregistered") {
    return projection(
      "unregistered",
      false,
      "Shift4 reports this device is not registered with the cloud service"
    )
  }

  if (input.connectivity.state === "offline") {
    return projection("offline", false, "Shift4 reported this terminal as unavailable")
  }

  if (input.connectivity.state === "unknown") {
    return projection(
      "unknown",
      false,
      "Shift4 answered, but the device status could not be read as available or unavailable"
    )
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
 * True only for CURRENT proven-online evidence. Retail card processing must not
 * become reachable because an operator typed a terminal ID into an admin form,
 * nor because the device was online several hours ago.
 */
export function isShift4TerminalOnline(
  connectivity: Shift4TerminalConnectivityEvidence
): boolean {
  return (
    connectivity.state === "online" &&
    connectivity.source === "shift4_status_operation" &&
    !connectivity.stale
  )
}
