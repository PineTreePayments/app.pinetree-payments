/**
 * Bridge (by Stripe) - status normalization.
 *
 * Translates Bridge's own vocabulary into PineTree's canonical merchant/
 * provider states. Raw Bridge values are retained on the normalized object for
 * diagnostics, but only PineTree terminology may reach a merchant surface.
 *
 * Mapping (authoritative for Bridge):
 *   Bridge not configured for this deployment        -> Coming soon
 *   Merchant asked for Bridge, no provider object yet -> Requested
 *   KYB/TOS incomplete, or requirements outstanding   -> Action required
 *   Bridge review pending                             -> Action required ("Under review")
 *   Approved + required endorsement approved          -> Connected
 *   Approved + merchant toggled acceptance on         -> Enabled
 *   Approved + merchant toggled acceptance off        -> Disabled
 *   Rejected / paused / offboarded                    -> Action required
 *
 * "Connected" is the state after approval and before the merchant has made an
 * explicit acceptance decision. Once that decision exists it becomes Enabled
 * or Disabled, which is why the decision itself is persisted rather than
 * inferred from the boolean alone.
 */

import type {
  BridgeConnectionState,
  BridgeCustomer,
  BridgeCustomerStatus,
  BridgeCustomerType,
  BridgeEndorsement,
  BridgeEndorsementStatus,
  BridgeKycLink,
  BridgeKycStatus,
  BridgeTosStatus,
  NormalizedBridgeConnection,
  NormalizedBridgeEndorsement,
  PineTreeProviderState,
} from "./types"
import {
  BRIDGE_CUSTOMER_STATUSES,
  BRIDGE_ENDORSEMENT_STATUSES,
  BRIDGE_KYC_STATUSES,
  BRIDGE_TOS_STATUSES,
  pineTreeProviderStateLabel,
} from "./types"

export const BRIDGE_DISPLAY_NAME = "Bridge by Stripe" as const
export const BRIDGE_PROVIDER_KEY = "bridge" as const

/**
 * The endorsement PineTree requires before Bridge-backed settlement may be
 * enabled. `base` is Bridge's USD-rail endorsement.
 */
export const BRIDGE_REQUIRED_ENDORSEMENT = "base" as const

function trimmedOrNull(value: unknown): string | null {
  const normalized = String(value ?? "").trim()
  return normalized || null
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => entry.length > 0)
    .slice(0, 50)
}

/**
 * Unrecognized provider values normalize to "unknown" rather than being
 * guessed into a favorable state. An unknown status never counts as approval.
 */
function normalizeKycStatus(value: unknown): BridgeKycStatus | "unknown" | null {
  const normalized = trimmedOrNull(value)?.toLowerCase()
  if (!normalized) return null
  return (BRIDGE_KYC_STATUSES as readonly string[]).includes(normalized)
    ? (normalized as BridgeKycStatus)
    : "unknown"
}

function normalizeTosStatus(value: unknown): BridgeTosStatus | "unknown" | null {
  const normalized = trimmedOrNull(value)?.toLowerCase()
  if (!normalized) return null
  return (BRIDGE_TOS_STATUSES as readonly string[]).includes(normalized)
    ? (normalized as BridgeTosStatus)
    : "unknown"
}

function normalizeCustomerStatus(value: unknown): BridgeCustomerStatus | "unknown" | null {
  const normalized = trimmedOrNull(value)?.toLowerCase()
  if (!normalized) return null
  return (BRIDGE_CUSTOMER_STATUSES as readonly string[]).includes(normalized)
    ? (normalized as BridgeCustomerStatus)
    : "unknown"
}

function normalizeCustomerType(value: unknown): BridgeCustomerType | null {
  const normalized = trimmedOrNull(value)?.toLowerCase()
  if (normalized === "business" || normalized === "individual") return normalized
  return null
}

function normalizeEndorsementStatus(value: unknown): BridgeEndorsementStatus | "unknown" {
  const normalized = trimmedOrNull(value)?.toLowerCase()
  if (!normalized) return "unknown"
  return (BRIDGE_ENDORSEMENT_STATUSES as readonly string[]).includes(normalized)
    ? (normalized as BridgeEndorsementStatus)
    : "unknown"
}

export function normalizeBridgeEndorsement(endorsement: BridgeEndorsement): NormalizedBridgeEndorsement {
  const status = normalizeEndorsementStatus(endorsement.status)
  const requirements = endorsement.requirements || {}

  return {
    name: String(endorsement.name ?? "").trim().toLowerCase(),
    status,
    approved: status === "approved",
    missingRequirements: stringArray(requirements.missing?.all_of),
    pendingRequirements: stringArray(requirements.pending),
    issues: stringArray(requirements.issues),
  }
}

export function normalizeBridgeEndorsements(
  endorsements: BridgeEndorsement[] | null | undefined
): NormalizedBridgeEndorsement[] {
  if (!Array.isArray(endorsements)) return []
  return endorsements
    .filter((entry): entry is BridgeEndorsement => Boolean(entry) && typeof entry === "object")
    .map(normalizeBridgeEndorsement)
    .filter((entry) => entry.name.length > 0)
}

/**
 * Merge a Bridge customer and/or KYC link into one normalized connection.
 *
 * Either source may be absent: onboarding starts with only a KYC link, and a
 * customer appears once Bridge creates it.
 */
export function normalizeBridgeConnection(input: {
  customer?: BridgeCustomer | null
  kycLink?: BridgeKycLink | null
}): NormalizedBridgeConnection {
  const customer = input.customer || null
  const kycLink = input.kycLink || null

  const endorsements = normalizeBridgeEndorsements(customer?.endorsements)
  const baseEndorsement = endorsements.find((entry) => entry.name === BRIDGE_REQUIRED_ENDORSEMENT)

  // A customer's own kyc_status is the more authoritative KYB signal when
  // present; the KYC-link status is the onboarding-session view of the same
  // process and is used while no customer exists yet.
  const kycStatus = trimmedOrNull(customer?.kyc_status)
    ? normalizeKycStatus(customer?.kyc_status)
    : normalizeKycStatus(kycLink?.kyc_status)

  return {
    customerId: trimmedOrNull(customer?.id) || trimmedOrNull(kycLink?.customer_id),
    kycLinkId: trimmedOrNull(kycLink?.id),
    customerType: normalizeCustomerType(customer?.type ?? kycLink?.type),
    rawCustomerStatus: trimmedOrNull(customer?.status),
    rawKycStatus: trimmedOrNull(customer?.kyc_status ?? kycLink?.kyc_status),
    rawTosStatus: trimmedOrNull(kycLink?.tos_status),
    kycStatus,
    tosStatus: normalizeTosStatus(kycLink?.tos_status),
    customerStatus: normalizeCustomerStatus(customer?.status),
    endorsements,
    baseEndorsementApproved: Boolean(baseEndorsement?.approved),
    requirementsDue: stringArray(customer?.requirements_due),
    futureRequirementsDue: stringArray(customer?.future_requirements_due),
    providerCreatedAt: trimmedOrNull(customer?.created_at ?? kycLink?.created_at),
    providerUpdatedAt: trimmedOrNull(customer?.updated_at ?? kycLink?.updated_at),
  }
}

/** True when Bridge has cleared KYB. `active` (customer) == `approved` (link). */
export function isBridgeKybCleared(connection: NormalizedBridgeConnection): boolean {
  return connection.customerStatus === "active" || connection.kycStatus === "approved"
}

/** True when Bridge reports the customer is being reviewed. */
export function isBridgeUnderReview(connection: NormalizedBridgeConnection): boolean {
  return connection.customerStatus === "under_review" || connection.kycStatus === "under_review"
}

/** True when Bridge has rejected, paused, or offboarded the customer. */
export function isBridgeBlocked(connection: NormalizedBridgeConnection): boolean {
  const blocked = new Set(["rejected", "paused", "offboarded"])
  return (
    (connection.customerStatus !== null && blocked.has(connection.customerStatus)) ||
    (connection.kycStatus !== null && blocked.has(connection.kycStatus))
  )
}

export function isBridgeTosAccepted(connection: NormalizedBridgeConnection): boolean {
  return connection.tosStatus === "approved"
}

/**
 * Full approval: KYB cleared, terms accepted, and the required endorsement
 * approved. All three are required - a cleared KYB alone never enables Bridge.
 */
export function isBridgeApproved(connection: NormalizedBridgeConnection): boolean {
  return (
    isBridgeKybCleared(connection) &&
    isBridgeTosAccepted(connection) &&
    connection.baseEndorsementApproved &&
    !isBridgeBlocked(connection)
  )
}

/**
 * Requirement identifiers the merchant still owes, deduplicated across the
 * customer record and the required endorsement. Identifiers only - PineTree
 * never surfaces or stores the underlying documents.
 */
export function outstandingBridgeRequirements(connection: NormalizedBridgeConnection): string[] {
  const baseEndorsement = connection.endorsements.find(
    (entry) => entry.name === BRIDGE_REQUIRED_ENDORSEMENT
  )
  const combined = [
    ...connection.requirementsDue,
    ...(baseEndorsement?.missingRequirements || []),
    ...(baseEndorsement?.issues || []),
  ]
  return Array.from(new Set(combined))
}

/**
 * Merchant-safe explanation of what is blocking Bridge. Never echoes a raw
 * Bridge status string, a rejection reason written for developers, or any
 * promise of approval timing.
 */
export function bridgeActionRequiredDetail(
  connection: NormalizedBridgeConnection
): BridgeConnectionState["actionRequired"] {
  if (isBridgeBlocked(connection)) {
    if (connection.customerStatus === "paused" || connection.kycStatus === "paused") {
      return {
        headline: "Verification paused",
        detail: "Bridge has paused this account. Contact PineTree support to review what is needed.",
      }
    }
    if (connection.customerStatus === "offboarded" || connection.kycStatus === "offboarded") {
      return {
        headline: "Account closed by Bridge",
        detail: "Bridge has closed this account. Contact PineTree support before starting again.",
      }
    }
    return {
      headline: "Verification not approved",
      detail: "Bridge could not approve this business. Contact PineTree support to review the details.",
    }
  }

  if (isBridgeUnderReview(connection)) {
    return {
      headline: "Under review",
      detail: "Bridge is reviewing the information you submitted. No further action is needed right now.",
    }
  }

  if (!isBridgeTosAccepted(connection)) {
    return {
      headline: "Accept Bridge terms",
      detail: "Continue onboarding to accept the Bridge terms of service.",
    }
  }

  if (!isBridgeKybCleared(connection)) {
    const outstanding = outstandingBridgeRequirements(connection)
    return {
      headline: "Finish business verification",
      detail: outstanding.length
        ? `Continue onboarding to provide ${outstanding.length} outstanding item${outstanding.length === 1 ? "" : "s"}.`
        : "Continue onboarding to finish Bridge business verification.",
    }
  }

  if (!connection.baseEndorsementApproved) {
    return {
      headline: "Awaiting Bridge approval",
      detail: "Business verification is complete. Bridge has not yet approved this account for settlement.",
    }
  }

  return null
}

/**
 * Resolve the canonical PineTree provider state.
 *
 * `enablementDecisionMade` distinguishes "approved, merchant has not chosen"
 * (Connected) from an explicit merchant choice (Enabled / Disabled).
 */
export function resolveBridgeProviderState(input: {
  configured: boolean
  onboardingRequested: boolean
  connection: NormalizedBridgeConnection
  enabled: boolean
  enablementDecisionMade: boolean
}): PineTreeProviderState {
  if (!input.configured) return "coming_soon"

  const hasProviderObject = Boolean(input.connection.customerId || input.connection.kycLinkId)
  if (!hasProviderObject) {
    return input.onboardingRequested ? "requested" : "coming_soon"
  }

  if (!isBridgeApproved(input.connection)) return "action_required"
  if (!input.enablementDecisionMade) return "connected"
  return input.enabled ? "enabled" : "disabled"
}

/**
 * Build the complete safe merchant-facing state. This is the only Bridge shape
 * an API route may return.
 */
export function buildBridgeConnectionState(input: {
  configured: boolean
  environment: "sandbox" | "production" | null
  onboardingRequested: boolean
  connection: NormalizedBridgeConnection
  enabled: boolean
  enablementDecisionMade: boolean
  lastSyncedAt: string | null
}): BridgeConnectionState {
  const state = resolveBridgeProviderState(input)
  const approved = isBridgeApproved(input.connection)
  const outstandingRequirements = outstandingBridgeRequirements(input.connection)
  const hasProviderObject = Boolean(input.connection.customerId || input.connection.kycLinkId)

  return {
    provider: BRIDGE_PROVIDER_KEY,
    displayName: BRIDGE_DISPLAY_NAME,
    state,
    stateLabel: pineTreeProviderStateLabel(state),
    approved,
    enabled: approved && input.enabled,
    onboardingStarted: hasProviderObject || input.onboardingRequested,
    kycCompleted: isBridgeKybCleared(input.connection),
    tosAccepted: isBridgeTosAccepted(input.connection),
    baseEndorsementApproved: input.connection.baseEndorsementApproved,
    outstandingRequirements,
    outstandingRequirementCount: outstandingRequirements.length,
    actionRequired: state === "action_required" ? bridgeActionRequiredDetail(input.connection) : null,
    lastSyncedAt: input.lastSyncedAt,
    environment: input.environment,
  }
}

/** An empty normalized connection, used before any provider object exists. */
export function emptyBridgeConnection(): NormalizedBridgeConnection {
  return {
    customerId: null,
    kycLinkId: null,
    customerType: null,
    rawCustomerStatus: null,
    rawKycStatus: null,
    rawTosStatus: null,
    kycStatus: null,
    tosStatus: null,
    customerStatus: null,
    endorsements: [],
    baseEndorsementApproved: false,
    requirementsDue: [],
    futureRequirementsDue: [],
    providerCreatedAt: null,
    providerUpdatedAt: null,
  }
}
