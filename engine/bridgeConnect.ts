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

import { randomUUID } from "node:crypto"

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
  type MerchantBridgeConnectionRow,
} from "@/database/merchantBridgeConnections"
import { insertMerchantAuditEvent } from "@/database/merchantAuditEvents"
import { getMerchantBusinessProfile } from "@/engine/businessProfile"
import { bridgeAdapter } from "@/providers/bridge/adapter"
import {
  describeBridgeConfiguration,
  getBridgeConfig,
  isBridgeConfigured,
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
  translateBridgeEvent,
  type NormalizedBridgeConnectionEvent,
} from "@/providers/bridge/translateEvent"
import {
  BRIDGE_SIGNATURE_HEADER,
  verifyBridgeWebhookSignature,
} from "@/providers/bridge/verifyWebhook"
import type {
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

  return buildBridgeConnectionState({
    configured: isBridgeConfigured(),
    environment: currentEnvironment(),
    onboardingRequested: Boolean(credentials.onboarding_requested_at),
    connection,
    enabled: row?.enabled === true,
    enablementDecisionMade: Boolean(credentials.enablement_decision_at),
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
async function persistConnection(input: {
  merchantId: string
  existing: BridgeCredentials
  connection: NormalizedBridgeConnection
  enabled: boolean
  enablementDecisionMade: boolean
  onboardingRequestedAt?: string
  extraCredentials?: Partial<BridgeCredentials>
}): Promise<BridgeConnectionState> {
  const syncedAt = new Date().toISOString()
  const approved = isBridgeApproved(input.connection)
  const onboardingRequestedAt = input.onboardingRequestedAt || input.existing.onboarding_requested_at

  const state = resolveBridgeProviderState({
    configured: isBridgeConfigured(),
    onboardingRequested: Boolean(onboardingRequestedAt),
    connection: input.connection,
    enabled: input.enabled,
    enablementDecisionMade: input.enablementDecisionMade,
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
  })

  const row = rowStateForProviderState(state, approved, input.enabled)
  await upsertMerchantBridgeConnection({
    merchantId: input.merchantId,
    status: row.status,
    enabled: row.enabled,
    credentials,
  })

  return buildBridgeConnectionState({
    configured: isBridgeConfigured(),
    environment: currentEnvironment(),
    onboardingRequested: Boolean(onboardingRequestedAt),
    connection: input.connection,
    enabled: row.enabled,
    enablementDecisionMade: input.enablementDecisionMade,
    lastSyncedAt: syncedAt,
  })
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
 * Start (or resume) Bridge onboarding for a merchant.
 *
 * Preconditions enforced here rather than in the route:
 *   - Bridge must be configured for this deployment.
 *   - The merchant must have a legal business name and an owner email; Bridge
 *     requires both and PineTree will not invent either.
 *
 * A Bridge customer is created ONLY on this path - that is, only when the
 * merchant has actively selected Bridge-backed settlement. Merchants who have
 * not asked for Bridge never get a Bridge customer.
 */
export async function startBridgeOnboardingEngine(args: {
  merchantId: string
  actorId?: string | null
}): Promise<StartBridgeOnboardingResult | BridgeEngineFailure> {
  const correlationId = randomUUID()

  if (!isBridgeConfigured()) {
    return failure("Bridge is not available yet.", correlationId)
  }

  let row: MerchantBridgeConnectionRow | null
  try {
    row = await getMerchantBridgeConnection(args.merchantId)
  } catch (error) {
    console.error("[bridge] onboarding_read_failed", { correlationId, ...describeBridgeError(error) })
    return failure("Unable to start Bridge onboarding right now.", correlationId, true)
  }

  const existing = row?.credentials || {}
  const now = new Date().toISOString()

  // Resume path: a KYC link already exists, so re-read it instead of creating
  // anything. This is what makes "Continue onboarding" safe to click twice.
  if (existing.bridge_kyc_link_id || existing.bridge_customer_id) {
    try {
      const { connection } = await bridgeAdapter.syncAccount({
        customerId: existing.bridge_customer_id || null,
        kycLinkId: existing.bridge_kyc_link_id || null,
        context: { correlationId, merchantId: args.merchantId },
      })

      const state = await persistConnection({
        merchantId: args.merchantId,
        existing,
        connection,
        enabled: row?.enabled === true,
        enablementDecisionMade: Boolean(existing.enablement_decision_at),
        onboardingRequestedAt: existing.onboarding_requested_at || now,
      })

      // The hosted URLs are single-use capabilities that PineTree never
      // stores, so a resumed session re-requests them from Bridge below only
      // when the link itself must be re-issued. Here the merchant continues
      // through the same Bridge-hosted session.
      const reissued = await reissueHostedLinks({
        merchantId: args.merchantId,
        kycLinkId: existing.bridge_kyc_link_id || null,
        correlationId,
      })

      return {
        ok: true,
        kycUrl: reissued.kycUrl,
        tosUrl: reissued.tosUrl,
        reused: true,
        connection: state,
        correlationId,
      }
    } catch (error) {
      const unknown = isBridgeUnknownOutcomeError(error)
      console.error("[bridge] onboarding_resume_failed", {
        correlationId,
        merchantId: args.merchantId,
        ...describeBridgeError(error),
      })
      return failure(
        unknown
          ? "Bridge did not respond in time. Your onboarding was not lost - try again."
          : "Unable to resume Bridge onboarding right now.",
        correlationId,
        true
      )
    }
  }

  // Create path: Bridge needs the legal business name and the authorized
  // account owner's email. Both come from the merchant's business profile.
  let legalBusinessName: string
  let ownerEmail: string
  try {
    const profile = await getMerchantBusinessProfile(args.merchantId)
    legalBusinessName = String(profile.legal_business_name || "").trim()
    ownerEmail = String(profile.owner_email || profile.contact_email || "").trim()
  } catch (error) {
    console.error("[bridge] onboarding_profile_read_failed", {
      correlationId,
      ...describeBridgeError(error),
    })
    return failure("Unable to start Bridge onboarding right now.", correlationId, true)
  }

  if (!legalBusinessName || !ownerEmail) {
    return failure(
      "Add your legal business name and account owner email in Business Profile before starting Bridge onboarding.",
      correlationId
    )
  }

  try {
    const result = await bridgeAdapter.connectMerchant({
      merchantId: args.merchantId,
      legalBusinessName,
      ownerEmail,
      context: { correlationId, merchantId: args.merchantId },
    })

    const state = await persistConnection({
      merchantId: args.merchantId,
      existing,
      connection: result.connection,
      enabled: false,
      enablementDecisionMade: false,
      onboardingRequestedAt: now,
    })

    await insertMerchantAuditEvent({
      merchantId: args.merchantId,
      eventType: "provider.bridge_onboarding_started",
      actorId: args.actorId ?? null,
      metadata: {
        provider: BRIDGE_PROVIDER_NAME,
        provider_model: BRIDGE_PROVIDER_MODEL,
        bridge_kyc_link_id: result.kycLinkId,
        bridge_customer_id: result.customerId,
        correlation_id: correlationId,
      },
    })

    return {
      ok: true,
      kycUrl: result.kycUrl,
      tosUrl: result.tosUrl,
      reused: false,
      connection: state,
      correlationId,
    }
  } catch (error) {
    if (error instanceof BridgeConfigError) {
      return failure("Bridge is not available yet.", correlationId)
    }

    const unknown = isBridgeUnknownOutcomeError(error)
    console.error("[bridge] onboarding_create_failed", {
      correlationId,
      merchantId: args.merchantId,
      ...describeBridgeError(error),
    })

    // A timeout is NOT a failure: Bridge may already hold the customer. The
    // deterministic idempotency key means retrying returns that same object,
    // so the merchant is told to retry rather than that onboarding failed.
    return failure(
      unknown
        ? "Bridge did not respond in time. Nothing was lost - try again in a moment."
        : "Unable to start Bridge onboarding right now.",
      correlationId,
      true
    )
  }
}

/**
 * Re-read the hosted onboarding URLs for an existing KYC link.
 *
 * The URLs are bearer capabilities, so PineTree never stores them: they are
 * fetched on demand and handed straight back to the authenticated merchant who
 * asked for them.
 */
async function reissueHostedLinks(input: {
  merchantId: string
  kycLinkId: string | null
  correlationId: string
}): Promise<{ kycUrl: string | null; tosUrl: string | null }> {
  if (!input.kycLinkId) return { kycUrl: null, tosUrl: null }

  try {
    const { getKycLink } = await import("@/providers/bridge/client")
    const result = await getKycLink({
      kycLinkId: input.kycLinkId,
      context: { correlationId: input.correlationId, merchantId: input.merchantId },
    })
    return {
      kycUrl: String(result.data.kyc_link || "").trim() || null,
      tosUrl: String(result.data.tos_link || "").trim() || null,
    }
  } catch (error) {
    // Losing the hosted URL is a degraded experience, never a state change.
    console.warn("[bridge] hosted_link_reissue_failed", {
      correlationId: input.correlationId,
      ...describeBridgeError(error),
    })
    return { kycUrl: null, tosUrl: null }
  }
}

// ─── Sync ────────────────────────────────────────────────────────────────────

/**
 * Re-read Bridge and synchronize PineTree's stored state.
 *
 * This is the authoritative approval check. It is what the merchant's "Refresh
 * status" action calls, and what a post-redirect page uses instead of trusting
 * the redirect.
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

    const state = await persistConnection({
      merchantId: args.merchantId,
      existing,
      connection,
      enabled: row?.enabled === true,
      enablementDecisionMade: Boolean(existing.enablement_decision_at),
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
 * Enabling is BLOCKED until Bridge has approved KYB, terms, and the required
 * endorsement. The stored state is re-derived from the connection rather than
 * trusted from the request, so a client cannot enable Bridge by asserting it.
 */
export async function setBridgeEnabledEngine(args: {
  merchantId: string
  enabled: boolean
  actorId?: string | null
}): Promise<{ ok: true; connection: BridgeConnectionState } | BridgeEngineFailure> {
  const correlationId = randomUUID()

  let row: MerchantBridgeConnectionRow | null
  try {
    row = await getMerchantBridgeConnection(args.merchantId)
  } catch (error) {
    console.error("[bridge] enablement_read_failed", { correlationId, ...describeBridgeError(error) })
    return failure("Unable to update Bridge right now.", correlationId, true)
  }

  if (!row) {
    return failure("Start Bridge onboarding before enabling Bridge.", correlationId)
  }

  const existing = row.credentials || {}
  const connection = connectionFromCredentials(existing)

  if (args.enabled && !isBridgeApproved(connection)) {
    return failure(
      "Bridge has not approved this business yet. Finish onboarding and refresh status before enabling Bridge.",
      correlationId
    )
  }

  try {
    const state = await persistConnection({
      merchantId: args.merchantId,
      existing,
      connection,
      enabled: args.enabled,
      enablementDecisionMade: true,
      extraCredentials: { enablement_decision_at: new Date().toISOString() },
    })

    await insertMerchantAuditEvent({
      merchantId: args.merchantId,
      eventType: args.enabled ? "provider.bridge_enabled" : "provider.bridge_disabled",
      actorId: args.actorId ?? null,
      metadata: {
        provider: BRIDGE_PROVIDER_NAME,
        connection_status: state.state,
        correlation_id: correlationId,
      },
    })

    return { ok: true, connection: state }
  } catch (error) {
    console.error("[bridge] enablement_write_failed", {
      correlationId,
      ...describeBridgeError(error),
    })
    return failure("Unable to update Bridge right now.", correlationId, true)
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
  //    Never from anything the payload asserts about a merchant.
  let owner: MerchantBridgeConnectionRow | null = null
  try {
    owner = await findMerchantByBridgeIdentifiers({
      customerId: event.customerId,
      kycLinkId: event.kycLinkId,
    })
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
    // Bridge customer. The event is retained as evidence rather than dropped.
    await markBridgeWebhookEventProcessed({ id: claim.record.id, skippedReason: "unresolved_merchant" })
    console.warn("[bridge] webhook_unresolved_merchant", { correlationId, eventId: event.eventId })
    return { ok: true, applied: false, reason: "unresolved_merchant", correlationId }
  }

  const applied = await applyBridgeEventToConnection({
    owner,
    event,
    payload,
    correlationId,
  })

  await markBridgeWebhookEventProcessed({
    id: claim.record.id,
    merchantId: owner.merchantId,
    skippedReason: applied.applied ? null : "out_of_order",
  })

  return { ok: true, applied: applied.applied, reason: applied.reason, correlationId }
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

  const state = await persistConnection({
    merchantId: input.owner.merchantId,
    existing,
    connection,
    enabled: input.owner.enabled === true,
    enablementDecisionMade: Boolean(existing.enablement_decision_at),
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

  return { applied: true, reason: "applied" }
}

/** Non-secret Bridge configuration summary for operator/admin diagnostics. */
export function describeBridgeEngineConfiguration() {
  return describeBridgeConfiguration()
}
