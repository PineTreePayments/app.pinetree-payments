/**
 * Pure decision engine for whether a POS-owned Base WalletConnect flow
 * attempt is allowed to start.
 *
 * Extracted out of components/pos/POSLayout.tsx so the actual blocking
 * decisions (production incident: a completed, disconnected Base payment
 * restarted WalletConnect from scratch — new pairing, new proposal — after
 * a stale poll tick or a realtime UPDATE event, fired by this flow's own
 * session-mirror writes to the same payment_intents row, rediscovered
 * selectedNetwork="base" once posBaseRunningRef had already been reset to
 * false by the completed attempt's own cleanup) can be tested directly,
 * without rendering the whole POS terminal component.
 *
 * Two layers:
 *  - A local, synchronous suppression set keyed by intentId+paymentId+
 *    attemptId — the cheap, always-available first line of defense.
 *  - A server-truth classifier (evaluateServerState) for the session
 *    step/txHash/payment-status facts POSLayout fetches from the two
 *    existing endpoints it already calls elsewhere in this same flow.
 */

export type PosBaseFlowGateInput = {
  sessionStep?: string | null
  sessionTxHash?: string | null
  paymentStatus?: string | null
}

export type PosBaseFlowGateResult = { blocked: false } | { blocked: true; reason: string }

const BLOCKED_PAYMENT_STATUSES = new Set(["PROCESSING", "CONFIRMED", "FAILED", "EXPIRED", "CANCELED", "INCOMPLETE"])
const BLOCKED_SESSION_STEPS = new Set(["payment_submitted", "confirming"])

export class PosBaseDuplicateGuard {
  private terminalAttempts = new Set<string>()
  private resetInProgress = false

  private key(intentId: string, paymentId: string, attemptId: number): string {
    return `${intentId}|${paymentId}|${attemptId}`
  }

  setResetInProgress(value: boolean): void {
    this.resetInProgress = value
  }

  isResetInProgress(): boolean {
    return this.resetInProgress
  }

  /** This exact attempt is done (blocked, succeeded, rejected, or errored) — never restart it. */
  markTerminal(intentId: string, paymentId: string, attemptId: number): void {
    this.terminalAttempts.add(this.key(intentId, paymentId, attemptId))
  }

  isSuppressedLocally(intentId: string, paymentId: string, attemptId: number): boolean {
    return this.terminalAttempts.has(this.key(intentId, paymentId, attemptId))
  }

  /** Clear all suppression state. Call only when a genuinely new payment intent is created. */
  reset(): void {
    this.terminalAttempts.clear()
  }

  /** Cheap, synchronous check — run before any network call or WalletConnect work. */
  evaluateLocalStart(intentId: string, paymentId: string, attemptId: number): PosBaseFlowGateResult {
    if (this.resetInProgress) return { blocked: true, reason: "pos_reset_in_progress" }
    if (this.isSuppressedLocally(intentId, paymentId, attemptId)) {
      return { blocked: true, reason: "attempt_already_terminal" }
    }
    return { blocked: false }
  }

  /** Server-truth check — payment status / session step facts fetched just before starting the flow. */
  evaluateServerState(input: PosBaseFlowGateInput): PosBaseFlowGateResult {
    if (input.sessionTxHash) return { blocked: true, reason: "payment_has_txhash" }
    if (input.sessionStep && BLOCKED_SESSION_STEPS.has(input.sessionStep)) {
      return { blocked: true, reason: `session_step_${input.sessionStep}` }
    }
    const status = String(input.paymentStatus || "").toUpperCase()
    if (status && BLOCKED_PAYMENT_STATUSES.has(status)) {
      return { blocked: true, reason: `payment_status_${status}` }
    }
    return { blocked: false }
  }
}
