/**
 * PineTree Engine - Shift4 Phase 3 backend contracts.
 *
 * TYPES ONLY. Nothing here is wired to a route, a UI, or the provider registry,
 * and importing this module has no runtime effect beyond the readiness helper.
 *
 * ── Why no routes yet ───────────────────────────────────────────────────────
 * The Phase 2 storage contract is implemented but its migration has NOT been
 * applied. Until `20260730_create_shift4_payment_attempts.sql` runs, the atomic
 * guarantees these contracts depend on - invoice uniqueness, version conflict
 * rejection, lease-based claiming, and evidence/transition/ledger atomicity -
 * exist only as SQL text. Exposing an authenticated route before then would put
 * merchant money on top of guarantees no database is actually enforcing.
 *
 * These definitions exist so the route layer, when it is authorized, has a
 * reviewed contract to implement rather than an improvised one.
 */

import type { PaymentStatus } from "@/engine/paymentStateMachine"

import type { Shift4Channel, Shift4EngineOperation } from "./types"

/* ── Provider readiness ───────────────────────────────────────────────────── */

/**
 * The distinct capabilities a Shift4 REST connection can hold.
 *
 * These are deliberately independent booleans rather than one status enum. A
 * successful Access Token Exchange proves ONLY that PineTree can authenticate
 * as the merchant. It does not prove the merchant is boarded, that a PAX device
 * is registered, that certification passed, or that PineTree should route live
 * money to Shift4.
 */
export type Shift4ReadinessCapability =
  /** An encrypted access-token envelope exists for this merchant. */
  | "credentials_configured"
  /** The most recent Access Token Exchange succeeded. */
  | "authenticated"
  /** i4Go tokenization is configured for the e-commerce channel. */
  | "ecommerce_capable"
  /** Commerce Engine for Cloud is configured for the retail channel. */
  | "retail_capable"
  /** At least one PAX device is registered and bound to this merchant. */
  | "terminal_configured"
  /** Shift4 certification has been completed and recorded. */
  | "certification_verified"
  /** PineTree may route live payments to this connection. */
  | "processing_enabled"

export type Shift4ProviderReadiness = Record<Shift4ReadinessCapability, boolean>

/**
 * Whether a channel may actually be selected for a live payment.
 *
 * `processing_enabled` and `certification_verified` are both required. Neither
 * is implied by authentication: a merchant who has exchanged an auth token is
 * authenticated and nothing more.
 */
export function isShift4ChannelSelectable(
  readiness: Shift4ProviderReadiness,
  channel: Shift4Channel
): boolean {
  if (!readiness.credentials_configured) return false
  if (!readiness.authenticated) return false
  if (!readiness.certification_verified) return false
  if (!readiness.processing_enabled) return false

  return channel === "retail"
    ? readiness.retail_capable && readiness.terminal_configured
    : readiness.ecommerce_capable
}

/** Readiness for a merchant with no Shift4 REST connection at all. */
export const SHIFT4_READINESS_NONE: Shift4ProviderReadiness = {
  credentials_configured: false,
  authenticated: false,
  ecommerce_capable: false,
  retail_capable: false,
  terminal_configured: false,
  certification_verified: false,
  processing_enabled: false,
}

/* ── Merchant connection services ─────────────────────────────────────────── */

/**
 * Begin a Shift4 REST connection with a merchant-supplied Auth Token.
 *
 * The Auth Token is single-use and is NEVER persisted: it is exchanged once for
 * an Access Token, and only the encrypted access-token envelope is stored.
 */
export type Shift4ConnectRequest = {
  merchantId: string
  /** Actor performing the connection, for the audit record. */
  actorUserId: string
  /** Lighthouse Transaction Manager auth token. Exchanged once, never stored. */
  authToken: string
  /** Idempotency for the exchange, so a double submit cannot burn the token. */
  idempotencyKey: string
  correlationId?: string
}

/**
 * What a connection attempt may return to the caller.
 *
 * There is deliberately no field capable of carrying an access token, an auth
 * token, a client GUID, or an encrypted envelope.
 */
export type Shift4ConnectResult = {
  connectionId: string
  status: "connected" | "already_connected" | "rejected"
  readiness: Shift4ProviderReadiness
  /** Non-secret fingerprint of the stored credential, for support. */
  credentialFingerprint: string | null
  environment: "test" | "production"
  correlationId: string
  rejectionReason: string | null
}

/** The safe, merchant-visible view of a connection. */
export type Shift4ConnectionStatus = {
  connectionId: string | null
  connected: boolean
  readiness: Shift4ProviderReadiness
  environment: "test" | "production" | null
  lastExchangeAt: string | null
  credentialFingerprint: string | null
}

export type Shift4DisconnectRequest = {
  merchantId: string
  actorUserId: string
  connectionId: string
  reason: string
}

export type Shift4DisconnectResult = {
  connectionId: string
  disconnected: boolean
  readiness: Shift4ProviderReadiness
}

/* ── Backend operation contracts ──────────────────────────────────────────── */

/**
 * Everything an authenticated Engine entry point must validate before it acts.
 *
 * Written as an explicit type so no route can forget one: each field is a
 * separate check, and the route layer must supply all of them.
 */
export type Shift4OperationAuthorization = {
  /** The authenticated actor. Never taken from the request body. */
  actorUserId: string
  /** Resolved server-side from the actor, never trusted from the client. */
  merchantId: string
  /** Must belong to the merchant above. */
  paymentId: string
  /** Must be the merchant's own shift4_rest connection. */
  merchantProviderConnectionId: string
  /** Must be a capability the readiness model actually grants. */
  channel: Shift4Channel
  operation: Shift4EngineOperation
  idempotencyKey: string
  correlationId?: string
}

export type Shift4TokenizedSaleRequest = Shift4OperationAuthorization & {
  operation: "sale"
  /** i4Go / Global Token Vault token. Never a PAN. */
  cardTokenValue: string
  amountMinor: number
  taxAmountMinor?: number
  currency: string
}

export type Shift4TokenizedAuthorizationRequest = Shift4OperationAuthorization & {
  operation: "authorization"
  cardTokenValue: string
  amountMinor: number
  taxAmountMinor?: number
  currency: string
}

export type Shift4CaptureRequest = Shift4OperationAuthorization & {
  operation: "capture"
  /** The approved authorization this capture closes. Required. */
  authorizationAttemptId: string
  amountMinor: number
  currency: string
}

export type Shift4RefundRequest = Shift4OperationAuthorization & {
  operation: "refund"
  cardTokenValue: string
  /** Distinguishes multiple refunds so they cannot share an invoice. */
  refundId: string
  amountMinor: number
  currency: string
}

export type Shift4VoidRequest = Shift4OperationAuthorization & {
  operation: "void"
  /** The attempt whose invoice is being voided. */
  targetAttemptId: string
}

export type Shift4InvoiceLookupRequest = {
  actorUserId: string
  merchantId: string
  merchantProviderConnectionId: string
  attemptId: string
  correlationId?: string
}

export type Shift4RecoveryRequest = {
  actorUserId: string
  merchantId: string
  /** One of these must be supplied; both scope the recovery. */
  paymentId?: string
  attemptId?: string
  dryRun?: boolean
}

/* ── Safe response envelope ───────────────────────────────────────────────── */

/**
 * The ONLY shape a Shift4 operation may return to a caller.
 *
 * It cannot carry an access token, auth token, client GUID, raw card token,
 * full provider payload, encrypted envelope, i4Go access block, or any
 * cardholder data, because no field of that kind exists on it.
 */
export type Shift4OperationResponse = {
  paymentId: string
  attemptId: string
  /** Canonical PineTree status, or null when the payment did not transition. */
  status: PaymentStatus | null
  /** Safe operation-level status, distinct from the payment lifecycle. */
  operationStatus:
    | "approved"
    | "declined"
    | "unresolved"
    | "action_required"
    | "reconciliation_required"
    | "resumed"
  /** True when the customer or clerk must do something (referral, SCA). */
  customerActionRequired: boolean
  /** Non-secret description of that action, if any. */
  actionRequired: string | null
  /** True while an invoice lookup is still needed to prove the outcome. */
  reconciliationPending: boolean
  /** Safe classification only - never the raw provider payload. */
  providerClassification: {
    responseCode: string | null
    authorizationCode: string | null
    retrievalReference: string | null
    approvedAmountMinor: number | null
  }
  correlationId: string
}
