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

// ─── Business customer payload (POST/PUT /customers) ─────────────────────────

/** Documented `business_type` values - how the business is legally registered. */
export const BRIDGE_BUSINESS_TYPES = [
  "cooperative",
  "corporation",
  "llc",
  "other",
  "partnership",
  "sole_prop",
  "trust",
] as const
export type BridgeBusinessType = (typeof BRIDGE_BUSINESS_TYPES)[number]

export const BRIDGE_ESTIMATED_ANNUAL_REVENUE = [
  "0_99999",
  "100000_999999",
  "1000000_9999999",
  "10000000_49999999",
  "50000000_249999999",
  "250000000_plus",
] as const
export type BridgeEstimatedAnnualRevenue = (typeof BRIDGE_ESTIMATED_ANNUAL_REVENUE)[number]

export const BRIDGE_ACCOUNT_PURPOSES = [
  "charitable_donations",
  "ecommerce_retail_payments",
  "investment_purposes",
  "other",
  "payments_to_friends_or_family_abroad",
  "payroll",
  "personal_or_living_expenses",
  "protect_wealth",
  "purchase_goods_and_services",
  "receive_payments_for_goods_and_services",
  "tax_optimization",
  "third_party_money_transmission",
  "treasury_management",
] as const
export type BridgeAccountPurpose = (typeof BRIDGE_ACCOUNT_PURPOSES)[number]

export const BRIDGE_SOURCE_OF_FUNDS = [
  "business_loans",
  "grants",
  "inter_company_funds",
  "investment_proceeds",
  "legal_settlement",
  "owners_capital",
  "pension_retirement",
  "sale_of_assets",
  "sales_of_goods_and_services",
  "third_party_funds",
  "treasury_reserves",
] as const
export type BridgeSourceOfFunds = (typeof BRIDGE_SOURCE_OF_FUNDS)[number]

export const BRIDGE_HIGH_RISK_ACTIVITIES = [
  "adult_entertainment",
  "gambling",
  "hold_client_funds",
  "investment_services",
  "lending_banking",
  "marijuana_or_related_services",
  "money_services",
  "nicotine_tobacco_or_related_services",
  "operate_foreign_exchange_virtual_currencies_brokerage_otc",
  "pharmaceuticals",
  "precious_metals_precious_stones_jewelry",
  "safe_deposit_box_rentals",
  "third_party_payment_processing",
  "weapons_firearms_and_explosives",
  "none_of_the_above",
] as const
export type BridgeHighRiskActivity = (typeof BRIDGE_HIGH_RISK_ACTIVITIES)[number]

/** Bridge's `Address2025WinterRefresh` shape. `country` is ISO 3166-1 alpha-3. */
export type BridgeAddress = {
  street_line_1: string
  street_line_2?: string
  city: string
  subdivision?: string
  postal_code?: string
  country: string
}

export type BridgeIdentifyingInformation = {
  type: string
  issuing_country: string
  number?: string
}

export type BridgeAssociatedPerson = {
  first_name: string
  last_name: string
  email: string
  phone?: string
  birth_date: string
  residential_address: BridgeAddress
  identifying_information: BridgeIdentifyingInformation[]
  has_ownership: boolean
  has_control: boolean
  is_signer: boolean
  is_director?: boolean
  title?: string
  ownership_percentage?: number
  relationship_established_at?: string
}

/**
 * The business-customer body PineTree sends to Bridge.
 *
 * Every field here originates from the merchant's PineTree Business Profile.
 * Tax identifiers travel inside `identifying_information` and are never
 * persisted by PineTree - see engine/bridgeCustomerPayload.ts.
 */
export type BridgeBusinessCustomerPayload = {
  type: "business"
  business_legal_name: string
  business_trade_name?: string
  business_description: string
  email: string
  phone?: string
  business_type: BridgeBusinessType
  primary_website?: string
  registered_address: BridgeAddress
  physical_address: BridgeAddress
  business_industry: string[]
  signed_agreement_id?: string
  is_dao: boolean
  has_material_intermediary_ownership: boolean
  estimated_annual_revenue_usd: BridgeEstimatedAnnualRevenue
  expected_monthly_payments_usd: number
  operates_in_prohibited_countries: boolean
  account_purpose: BridgeAccountPurpose
  account_purpose_other?: string
  high_risk_activities: BridgeHighRiskActivity[]
  high_risk_activities_explanation?: string
  source_of_funds: BridgeSourceOfFunds
  conducts_money_services: boolean
  compliance_screening_explanation?: string
  identifying_information?: BridgeIdentifyingInformation[]
  associated_persons?: BridgeAssociatedPerson[]
  endorsements?: string[]
}

// ─── External accounts and liquidation addresses ─────────────────────────────

export type BridgeCheckingOrSavings = "checking" | "savings"

export type BridgeExternalAccount = {
  id: string
  customer_id?: string | null
  bank_name?: string | null
  account_name?: string | null
  account_owner_name?: string | null
  account_owner_type?: string | null
  account_type?: string | null
  currency?: string | null
  active?: boolean
  last_4?: string | null
  account?: { last_4?: string | null; checking_or_savings?: string | null } | null
  beneficiary_address_valid?: boolean
  deactivation_reason?: string | null
  created_at?: string
  updated_at?: string
}

/** Source chains PineTree supports for a liquidation address today. */
export const BRIDGE_LIQUIDATION_CHAINS = ["base", "solana"] as const
export type BridgeLiquidationChain = (typeof BRIDGE_LIQUIDATION_CHAINS)[number]

export type BridgeLiquidationAddress = {
  id: string
  customer_id?: string | null
  /** The on-chain address the merchant sends USDC to. */
  address?: string | null
  chain?: string | null
  currency?: string | null
  external_account_id?: string | null
  destination_payment_rail?: string | null
  destination_currency?: string | null
  state?: string | null
  created_at?: string
  updated_at?: string
}

/**
 * Documented drain states. `awaiting_funds` appears in Bridge's shared
 * TransactionStatus enum, and the returns states (`missing_return_policy`,
 * `refund_in_flight`, `refund_failed`) appear in Bridge's drain-state table.
 */
export const BRIDGE_DRAIN_STATES = [
  "awaiting_funds",
  "in_review",
  "funds_received",
  "payment_submitted",
  "payment_processed",
  "undeliverable",
  "returned",
  "missing_return_policy",
  "refund_in_flight",
  "refund_failed",
  "refunded",
  "error",
  "canceled",
] as const
export type BridgeDrainState = (typeof BRIDGE_DRAIN_STATES)[number]

export type BridgeDrain = {
  id: string
  customer_id?: string | null
  liquidation_address_id?: string | null
  amount?: string | null
  currency?: string | null
  state?: string | null
  created_at?: string
  updated_at?: string
  deposit_tx_hash?: string | null
  destination_tx_hash?: string | null
  refund_tx_hash?: string | null
  from_address?: string | null
  destination?: {
    payment_rail?: string | null
    currency?: string | null
    external_account_id?: string | null
    trace_number?: string | null
    imad?: string | null
    to_address?: string | null
  } | null
  return_details?: { reason?: string | null; risk_rejection_reason?: string | null } | null
  receipt?: Record<string, unknown> | null
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
