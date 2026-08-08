/**
 * PineTree Engine - settlement-provider drain -> canonical withdrawal state.
 *
 * A PURE mapping. No I/O, no database writes, no provider calls.
 *
 * ── The rule this module exists to enforce ───────────────────────────────────
 * For a bank withdrawal, a confirmed source-chain transaction proves only that
 * the merchant's USDC reached the settlement provider. It is NOT payout
 * evidence. The withdrawal stays PROCESSING until the provider reports a
 * completed payout, and nothing else may confirm it.
 *
 * Every state is mapped deliberately rather than flattened:
 *   - in-flight states keep the withdrawal PROCESSING;
 *   - a completed payout is the only path to CONFIRMED;
 *   - a returned, refunded, undeliverable, or canceled payout is a verified
 *     FAILURE, never a silent success;
 *   - `error` is UNKNOWN, not failure: it needs a lookup, not a verdict;
 *   - an unrecognized value changes nothing at all.
 */

import type { BridgeDrainState } from "@/providers/bridge/types"
import type { WalletWithdrawalStatus } from "@/database/walletWithdrawalRequests"

export type DrainLifecycleOutcome = {
  /**
   * The canonical withdrawal status this evidence supports, or null when the
   * evidence is not strong enough to move the withdrawal at all.
   */
  status: WalletWithdrawalStatus | null
  /** True only for evidence of a completed bank payout. */
  terminalSuccess: boolean
  /** True for a verified terminal failure of the payout. */
  terminalFailure: boolean
  /**
   * True when the outcome cannot yet be proven either way. The withdrawal stays
   * nonterminal and reconciliation keeps checking - it is never resubmitted.
   */
  unresolved: boolean
  /** True when a human at PineTree needs to look at this. Admin-only signal. */
  requiresOperatorAction: boolean
  /** Merchant-safe copy. Never a provider status string or developer reason. */
  merchantMessage: string | null
  /** Stable PineTree error code for a failed payout. */
  errorCode: string | null
}

function inFlight(message: string | null = null): DrainLifecycleOutcome {
  return {
    status: "processing",
    terminalSuccess: false,
    terminalFailure: false,
    unresolved: false,
    requiresOperatorAction: false,
    merchantMessage: message,
    errorCode: null,
  }
}

function failed(input: {
  message: string
  errorCode: string
  requiresOperatorAction?: boolean
}): DrainLifecycleOutcome {
  return {
    status: "failed",
    terminalSuccess: false,
    terminalFailure: true,
    unresolved: false,
    requiresOperatorAction: input.requiresOperatorAction ?? false,
    merchantMessage: input.message,
    errorCode: input.errorCode,
  }
}

/**
 * Map one settlement drain state.
 *
 * `unknown` is what an unrecognized provider value normalizes to. It returns a
 * null status so the withdrawal keeps whatever canonical state it already has,
 * per the provider contract's rule against guessing.
 */
export function mapDrainStateToWithdrawal(
  state: BridgeDrainState | "unknown"
): DrainLifecycleOutcome {
  switch (state) {
    case "awaiting_funds":
      return inFlight()

    case "in_review":
      // Documented as rare and usually seconds-long. Nothing is wrong yet, and
      // there is nothing for the merchant to do.
      return inFlight("Your bank transfer is being reviewed before it is sent.")

    case "funds_received":
      return inFlight("Your funds have been received and your bank transfer is being prepared.")

    case "payment_submitted":
      // The provider explicitly warns that the reference at this stage may be
      // preliminary, so this is emphatically not confirmation.
      return inFlight("Your bank transfer has been sent and is awaiting confirmation.")

    case "payment_processed":
      return {
        status: "confirmed",
        terminalSuccess: true,
        terminalFailure: false,
        unresolved: false,
        requiresOperatorAction: false,
        merchantMessage: "Your bank transfer completed.",
        errorCode: null,
      }

    case "undeliverable":
      return failed({
        message:
          "Your bank could not accept this transfer. Check the account details on your saved bank account and try again.",
        errorCode: "BANK_PAYOUT_UNDELIVERABLE",
      })

    case "returned":
      return failed({
        message: "Your bank returned this transfer. Check your saved bank account details and try again.",
        errorCode: "BANK_PAYOUT_RETURNED",
      })

    case "refunded":
      // The funds went back to the merchant's own return address, so the
      // withdrawal definitively did not reach the bank.
      return failed({
        message: "This bank transfer could not be completed and the funds were returned to your wallet.",
        errorCode: "BANK_PAYOUT_REFUNDED",
      })

    case "refund_in_flight":
      // The payout failed, but the recovery is still moving. Terminal state is
      // withheld until the return itself resolves.
      return {
        ...inFlight("This bank transfer could not be completed. Your funds are being returned."),
        requiresOperatorAction: true,
      }

    case "refund_failed":
      return failed({
        message: "This bank transfer could not be completed. PineTree support is resolving it with you.",
        errorCode: "BANK_PAYOUT_REFUND_FAILED",
        requiresOperatorAction: true,
      })

    case "missing_return_policy":
      return failed({
        message: "This bank transfer could not be completed. PineTree support is resolving it with you.",
        errorCode: "BANK_PAYOUT_RETURN_BLOCKED",
        requiresOperatorAction: true,
      })

    case "canceled":
      return failed({
        message: "This bank transfer was canceled before it was sent. Your funds are being returned.",
        errorCode: "BANK_PAYOUT_CANCELED",
      })

    case "error":
      // NOT a failure. The provider states manual intervention may be needed,
      // so the outcome is unknown until a lookup resolves it.
      return {
        status: null,
        terminalSuccess: false,
        terminalFailure: false,
        unresolved: true,
        requiresOperatorAction: true,
        merchantMessage: null,
        errorCode: null,
      }

    default:
      return {
        status: null,
        terminalSuccess: false,
        terminalFailure: false,
        unresolved: true,
        requiresOperatorAction: false,
        merchantMessage: null,
        errorCode: null,
      }
  }
}

/**
 * Drain states, in the order the provider documents them progressing through.
 *
 * Used to reject an out-of-order delivery: a drain never moves backwards, so a
 * late `funds_received` must not overwrite a stored `payment_processed`.
 * States off the forward path (returns, errors) carry rank -1 and are compared
 * by timestamp instead.
 */
const DRAIN_FORWARD_RANK: Partial<Record<BridgeDrainState, number>> = {
  awaiting_funds: 0,
  in_review: 1,
  funds_received: 2,
  payment_submitted: 3,
  payment_processed: 4,
}

export function drainForwardRank(state: BridgeDrainState | "unknown"): number {
  return DRAIN_FORWARD_RANK[state as BridgeDrainState] ?? -1
}

/**
 * True when incoming drain evidence is older than what PineTree already
 * applied, and must therefore be retained but not applied.
 *
 * Two independent guards, because either can fire alone:
 *   - forward-path regression (both states are on the documented progression);
 *   - timestamp regression (anything else, including the return states).
 */
export function isStaleDrainEvidence(input: {
  storedState: BridgeDrainState | "unknown" | null
  incomingState: BridgeDrainState | "unknown"
  storedUpdatedAtMs: number | null
  incomingUpdatedAtMs: number | null
}): boolean {
  const storedRank = input.storedState ? drainForwardRank(input.storedState) : -1
  const incomingRank = drainForwardRank(input.incomingState)
  if (storedRank >= 0 && incomingRank >= 0 && incomingRank < storedRank) return true

  if (input.storedUpdatedAtMs !== null && input.incomingUpdatedAtMs !== null) {
    return input.incomingUpdatedAtMs < input.storedUpdatedAtMs
  }
  return false
}
