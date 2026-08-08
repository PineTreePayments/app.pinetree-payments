/**
 * PineTree Engine - Bridge (by Stripe) provider connection.
 *
 * This module owns ALL Bridge state transitions. The provider adapter talks to
 * Bridge and normalizes its vocabulary; the API routes are thin wrappers; the
 * UI displays. Nothing outside this module writes Bridge state.
 *
 * Bridge is NOT Stripe Connect. A merchant with a Stripe connected account is
 * not approved by Bridge, and this module never reads Stripe state to decide a
 * Bridge outcome.
 *
 * ── Approval evidence ────────────────────────────────────────────────────────
 * A browser redirect back from the hosted KYB flow is NOT proof of approval -
 * it only means the merchant's browser returned. Approval comes exclusively
 * from a Bridge status lookup or a signature-verified Bridge webhook.
 *
 * ── Duplicate prevention ─────────────────────────────────────────────────────
 * Onboarding reuses the stored Bridge customer / KYC link when one exists, and
 * otherwise sends a DETERMINISTIC idempotency key derived from the merchant
 * id. A merchant who restarts onboarding therefore never gets a second Bridge
 * customer, even if PineTree's own record was lost.
 */

import { createHash, randomUUID } from "node:crypto"

import {
  BRIDGE_PROVIDER_MODEL,
  BRIDGE_PROVIDER_NAME,
  bridgeCredentialsFromConnection,
  claimBridgeWebhookEvent,
  findMerchantByBridgeIdentifiers,
  getMerchantBridgeConnection,
  markBridgeWebhookEventProcessed,
  sanitizeBridgeCredentials,
  upsertMerchantBridgeConnection,
  type BridgeCredentials,
  type BridgeWebhookSkippedReason,
  type MerchantBridgeConnectionRow,
} from "@/database/merchantBridgeConnections"
import { insertMerchantAuditEvent } from "@/database/merchantAuditEvents"
import { getMerchantBusinessProfile } from "@/engine/businessProfile"
import {
  buildBridgeCustomerPayload,
  taxIdentifierLast4,
  type BusinessVerificationSensitiveInput,
} from "@/engine/bridgeCustomerPayload"
import { bridgeAdapter } from "@/providers/bridge/adapter"
import {
  describeBridgeConfiguration,
  getBridgeConfig,
  isBridgeConfigured,
  isBridgeSandbox,
  BridgeConfigError,
} from "@/providers/bridge/config"
import {
  bridgeActionRequiredDetail,
  buildBridgeConnectionState,
  emptyBridgeConnection,
  isBridgeApproved,
  normalizeBridgeConnection,
  resolveBridgeProviderState,
} from "@/providers/bridge/normalize"
import {
  describeBridgeError,
  isBridgeUnknownOutcomeError,
} from "@/providers/bridge/errors"
import {
  isBridgeDrainEventCategory,
  translateBridgeEvent,
  type NormalizedBridgeConnectionEvent,
} from "@/providers/bridge/translateEvent"
import { createTosLink, simulateKycApproval } from "@/providers/bridge/client"
import { bridgeOnboardingIdempotencyKey } from "@/providers/bridge/idempotency"
import {
  BRIDGE_SIGNATURE_HEADER,
  verifyBridgeWebhookSignature,
} from "@/providers/bridge/verifyWebhook"
import type {
  BridgeBusinessCustomerPayload,
  BridgeConnectionState,
  NormalizedBridgeConnection,
  PineTreeProviderState,
} from "@/providers/bridge/types"

export type BridgeEngineFailure = {
  ok: false
  error: string
  /** True when the caller may safely retry the identical request. */
  retryable: boolean
  correlationId: string
}

function failure(error: string, correlationId: string, retryable = false): BridgeEngineFailure {
  return { ok: false, error, retryable, correlationId }
}

/**
 * Map a normalized provider state onto the `merchant_providers` row
 * vocabulary. `enabled` is only ever true for an approved, merchant-enabled
 * connection - the row can never claim readiness Bridge has not granted.
 */
function rowStateForProviderState(
  state: PineTreeProviderState,
  approved: boolean,
  enabled: boolean
): { status: string; enabled: boolean } {
  if (state === "enabled") return { status: "active", enabled: true }
  if (state === "connected" || state === "disabled") {
    return { status: "connected", enabled: approved && enabled }
  }
  if (state === "requested") return { status: "pending", enabled: false }
  if (state === "action_required") return { status: "action_required", enabled: false }
  return { status: "not_started", enabled: false }
}

function currentEnvironment(): "sandbox" | "production" | null {
  try {
    return getBridgeConfig().environment
  } catch {
    return null
  }
}

/** Rebuild the safe merchant-facing state from a stored row. No provider call. */
function stateFromRow(row: MerchantBridgeConnectionRow | null): BridgeConnectionState {
  const credentials = row?.credentials || {}
  const connection = connectionFromCredentials(credentials)

  // Activation is re-derived rather than read from the row, so a stale
  // `enabled` flag can never present a capability as live after approval was
  // withdrawn or an administrator hold was applied.
  const activation = resolveBridgeActivation({
    approved: isBridgeApproved(connection),
    credentials,
  })

  return buildBridgeConnectionState({
    configured: isBridgeConfigured(),
    environment: currentEnvironment(),
    onboardingRequested: Boolean(credentials.onboarding_requested_at),
    connection,
    enabled: activation.active && row?.enabled === true,
    enablementDecisionMade: activation.decided,
    lastSyncedAt: credentials.last_synced_at || null,
  })
}

/**
 * Reconstruct the normalized connection from persisted credentials.
 *
 * Reads flow through the same normalizer as provider responses so a stored row
 * and a fresh Bridge read can never disagree about what a status means.
 */
function connectionFromCredentials(credentials: BridgeCredentials): NormalizedBridgeConnection {
  if (!credentials.bridge_customer_id && !credentials.bridge_kyc_link_id) {
    return emptyBridgeConnection()
  }

  const normalized = normalizeBridgeConnection({
    customer: credentials.bridge_customer_id
      ? {
          id: credentials.bridge_customer_id,
          status: credentials.bridge_customer_status,
          kyc_status: credentials.bridge_kyc_status,
          requirements_due: credentials.bridge_requirements_due,
          future_requirements_due: credentials.bridge_future_requirements_due,
          created_at: credentials.provider_created_at,
          updated_at: credentials.provider_updated_at,
        }
      : null,
    kycLink: credentials.bridge_kyc_link_id
      ? {
          id: credentials.bridge_kyc_link_id,
          customer_id: credentials.bridge_customer_id || null,
          kyc_status: credentials.bridge_kyc_status,
          tos_status: credentials.bridge_tos_status,
        }
      : null,
  })

  // Endorsements are stored already normalized, so they are restored directly
  // rather than round-tripped through the provider shape.
  const endorsements = Array.isArray(credentials.bridge_endorsements)
    ? credentials.bridge_endorsements
    : []

  return {
    ...normalized,
    endorsements,
    baseEndorsementApproved: credentials.bridge_base_endorsement_approved === true,
  }
}

/** Persist a normalized connection and return the resulting safe state. */
/**
 * PineTree rollout control for the Bridge-backed wallet capability.
 *
 * Set to exactly "false" to hold activation back across the whole deployment
 * during a controlled rollout. Absent or any other value leaves activation
 * enabled, so a normal deployment needs no flag.
 */
export function isBridgeCapabilityRolloutEnabled(): boolean {
  return String(process.env.BRIDGE_CAPABILITY_ROLLOUT_ENABLED || "").trim().toLowerCase() !== "false"
}

export type BridgeActivationDecision = {
  /** True when the Bridge-backed wallet capability is live for this merchant. */
  active: boolean
  /** True when PineTree has made an activation decision at all. */
  decided: boolean
  /** Set the first time activation happens; never cleared once set. */
  autoActivatedAt: string | undefined
  /** Why activation has not happened, for diagnostics only. */
  blockedReason: "not_approved" | "administrator_hold" | "rollout_disabled" | null
}

/**
 * Decide whether the Bridge-backed capability is active.
 *
 * There is NO merchant input here. Activation is a pure consequence of:
 * Bridge approval + no administrator hold + rollout eligibility. A merchant
 * can neither turn it on early nor turn it off, which is what keeps approval
 * authority with Bridge rather than with the browser.
 */
export function resolveBridgeActivation(input: {
  approved: boolean
  credentials: BridgeCredentials
  now?: string
}): BridgeActivationDecision {
  const adminBlocked = Boolean(input.credentials.admin_activation_blocked_at)
  const rolloutEnabled = isBridgeCapabilityRolloutEnabled()
  const previouslyActivatedAt = input.credentials.auto_activated_at

  if (!input.approved) {
    return { active: false, decided: false, autoActivatedAt: previouslyActivatedAt, blockedReason: "not_approved" }
  }
  if (adminBlocked) {
    return { active: false, decided: true, autoActivatedAt: previouslyActivatedAt, blockedReason: "administrator_hold" }
  }
  if (!rolloutEnabled) {
    return { active: false, decided: true, autoActivatedAt: previouslyActivatedAt, blockedReason: "rollout_disabled" }
  }

  return {
    active: true,
    decided: true,
    // The first activation timestamp is retained so an auditor can see when
    // the capability went live, even across later re-syncs.
    autoActivatedAt: previouslyActivatedAt || input.now || new Date().toISOString(),
    blockedReason: null,
  }
}

async function persistConnection(input: {
  merchantId: string
  existing: BridgeCredentials
  connection: NormalizedBridgeConnection
  onboardingRequestedAt?: string
  extraCredentials?: Partial<BridgeCredentials>
}): Promise<{ state: BridgeConnectionState; activation: BridgeActivationDecision }> {
  const syncedAt = new Date().toISOString()
  const approved = isBridgeApproved(input.connection)
  const onboardingRequestedAt = input.onboardingRequestedAt || input.existing.onboarding_requested_at

  // Merge any caller-supplied credential patch BEFORE deciding activation, so
  // an administrator hold applied in the same call takes effect immediately.
  const pendingCredentials: BridgeCredentials = { ...input.existing, ...(input.extraCredentials || {}) }
  const activation = resolveBridgeActivation({
    approved,
    credentials: pendingCredentials,
    now: syncedAt,
  })

  const state = resolveBridgeProviderState({
    configured: isBridgeConfigured(),
    onboardingRequested: Boolean(onboardingRequestedAt),
    connection: input.connection,
    enabled: activation.active,
    enablementDecisionMade: activation.decided,
  })

  const credentials = sanitizeBridgeCredentials({
    ...bridgeCredentialsFromConnection({
      existing: input.existing,
      connection: input.connection,
      connectionStatus: state,
      actionRequired: state === "action_required" ? bridgeActionRequiredDetail(input.connection) : null,
      environment: currentEnvironment(),
      syncedAt,
    }),
    ...(onboardingRequestedAt ? { onboarding_requested_at: onboardingRequestedAt } : {}),
    ...(input.extraCredentials || {}),
    ...(activation.autoActivatedAt ? { auto_activated_at: activation.autoActivatedAt } : {}),
  })

  const row = rowStateForProviderState(state, approved, activation.active)
  await upsertMerchantBridgeConnection({
    merchantId: input.merchantId,
    status: row.status,
    enabled: row.enabled,
    credentials,
  })

  return {
    state: buildBridgeConnectionState({
      configured: isBridgeConfigured(),
      environment: currentEnvironment(),
      onboardingRequested: Boolean(onboardingRequestedAt),
      connection: input.connection,
      enabled: row.enabled,
      enablementDecisionMade: activation.decided,
      lastSyncedAt: syncedAt,
    }),
    activation,
  }
}

// ─── Read ────────────────────────────────────────────────────────────────────

/**
 * The merchant's stored Bridge state. A pure database read - it never contacts
 * Bridge, so a dashboard render cannot be delayed by provider latency.
 */
export async function getBridgeConnectionEngine(args: {
  merchantId: string
}): Promise<{ ok: true; connection: BridgeConnectionState } | BridgeEngineFailure> {
  const correlationId = randomUUID()
  try {
    const row = await getMerchantBridgeConnection(args.merchantId)
    return { ok: true, connection: stateFromRow(row) }
  } catch (error) {
    console.error("[bridge] connection_read_failed", {
      correlationId,
      ...describeBridgeError(error),
    })
    return failure("Unable to load Bridge status right now.", correlationId, true)
  }
}

// ─── Onboarding ──────────────────────────────────────────────────────────────

export type StartBridgeOnboardingResult = {
  ok: true
  /** Hosted Bridge KYB URL. Returned to the requesting merchant only, never stored. */
  kycUrl: string | null
  /** Hosted Bridge terms-of-service URL. Returned to the merchant only. */
  tosUrl: string | null
  /** True when an existing Bridge onboarding was reused rather than created. */
  reused: boolean
  connection: BridgeConnectionState
  correlationId: string
}

/**
 * Fingerprint of a submitted customer payload.
 *
 * Comparing fingerprints is what makes a Business Profile edit idempotent: an
 * unchanged profile produces the same value and no provider call is made at
 * all. The payload itself is never stored - only this digest.
 */
function customerPayloadRevision(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32)
}

/**
 * Resolve the Bridge terms agreement that authorizes creating this customer.
 *
 * PRODUCTION: Bridge requires a real `signed_agreement_id`, obtained when the
 * merchant accepts Bridge's own terms on Bridge's hosted page. Without one,
 * PineTree does not create a customer - it asks the merchant to complete that
 * step first.
 *
 * SANDBOX: Bridge documents that sandbox customers are created via the API and
 * that a production signed-agreement id "cannot be arbitrary" - i.e. sandbox
 * accepts a synthetic one. PineTree derives it deterministically so a retry
 * reuses the same value. This branch is unreachable in production: it is gated
 * on the explicit, fail-closed BRIDGE_ENVIRONMENT check.
 */
function resolveSignedAgreement(input: {
  merchantId: string
  credentials: BridgeCredentials
}): { agreementId: string | null; synthetic: boolean } {
  const stored = String(input.credentials.bridge_signed_agreement_id || "").trim()
  if (stored) {
    return { agreementId: stored, synthetic: input.credentials.bridge_signed_agreement_synthetic === true }
  }

  if (!isBridgeSandbox()) return { agreementId: null, synthetic: false }

  const digest = createHash("sha256").update(`pinetree.bridge.sandbox.tos|${input.merchantId}`).digest("hex")
  // Shaped as a UUID because Bridge documents the field as a UUID string.
  const uuid = [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `8${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-")
  return { agreementId: uuid, synthetic: true }
}

export type BridgeTermsLinkResult =
  | { ok: true; termsUrl: string; correlationId: string }
  | BridgeEngineFailure

/**
 * Request the Bridge-hosted terms page the merchant must accept before KYB.
 *
 * The URL is a bearer capability handed straight back to the authenticated
 * merchant who asked for it. It is never persisted. Bridge appends
 * `signed_agreement_id` to the PineTree return route, which is captured
 * server-side by recordBridgeSignedAgreementEngine.
 */
export async function requestBridgeTermsLinkEngine(args: {
  merchantId: string
  returnUrl: string
}): Promise<BridgeTermsLinkResult> {
  const correlationId = randomUUID()

  if (!isBridgeConfigured()) {
    return failure("Verification is temporarily unavailable.", correlationId)
  }

  try {
    const result = await createTosLink({
      idempotencyKey: bridgeOnboardingIdempotencyKey({ merchantId: args.merchantId }),
      redirectUri: args.returnUrl,
      context: { correlationId, merchantId: args.merchantId },
    })

    const url = String(result.data.url || "").trim()
    if (!url) {
      return failure("Verification is temporarily unavailable.", correlationId, true)
    }
    return { ok: true, termsUrl: url, correlationId }
  } catch (error) {
    console.error("[bridge] terms_link_failed", { correlationId, ...describeBridgeError(error) })
    return failure("Verification is temporarily unavailable.", correlationId, true)
  }
}

/**
 * Capture the agreement reference Bridge returned with the merchant's browser.
 *
 * A browser return is NOT approval and does not advance verification on its
 * own. All it does is record which agreement authorizes the later submission,
 * which is then confirmed by Bridge itself when the customer is created.
 */
export async function recordBridgeSignedAgreementEngine(args: {
  merchantId: string
  signedAgreementId: string
  actorId?: string | null
}): Promise<{ ok: true; correlationId: string } | BridgeEngineFailure> {
  const correlationId = randomUUID()
  const signedAgreementId = String(args.signedAgreementId || "").trim()

  // An opaque provider reference, but it still arrives from a query string, so
  // its shape is bounded before it is stored or sent anywhere.
  if (!signedAgreementId || signedAgreementId.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(signedAgreementId)) {
    return failure("That verification link could not be read. Start the terms step again.", correlationId)
  }

  try {
    const row = await getMerchantBridgeConnection(args.merchantId)
    const existing = row?.credentials || {}
    const connection = connectionFromCredentials(existing)

    await persistConnection({
      merchantId: args.merchantId,
      existing,
      connection,
      extraCredentials: {
        bridge_signed_agreement_id: signedAgreementId,
        bridge_signed_agreement_at: new Date().toISOString(),
        bridge_signed_agreement_synthetic: false,
      },
    })

    await insertMerchantAuditEvent({
      merchantId: args.merchantId,
      eventType: "provider.bridge_terms_agreement_recorded",
      actorId: args.actorId ?? null,
      metadata: { provider: BRIDGE_PROVIDER_NAME, correlation_id: correlationId },
    })

    return { ok: true, correlationId }
  } catch (error) {
    console.error("[bridge] signed_agreement_write_failed", {
      correlationId,
      ...describeBridgeError(error),
    })
    return failure("Unable to save that step right now.", correlationId, true)
  }
}

export type BridgeCustomerEnsureResult =
  | {
      ok: true
      customerId: string
      /** True when the stored Bridge customer was reused rather than created. */
      reused: boolean
      /** True when a profile edit was pushed to the existing Bridge customer. */
      updated: boolean
      connection: BridgeConnectionState
      correlationId: string
    }
  | (BridgeEngineFailure & {
      /** PineTree Business Profile labels the merchant still owes. */
      missingProfileFields?: string[]
      /** Set when Bridge's own terms must be accepted before submission. */
      requiresProviderTerms?: boolean
    })

/**
 * Create or update the merchant's Bridge business customer from the Business
 * Profile PineTree already holds.
 *
 * This is the single submission path. Preconditions are enforced here rather
 * than by callers so no future call site can bypass them:
 *   - Bridge configured for this deployment;
 *   - CONSENT: the merchant accepted the terms version that disclosed Bridge;
 *   - the Business Profile carries everything the KYB payload requires;
 *   - Bridge's own terms agreement exists (or is sandbox-synthesized).
 *
 * Duplicate prevention is twofold: the stored customer id is reused when one
 * exists, and creation otherwise sends a DETERMINISTIC idempotency key derived
 * from the merchant id, so even a lost PineTree record cannot produce a second
 * Bridge customer.
 */
export async function ensureBridgeCustomerEngine(args: {
  merchantId: string
  /** Terms version whose acceptance authorizes this submission. Required. */
  consentTermsVersion: string
  consentAcceptedAt: string
  actorId?: string | null
  /** Request-scoped tax identifiers. Never persisted. */
  sensitive?: BusinessVerificationSensitiveInput
}): Promise<BridgeCustomerEnsureResult> {
  const correlationId = randomUUID()

  if (!isBridgeConfigured()) {
    return failure("Verification is temporarily unavailable.", correlationId)
  }

  // Consent is a hard gate on customer creation, not a UI nicety. An empty
  // version means no verified acceptance reached this call.
  if (!String(args.consentTermsVersion || "").trim()) {
    console.warn("[bridge] submission_blocked_without_consent", {
      correlationId,
      merchantId: args.merchantId,
    })
    return failure("Accept the PineTree service terms before verification can begin.", correlationId)
  }

  let row: MerchantBridgeConnectionRow | null
  try {
    row = await getMerchantBridgeConnection(args.merchantId)
  } catch (error) {
    console.error("[bridge] submission_read_failed", { correlationId, ...describeBridgeError(error) })
    return failure("Unable to continue verification right now.", correlationId, true)
  }

  const existing = row?.credentials || {}
  const now = new Date().toISOString()

  let profile: Awaited<ReturnType<typeof getMerchantBusinessProfile>>
  try {
    profile = await getMerchantBusinessProfile(args.merchantId)
  } catch (error) {
    console.error("[bridge] submission_profile_read_failed", {
      correlationId,
      ...describeBridgeError(error),
    })
    return failure("Unable to continue verification right now.", correlationId, true)
  }

  const agreement = resolveSignedAgreement({ merchantId: args.merchantId, credentials: existing })
  const built = buildBridgeCustomerPayload({
    profile,
    sensitive: args.sensitive,
    signedAgreementId: agreement.agreementId,
  })

  if (!built.ok) {
    return {
      ...failure("Add the remaining details to your Business Profile to continue.", correlationId),
      missingProfileFields: built.missing,
    }
  }

  const sensitiveLast4 = {
    ...(taxIdentifierLast4(args.sensitive?.businessTaxId)
      ? { bridge_business_tax_id_last4: taxIdentifierLast4(args.sensitive?.businessTaxId) as string }
      : {}),
    ...(taxIdentifierLast4(args.sensitive?.ownerTaxId)
      ? { bridge_owner_tax_id_last4: taxIdentifierLast4(args.sensitive?.ownerTaxId) as string }
      : {}),
    ...(args.sensitive?.businessTaxId || args.sensitive?.ownerTaxId
      ? { bridge_identity_submitted_at: now }
      : {}),
  }

  const revision = customerPayloadRevision(built.payload)

  // ── Update path: a Bridge customer already exists for this merchant.
  const storedCustomerId = String(existing.bridge_customer_id || "").trim()
  if (storedCustomerId) {
    const unchanged = existing.bridge_customer_revision === revision && !args.sensitive?.businessTaxId &&
      !args.sensitive?.ownerTaxId

    try {
      if (!unchanged) {
        await bridgeAdapter.updateMerchant({
          customerId: storedCustomerId,
          // `type` and the signed agreement are creation-time facts; resending
          // them on an update is neither required nor meaningful.
          payload: stripCreationOnlyFields(built.payload),
          revision,
          merchantId: args.merchantId,
          context: { correlationId, merchantId: args.merchantId },
        })
      }

      const { connection } = await bridgeAdapter.syncAccount({
        customerId: storedCustomerId,
        kycLinkId: existing.bridge_kyc_link_id || null,
        context: { correlationId, merchantId: args.merchantId },
      })

      const { state } = await persistConnection({
        merchantId: args.merchantId,
        existing,
        connection,
        onboardingRequestedAt: existing.onboarding_requested_at || now,
        extraCredentials: {
          ...sensitiveLast4,
          bridge_customer_revision: revision,
          ...(unchanged ? {} : { bridge_customer_submitted_at: now }),
        },
      })

      if (!unchanged) {
        await insertMerchantAuditEvent({
          merchantId: args.merchantId,
          eventType: "provider.bridge_customer_updated",
          actorId: args.actorId ?? null,
          metadata: {
            provider: BRIDGE_PROVIDER_NAME,
            bridge_customer_id: storedCustomerId,
            correlation_id: correlationId,
          },
        })
      }

      return {
        ok: true,
        customerId: storedCustomerId,
        reused: true,
        updated: !unchanged,
        connection: state,
        correlationId,
      }
    } catch (error) {
      const unknown = isBridgeUnknownOutcomeError(error)
      console.error("[bridge] customer_update_failed", {
        correlationId,
        merchantId: args.merchantId,
        ...describeBridgeError(error),
      })
      return failure(
        unknown
          ? "Verification did not respond in time. Nothing was lost - try again in a moment."
          : "Unable to continue verification right now.",
        correlationId,
        true
      )
    }
  }

  // ── Create path.
  if (!agreement.agreementId) {
    return {
      ...failure("One more step is needed before verification can begin.", correlationId),
      requiresProviderTerms: true,
    }
  }

  try {
    const result = await bridgeAdapter.connectMerchant({
      merchantId: args.merchantId,
      payload: built.payload,
      context: { correlationId, merchantId: args.merchantId },
    })

    const { state } = await persistConnection({
      merchantId: args.merchantId,
      existing,
      connection: result.connection,
      onboardingRequestedAt: now,
      extraCredentials: {
        // The consent that authorized this submission is recorded on the
        // connection so the authorization is auditable alongside the customer
        // it created.
        consent_terms_version: args.consentTermsVersion,
        consent_accepted_at: args.consentAcceptedAt,
        bridge_signed_agreement_id: agreement.agreementId,
        bridge_signed_agreement_synthetic: agreement.synthetic,
        bridge_signed_agreement_at: existing.bridge_signed_agreement_at || now,
        bridge_customer_revision: revision,
        bridge_customer_submitted_at: now,
        ...sensitiveLast4,
      },
    })

    await insertMerchantAuditEvent({
      merchantId: args.merchantId,
      eventType: "provider.bridge_onboarding_started",
      actorId: args.actorId ?? null,
      metadata: {
        provider: BRIDGE_PROVIDER_NAME,
        provider_model: BRIDGE_PROVIDER_MODEL,
        bridge_customer_id: result.customerId,
        consent_terms_version: args.consentTermsVersion,
        signed_agreement_synthetic: agreement.synthetic,
        correlation_id: correlationId,
      },
    })

    return {
      ok: true,
      customerId: result.customerId,
      reused: false,
      updated: false,
      connection: state,
      correlationId,
    }
  } catch (error) {
    if (error instanceof BridgeConfigError) {
      return failure("Verification is temporarily unavailable.", correlationId)
    }

    const unknown = isBridgeUnknownOutcomeError(error)
    console.error("[bridge] customer_create_failed", {
      correlationId,
      merchantId: args.merchantId,
      ...describeBridgeError(error),
    })

    // A timeout is NOT a failure: Bridge may already hold the customer. The
    // deterministic idempotency key means retrying returns that same object,
    // so the merchant is told to retry rather than that verification failed.
    return failure(
      unknown
        ? "Verification did not respond in time. Nothing was lost - try again in a moment."
        : "Unable to continue verification right now.",
      correlationId,
      true
    )
  }
}

/**
 * Fields that only make sense when the customer is first created.
 *
 * Resending a signed agreement or an endorsement request on an update is
 * neither required nor meaningful, and endorsements are already granted or
 * pending by then.
 */
function stripCreationOnlyFields(
  payload: BridgeBusinessCustomerPayload
): Partial<BridgeBusinessCustomerPayload> {
  const { signed_agreement_id: _agreement, endorsements: _endorsements, ...rest } = payload
  return rest
}

/**
 * SANDBOX ONLY: simulate KYB approval for a merchant's Bridge customer.
 *
 * Exists so PineTree can exercise the whole merchant journey without a real
 * KYB provider. It is administrator-authorized by the caller and FAILS CLOSED
 * here on the environment: production is refused regardless of what any UI
 * sends, and there is no merchant-facing equivalent.
 */
export async function simulateBridgeKybApprovalEngine(args: {
  merchantId: string
  adminId: string
}): Promise<{ ok: true; connection: BridgeConnectionState } | BridgeEngineFailure> {
  const correlationId = randomUUID()

  if (!String(args.adminId || "").trim()) {
    return failure("An administrator identity is required.", correlationId)
  }
  if (!isBridgeSandbox()) {
    console.warn("[bridge] simulate_approval_refused_outside_sandbox", { correlationId })
    return failure("Verification simulation is available in sandbox only.", correlationId)
  }

  let row: MerchantBridgeConnectionRow | null
  try {
    row = await getMerchantBridgeConnection(args.merchantId)
  } catch (error) {
    console.error("[bridge] simulate_read_failed", { correlationId, ...describeBridgeError(error) })
    return failure("Unable to load this merchant right now.", correlationId, true)
  }

  const existing = row?.credentials || {}
  const customerId = String(existing.bridge_customer_id || "").trim()
  if (!customerId) {
    return failure("This merchant has no verification customer to simulate.", correlationId)
  }

  try {
    await simulateKycApproval({
      customerId,
      idempotencyKey: `${bridgeOnboardingIdempotencyKey({ merchantId: args.merchantId })}.simulate`,
      context: { correlationId, merchantId: args.merchantId },
    })

    // Approval still comes from a Bridge READ, not from the simulate response.
    const { connection } = await bridgeAdapter.syncAccount({
      customerId,
      kycLinkId: existing.bridge_kyc_link_id || null,
      context: { correlationId, merchantId: args.merchantId },
    })

    const { state } = await persistConnection({
      merchantId: args.merchantId,
      existing,
      connection,
      extraCredentials: { sandbox_simulated_approval_at: new Date().toISOString() },
    })

    await insertMerchantAuditEvent({
      merchantId: args.merchantId,
      eventType: "provider.bridge_sandbox_approval_simulated",
      actorId: args.adminId,
      metadata: {
        provider: BRIDGE_PROVIDER_NAME,
        bridge_customer_id: customerId,
        correlation_id: correlationId,
      },
    })

    return { ok: true, connection: state }
  } catch (error) {
    console.error("[bridge] simulate_failed", { correlationId, ...describeBridgeError(error) })
    return failure("Unable to simulate verification approval right now.", correlationId, true)
  }
}

/**
 * Ensure the merchant has Bridge onboarding.
 *
 * Thin orchestration over `ensureBridgeCustomerEngine`: PineTree submits the
 * business customer directly from the Business Profile it already holds, then -
 * only when Bridge still needs material PineTree does not hold - hands back the
 * hosted URL for that remaining step. This is INTERNAL Engine plumbing driven
 * by `engine/businessVerification.ts`, never by a merchant-facing
 * "Connect Bridge" action.
 */
export async function ensureBridgeOnboardingEngine(args: {
  merchantId: string
  /** Terms version whose acceptance authorizes this submission. Required. */
  consentTermsVersion: string
  consentAcceptedAt: string
  actorId?: string | null
  /** Request-scoped tax identifiers. Never persisted. */
  sensitive?: BusinessVerificationSensitiveInput
  /** Set when the caller intends to hand the merchant into a hosted step. */
  wantHostedUrl?: boolean
}): Promise<StartBridgeOnboardingResult | BridgeEngineFailure> {
  const ensured = await ensureBridgeCustomerEngine(args)
  if (!ensured.ok) return ensured

  const hosted =
    args.wantHostedUrl && !ensured.connection.approved
      ? await hostedVerificationUrl({
          merchantId: args.merchantId,
          customerId: ensured.customerId,
          correlationId: ensured.correlationId,
        })
      : null

  return {
    ok: true,
    kycUrl: hosted,
    tosUrl: null,
    reused: ensured.reused,
    connection: ensured.connection,
    correlationId: ensured.correlationId,
  }
}

/**
 * Fetch the hosted step URL for an existing Bridge customer.
 *
 * The URL is a bearer capability, so PineTree never stores it: it is fetched on
 * demand and handed straight back to the authenticated merchant who asked for
 * it. Losing it is a degraded experience, never a state change.
 */
async function hostedVerificationUrl(input: {
  merchantId: string
  customerId: string
  correlationId: string
}): Promise<string | null> {
  try {
    return await bridgeAdapter.getHostedVerificationUrl({
      customerId: input.customerId,
      context: { correlationId: input.correlationId, merchantId: input.merchantId },
    })
  } catch (error) {
    console.warn("[bridge] hosted_link_fetch_failed", {
      correlationId: input.correlationId,
      ...describeBridgeError(error),
    })
    return null
  }
}

// ─── Sync ────────────────────────────────────────────────────────────────────

/**
 * Re-read Bridge and synchronize PineTree's stored state.
 *
 * This is the authoritative approval check, and the point at which an approved
 * merchant's capability is AUTOMATICALLY activated. It is what the PineTree
 * verification refresh calls, and what a post-redirect page uses instead of
 * trusting the redirect.
 */
export async function syncBridgeConnectionEngine(args: {
  merchantId: string
}): Promise<{ ok: true; connection: BridgeConnectionState } | BridgeEngineFailure> {
  const correlationId = randomUUID()

  if (!isBridgeConfigured()) {
    return failure("Bridge is not available yet.", correlationId)
  }

  let row: MerchantBridgeConnectionRow | null
  try {
    row = await getMerchantBridgeConnection(args.merchantId)
  } catch (error) {
    console.error("[bridge] sync_read_failed", { correlationId, ...describeBridgeError(error) })
    return failure("Unable to refresh Bridge status right now.", correlationId, true)
  }

  const existing = row?.credentials || {}
  if (!existing.bridge_customer_id && !existing.bridge_kyc_link_id) {
    // Nothing to sync: the merchant has not started Bridge onboarding.
    return { ok: true, connection: stateFromRow(row) }
  }

  try {
    const { connection } = await bridgeAdapter.syncAccount({
      customerId: existing.bridge_customer_id || null,
      kycLinkId: existing.bridge_kyc_link_id || null,
      context: { correlationId, merchantId: args.merchantId },
    })

    const alreadyActivated = Boolean(existing.auto_activated_at)
    const { state, activation } = await persistConnection({
      merchantId: args.merchantId,
      existing,
      connection,
    })

    await insertMerchantAuditEvent({
      merchantId: args.merchantId,
      eventType: "provider.bridge_status_synced",
      metadata: {
        provider: BRIDGE_PROVIDER_NAME,
        connection_status: state.state,
        approved: state.approved,
        correlation_id: correlationId,
      },
    })

    // Capability activation is automatic and audited once, the first time it
    // happens - there is no merchant action to record.
    if (activation.active && !alreadyActivated) {
      await insertMerchantAuditEvent({
        merchantId: args.merchantId,
        eventType: "provider.bridge_capability_auto_activated",
        metadata: {
          provider: BRIDGE_PROVIDER_NAME,
          activated_at: activation.autoActivatedAt ?? null,
          correlation_id: correlationId,
        },
      })
    }

    return { ok: true, connection: state }
  } catch (error) {
    console.error("[bridge] sync_failed", {
      correlationId,
      merchantId: args.merchantId,
      ...describeBridgeError(error),
    })
    return failure("Unable to refresh Bridge status right now.", correlationId, true)
  }
}

// ─── Enable / disable ────────────────────────────────────────────────────────

/**
 * Record the merchant's explicit acceptance decision.
 *
 * There is deliberately NO merchant-facing enable/disable entry point. A
 * merchant cannot turn the capability on before Bridge approves, and cannot
 * turn it off afterwards - approval authority stays with Bridge and activation
 * stays with PineTree Engine.
 *
 * This ADMINISTRATOR-ONLY hold exists solely for controlled rollout and
 * incident response. It is audited and merchant-scoped, and it never appears
 * as a merchant setup step.
 */
export async function setBridgeAdministrativeHoldEngine(args: {
  merchantId: string
  /** True to hold activation back; false to release the hold. */
  held: boolean
  /** The acting PineTree administrator. Required for the audit record. */
  adminId: string
}): Promise<{ ok: true; connection: BridgeConnectionState } | BridgeEngineFailure> {
  const correlationId = randomUUID()

  if (!String(args.adminId || "").trim()) {
    return failure("An administrator identity is required.", correlationId)
  }

  let row: MerchantBridgeConnectionRow | null
  try {
    row = await getMerchantBridgeConnection(args.merchantId)
  } catch (error) {
    console.error("[bridge] admin_hold_read_failed", { correlationId, ...describeBridgeError(error) })
    return failure("Unable to update this merchant right now.", correlationId, true)
  }

  if (!row) {
    return failure("This merchant has no Bridge connection.", correlationId)
  }

  const existing = row.credentials || {}
  const connection = connectionFromCredentials(existing)

  try {
    const { state } = await persistConnection({
      merchantId: args.merchantId,
      existing,
      connection,
      extraCredentials: {
        // Releasing the hold clears the marker so the normal automatic
        // activation path can run on the next evaluation.
        admin_activation_blocked_at: args.held ? new Date().toISOString() : undefined,
      },
    })

    await insertMerchantAuditEvent({
      merchantId: args.merchantId,
      eventType: args.held
        ? "provider.bridge_admin_hold_applied"
        : "provider.bridge_admin_hold_released",
      actorId: args.adminId,
      metadata: {
        provider: BRIDGE_PROVIDER_NAME,
        connection_status: state.state,
        correlation_id: correlationId,
      },
    })

    return { ok: true, connection: state }
  } catch (error) {
    console.error("[bridge] admin_hold_write_failed", {
      correlationId,
      ...describeBridgeError(error),
    })
    return failure("Unable to update this merchant right now.", correlationId, true)
  }
}

// ─── Webhook ingestion ───────────────────────────────────────────────────────

export type BridgeWebhookIngestOutcome =
  | { ok: true; applied: boolean; reason: string; correlationId: string }
  | { ok: false; status: 400 | 500; reason: string; correlationId: string }

/**
 * Read Bridge's signature header from a raw header map, case-insensitively.
 *
 * The Engine owns this lookup so the webhook route stays a thin wrapper and
 * never imports provider internals - the same boundary the Stripe and Speed
 * webhook routes follow.
 */
function readBridgeSignatureHeader(headers: Record<string, string>): string | null {
  for (const [name, value] of Object.entries(headers || {})) {
    if (name.toLowerCase() === BRIDGE_SIGNATURE_HEADER) return value
  }
  return null
}

/**
 * Ingest one Bridge webhook delivery.
 *
 * Order of operations is deliberate and must not be reordered:
 *   1. verify the signature against the RAW body
 *   2. only then parse
 *   3. claim the event id (durable dedup)
 *   4. resolve the owning merchant from stored Bridge identifiers
 *   5. apply, unless the event is older than the last applied event
 *
 * Steps 3-5 make the pipeline idempotent: a redelivery is stored once,
 * applied once, and audited once.
 */
export async function ingestBridgeWebhookEventEngine(args: {
  rawBody: string
  headers: Record<string, string>
  nowMs?: number
}): Promise<BridgeWebhookIngestOutcome> {
  const correlationId = randomUUID()

  // 1. Verify before parsing. An unverified body is never trusted or parsed
  //    into anything that could influence state.
  const verification = verifyBridgeWebhookSignature({
    rawBody: args.rawBody,
    signatureHeader: readBridgeSignatureHeader(args.headers),
    nowMs: args.nowMs,
  })

  if (!verification.valid) {
    console.warn("[bridge] webhook_rejected", { correlationId, reason: verification.reason })
    // 400 asks Bridge to retry a stale-but-genuine delivery, and refuses a
    // forged one, without disclosing which.
    return { ok: false, status: 400, reason: verification.reason, correlationId }
  }

  // 2. Parse only after verification succeeded.
  let payload: unknown
  try {
    payload = args.rawBody ? JSON.parse(args.rawBody) : {}
  } catch {
    return { ok: false, status: 400, reason: "malformed_json", correlationId }
  }

  const event = translateBridgeEvent(payload)
  if (!event) {
    // A verified but unsupported category is acknowledged, not retried:
    // Bridge did nothing wrong and redelivery would not help.
    console.info("[bridge] webhook_unsupported", { correlationId })
    return { ok: true, applied: false, reason: "unsupported_category", correlationId }
  }

  // 4. Resolve the owning merchant from PineTree's stored Bridge identifiers.
  //    Never from anything the payload asserts about a merchant. Each category
  //    resolves through the record that actually holds its identifier.
  let owner: { merchantId: string; connection: MerchantBridgeConnectionRow | null } | null = null
  try {
    owner = await resolveBridgeEventOwner(event)
  } catch (error) {
    console.error("[bridge] webhook_owner_lookup_failed", {
      correlationId,
      ...describeBridgeError(error),
    })
    return { ok: false, status: 500, reason: "owner_lookup_failed", correlationId }
  }

  // 3. Claim the event id. A duplicate delivery stops here.
  let claim: Awaited<ReturnType<typeof claimBridgeWebhookEvent>>
  try {
    claim = await claimBridgeWebhookEvent({
      providerEventId: event.eventId,
      eventCategory: event.category,
      eventType: event.type,
      bridgeCustomerId: event.customerId,
      bridgeKycLinkId: event.kycLinkId,
      bridgeExternalAccountId: event.externalAccountId,
      bridgeLiquidationAddressId: event.liquidationAddressId,
      bridgeDrainId: event.drainId,
      merchantId: owner?.merchantId || null,
      occurredAt: event.occurredAt,
      rawPayload: (payload && typeof payload === "object" ? payload : null) as Record<
        string,
        unknown
      > | null,
    })
  } catch (error) {
    console.error("[bridge] webhook_claim_failed", { correlationId, ...describeBridgeError(error) })
    return { ok: false, status: 500, reason: "claim_failed", correlationId }
  }

  if (!claim.claimed) {
    console.info("[bridge] webhook_duplicate", { correlationId, eventId: event.eventId })
    return { ok: true, applied: false, reason: "duplicate", correlationId }
  }

  if (!owner) {
    // Verified and durably stored, but PineTree does not (yet) know this
    // Bridge object. The event is retained as evidence rather than dropped.
    await markBridgeWebhookEventProcessed({ id: claim.record.id, skippedReason: "unresolved_merchant" })
    console.warn("[bridge] webhook_unresolved_merchant", { correlationId, eventId: event.eventId })
    return { ok: true, applied: false, reason: "unresolved_merchant", correlationId }
  }

  const applied = await applyVerifiedBridgeEvent({
    merchantId: owner.merchantId,
    connection: owner.connection,
    event,
    payload,
    correlationId,
  })

  await markBridgeWebhookEventProcessed({
    id: claim.record.id,
    merchantId: owner.merchantId,
    skippedReason: applied.applied ? null : (applied.reason as BridgeWebhookSkippedReason),
  })

  return { ok: true, applied: applied.applied, reason: applied.reason, correlationId }
}

/**
 * Resolve the tenant for a verified event.
 *
 * Connection events resolve through the stored Bridge customer/KYC-link ids and
 * carry their connection row straight through; bank-destination and drain
 * events resolve through the PineTree records that hold those provider
 * identifiers. In every case the merchant comes from PineTree's own stored
 * mapping, never from anything the payload asserts.
 */
async function resolveBridgeEventOwner(
  event: NormalizedBridgeConnectionEvent
): Promise<{ merchantId: string; connection: MerchantBridgeConnectionRow | null } | null> {
  if (event.category === "external_account" && event.externalAccountId) {
    const { findBankDestinationByProviderId } = await import("@/database/merchantBankDestinations")
    const destination = await findBankDestinationByProviderId(event.externalAccountId)
    if (destination) return { merchantId: destination.merchant_id, connection: null }
  }

  if (isBridgeDrainEventCategory(event.category) && event.liquidationAddressId) {
    const { findLiquidationRouteByProviderId } = await import(
      "@/database/merchantBridgeLiquidationRoutes"
    )
    const route = await findLiquidationRouteByProviderId(event.liquidationAddressId)
    if (route) return { merchantId: route.merchant_id, connection: null }
  }

  const connection = await findMerchantByBridgeIdentifiers({
    customerId: event.customerId,
    kycLinkId: event.kycLinkId,
  })
  return connection ? { merchantId: connection.merchantId, connection } : null
}

/**
 * Route a verified, deduplicated event to the lifecycle it belongs to.
 *
 * A KYB status change and a bank payout are different lifecycles. Keeping the
 * split explicit here is what stops a drain from ever touching the connection
 * state machine, or a customer status from touching a withdrawal.
 */
async function applyVerifiedBridgeEvent(input: {
  merchantId: string
  connection: MerchantBridgeConnectionRow | null
  event: NormalizedBridgeConnectionEvent
  payload: unknown
  correlationId: string
}): Promise<{ applied: boolean; reason: string }> {
  if (isBridgeDrainEventCategory(input.event.category)) {
    const { applyBridgeDrainEventEngine } = await import("@/engine/withdrawals/bankWithdrawals")
    return applyBridgeDrainEventEngine({
      merchantId: input.merchantId,
      event: input.event,
      payload: input.payload,
      correlationId: input.correlationId,
    })
  }

  if (input.event.category === "external_account") {
    const { applyBridgeExternalAccountEventEngine } = await import("@/engine/bridgeBankDestinations")
    return applyBridgeExternalAccountEventEngine({
      merchantId: input.merchantId,
      event: input.event,
      payload: input.payload,
      correlationId: input.correlationId,
    })
  }

  let owner = input.connection
  if (!owner) {
    try {
      owner = await getMerchantBridgeConnection(input.merchantId)
    } catch (error) {
      console.error("[bridge] webhook_connection_read_failed", {
        correlationId: input.correlationId,
        ...describeBridgeError(error),
      })
      return { applied: false, reason: "state_reread_failed" }
    }
  }
  if (!owner) return { applied: false, reason: "unresolved_merchant" }

  return applyBridgeEventToConnection({
    owner,
    event: input.event,
    payload: input.payload,
    correlationId: input.correlationId,
  })
}

/**
 * Apply a verified, deduplicated event to the merchant's connection.
 *
 * OUT-OF-ORDER PROTECTION: an event older than the last applied event is
 * retained but never applied, so a delayed `under_review` delivery cannot
 * regress a merchant who is already approved. A NEWER event may legitimately
 * move an approved merchant to rejected/paused/offboarded, so the guard is
 * strictly about ordering, not about status direction.
 */
async function applyBridgeEventToConnection(input: {
  owner: MerchantBridgeConnectionRow
  event: NormalizedBridgeConnectionEvent
  payload: unknown
  correlationId: string
}): Promise<{ applied: boolean; reason: string }> {
  const existing = input.owner.credentials || {}
  const lastAppliedAt = existing.last_applied_event_at
    ? Date.parse(existing.last_applied_event_at)
    : null

  if (
    lastAppliedAt !== null &&
    input.event.occurredAtMs !== null &&
    input.event.occurredAtMs < lastAppliedAt
  ) {
    console.info("[bridge] webhook_out_of_order", {
      correlationId: input.correlationId,
      eventId: input.event.eventId,
    })
    return { applied: false, reason: "out_of_order" }
  }

  // The event object is a signal, not evidence. Bridge state is re-read so
  // approval always comes from a Bridge lookup rather than a payload field.
  let connection: NormalizedBridgeConnection
  try {
    const result = await bridgeAdapter.syncAccount({
      customerId: existing.bridge_customer_id || input.event.customerId,
      kycLinkId: existing.bridge_kyc_link_id || input.event.kycLinkId,
      context: { correlationId: input.correlationId, merchantId: input.owner.merchantId },
    })
    connection = result.connection
  } catch (error) {
    console.error("[bridge] webhook_state_reread_failed", {
      correlationId: input.correlationId,
      ...describeBridgeError(error),
    })
    return { applied: false, reason: "state_reread_failed" }
  }

  const alreadyActivated = Boolean(existing.auto_activated_at)
  const { state, activation } = await persistConnection({
    merchantId: input.owner.merchantId,
    existing,
    connection,
    extraCredentials: {
      ...(input.event.occurredAt ? { last_applied_event_at: input.event.occurredAt } : {}),
      last_applied_event_id: input.event.eventId,
    },
  })

  await insertMerchantAuditEvent({
    merchantId: input.owner.merchantId,
    eventType: "provider.bridge_webhook_applied",
    metadata: {
      provider: BRIDGE_PROVIDER_NAME,
      bridge_event_id: input.event.eventId,
      bridge_event_type: input.event.type,
      connection_status: state.state,
      approved: state.approved,
      correlation_id: input.correlationId,
    },
  })

  // A verified approval webhook is one of the two authoritative paths that can
  // activate the capability, so activation is audited here too - once.
  if (activation.active && !alreadyActivated) {
    await insertMerchantAuditEvent({
      merchantId: input.owner.merchantId,
      eventType: "provider.bridge_capability_auto_activated",
      metadata: {
        provider: BRIDGE_PROVIDER_NAME,
        activated_at: activation.autoActivatedAt ?? null,
        source: "provider_webhook",
        correlation_id: input.correlationId,
      },
    })
  }

  return { applied: true, reason: "applied" }
}

/** Non-secret Bridge configuration summary for operator/admin diagnostics. */
export function describeBridgeEngineConfiguration() {
  return describeBridgeConfiguration()
}
