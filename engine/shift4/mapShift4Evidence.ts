/**
 * PineTree Engine - Shift4 evidence mapping.
 *
 * Translates verified Shift4 evidence into a canonical transition
 * RECOMMENDATION. This module is pure: it reads nothing, writes nothing, and
 * never calls a provider. The Engine applies the recommendation through the
 * existing state machine, which remains the only authority.
 *
 * ── Lifecycle rules encoded here ─────────────────────────────────────────────
 *  - A confirmed card payment requires an accepted Shift4 response code plus
 *    authoritative evidence. Nothing else confirms.
 *  - A timeout, communication failure, blank response code, or undocumented
 *    response code is UNKNOWN - never FAILED, never CONFIRMED.
 *  - Authorization approval is NOT a captured sale. It leaves the payment
 *    mid-lifecycle and posts nothing.
 *  - Refund and void belong to the refund/adjustment lifecycle, not the payment
 *    state machine. `docs/architecture.md` is explicit: "Refunded is a
 *    post-settlement transaction adjustment; it is not a payment-state
 *    transition."
 *  - Partial approval must never confirm the full requested amount.
 */

import type {
  Shift4EvidenceInput,
  Shift4EvidenceMapping,
} from "./types"

/**
 * Operations whose approval settles money FOR THE PAYMENT and therefore may
 * drive the payment to CONFIRMED and post the ledger entry exactly once.
 *
 * `authorization` is excluded on purpose: approval holds funds, it does not
 * capture them. `refund` and `void` are excluded because they adjust a settled
 * payment rather than completing one.
 */
const PAYMENT_SETTLING_OPERATIONS = new Set(["sale", "capture"])

export function mapShift4Evidence(input: Shift4EvidenceInput): Shift4EvidenceMapping {
  const { operation, result, requestedAmountMinor } = input
  const settlesPayment = PAYMENT_SETTLING_OPERATIONS.has(operation)

  switch (result.outcome) {
    /* ── Approved: response code A or C ─────────────────────────────────── */
    case "approved": {
      // A settling approval must state EXACTLY what it approved.
      //
      // Shift4 reports a true partial approval as P, but an A/C whose amount
      // does not match must not be rubber-stamped either - in EITHER direction,
      // and not when the amount is absent. A missing approved total is no amount
      // evidence at all, and an approval for more than was requested confirms a
      // figure PineTree never asked for. Both become reconciliation exceptions
      // rather than confirmations. The database enforces the same rule
      // independently, so neither layer alone can wave a mismatch through.
      const amountMismatch = operation !== "void"
        ? classifyApprovedAmountMinor(result.approvedAmountMinor, requestedAmountMinor)
        : null

      if (amountMismatch) {
        return {
          status: null,
          attemptState: amountMismatch === "approved_amount_missing"
            ? "unresolved"
            : "reconciliation_required",
          terminal: false,
          lookupRequired: amountMismatch === "approved_amount_missing",
          reconciliationRequired: true,
          retryClassification:
            amountMismatch === "approved_amount_missing"
              ? "lookup_required"
              : "operator_review_required",
          actionRequired: amountMismatch,
          reason: APPROVED_AMOUNT_REASONS[amountMismatch],
        }
      }

      if (operation === "authorization") {
        // Funds are held, not captured. The payment stays mid-lifecycle until a
        // capture closes it, and nothing is posted to the ledger.
        return {
          status: "PROCESSING",
          attemptState: "approved",
          terminal: false,
          lookupRequired: false,
          reconciliationRequired: false,
          retryClassification: "terminal_no_retry",
          actionRequired: null,
          reason: "Authorization approved. Funds are held pending capture.",
        }
      }

      if (operation === "refund" || operation === "void") {
        // Adjustment lifecycle only. The payment's canonical status is not a
        // refund's business, so no transition is recommended.
        return {
          status: null,
          attemptState: "approved",
          terminal: true,
          lookupRequired: false,
          reconciliationRequired: false,
          retryClassification: "terminal_no_retry",
          actionRequired: null,
          reason: `${operation} approved. Recorded as a post-settlement adjustment.`,
        }
      }

      return {
        status: "CONFIRMED",
        attemptState: "approved",
        terminal: true,
        lookupRequired: false,
        reconciliationRequired: false,
        retryClassification: "terminal_no_retry",
        actionRequired: null,
        reason: `${operation} approved by Shift4.`,
      }
    }

    /* ── Partial approval: response code P ──────────────────────────────── */
    case "partial_approval": {
      const approved = result.approvedAmountMinor
      if (approved === null || approved === undefined || !Number.isSafeInteger(approved)) {
        return {
          status: null,
          attemptState: "unresolved",
          terminal: false,
          lookupRequired: true,
          reconciliationRequired: true,
          retryClassification: "lookup_required",
          actionRequired: "approved_amount_missing",
          reason: APPROVED_AMOUNT_REASONS.approved_amount_missing,
        }
      }
      const validPartial = (operation === "sale" || operation === "authorization") && approved > 0
        && approved < requestedAmountMinor
      return {
        status: validPartial ? "PROCESSING" : null,
        attemptState: validPartial ? "action_required" : "reconciliation_required",
        terminal: false,
        lookupRequired: false,
        reconciliationRequired: !validPartial,
        retryClassification: "operator_review_required",
        actionRequired: validPartial
          ? "remaining_tender_required"
          : "invalid_partial_approval_amount",
        reason: validPartial
          ? "Shift4 approved part of the sale. The payment remains processing until another tender completes the exact total."
          : "Shift4 returned partial-approval evidence with an invalid amount or operation.",
      }
    }

    /* ── Amount-inconsistent A/C or P evidence ─────────────────────── */
    case "inconsistent_approval": {
      const actionRequired = result.approvedAmountMinor !== null
        && result.approvedAmountMinor > requestedAmountMinor
        ? "approved_amount_exceeds_requested"
        : result.responseCode === "P"
          ? "invalid_partial_approval_amount"
          : "approved_amount_below_requested"
      return {
        status: null,
        attemptState: "reconciliation_required",
        terminal: false,
        lookupRequired: false,
        reconciliationRequired: true,
        retryClassification: "operator_review_required",
        actionRequired,
        reason: actionRequired === "approved_amount_exceeds_requested"
          ? APPROVED_AMOUNT_REASONS.approved_amount_exceeds_requested
          : actionRequired === "approved_amount_below_requested"
            ? APPROVED_AMOUNT_REASONS.approved_amount_below_requested
            : "Shift4 returned partial-approval evidence whose amount is not a positive amount below the request.",
      }
    }

    /* ── Verified decline: response code D ──────────────────────────────── */
    case "declined": {
      return {
        status: settlesPayment ? "FAILED" : null,
        attemptState: "declined",
        terminal: true,
        lookupRequired: false,
        reconciliationRequired: false,
        // A decline is authoritative for THIS attempt. A customer may retry
        // with a new attempt, which derives a new invoice.
        retryClassification: "new_attempt_allowed",
        actionRequired: null,
        reason: "Shift4 declined the transaction.",
      }
    }

    /* ── Expired card: response code X ──────────────────────────────────── */
    case "provider_error": {
      // `e` and `X` both land here. `X` (expired card) is a terminal card
      // problem; `e` is a general error condition whose recoverability the
      // client already classified - a documented communication error would have
      // surfaced as `unknown`, not here.
      const expiredCard = result.responseCode === "X"
      return {
        status: settlesPayment && expiredCard ? "FAILED" : null,
        attemptState: expiredCard ? "declined" : "reconciliation_required",
        terminal: expiredCard,
        lookupRequired: false,
        reconciliationRequired: !expiredCard,
        retryClassification: expiredCard ? "new_attempt_allowed" : "operator_review_required",
        actionRequired: expiredCard ? null : "provider_error_review",
        reason: expiredCard
          ? "Shift4 reported an expired card."
          : "Shift4 reported an error condition that is not a documented communication failure.",
      }
    }

    /* ── AVS/CSC failure: response code f ───────────────────────────────── */
    case "verification_failed": {
      // Shift4 only returns `f` when POSHANDLEAVSFAIL was sent, meaning the
      // interface asked to handle the failure itself. The transaction was NOT
      // approved. This is a verification decision, categorically different from
      // a transport timeout: the outcome is known, so no lookup is needed.
      return {
        status: settlesPayment ? "FAILED" : null,
        attemptState: "declined",
        terminal: true,
        lookupRequired: false,
        reconciliationRequired: false,
        retryClassification: "new_attempt_allowed",
        actionRequired: "avs_csc_verification_failed",
        reason: "Shift4 reported an AVS or CSC verification failure.",
      }
    }

    /* ── Voice referral: response code R ────────────────────────────────── */
    case "referral": {
      // Not approved. Completing a referral requires a voice authorization and
      // a Manual Authorization request, which is not in this phase's scope.
      return {
        status: null,
        attemptState: "action_required",
        terminal: false,
        lookupRequired: false,
        reconciliationRequired: true,
        retryClassification: "operator_review_required",
        actionRequired: "voice_referral_required",
        reason: "Shift4 requires a voice referral before this transaction can complete.",
      }
    }

    /* ── SCA conditions: response codes S and I ─────────────────────────── */
    case "authentication_required": {
      return {
        status: null,
        attemptState: "action_required",
        terminal: false,
        lookupRequired: false,
        reconciliationRequired: false,
        retryClassification: "operator_review_required",
        actionRequired:
          result.responseCode === "S"
            ? "sca_online_pin_required"
            : "sca_interface_switch_required",
        reason:
          "Shift4 requires strong customer authentication before this transaction can continue.",
      }
    }

    /* ── Soft decline after exemption: response code J ──────────────────── */
    case "soft_declined": {
      return {
        status: null,
        attemptState: "action_required",
        terminal: false,
        lookupRequired: false,
        reconciliationRequired: false,
        retryClassification: "new_attempt_allowed",
        actionRequired: "soft_decline_retry_with_authentication",
        reason: "The issuer rejected the requested exemption.",
      }
    }

    /* ── Invoice absent ─────────────────────────────────────────────────── */
    case "not_found": {
      // Only meaningful for a lookup. It is an observation, not permission to
      // resend - `evaluateResendPolicy` owns that decision.
      return {
        status: null,
        attemptState: "unresolved",
        terminal: false,
        lookupRequired: false,
        reconciliationRequired: true,
        retryClassification: "same_invoice_resend_candidate",
        actionRequired: null,
        reason: "Shift4 reports no transaction for this invoice.",
      }
    }

    /* ── Unknown: timeout, comm failure, blank or undocumented code ─────── */
    case "unknown":
    default: {
      // Never FAILED and never CONFIRMED. The transaction may have been
      // approved by the issuer before the failure, so only an Invoice
      // Information lookup can resolve it.
      return {
        status: null,
        attemptState: "unresolved",
        terminal: false,
        lookupRequired: true,
        reconciliationRequired: true,
        retryClassification: "lookup_required",
        actionRequired: null,
        reason:
          "Shift4 did not report a determinate outcome. The invoice must be looked up before any conclusion.",
      }
    }
  }
}

type Shift4ApprovedAmountProblem =
  | "approved_amount_missing"
  | "approved_amount_below_requested"
  | "approved_amount_exceeds_requested"

const APPROVED_AMOUNT_REASONS: Record<Shift4ApprovedAmountProblem, string> = {
  approved_amount_missing:
    "Shift4 reported an approval without an approved amount, so there is no amount evidence to confirm against.",
  approved_amount_below_requested:
    "Shift4 approved less than the requested amount without reporting a partial approval.",
  approved_amount_exceeds_requested:
    "Shift4 approved more than the requested amount, which PineTree never asked for.",
}

/**
 * Why a settling approval's amount cannot be confirmed, or null when it can.
 *
 * The approved total must be present and exactly equal to the requested amount.
 * Compared in whole minor units so a floating-point artifact is never read as a
 * mismatch - and never hides one.
 */
function classifyApprovedAmountMinor(
  approved: number | null | undefined,
  requested: number
): Shift4ApprovedAmountProblem | null {
  if (approved === null || approved === undefined || !Number.isSafeInteger(approved)) {
    return "approved_amount_missing"
  }
  if (!Number.isSafeInteger(requested)) return "approved_amount_missing"

  if (approved < requested) return "approved_amount_below_requested"
  if (approved > requested) return "approved_amount_exceeds_requested"
  return null
}
