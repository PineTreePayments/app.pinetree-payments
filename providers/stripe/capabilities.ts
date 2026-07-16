import type {
  StripeConnectedAccountDetails,
  StripeConnectionStatus,
  StripeNormalizedConnection
} from "./types"

/**
 * Normalizes Stripe account state into the PineTree Stripe connection model.
 *
 * Pure translation only — no database access, no business decisions beyond
 * the documented mapping. PineTree Engine owns persistence and any further
 * merchant-facing presentation.
 *
 * Status mapping (evaluated in order):
 *
 * | Stripe evidence                                            | PineTree status       |
 * |------------------------------------------------------------|-----------------------|
 * | no connected account (details = null)                       | not_connected         |
 * | requirements.disabled_reason is terminal                    | disabled              |
 * |   (rejected.*, listed, platform_paused, other)              |                       |
 * | details_submitted = false                                   | onboarding_required   |
 * | requirements.past_due non-empty or                          | restricted            |
 * |   disabled_reason = requirements.past_due                   |                       |
 * | charges_enabled && payouts_enabled                          | active                |
 * | requirements.currently_due non-empty                        | onboarding_required   |
 * | otherwise (submitted, Stripe reviewing / not yet enabled)   | pending_verification  |
 *
 * details_submitted is checked BEFORE past_due: on accounts where the
 * platform collects requirements (requirement_collection=application),
 * Stripe marks a brand-new account's requirements past_due immediately —
 * verified against the live Stripe API. An account the merchant has never
 * onboarded is "onboarding required", not "restricted"; past_due only
 * signals restriction once details were submitted.
 */

const TERMINAL_DISABLED_REASONS = new Set(["listed", "platform_paused", "other"])

function isTerminalDisabledReason(disabledReason: string | null): boolean {
  if (!disabledReason) return false
  return disabledReason.startsWith("rejected") || TERMINAL_DISABLED_REASONS.has(disabledReason)
}

export function deriveStripeConnectionStatus(
  details: StripeConnectedAccountDetails | null
): StripeConnectionStatus {
  if (!details) return "not_connected"

  const { requirements } = details

  if (isTerminalDisabledReason(requirements.disabledReason)) return "disabled"

  if (!details.detailsSubmitted) return "onboarding_required"

  if (requirements.pastDue.length > 0 || requirements.disabledReason === "requirements.past_due") {
    return "restricted"
  }

  if (details.chargesEnabled && details.payoutsEnabled) return "active"

  if (requirements.currentlyDue.length > 0) return "onboarding_required"

  return "pending_verification"
}

export function normalizeStripeAccountStatus(
  details: StripeConnectedAccountDetails | null
): StripeNormalizedConnection {
  if (!details) {
    return {
      provider: "stripe",
      connectionStatus: "not_connected",
      accountConnected: false,
      detailsSubmitted: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      requirementsCurrentlyDue: [],
      requirementsEventuallyDue: [],
      requirementsPastDue: [],
      requirementsPendingVerification: [],
      disabledReason: null,
      capabilities: {}
    }
  }

  return {
    provider: "stripe",
    connectionStatus: deriveStripeConnectionStatus(details),
    accountConnected: true,
    detailsSubmitted: details.detailsSubmitted,
    chargesEnabled: details.chargesEnabled,
    payoutsEnabled: details.payoutsEnabled,
    requirementsCurrentlyDue: details.requirements.currentlyDue,
    requirementsEventuallyDue: details.requirements.eventuallyDue,
    requirementsPastDue: details.requirements.pastDue,
    requirementsPendingVerification: details.requirements.pendingVerification,
    disabledReason: details.requirements.disabledReason,
    capabilities: details.capabilities
  }
}
