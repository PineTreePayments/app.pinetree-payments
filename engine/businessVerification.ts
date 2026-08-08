/**
 * PineTree Engine - merchant business verification.
 *
 * This module is the ONE merchant-facing verification concept in PineTree.
 * Merchants complete a single PineTree onboarding; PineTree handles the
 * regulated infrastructure behind it.
 *
 * PRODUCT RULE: Bridge is infrastructure, not a product a merchant connects.
 * Nothing this module returns may name Bridge, expose a Bridge identifier, or
 * leak a raw Bridge status. Merchants see PineTree verification status and one
 * clear next action; administrators get the technical detail elsewhere
 * (`bridgeAdminDiagnostics`).
 *
 * HONESTY RULE: PineTree does not perform KYB/KYC approval. Merchant-facing
 * copy says PineTree is reviewing or processing verification, never that
 * PineTree approved anything. Approval evidence comes only from a provider
 * lookup or a signature-verified provider webhook - never from a browser
 * redirect.
 *
 * ORCHESTRATION: reading verification status is also what advances it. A read
 * will, when every precondition holds, idempotently create the provider
 * onboarding and activate an approved capability. That keeps the merchant on
 * one continuous PineTree journey with no "connect" step.
 *
 * PREFILL CONTRACT (not yet implemented): PineTree already holds a complete
 * business profile before any provider submission happens. When provider KYB is
 * built out, it must submit and prefill from that profile wherever the provider
 * API allows - legal name, DBA, address, phone, business type, tax details,
 * owners/controllers, and contacts are never re-collected. Only material
 * PineTree genuinely does not hold (identity documents and similar sensitive
 * compliance data) may prompt the merchant again, and that is collected on the
 * provider-hosted page. See docs/onboarding/business-verification.md.
 *
 * PRESENTATION CONTRACT: `primaryAction.kind` is what merchant surfaces switch
 * on. `none` means PineTree is waiting on itself or on a provider, never on the
 * merchant, so the operational warning must not render. Interface code must not
 * substitute its own status when a read fails.
 */

import { randomUUID } from "node:crypto"

import {
  CURRENT_SERVICE_TERMS_VERSION,
  DISCLOSED_SERVICE_PROVIDERS,
  getLatestServiceTermsAcceptance,
  isServiceTermsAcceptanceCurrent,
  recordServiceTermsAcceptance,
  type MerchantServiceTermsAcceptance,
} from "@/database/merchantServiceTerms"
import { getMerchantBridgeConnection } from "@/database/merchantBridgeConnections"
import { insertMerchantAuditEvent } from "@/database/merchantAuditEvents"
import {
  BUSINESS_PROFILE_FIELD_LABELS,
  getMerchantBusinessProfile,
  type MerchantBusinessProfile,
} from "@/engine/businessProfile"
import {
  ensureBridgeCustomerEngine,
  ensureBridgeOnboardingEngine,
  getBridgeConnectionEngine,
  requestBridgeTermsLinkEngine,
  syncBridgeConnectionEngine,
} from "@/engine/bridgeConnect"
import {
  missingKybProfileFields,
  type BusinessVerificationSensitiveInput,
} from "@/engine/bridgeCustomerPayload"
import { isBridgeConfigured } from "@/providers/bridge/config"
import type { BridgeConnectionState } from "@/providers/bridge/types"

/**
 * The merchant-facing verification vocabulary. This is PineTree terminology
 * and the only status language any merchant surface may present.
 */
export const BUSINESS_VERIFICATION_STATUSES = [
  "not_started",
  "in_progress",
  "under_review",
  "action_required",
  "verified",
  "temporarily_unavailable",
] as const

export type BusinessVerificationStatus = (typeof BUSINESS_VERIFICATION_STATUSES)[number]

export const BUSINESS_VERIFICATION_STATUS_LABELS: Record<BusinessVerificationStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  under_review: "Under review",
  action_required: "Additional information required",
  verified: "Verified",
  temporarily_unavailable: "Temporarily unavailable",
}

/** The single next action a merchant can take. Never more than one. */
export type BusinessVerificationAction =
  | { kind: "complete_profile"; label: string; href: string }
  | { kind: "review_and_consent"; label: string; href: string }
  | { kind: "continue_verification"; label: string; href: null }
  | { kind: "none"; label: null; href: null }

export type BusinessVerificationState = {
  status: BusinessVerificationStatus
  statusLabel: string
  /** Short merchant-facing headline. */
  headline: string
  /** One or two sentences of plain merchant-facing explanation. */
  detail: string
  primaryAction: BusinessVerificationAction
  /** True once PineTree's business profile has every required field. */
  profileComplete: boolean
  /** Human-readable labels of missing profile fields. Never raw column names. */
  missingProfileFields: string[]
  /** True when the merchant has accepted the current terms bundle. */
  termsAccepted: boolean
  termsVersion: string
  /** True when Bridge-backed wallet/settlement capability is live. */
  walletCapabilitiesActive: boolean
  lastCheckedAt: string | null
}

const BUSINESS_PROFILE_HREF = "/dashboard/settings?section=business-profile&return=wallet"

function labelForField(field: string): string {
  return (
    (BUSINESS_PROFILE_FIELD_LABELS as Record<string, string>)[field] ||
    field.replace(/_/g, " ")
  )
}

function state(input: {
  status: BusinessVerificationStatus
  headline: string
  detail: string
  primaryAction: BusinessVerificationAction
  profile: MerchantBusinessProfile
  termsAccepted: boolean
  walletCapabilitiesActive: boolean
  lastCheckedAt: string | null
}): BusinessVerificationState {
  return {
    status: input.status,
    statusLabel: BUSINESS_VERIFICATION_STATUS_LABELS[input.status],
    headline: input.headline,
    detail: input.detail,
    primaryAction: input.primaryAction,
    profileComplete: input.profile.profile_status === "complete",
    missingProfileFields: (input.profile.missing_fields || []).map(labelForField),
    termsAccepted: input.termsAccepted,
    termsVersion: CURRENT_SERVICE_TERMS_VERSION,
    walletCapabilitiesActive: input.walletCapabilitiesActive,
    lastCheckedAt: input.lastCheckedAt,
  }
}

/**
 * Project the underlying provider connection into PineTree vocabulary.
 *
 * The provider's own state names (`connected`, `enabled`, `action_required`)
 * and its raw statuses never escape this function.
 */
function projectFromProviderConnection(input: {
  connection: BridgeConnectionState
  profile: MerchantBusinessProfile
  termsAccepted: boolean
}): BusinessVerificationState {
  const { connection, profile, termsAccepted } = input
  const lastCheckedAt = connection.lastSyncedAt

  if (connection.approved) {
    return state({
      status: "verified",
      headline: "Business verification",
      // Honest about what activation depends on: approval is necessary, and
      // PineTree still gates the capability on its own rollout eligibility.
      detail: connection.enabled
        ? "Your PineTree Wallet is ready for supported payment and settlement capabilities."
        : "Verification is complete. PineTree is finishing activation of your wallet capabilities.",
      primaryAction: { kind: "none", label: null, href: null },
      profile,
      termsAccepted,
      walletCapabilitiesActive: connection.enabled,
      lastCheckedAt,
    })
  }

  // "Under review" is a distinct merchant experience from "we need something
  // from you": there is deliberately no action button.
  const underReview = connection.actionRequired?.headline === "Under review"
  if (underReview) {
    return state({
      status: "under_review",
      headline: "Business verification",
      detail:
        "Your information has been submitted. You can continue using available PineTree features while verification is completed.",
      primaryAction: { kind: "none", label: null, href: null },
      profile,
      termsAccepted,
      walletCapabilitiesActive: false,
      lastCheckedAt,
    })
  }

  if (connection.actionRequired) {
    return state({
      status: "action_required",
      headline: "Business verification",
      detail:
        "Complete the remaining verification step to activate supported wallet and settlement capabilities.",
      primaryAction: {
        kind: "continue_verification",
        label: "Continue verification",
        href: null,
      },
      profile,
      termsAccepted,
      walletCapabilitiesActive: false,
      lastCheckedAt,
    })
  }

  // Submitted, nothing outstanding, not yet approved.
  return state({
    status: "in_progress",
    headline: "Business verification",
    detail: "PineTree is processing your business verification. No action is needed right now.",
    primaryAction: { kind: "none", label: null, href: null },
    profile,
    termsAccepted,
    walletCapabilitiesActive: false,
    lastCheckedAt,
  })
}

/**
 * Build the merchant-facing state from PineTree-side facts alone, for the
 * stages before any provider submission exists.
 */
function projectPreSubmission(input: {
  profile: MerchantBusinessProfile
  acceptance: MerchantServiceTermsAcceptance | null
  providerConfigured: boolean
}): BusinessVerificationState {
  const { profile, acceptance, providerConfigured } = input
  const termsAccepted = isServiceTermsAcceptanceCurrent(acceptance, "bridge")
  const profileComplete = profile.profile_status === "complete"

  // A profile can satisfy the required-field list and still be missing
  // something verification needs - a legacy row saved before a field existed.
  // Both cases route the merchant to the SAME Business Profile; there is no
  // second form and no second card.
  const outstandingKybFields = missingKybProfileFields(profile)
  if (!profileComplete || outstandingKybFields.length > 0) {
    const started = Boolean(profile.legal_business_name || profile.contact_email)
    return state({
      status: started ? "in_progress" : "not_started",
      headline: started ? "Finish business verification" : "Start business verification",
      detail:
        "Complete your PineTree business profile to activate wallet and settlement capabilities.",
      primaryAction: {
        kind: "complete_profile",
        label: started ? "Continue business profile" : "Complete business profile",
        href: BUSINESS_PROFILE_HREF,
      },
      profile,
      termsAccepted,
      walletCapabilitiesActive: false,
      lastCheckedAt: null,
    })
  }

  if (!termsAccepted) {
    return state({
      status: "in_progress",
      headline: "Finish business verification",
      detail:
        "Review and accept the PineTree service terms so verification of your business can begin.",
      primaryAction: {
        kind: "review_and_consent",
        label: "Review and continue",
        href: BUSINESS_PROFILE_HREF,
      },
      profile,
      termsAccepted,
      walletCapabilitiesActive: false,
      lastCheckedAt: null,
    })
  }

  if (!providerConfigured) {
    // Neutral, honest, and not a provider card. The merchant has done
    // everything asked of them; PineTree simply cannot verify right now.
    return state({
      status: "temporarily_unavailable",
      headline: "Business verification",
      detail:
        "Verification is temporarily unavailable. Your information is saved and PineTree will continue automatically.",
      primaryAction: { kind: "none", label: null, href: null },
      profile,
      termsAccepted,
      walletCapabilitiesActive: false,
      lastCheckedAt: null,
    })
  }

  // Consent exists and the provider is configured, but submission has not
  // completed yet (or just failed transiently).
  return state({
    status: "in_progress",
    headline: "Business verification",
    detail: "PineTree is submitting your business information for verification.",
    primaryAction: { kind: "none", label: null, href: null },
    profile,
    termsAccepted,
    walletCapabilitiesActive: false,
    lastCheckedAt: null,
  })
}

/**
 * Whether PineTree may create the provider customer for this merchant.
 *
 * Every condition is a PineTree-side fact resolved server-side. A merchant who
 * abandoned signup, never completed the profile, or never consented is never
 * submitted to a provider. The KYB payload check is included because a profile
 * that cannot produce a complete submission would only earn a provider
 * rejection - PineTree keeps the merchant on a fixable PineTree error instead.
 */
export function canSubmitForVerification(input: {
  profile: MerchantBusinessProfile
  acceptance: MerchantServiceTermsAcceptance | null
  providerConfigured: boolean
}): boolean {
  return (
    input.providerConfigured &&
    input.profile.profile_status === "complete" &&
    Boolean(String(input.profile.legal_business_name || "").trim()) &&
    Boolean(String(input.profile.owner_email || input.profile.contact_email || "").trim()) &&
    missingKybProfileFields(input.profile).length === 0 &&
    isServiceTermsAcceptanceCurrent(input.acceptance, "bridge")
  )
}

export type BusinessVerificationResult =
  | { ok: true; verification: BusinessVerificationState; correlationId: string }
  | { ok: false; error: string; retryable: boolean; correlationId: string }

/**
 * The merchant-facing verification state, advancing the workflow as a side
 * effect when it safely can.
 *
 * `refresh` controls whether the provider is re-read:
 *   - false (default): a fast database-only projection for page render.
 *   - true: an authoritative provider lookup, used on return from the hosted
 *     step, on explicit status checks, and by reconciliation.
 *
 * Advancement is idempotent throughout: submission reuses any existing
 * provider customer, and activation is derived from approval rather than
 * toggled.
 */
export async function getBusinessVerificationEngine(args: {
  merchantId: string
  refresh?: boolean
  actorId?: string | null
  /**
   * Request-scoped tax identifiers, present only on the request that collected
   * them. Never stored, never returned, never logged.
   */
  sensitive?: BusinessVerificationSensitiveInput
}): Promise<BusinessVerificationResult> {
  const correlationId = randomUUID()

  try {
    const providerConfigured = isBridgeConfigured()
    const [profile, acceptance, existingRow] = await Promise.all([
      getMerchantBusinessProfile(args.merchantId),
      getLatestServiceTermsAcceptance(args.merchantId),
      getMerchantBridgeConnection(args.merchantId),
    ])

    const hasSubmission = Boolean(
      existingRow?.credentials?.bridge_customer_id || existingRow?.credentials?.bridge_kyc_link_id
    )

    // ── Advance: submit when every precondition holds. A merchant who already
    //    has a provider customer still passes through here when this request
    //    carries fresh data, so an edit reaches the SAME customer.
    const shouldAdvance =
      canSubmitForVerification({ profile, acceptance, providerConfigured }) &&
      (!hasSubmission || Boolean(args.sensitive?.businessTaxId || args.sensitive?.ownerTaxId))

    if (shouldAdvance) {
      const submitted = await submitForVerification({
        merchantId: args.merchantId,
        acceptance: acceptance as MerchantServiceTermsAcceptance,
        actorId: args.actorId ?? null,
        sensitive: args.sensitive,
      })

      if (submitted.ok) {
        return {
          ok: true,
          verification: projectFromProviderConnection({
            connection: submitted.connection,
            profile,
            termsAccepted: true,
          }),
          correlationId,
        }
      }

      // A failed or unknown-outcome submission must not be presented as a
      // failure the merchant caused. The projection stays "in progress" and
      // the next read retries with the same deterministic idempotency key.
      return {
        ok: true,
        verification: projectPreSubmission({ profile, acceptance, providerConfigured }),
        correlationId,
      }
    }

    if (!hasSubmission) {
      return {
        ok: true,
        verification: projectPreSubmission({ profile, acceptance, providerConfigured }),
        correlationId,
      }
    }

    // ── Project an existing submission, refreshing from the provider first
    //    when the caller needs authoritative evidence.
    let connection: BridgeConnectionState
    if (args.refresh && providerConfigured) {
      const synced = await syncBridgeConnectionEngine({ merchantId: args.merchantId })
      if (synced.ok) {
        connection = synced.connection
      } else {
        // A provider outage must never regress a merchant's displayed status.
        const stored = await getBridgeConnectionEngine({ merchantId: args.merchantId })
        if (!stored.ok) {
          return { ok: false, error: stored.error, retryable: true, correlationId }
        }
        connection = stored.connection
      }
    } else {
      const stored = await getBridgeConnectionEngine({ merchantId: args.merchantId })
      if (!stored.ok) {
        return { ok: false, error: stored.error, retryable: true, correlationId }
      }
      connection = stored.connection
    }

    return {
      ok: true,
      verification: projectFromProviderConnection({
        connection,
        profile,
        termsAccepted: isServiceTermsAcceptanceCurrent(acceptance, "bridge"),
      }),
      correlationId,
    }
  } catch (error) {
    console.error("[business-verification] read_failed", {
      correlationId,
      error: error instanceof Error ? error.message : "unknown",
    })
    return {
      ok: false,
      error: "Unable to load your verification status right now.",
      retryable: true,
      correlationId,
    }
  }
}

/**
 * Create the provider onboarding for a consented merchant.
 *
 * Internal. Callers must have already established consent; the consent record
 * is passed through so the provider layer can refuse without it.
 */
async function submitForVerification(input: {
  merchantId: string
  acceptance: MerchantServiceTermsAcceptance
  actorId: string | null
  sensitive?: BusinessVerificationSensitiveInput
}): Promise<{ ok: true; connection: BridgeConnectionState } | { ok: false }> {
  const result = await ensureBridgeCustomerEngine({
    merchantId: input.merchantId,
    consentTermsVersion: input.acceptance.termsVersion,
    consentAcceptedAt: input.acceptance.acceptedAt,
    actorId: input.actorId,
    sensitive: input.sensitive,
  })

  if (!result.ok) return { ok: false }

  if (!result.reused) {
    await insertMerchantAuditEvent({
      merchantId: input.merchantId,
      eventType: "onboarding.business_verification_submitted",
      actorId: input.actorId,
      metadata: {
        terms_version: input.acceptance.termsVersion,
        terms_accepted_at: input.acceptance.acceptedAt,
      },
    })
  }

  return { ok: true, connection: result.connection }
}

/**
 * Record the merchant's acceptance of PineTree's terms and the required
 * service-provider disclosure, then immediately advance verification.
 *
 * Idempotent: accepting twice reuses the same consent record and the same
 * provider customer.
 */
export async function acceptServiceTermsEngine(args: {
  merchantId: string
  actorId: string
  termsVersion: string
  sourceIp?: string | null
  userAgent?: string | null
}): Promise<BusinessVerificationResult> {
  const correlationId = randomUUID()

  // The client tells PineTree which terms it displayed. If that is not the
  // current version, the merchant consented to something else - refuse rather
  // than record consent the merchant never saw.
  if (args.termsVersion !== CURRENT_SERVICE_TERMS_VERSION) {
    return {
      ok: false,
      error: "These terms are out of date. Reload the page and review the current terms.",
      retryable: false,
      correlationId,
    }
  }

  try {
    const profile = await getMerchantBusinessProfile(args.merchantId)
    if (profile.profile_status !== "complete") {
      return {
        ok: false,
        error: "Complete your business profile before accepting the service terms.",
        retryable: false,
        correlationId,
      }
    }

    const acceptance = await recordServiceTermsAcceptance({
      merchantId: args.merchantId,
      termsVersion: CURRENT_SERVICE_TERMS_VERSION,
      disclosedProviders: DISCLOSED_SERVICE_PROVIDERS,
      actorUserId: args.actorId,
      sourceIp: args.sourceIp ?? null,
      userAgent: args.userAgent ?? null,
    })

    await insertMerchantAuditEvent({
      merchantId: args.merchantId,
      eventType: "onboarding.service_terms_accepted",
      actorId: args.actorId,
      metadata: {
        terms_version: acceptance.termsVersion,
        disclosed_providers: acceptance.disclosedProviders,
        accepted_at: acceptance.acceptedAt,
      },
    })

    // Accepting consent is exactly the moment submission becomes permitted,
    // so advance immediately rather than making the merchant wait for a
    // later page load.
    return getBusinessVerificationEngine({
      merchantId: args.merchantId,
      actorId: args.actorId,
    })
  } catch (error) {
    console.error("[business-verification] consent_failed", {
      correlationId,
      error: error instanceof Error ? error.message : "unknown",
    })
    return {
      ok: false,
      error: "Unable to record your acceptance right now.",
      retryable: true,
      correlationId,
    }
  }
}

/**
 * Hand the merchant into the provider-hosted compliance step.
 *
 * The hosted URL is a single-use capability: it is fetched on demand, returned
 * only to the authenticated merchant who asked for it, and never stored.
 *
 * Bridge does not document iframe embedding of its hosted KYC flow, so
 * PineTree does NOT embed it. The caller performs a same-window or new-window
 * handoff and returns to a PineTree route, where status is re-synchronized
 * from the provider rather than inferred from the return itself.
 */
export async function continueBusinessVerificationEngine(args: {
  merchantId: string
  actorId?: string | null
  /** Where the provider returns the merchant's browser after its terms step. */
  termsReturnUrl?: string | null
}): Promise<
  | { ok: true; verificationUrl: string | null; verification: BusinessVerificationState; correlationId: string }
  | { ok: false; error: string; retryable: boolean; correlationId: string }
> {
  const correlationId = randomUUID()

  try {
    const [profile, acceptance] = await Promise.all([
      getMerchantBusinessProfile(args.merchantId),
      getLatestServiceTermsAcceptance(args.merchantId),
    ])

    if (!canSubmitForVerification({ profile, acceptance, providerConfigured: isBridgeConfigured() })) {
      const current = await getBusinessVerificationEngine({ merchantId: args.merchantId })
      if (!current.ok) return current
      return {
        ok: false,
        error:
          current.verification.status === "temporarily_unavailable"
            ? "Verification is temporarily unavailable. PineTree will continue automatically."
            : "Finish your business profile and accept the service terms to continue verification.",
        retryable: current.verification.status === "temporarily_unavailable",
        correlationId,
      }
    }

    const result = await ensureBridgeOnboardingEngine({
      merchantId: args.merchantId,
      consentTermsVersion: (acceptance as MerchantServiceTermsAcceptance).termsVersion,
      consentAcceptedAt: (acceptance as MerchantServiceTermsAcceptance).acceptedAt,
      actorId: args.actorId ?? null,
      wantHostedUrl: true,
    })

    if (!result.ok) {
      // The provider requires its own terms acceptance before it will process
      // verification. That is a provider-hosted step, and this is the one place
      // besides the consent disclosure where the merchant leaves PineTree.
      if ("requiresProviderTerms" in result && result.requiresProviderTerms && args.termsReturnUrl) {
        const terms = await requestBridgeTermsLinkEngine({
          merchantId: args.merchantId,
          returnUrl: args.termsReturnUrl,
        })
        if (terms.ok) {
          const current = await getBusinessVerificationEngine({ merchantId: args.merchantId })
          return {
            ok: true,
            verificationUrl: terms.termsUrl,
            verification: current.ok
              ? current.verification
              : projectPreSubmission({ profile, acceptance, providerConfigured: true }),
            correlationId,
          }
        }
      }

      return {
        ok: false,
        error: "Unable to continue verification right now. Your information is saved.",
        retryable: result.retryable,
        correlationId,
      }
    }

    return {
      ok: true,
      // The provider-hosted step for whatever it still needs and PineTree does
      // not hold, so identity documents never transit PineTree.
      verificationUrl: result.tosUrl || result.kycUrl,
      verification: projectFromProviderConnection({
        connection: result.connection,
        profile,
        termsAccepted: true,
      }),
      correlationId,
    }
  } catch (error) {
    console.error("[business-verification] continue_failed", {
      correlationId,
      error: error instanceof Error ? error.message : "unknown",
    })
    return {
      ok: false,
      error: "Unable to continue verification right now.",
      retryable: true,
      correlationId,
    }
  }
}

/** The current terms bundle a merchant must accept, for the consent UI. */
export function getServiceTermsDisclosure() {
  return {
    version: CURRENT_SERVICE_TERMS_VERSION,
    /**
     * Plain merchant-facing disclosure. Bridge is named here because this is
     * exactly the required legal/provider disclosure context - the one place
     * outside admin diagnostics where naming the partner is correct.
     */
    summary: [
      "PineTree uses regulated payment and financial infrastructure partners to provide wallet, conversion, and settlement services.",
      "Your business and representative information may be shared with those partners for identity verification, compliance, fraud prevention, payment processing, and settlement.",
      "Additional documentation may be required, and approval is not guaranteed.",
      "PineTree remains your platform and point of contact throughout.",
    ],
    providers: [
      {
        name: "Bridge",
        role: "Wallet, stablecoin conversion, and settlement infrastructure",
        termsUrl: "https://www.bridge.xyz/legal",
      },
    ],
  }
}
