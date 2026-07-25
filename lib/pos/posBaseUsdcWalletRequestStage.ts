/**
 * Explicit wallet-request-stage guard for the POS-owned Base USDC flow
 * (components/pos/POSLayout.tsx runPosBaseFlow / executePosBaseEip3009 /
 * executePosBaseAllowancePath).
 *
 * Before this guard existed, "only one wallet request in flight" was purely
 * an emergent property of the surrounding code being a single sequential
 * async function — true today, but not an assertable invariant, and not
 * something a stale/duplicate trigger (a repeated realtime event, a second
 * poll tick, a React effect re-run, a double tap) could be checked against.
 * This makes that invariant explicit and testable, and gives every stage
 * transition an ownership record ({paymentId, intentId, attemptId}) so a
 * late continuation from a superseded attempt can be told apart from the
 * current one.
 *
 * Pure, framework-free class — same pattern as lib/pos/posBaseDuplicateGuard.ts —
 * so it can be unit-tested without rendering POSLayout.tsx, and instantiated
 * once per component via useRef the same way that guard already is.
 */

export type BaseUsdcWalletRequestStage =
  | "idle"
  | "typed_data_signing"
  | "allowance_approval"
  | "payment_sending"

export type BaseUsdcStageOwnership = {
  paymentId: string
  intentId: string
  attemptId: number
}

function sameOwnership(a: BaseUsdcStageOwnership, b: BaseUsdcStageOwnership): boolean {
  return a.paymentId === b.paymentId && a.intentId === b.intentId && a.attemptId === b.attemptId
}

export class PosBaseUsdcWalletRequestStageGuard {
  private stage: BaseUsdcWalletRequestStage = "idle"
  private owner: BaseUsdcStageOwnership | null = null

  getStage(): BaseUsdcWalletRequestStage {
    return this.stage
  }

  /**
   * Attempt to move from "idle" into the given stage under the given
   * ownership. Returns false — a strict no-op, never throws — if a request
   * is already in flight (whoever owns it, including the same owner calling
   * twice), so a caller that gets `false` back must not send a second wallet
   * request.
   */
  begin(stage: Exclude<BaseUsdcWalletRequestStage, "idle">, owner: BaseUsdcStageOwnership): boolean {
    if (this.stage !== "idle") return false
    this.stage = stage
    this.owner = owner
    return true
  }

  /** True only if `owner` is the one currently holding a non-idle stage. */
  isOwner(owner: BaseUsdcStageOwnership): boolean {
    return this.stage !== "idle" && this.owner !== null && sameOwnership(this.owner, owner)
  }

  /**
   * End the current stage (request resolved, rejected, or timed out) —
   * only the owner that began it may do this. A stale owner's `end()` call
   * (e.g. a superseded attempt's request finally settling after a newer
   * attempt has already reset the guard) is a silent no-op so it can never
   * clear a stage it doesn't own.
   */
  end(owner: BaseUsdcStageOwnership): void {
    if (!this.isOwner(owner)) return
    this.stage = "idle"
    this.owner = null
  }

  /** Unconditional reset — attempt invalidated / sale reset / cancel. */
  reset(): void {
    this.stage = "idle"
    this.owner = null
  }
}
