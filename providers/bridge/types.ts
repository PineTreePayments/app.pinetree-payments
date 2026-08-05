/**
 * Bridge (by Stripe) - provider types and PineTree normalized types.
 *
 * The `Bridge*` types mirror documented Bridge API shapes. The `PineTree*`
 * types are the only vocabulary allowed to cross the provider boundary; raw
 * Bridge status strings are retained for diagnostics but never rendered.
 */

// ─── Bridge API shapes ───────────────────────────────────────────────────────

/** Documented KYC-link statuses. */
export const BRIDGE_KYC_STATUSES = [
  "not_started",
  "incomplete",
  "awaiting_questionnaire",
  "awaiting_ubo",
  "under_review",
  "approved",
  "rejected",
  "paused",
  "offboarded",
] as const
export type BridgeKycStatus = (typeof BRIDGE_KYC_STATUSES)[number]

/** Documented Terms-of-Service acceptance statuses. */
export const BRIDGE_TOS_STATUSES = ["pending", "approved"] as const
export type BridgeTosStatus = (typeof BRIDGE_TOS_STATUSES)[number]

/**
 * Documented customer statuses. Note that a customer reports `active` where a
 * KYC link reports `approved`; both mean "cleared".
 */
export const BRIDGE_CUSTOMER_STATUSES = [
  "not_started",
  "incomplete",
  "awaiting_questionnaire",
  "awaiting_ubo",
  "under_review",
  "active",
  "rejected",
  "paused",
  "offboarded",
] as const
export type BridgeCustomerStatus = (typeof BRIDGE_CUSTOMER_STATUSES)[number]

export type BridgeCustomerType = "individual" | "business"

/**
 * Endorsement names Bridge documents. `base` is the USD-rail endorsement and
 * is the one PineTree requires before Bridge-backed settlement may be enabled.
 */
export const BRIDGE_ENDORSEMENT_NAMES = [
  "base",
  "sepa",
  "spei",
  "pix",
  "faster_payments",
  "cop",
] as const
export type BridgeEndorsementName = (typeof BRIDGE_ENDORSEMENT_NAMES)[number]

export const BRIDGE_ENDORSEMENT_STATUSES = [
  "approved",
  "incomplete",
  "pending",
  "revoked",
] as const
export type BridgeEndorsementStatus = (typeof BRIDGE_ENDORSEMENT_STATUSES)[number]

export type BridgeEndorsementRequirements = {
  complete?: string[]
  pending?: string[]
  missing?: { all_of?: string[] } | null
  issues?: string[]
}

export type BridgeEndorsement = {
  name: string
  status: string
  requirements?: BridgeEndorsementRequirements | null
  future_requirements?: (BridgeEndorsementRequirements & { effective_date?: string }) | null
}

export type BridgeRejectionReason = {
  reason?: string
  developer_reason?: string
  created_at?: string
}

export type BridgeKycLink = {
  id: string
  type?: string
  customer_id?: string | null
  full_name?: string
  email?: string
  kyc_link?: string
  tos_link?: string
  kyc_status?: string
  tos_status?: string
  rejection_reasons?: BridgeRejectionReason[]
  created_at?: string
  updated_at?: string
}

export type BridgeCustomer = {
  id: string
  type?: string
  status?: string
  /**
   * Older Bridge responses expose `kyc_status` on the customer. It is retained
   * because a customer read is one of the two sources PineTree merges.
   */
  kyc_status?: string
  endorsements?: BridgeEndorsement[]
  requirements_due?: string[]
  future_requirements_due?: string[]
  rejection_reasons?: BridgeRejectionReason[]
  has_accepted_terms_of_service?: boolean
  created_at?: string
  updated_at?: string
}

export type BridgeWebhookEndpoint = {
  id: string
  url?: string
  status?: string
  /** Per-endpoint PEM public key used to verify X-Webhook-Signature. */
  public_key?: string
  event_categories?: string[]
  created_at?: string
  updated_at?: string
}

/** The documented Bridge webhook event envelope. */
export type BridgeWebhookEvent = {
  api_version?: string
  event_id?: string
  event_category?: string
  event_type?: string
  event_object_id?: string
  event_object_status?: string
  event_object?: Record<string, unknown>
  event_object_changes?: Record<string, unknown>
  event_created_at?: string
}

// ─── PineTree normalized vocabulary ──────────────────────────────────────────

/**
 * The canonical merchant/provider connection states. This is PineTree
 * terminology and the ONLY vocabulary any surface may present.
 *
 * "Available" is deliberately absent: it is never a substitute for Connected
 * or Enabled.
 */
export const PINETREE_PROVIDER_STATES = [
  "coming_soon",
  "requested",
  "action_required",
  "connected",
  "enabled",
  "disabled",
] as const
export type PineTreeProviderState = (typeof PINETREE_PROVIDER_STATES)[number]

export const PINETREE_PROVIDER_STATE_LABELS: Record<PineTreeProviderState, string> = {
  coming_soon: "Coming soon",
  requested: "Requested",
  action_required: "Action required",
  connected: "Connected",
  enabled: "Enabled",
  disabled: "Disabled",
}

export function pineTreeProviderStateLabel(state: PineTreeProviderState): string {
  return PINETREE_PROVIDER_STATE_LABELS[state]
}

/** Normalized, non-sensitive endorsement summary. */
export type NormalizedBridgeEndorsement = {
  name: string
  status: BridgeEndorsementStatus | "unknown"
  approved: boolean
  /** Requirement identifiers only - never the underlying documents. */
  missingRequirements: string[]
  pendingRequirements: string[]
  issues: string[]
}

/**
 * The complete normalized Bridge connection.
 *
 * Contains Bridge identifiers and normalized statuses only. It never contains
 * KYB documents, personal identifiers, or the hosted onboarding URLs (those
 * are returned once, directly to the requesting merchant, and never stored).
 */
export type NormalizedBridgeConnection = {
  customerId: string | null
  kycLinkId: string | null
  customerType: BridgeCustomerType | null
  /** Raw Bridge values, retained for diagnostics only. */
  rawCustomerStatus: string | null
  rawKycStatus: string | null
  rawTosStatus: string | null
  kycStatus: BridgeKycStatus | "unknown" | null
  tosStatus: BridgeTosStatus | "unknown" | null
  customerStatus: BridgeCustomerStatus | "unknown" | null
  endorsements: NormalizedBridgeEndorsement[]
  /** True once the `base` (USD rail) endorsement is approved. */
  baseEndorsementApproved: boolean
  requirementsDue: string[]
  futureRequirementsDue: string[]
  /** Bridge-side timestamps, when the provider supplied them. */
  providerCreatedAt: string | null
  providerUpdatedAt: string | null
}

/** Why a merchant cannot yet enable Bridge, in merchant-safe language. */
export type BridgeActionRequiredDetail = {
  headline: string
  detail: string
}

/** The safe merchant-facing Bridge provider state. */
export type BridgeConnectionState = {
  provider: "bridge"
  displayName: string
  state: PineTreeProviderState
  stateLabel: string
  /** True once Bridge has approved KYB, TOS, and the required endorsement. */
  approved: boolean
  /** The merchant's acceptance toggle. Only meaningful once approved. */
  enabled: boolean
  onboardingStarted: boolean
  kycCompleted: boolean
  tosAccepted: boolean
  baseEndorsementApproved: boolean
  /** Requirement identifiers only, never source documents. */
  outstandingRequirements: string[]
  outstandingRequirementCount: number
  actionRequired: BridgeActionRequiredDetail | null
  lastSyncedAt: string | null
  environment: "sandbox" | "production" | null
}
