/**
 * Bridge (by Stripe) - merchant provider connection persistence.
 *
 * Bridge state lives in the canonical generalized provider model
 * (`merchant_providers`, provider = 'bridge') alongside every other provider,
 * with normalized Bridge state in the `credentials` JSONB column.
 *
 * TENANT SAFETY: every read and write in this module filters by merchant_id.
 * The service-role client bypasses RLS, so the merchant filter here IS the
 * isolation boundary - a query without it would cross tenants.
 *
 * SECURITY: no Bridge API key, no webhook public key, and no hosted
 * kyc_link / tos_link URL is ever written here. Only Bridge identifiers and
 * normalized statuses are persisted.
 */

import { supabase, supabaseAdmin } from "./supabase"
import type {
  NormalizedBridgeConnection,
  NormalizedBridgeEndorsement,
} from "@/providers/bridge/types"

const db = supabaseAdmin || supabase

export const BRIDGE_PROVIDER_NAME = "bridge" as const
export const BRIDGE_PROVIDER_MODEL = "bridge_hosted_kyb" as const

const BRIDGE_WEBHOOK_EVENTS_TABLE = "bridge_webhook_events"

/**
 * The normalized Bridge state persisted in `merchant_providers.credentials`.
 * Field names are snake_case to match the surrounding provider rows.
 */
export type BridgeCredentials = {
  bridge_customer_id?: string
  bridge_kyc_link_id?: string
  bridge_kyc_status?: string
  bridge_tos_status?: string
  bridge_customer_status?: string
  bridge_endorsements?: NormalizedBridgeEndorsement[]
  bridge_base_endorsement_approved?: boolean
  bridge_requirements_due?: string[]
  bridge_future_requirements_due?: string[]
  /** Safe merchant-facing summary. Never a raw Bridge rejection reason. */
  bridge_action_required?: { headline: string; detail: string } | null
  connection_status?: string
  onboarding_requested_at?: string
  /**
   * When PineTree AUTOMATICALLY activated the Bridge-backed wallet capability
   * after approval. There is no merchant-facing enable/disable decision:
   * activation is a consequence of approval plus rollout eligibility.
   */
  auto_activated_at?: string
  /**
   * Set by a PineTree administrator to hold activation back during a
   * controlled rollout. Admin-only and audited; never merchant-settable.
   */
  admin_activation_blocked_at?: string
  /**
   * Evidence of the consent that authorized creating this Bridge customer.
   * Recorded on the connection so an auditor can see which terms version
   * permitted the submission without joining another table.
   */
  consent_terms_version?: string
  consent_accepted_at?: string
  /**
   * Bridge's reference for the terms agreement the merchant signed on Bridge's
   * own hosted page. An opaque identifier, not a credential and not a document.
   */
  bridge_signed_agreement_id?: string
  bridge_signed_agreement_at?: string
  /** True when the agreement id was synthesized for the Bridge SANDBOX only. */
  bridge_signed_agreement_synthetic?: boolean
  /**
   * Fingerprint of the last customer payload PineTree submitted. Comparing it
   * is what decides whether a profile edit needs a Bridge update at all, and it
   * seeds the update idempotency key so an unchanged save is a no-op.
   */
  bridge_customer_revision?: string
  bridge_customer_submitted_at?: string
  /**
   * When tax identifiers were last handed to Bridge, and their masked last
   * four. The identifiers themselves are NEVER stored - see
   * engine/bridgeCustomerPayload.ts.
   */
  bridge_identity_submitted_at?: string
  bridge_business_tax_id_last4?: string
  bridge_owner_tax_id_last4?: string
  /** Sandbox-only marker for an administrator-simulated KYB approval. */
  sandbox_simulated_approval_at?: string
  last_synced_at?: string
  provider_created_at?: string
  provider_updated_at?: string
  /** Bridge's event timestamp for the most recently APPLIED status change. */
  last_applied_event_at?: string
  last_applied_event_id?: string
  provider_model?: string
  environment?: string
}

export type MerchantBridgeConnectionRow = {
  id: string
  merchantId: string
  status: string
  enabled: boolean
  credentials: BridgeCredentials
  createdAt: string | null
  updatedAt: string | null
}

/**
 * Keys allowed into the credentials column. Anything else - especially a
 * hosted onboarding URL or a raw Bridge object - is dropped rather than
 * persisted, so a future caller cannot widen what Bridge data PineTree stores
 * simply by passing extra fields.
 */
const ALLOWED_CREDENTIAL_KEYS: readonly (keyof BridgeCredentials)[] = [
  "bridge_customer_id",
  "bridge_kyc_link_id",
  "bridge_kyc_status",
  "bridge_tos_status",
  "bridge_customer_status",
  "bridge_endorsements",
  "bridge_base_endorsement_approved",
  "bridge_requirements_due",
  "bridge_future_requirements_due",
  "bridge_action_required",
  "connection_status",
  "onboarding_requested_at",
  "auto_activated_at",
  "admin_activation_blocked_at",
  "consent_terms_version",
  "consent_accepted_at",
  "bridge_signed_agreement_id",
  "bridge_signed_agreement_at",
  "bridge_signed_agreement_synthetic",
  "bridge_customer_revision",
  "bridge_customer_submitted_at",
  "bridge_identity_submitted_at",
  "bridge_business_tax_id_last4",
  "bridge_owner_tax_id_last4",
  "sandbox_simulated_approval_at",
  "last_synced_at",
  "provider_created_at",
  "provider_updated_at",
  "last_applied_event_at",
  "last_applied_event_id",
  "provider_model",
  "environment",
]

export function sanitizeBridgeCredentials(credentials: BridgeCredentials): BridgeCredentials {
  const output: BridgeCredentials = {}
  for (const key of ALLOWED_CREDENTIAL_KEYS) {
    const value = credentials[key]
    if (value === undefined) continue
    // `bridge_action_required` is intentionally allowed to be null so a
    // resolved requirement clears rather than lingering.
    Object.assign(output, { [key]: value })
  }
  return output
}

function toRow(data: {
  id?: unknown
  merchant_id?: unknown
  status?: unknown
  enabled?: unknown
  credentials?: unknown
  created_at?: unknown
  updated_at?: unknown
}): MerchantBridgeConnectionRow {
  return {
    id: String(data.id || ""),
    merchantId: String(data.merchant_id || ""),
    status: String(data.status || ""),
    enabled: data.enabled === true,
    credentials: (data.credentials || {}) as BridgeCredentials,
    createdAt: typeof data.created_at === "string" ? data.created_at : null,
    updatedAt: typeof data.updated_at === "string" ? data.updated_at : null,
  }
}

/** Load a merchant's Bridge connection row, or null when none exists. */
export async function getMerchantBridgeConnection(
  merchantId: string
): Promise<MerchantBridgeConnectionRow | null> {
  const normalizedMerchantId = String(merchantId || "").trim()
  if (!normalizedMerchantId) return null

  const { data, error } = await db
    .from("merchant_providers")
    .select("id, merchant_id, status, enabled, credentials, created_at, updated_at")
    .eq("merchant_id", normalizedMerchantId)
    .eq("provider", BRIDGE_PROVIDER_NAME)
    .maybeSingle()

  if (error) throw new Error(`Failed loading Bridge connection: ${error.message}`)
  if (!data) return null
  return toRow(data)
}

/**
 * Insert or update the merchant's Bridge connection.
 *
 * Uses the (merchant_id, provider) unique constraint, so a concurrent request
 * updates the same row instead of creating a second Bridge connection.
 */
export async function upsertMerchantBridgeConnection(input: {
  merchantId: string
  status: string
  enabled: boolean
  credentials: BridgeCredentials
}): Promise<void> {
  const merchantId = String(input.merchantId || "").trim()
  if (!merchantId) throw new Error("A merchant id is required to save a Bridge connection.")

  const { error } = await db.from("merchant_providers").upsert(
    {
      merchant_id: merchantId,
      provider: BRIDGE_PROVIDER_NAME,
      status: input.status,
      enabled: input.enabled,
      credentials: sanitizeBridgeCredentials(input.credentials),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "merchant_id,provider" }
  )

  if (error) {
    // The partial unique index on bridge_customer_id fires when a Bridge
    // customer is already bound to a different merchant. That is a tenant
    // boundary violation, not a transient failure.
    if (error.code === "23505") {
      throw new Error("This Bridge customer is already linked to a different merchant.")
    }
    throw new Error(`Failed saving Bridge connection: ${error.message}`)
  }
}

/**
 * Resolve the merchant that owns a Bridge customer or KYC link.
 *
 * This is how a verified webhook finds its tenant. It matches on the stored
 * Bridge identifier only - never on anything the request body claims about a
 * merchant.
 */
export async function findMerchantByBridgeIdentifiers(input: {
  customerId?: string | null
  kycLinkId?: string | null
}): Promise<MerchantBridgeConnectionRow | null> {
  const customerId = String(input.customerId || "").trim()
  const kycLinkId = String(input.kycLinkId || "").trim()

  for (const [key, value] of [
    ["bridge_customer_id", customerId],
    ["bridge_kyc_link_id", kycLinkId],
  ] as const) {
    if (!value) continue

    const { data, error } = await db
      .from("merchant_providers")
      .select("id, merchant_id, status, enabled, credentials, created_at, updated_at")
      .eq("provider", BRIDGE_PROVIDER_NAME)
      .contains("credentials", { [key]: value })
      .maybeSingle()

    if (error) throw new Error(`Failed resolving Bridge connection owner: ${error.message}`)
    if (data) return toRow(data)
  }

  return null
}

// ─── Webhook inbox ───────────────────────────────────────────────────────────

export type BridgeWebhookEventRecord = {
  id: string
  provider_event_id: string
  event_category: string
  event_type: string
  bridge_customer_id: string | null
  bridge_kyc_link_id: string | null
  bridge_external_account_id: string | null
  bridge_liquidation_address_id: string | null
  bridge_drain_id: string | null
  merchant_id: string | null
  occurred_at: string | null
  received_at: string
  processed_at: string | null
  skipped_reason: string | null
}

const BRIDGE_WEBHOOK_EVENT_COLUMNS =
  "id, provider_event_id, event_category, event_type, bridge_customer_id, bridge_kyc_link_id, " +
  "bridge_external_account_id, bridge_liquidation_address_id, bridge_drain_id, merchant_id, " +
  "occurred_at, received_at, processed_at, skipped_reason"

export type BridgeWebhookClaim =
  | { claimed: true; record: BridgeWebhookEventRecord }
  | { claimed: false; record: BridgeWebhookEventRecord }

/**
 * Claim a verified Bridge delivery by its `event_id`.
 *
 * `claimed: false` means the event was already recorded, so the caller must
 * acknowledge and stop. This is what stops a redelivery from applying a status
 * change - or writing an audit record - twice.
 */
export async function claimBridgeWebhookEvent(input: {
  providerEventId: string
  eventCategory: string
  eventType: string
  bridgeCustomerId: string | null
  bridgeKycLinkId: string | null
  bridgeExternalAccountId?: string | null
  bridgeLiquidationAddressId?: string | null
  bridgeDrainId?: string | null
  merchantId: string | null
  occurredAt: string | null
  rawPayload: Record<string, unknown> | null
}): Promise<BridgeWebhookClaim> {
  const { data, error } = await db
    .from(BRIDGE_WEBHOOK_EVENTS_TABLE)
    .insert({
      provider_event_id: input.providerEventId,
      event_category: input.eventCategory,
      event_type: input.eventType,
      bridge_customer_id: input.bridgeCustomerId,
      bridge_kyc_link_id: input.bridgeKycLinkId,
      bridge_external_account_id: input.bridgeExternalAccountId ?? null,
      bridge_liquidation_address_id: input.bridgeLiquidationAddressId ?? null,
      bridge_drain_id: input.bridgeDrainId ?? null,
      merchant_id: input.merchantId,
      occurred_at: input.occurredAt,
      raw_payload: input.rawPayload,
      signature_verified: true,
    })
    .select(BRIDGE_WEBHOOK_EVENT_COLUMNS)
    .single()

  if (!error) return { claimed: true, record: data as unknown as BridgeWebhookEventRecord }
  if (error.code !== "23505") {
    throw new Error(`Failed to claim Bridge webhook event: ${error.message}`)
  }

  const { data: existing, error: lookupError } = await db
    .from(BRIDGE_WEBHOOK_EVENTS_TABLE)
    .select(BRIDGE_WEBHOOK_EVENT_COLUMNS)
    .eq("provider_event_id", input.providerEventId)
    .maybeSingle()

  if (lookupError || !existing) {
    throw new Error("Failed to load existing Bridge webhook event after idempotency conflict")
  }
  return { claimed: false, record: existing as unknown as BridgeWebhookEventRecord }
}

/**
 * Record the outcome of a claimed event.
 *
 * `skippedReason` is set when a verified event was durably stored but
 * deliberately not applied (out of order, merchant not resolvable yet). The
 * row is retained either way so the evidence is never lost.
 */
export type BridgeWebhookSkippedReason =
  | "duplicate"
  | "out_of_order"
  | "unresolved_merchant"
  | "unsupported_category"
  | "state_reread_failed"
  | "no_matching_withdrawal"
  | "unresolved_route"
  | "applied"

export async function markBridgeWebhookEventProcessed(input: {
  id: string
  merchantId?: string | null
  skippedReason?: BridgeWebhookSkippedReason | null
}): Promise<void> {
  const update: Record<string, unknown> = {
    processed_at: new Date().toISOString(),
    skipped_reason: input.skippedReason ?? null,
  }
  if (input.merchantId) update.merchant_id = input.merchantId

  const { error } = await db
    .from(BRIDGE_WEBHOOK_EVENTS_TABLE)
    .update(update)
    .eq("id", input.id)

  if (error) throw new Error(`Failed to mark Bridge webhook event processed: ${error.message}`)
}

/**
 * Build the credentials patch for a normalized Bridge connection.
 *
 * Kept here so the persisted field names have exactly one definition shared by
 * the Engine's sync path and its webhook path.
 */
export function bridgeCredentialsFromConnection(input: {
  existing: BridgeCredentials
  connection: NormalizedBridgeConnection
  connectionStatus: string
  actionRequired: { headline: string; detail: string } | null
  environment: string | null
  syncedAt: string
}): BridgeCredentials {
  const { existing, connection } = input

  return sanitizeBridgeCredentials({
    ...existing,
    // A provider identifier is never unset by a later partial read.
    bridge_customer_id: connection.customerId || existing.bridge_customer_id,
    bridge_kyc_link_id: connection.kycLinkId || existing.bridge_kyc_link_id,
    bridge_kyc_status: connection.kycStatus || existing.bridge_kyc_status,
    bridge_tos_status: connection.tosStatus || existing.bridge_tos_status,
    bridge_customer_status: connection.customerStatus || existing.bridge_customer_status,
    bridge_endorsements: connection.endorsements,
    bridge_base_endorsement_approved: connection.baseEndorsementApproved,
    bridge_requirements_due: connection.requirementsDue,
    bridge_future_requirements_due: connection.futureRequirementsDue,
    bridge_action_required: input.actionRequired,
    connection_status: input.connectionStatus,
    last_synced_at: input.syncedAt,
    provider_created_at: connection.providerCreatedAt || existing.provider_created_at,
    provider_updated_at: connection.providerUpdatedAt || existing.provider_updated_at,
    provider_model: BRIDGE_PROVIDER_MODEL,
    environment: input.environment || existing.environment,
  })
}
