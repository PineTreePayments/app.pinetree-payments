import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const supabase = supabaseAdmin || supabaseAnon

/**
 * Merchant-scoped audit event types.
 * Extend this union as new auditable actions are added.
 */
export type WithdrawalAuditEventType =
  | "withdrawal.review_created"
  | "withdrawal.pending_review"
  | "withdrawal.processing"
  | "withdrawal.confirmed"
  | "withdrawal.failed"
  | "withdrawal.canceled"
  // Bank withdrawals share the withdrawal ledger and lifecycle. These two
  // record the extra evidence a bank payout has that a crypto one does not:
  // the settlement route it was bound to, and the moment the source-chain
  // transfer reached the settlement provider - which is NOT confirmation.
  | "withdrawal.bank_review_created"
  | "withdrawal.bank_source_chain_confirmed"

export type AddressBookAuditEventType =
  | "address_book.entry_added"
  | "address_book.entry_updated"
  | "address_book.entry_confirmed"
  | "address_book.entry_archived"
  | "address_book.entry_deleted"

/**
 * Audit events for rows in `merchant_wallet_operations`.
 *
 * NOTE: `merchant_wallet_operations` has no dedicated event table of its own.
 * `wallet_operation_events` is NOT usable — its FK targets the separate
 * `wallet_operations` table — and `speed_webhook_events` is a provider webhook
 * inbox that backfill tooling reads as a recovery source, so synthetic rows
 * there would fabricate provider provenance. Wallet-operation audit evidence
 * therefore lands here, with the operation id carried in `metadata`.
 */
export type WalletOperationAuditEventType =
  | "destination_backfill.verified"

/**
 * Merchant bank payout destinations and the settlement routes bound to them.
 *
 * Metadata carries the PineTree destination id and the masked last four only -
 * never a routing number, an account number, or a provider payload.
 */
export type BankDestinationAuditEventType =
  | "wallet.bank_destination_linked"
  | "wallet.bank_destination_removed"
  | "wallet.bank_destination_state_synced"
  | "wallet.bank_settlement_route_created"

/**
 * Privileged admin actions on merchant support tickets.
 *
 * Recorded against the ticket's merchant (so the merchant's audit trail is
 * complete) with the acting admin in `actor_id`. Reply and note bodies are never
 * written here — only the message id.
 */
export type SupportAuditEventType =
  | "support.admin_replied"
  | "support.status_changed"

/**
 * Bridge (by Stripe) provider-connection actions.
 *
 * Bridge is a separate provider connection from Stripe Connect, so its audit
 * trail is separate too. Metadata carries Bridge identifiers and normalized
 * statuses only - never KYB material, hosted onboarding URLs, or credentials.
 */
export type BridgeProviderAuditEventType =
  | "provider.bridge_onboarding_started"
  | "provider.bridge_customer_updated"
  | "provider.bridge_terms_agreement_recorded"
  | "provider.bridge_status_synced"
  | "provider.bridge_webhook_applied"
  // Administrator-only, sandbox-only. Refused in production server-side.
  | "provider.bridge_sandbox_approval_simulated"
  // Activation is automatic after Bridge approval; it is audited once, when it
  // first happens. There is no merchant enable/disable action to record.
  | "provider.bridge_capability_auto_activated"
  // Administrator-only rollout hold. Never merchant-triggered.
  | "provider.bridge_admin_hold_applied"
  | "provider.bridge_admin_hold_released"
  // Legacy values retained so historical rows written by the removed
  // merchant-facing enable/disable controls remain readable. Never emitted.
  | "provider.bridge_enabled"
  | "provider.bridge_disabled"

/** PineTree-branded merchant onboarding and verification consent. */
export type BusinessVerificationAuditEventType =
  | "onboarding.service_terms_accepted"
  | "onboarding.business_verification_submitted"

export type MerchantAuditEventType =
  | "webhook.secret_regenerated"
  | BridgeProviderAuditEventType
  | BusinessVerificationAuditEventType
  | SupportAuditEventType
  | "lightning.speed_credential_revealed"
  | "lightning.sweep_retried"
  | "lightning.sweep_canceled"
  | WithdrawalAuditEventType
  | AddressBookAuditEventType
  | WalletOperationAuditEventType
  | BankDestinationAuditEventType

export type MerchantAuditEvent = {
  id: string
  merchant_id: string
  event_type: MerchantAuditEventType
  actor_id: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

/**
 * Write a merchant-scoped audit record.
 *
 * Fails silently (warn only) so audit logging never breaks the primary
 * request path. Secrets — old or new — must never appear in metadata.
 *
 * ── Required SQL migration ────────────────────────────────────────────────
 *
 *   CREATE TABLE IF NOT EXISTS merchant_audit_events (
 *     id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
 *     merchant_id UUID        NOT NULL,
 *     event_type  TEXT        NOT NULL,
 *     actor_id    UUID,
 *     metadata    JSONB,
 *     created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
 *   );
 *   CREATE INDEX ON merchant_audit_events (merchant_id, created_at DESC);
 *
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function insertWithdrawalAuditEvent(input: {
  merchantId: string
  eventType: WithdrawalAuditEventType
  withdrawalId: string
  rail: string
  asset: string
  status: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  await insertMerchantAuditEvent({
    merchantId: input.merchantId,
    eventType: input.eventType,
    metadata: {
      withdrawal_id: input.withdrawalId,
      rail: input.rail,
      asset: input.asset,
      status: input.status,
      ...(input.metadata || {}),
    },
  })
}

export async function insertMerchantAuditEvent(input: {
  merchantId: string
  eventType: MerchantAuditEventType
  actorId?: string | null
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    const { error } = await supabase.from("merchant_audit_events").insert({
      id: crypto.randomUUID(),
      merchant_id: input.merchantId,
      event_type: input.eventType,
      actor_id: input.actorId ?? null,
      metadata: input.metadata ?? null,
    })
    if (error) {
      console.warn("[audit] merchant_audit_events insert failed:", error.message)
    }
  } catch (err) {
    console.warn("[audit] merchant_audit_events threw:", err instanceof Error ? err.message : err)
  }
}

/**
 * Same write as `insertMerchantAuditEvent`, but surfaces failures instead of
 * swallowing them.
 *
 * Use this only where the caller must be able to distinguish "audit recorded"
 * from "audit missing" — e.g. backfill tooling that has to report audit
 * coverage honestly. Request paths should keep using the silent variant so
 * audit logging never breaks the primary operation.
 */
export async function insertMerchantAuditEventStrict(input: {
  merchantId: string
  eventType: MerchantAuditEventType
  actorId?: string | null
  metadata?: Record<string, unknown>
}): Promise<void> {
  const { error } = await supabase.from("merchant_audit_events").insert({
    id: crypto.randomUUID(),
    merchant_id: input.merchantId,
    event_type: input.eventType,
    actor_id: input.actorId ?? null,
    metadata: input.metadata ?? null,
  })
  if (error) {
    throw new Error(`merchant_audit_events insert failed: ${error.message}`)
  }
}
