/**
 * PineTree Engine - administrator diagnostics for the wallet/settlement
 * infrastructure provider (Bridge).
 *
 * Merchants see PineTree business verification. ADMINISTRATORS need the
 * underlying technical detail to support them, and this module is the only
 * merchant-scoped surface that exposes it.
 *
 * SECURITY: callers must already have enforced administrator authorization.
 * Nothing here returns an API key, webhook verification material, a hosted
 * onboarding URL, or a raw provider payload - only identifiers, normalized and
 * raw statuses, and redacted diagnostics.
 */

import {
  getMerchantBridgeConnection,
  BRIDGE_PROVIDER_NAME,
} from "@/database/merchantBridgeConnections"
import { getLatestServiceTermsAcceptance } from "@/database/merchantServiceTerms"
import {
  isBridgeCapabilityRolloutEnabled,
  resolveBridgeActivation,
} from "@/engine/bridgeConnect"
import { describeBridgeConfiguration } from "@/providers/bridge/config"
import { isBridgeApproved, normalizeBridgeConnection } from "@/providers/bridge/normalize"
import type { NormalizedBridgeEndorsement } from "@/providers/bridge/types"

export type BridgeAdminDiagnostics = {
  merchantId: string
  /** The underlying provider, named for administrators only. */
  provider: string
  connected: boolean
  bridgeCustomerId: string | null
  bridgeKycLinkId: string | null
  /** PineTree's normalized connection state. */
  normalizedStatus: string | null
  /** The provider's own status strings, retained for support. */
  rawCustomerStatus: string | null
  rawKycStatus: string | null
  rawTosStatus: string | null
  endorsements: NormalizedBridgeEndorsement[]
  approved: boolean
  actionRequired: { headline: string; detail: string } | null
  requirementsDue: string[]
  lastSyncedAt: string | null
  providerCreatedAt: string | null
  providerUpdatedAt: string | null
  lastAppliedEventId: string | null
  lastAppliedEventAt: string | null
  /** Whether automatic capability activation has occurred, and why not. */
  capabilityActive: boolean
  autoActivatedAt: string | null
  activationBlockedReason: string | null
  adminHoldAt: string | null
  rolloutEnabled: boolean
  /** Consent evidence that authorized the provider submission. */
  consentTermsVersion: string | null
  consentAcceptedAt: string | null
  environment: string | null
}

/**
 * Full technical diagnostics for one merchant.
 *
 * Always scoped to a single merchant id supplied by the caller and validated
 * against the stored row, so an administrator read can never span tenants.
 */
export async function getBridgeAdminDiagnostics(merchantId: string): Promise<BridgeAdminDiagnostics> {
  const normalizedMerchantId = String(merchantId || "").trim()
  if (!normalizedMerchantId) {
    throw Object.assign(new Error("A merchant id is required."), { status: 400 })
  }

  const [row, acceptance] = await Promise.all([
    getMerchantBridgeConnection(normalizedMerchantId),
    getLatestServiceTermsAcceptance(normalizedMerchantId),
  ])

  const credentials = row?.credentials || {}
  const configuration = describeBridgeConfiguration()

  const connection = normalizeBridgeConnection({
    customer: credentials.bridge_customer_id
      ? {
          id: credentials.bridge_customer_id,
          status: credentials.bridge_customer_status,
          kyc_status: credentials.bridge_kyc_status,
          requirements_due: credentials.bridge_requirements_due,
        }
      : null,
    kycLink: credentials.bridge_kyc_link_id
      ? {
          id: credentials.bridge_kyc_link_id,
          kyc_status: credentials.bridge_kyc_status,
          tos_status: credentials.bridge_tos_status,
        }
      : null,
  })

  const endorsements = Array.isArray(credentials.bridge_endorsements)
    ? credentials.bridge_endorsements
    : []
  const approved =
    isBridgeApproved({ ...connection, endorsements, baseEndorsementApproved: credentials.bridge_base_endorsement_approved === true })

  const activation = resolveBridgeActivation({
    approved,
    credentials,
  })

  return {
    merchantId: normalizedMerchantId,
    provider: BRIDGE_PROVIDER_NAME,
    connected: Boolean(row),
    bridgeCustomerId: credentials.bridge_customer_id || null,
    bridgeKycLinkId: credentials.bridge_kyc_link_id || null,
    normalizedStatus: credentials.connection_status || null,
    rawCustomerStatus: credentials.bridge_customer_status || null,
    rawKycStatus: credentials.bridge_kyc_status || null,
    rawTosStatus: credentials.bridge_tos_status || null,
    endorsements,
    approved,
    actionRequired: credentials.bridge_action_required ?? null,
    requirementsDue: Array.isArray(credentials.bridge_requirements_due)
      ? credentials.bridge_requirements_due
      : [],
    lastSyncedAt: credentials.last_synced_at || null,
    providerCreatedAt: credentials.provider_created_at || null,
    providerUpdatedAt: credentials.provider_updated_at || null,
    lastAppliedEventId: credentials.last_applied_event_id || null,
    lastAppliedEventAt: credentials.last_applied_event_at || null,
    capabilityActive: activation.active && row?.enabled === true,
    autoActivatedAt: credentials.auto_activated_at || null,
    activationBlockedReason: activation.blockedReason,
    adminHoldAt: credentials.admin_activation_blocked_at || null,
    rolloutEnabled: isBridgeCapabilityRolloutEnabled(),
    consentTermsVersion: acceptance?.termsVersion || credentials.consent_terms_version || null,
    consentAcceptedAt: acceptance?.acceptedAt || credentials.consent_accepted_at || null,
    environment: configuration.environment,
  }
}
