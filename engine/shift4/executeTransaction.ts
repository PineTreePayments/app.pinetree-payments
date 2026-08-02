/**
 * PineTree Engine - Shift4 transaction execution.
 *
 * The one backend entry point for sale, authorization, capture, refund, and
 * void. Backend-only: no route or UI is wired in this phase.
 *
 * ── Sequence ────────────────────────────────────────────────────────────────
 *  1. validate merchant, connection, channel, amount, currency, operation
 *  2. confirm the Shift4 REST connection is authenticated (NOT that the
 *     merchant is boarded or a device is certified)
 *  3. derive the deterministic attempt identity and invoice
 *  4. create the attempt in the database BEFORE transmitting - this is where an
 *     invoice collision or a conflicting idempotency key fails, and where a
 *     duplicate request resolves to the existing attempt instead of sending
 *  5. call the typed Shift4 wrapper
 *  6. apply evidence, the canonical transition, and the ledger entry in ONE
 *     database transaction
 *
 * Ownership is verified twice: here, and again inside the SECURITY DEFINER
 * functions, which re-read the payment and the provider connection themselves.
 */

import { randomUUID } from "node:crypto"

import {
  applyShift4AttemptEvidence,
  createShift4PaymentAttempt,
  getShift4PaymentAttempt,
  hashIdempotencyKey,
  assertSafeMinorUnits,
  type Shift4PaymentAttemptRow,
} from "@/database/shift4PaymentAttempts"
import { getPaymentById } from "@/database/payments"
import { getShift4RestAccessToken } from "@/database/merchantShift4RestConnections"
import {
  authorize,
  capture,
  createInvoiceReference,
  describeShift4Error,
  isShift4UnknownOutcomeError,
  manualAuthorization,
  refund as refundTransaction,
  sale,
  Shift4RestApiError,
  Shift4RestTransportError,
  voidInvoice,
  SHIFT4_RECOVERY_DELAY_MS,
  type Shift4NormalizedOperationResult,
} from "@/providers/shift4/rest"

import {
  buildRequestFingerprint,
  deriveAttemptId,
  eventNameForState,
  fingerprintCardToken,
  projectEvidence,
} from "./attempt"
import { mapShift4Evidence } from "./mapShift4Evidence"
import type {
  Shift4ExecuteRequest,
  Shift4ExecuteResult,
} from "./types"

export class Shift4ExecutionError extends Error {
  readonly code:
    | "invalid_request"
    | "connection_unavailable"
    | "idempotency_conflict"
    | "invoice_collision"
    | "payment_not_found"
    | "operation_not_permitted"
    | "version_conflict"

  readonly detail: string | null

  constructor(message: string, code: Shift4ExecutionError["code"], detail: string | null = null) {
    super(message)
    this.name = "Shift4ExecutionError"
    this.code = code
    this.detail = detail
  }
}

function assertPositiveAmountMinor(value: number): number {
  try {
    const amountMinor = assertSafeMinorUnits(value, "amountMinor")
    if (amountMinor <= 0) throw new Error("not positive")
    return amountMinor
  } catch {
    throw new Shift4ExecutionError(
      "amountMinor must be a positive safe integer.",
      "invalid_request"
    )
  }
}

/**
 * Execute one Shift4 operation for a payment.
 *
 * Returns a decision object. It never throws for a decline, a referral, or an
 * unknown outcome - those are provider evidence, not failures of this call.
 */
export async function executeShift4Transaction(
  request: Shift4ExecuteRequest
): Promise<Shift4ExecuteResult> {
  /* ── 1. Validate ──────────────────────────────────────────────────────── */
  const merchantId = String(request.merchantId || "").trim()
  const paymentId = String(request.paymentId || "").trim()
  const connectionId = String(request.merchantProviderConnectionId || "").trim()
  const idempotencyKey = String(request.idempotencyKey || "").trim()

  if (!merchantId || !paymentId || !connectionId || !idempotencyKey) {
    throw new Shift4ExecutionError(
      "merchantId, paymentId, merchantProviderConnectionId, and idempotencyKey are all required.",
      "invalid_request"
    )
  }
  if (request.channel !== "retail" && request.channel !== "ecommerce") {
    throw new Shift4ExecutionError("channel must be \"retail\" or \"ecommerce\".", "invalid_request")
  }

  const amountMinor = assertPositiveAmountMinor(request.amountMinor)
  const currency = String(request.currency || "").trim().toUpperCase()
  if (currency !== "USD" && currency !== "CAD") {
    throw new Shift4ExecutionError(
      "currency must be USD or CAD.",
      "invalid_request"
    )
  }

  const payment = await getPaymentById(paymentId)
  if (!payment) {
    throw new Shift4ExecutionError("Payment not found.", "payment_not_found")
  }
  // Tenant isolation: a payment may only be driven by the merchant that owns it.
  // The database function re-checks this; failing early gives a clearer error.
  if (String(payment.merchant_id) !== merchantId) {
    throw new Shift4ExecutionError(
      "Payment does not belong to this merchant.",
      "invalid_request"
    )
  }

  if (request.operation === "capture" && !request.authorizationAttemptId) {
    throw new Shift4ExecutionError(
      "A capture must reference the authorization attempt it closes.",
      "invalid_request"
    )
  }
  if (request.operation === "refund" && !String(request.refundId || "").trim()) {
    throw new Shift4ExecutionError(
      "A refund requires a refundId so multiple refunds cannot share an invoice.",
      "invalid_request"
    )
  }
  const isManualAuthorization =
    request.operation === "authorization" && request.attemptRole === "manual_authorization"
  if (isManualAuthorization) {
    if (request.certificationScopeConfirmed !== true) {
      throw new Shift4ExecutionError(
        "Manual Authorization requires confirmed Shift4 certification scope.",
        "operation_not_permitted"
      )
    }
    if (!/^[A-Za-z0-9]{6}$/.test(String(request.manualAuthorizationCode || "").trim())) {
      throw new Shift4ExecutionError(
        "Manual Authorization requires exactly six alphanumeric characters.",
        "invalid_request"
      )
    }
  }
  if (
    (request.operation === "sale" ||
      request.operation === "authorization" ||
      request.operation === "refund") &&
    !String(request.cardTokenValue || "").trim()
  ) {
    throw new Shift4ExecutionError(
      "A tokenized card value is required. PineTree never sends raw card data.",
      "invalid_request"
    )
  }

  /* ── 2. Resolve the authenticated connection ──────────────────────────── */
  // This proves PineTree can authenticate as the merchant. It deliberately does
  // NOT imply the merchant account is boarded or a device is certified.
  const connection = await getShift4RestAccessToken(merchantId)
  if (!connection) {
    throw new Shift4ExecutionError(
      "This merchant has no connected Shift4 REST credential.",
      "connection_unavailable"
    )
  }
  if (connection.connectionId !== connectionId) {
    throw new Shift4ExecutionError(
      "The supplied Shift4 connection does not match the merchant's stored connection.",
      "invalid_request"
    )
  }

  const correlationId = String(request.correlationId || "").trim() || randomUUID()
  const attemptId =
    String(request.paymentAttemptId || "").trim() ||
    deriveAttemptId({ paymentId, operation: request.operation, idempotencyKey })

  const requestFingerprint = buildRequestFingerprint({
    merchantId,
    merchantProviderConnectionId: connectionId,
    paymentId,
    operation: request.operation,
    channel: request.channel,
    amountMinor,
    currency,
    cardTokenValue: request.cardTokenValue,
  })

  /* ── 3. Invoice ───────────────────────────────────────────────────────── */
  const invoiceReference = createInvoiceReference({
    merchantProviderConnectionId: connectionId,
    pineTreePaymentId: paymentId,
    pineTreePaymentAttemptId: attemptId,
    purpose: request.operation === "refund" ? "refund" : "payment",
    refundId: request.operation === "refund" ? String(request.refundId) : undefined,
  })

  // A capture or void must reuse the authorization's invoice: Shift4 links
  // subsequent requests to the original transaction by invoice number.
  let invoice = invoiceReference.invoice
  let authorization: Shift4PaymentAttemptRow | null = null

  const relatedAttemptId =
    String(request.relatedAttemptId || request.authorizationAttemptId || "").trim()

  if (request.operation === "capture" || request.operation === "void" || isManualAuthorization) {
    if (!relatedAttemptId) {
      throw new Shift4ExecutionError(
        `A ${request.operation} must reference the transaction it settles or reverses.`,
        "invalid_request"
      )
    }
    authorization = await getShift4PaymentAttempt(merchantId, relatedAttemptId)
    if (!authorization) {
      throw new Shift4ExecutionError(
        "The referenced transaction attempt does not exist for this merchant.",
        "invalid_request"
      )
    }
    if (authorization.payment_id !== paymentId) {
      throw new Shift4ExecutionError(
        "The referenced transaction belongs to a different payment.",
        "invalid_request"
      )
    }
    if (authorization.merchant_provider_connection_id !== connectionId) {
      throw new Shift4ExecutionError(
        "The referenced transaction belongs to a different provider connection.",
        "invalid_request"
      )
    }

    if (isManualAuthorization && authorization.attempt_role !== "referral_authorization") {
      throw new Shift4ExecutionError(
        "Manual Authorization must reference the referral attempt it resolves.",
        "invalid_request"
      )
    }

    if (request.operation === "capture") {
      if (authorization.operation !== "authorization" || authorization.state !== "approved") {
        throw new Shift4ExecutionError(
          "A capture requires an approved authorization.",
          "invalid_request"
        )
      }
      if (authorization.authorized_amount_minor === null) {
        throw new Shift4ExecutionError(
          "The referenced authorization has no recorded authorized amount.",
          "invalid_request"
        )
      }
      // FULL CAPTURE ONLY, compared as integer minor units - never a float.
      // Under-capture is refused as explicitly as over-capture: settling less
      // than was authorized silently loses merchant revenue.
      if (amountMinor < authorization.authorized_amount_minor) {
        throw new Shift4ExecutionError(
          "A capture must equal the authorized amount; partial capture is not supported.",
          "invalid_request"
        )
      }
      if (amountMinor > authorization.authorized_amount_minor) {
        throw new Shift4ExecutionError(
          "A capture cannot exceed the authorized amount.",
          "invalid_request"
        )
      }
    }

    if (request.operation === "void") {
      if (!["sale", "authorization", "capture"].includes(authorization.operation)) {
        throw new Shift4ExecutionError(
          "A void must reference a sale, authorization, or capture.",
          "invalid_request"
        )
      }
      if (authorization.state !== "approved") {
        throw new Shift4ExecutionError(
          "A void requires an approved originating transaction.",
          "invalid_request"
        )
      }
    }

    // The chain is linked by invoice, so the child carries the parent's.
    invoice = authorization.invoice
  }

  /* ── 4. Create the attempt BEFORE transmitting ────────────────────────── */
  // The database owns invoice uniqueness and idempotency identity, so a
  // collision or a conflicting key reuse fails here - never after a transaction
  // has already been sent to Shift4.
  const created = await createShift4PaymentAttempt({
    attemptId,
    merchantId,
    paymentId,
    merchantProviderConnectionId: connectionId,
    operation: request.operation,
    channel: request.channel,
    invoice,
    amountMinor,
    currency,
    idempotencyKeyHash: hashIdempotencyKey(idempotencyKey),
    requestFingerprint,
    correlationId,
    authorizationAttemptId:
      request.operation === "capture" ? (relatedAttemptId || null) : null,
    relatedAttemptId:
      request.operation === "capture" || request.operation === "void" || isManualAuthorization
        ? (relatedAttemptId || null)
        : null,
    refundId: request.refundId ?? null,
    // No authorization amount is supplied from here: for a capture the
    // database takes it from the linked authorization row itself.
    cardTokenFingerprint: request.cardTokenValue
      ? fingerprintCardToken(request.cardTokenValue)
      : null,
    attemptRole: request.attemptRole,
    manualAuthorizationCode: request.manualAuthorizationCode ?? null,
  })

  if (created.outcome === "idempotency_conflict") {
    throw new Shift4ExecutionError(
      "This idempotency key was already used for a different Shift4 request.",
      "idempotency_conflict",
      created.conflictReason
    )
  }
  if (created.outcome === "invoice_collision") {
    throw new Shift4ExecutionError(
      "The derived Shift4 invoice is already in use on this provider connection. " +
        "No transaction was transmitted.",
      "invoice_collision",
      created.conflictReason
    )
  }
  if (created.outcome === "rejected") {
    throw new Shift4ExecutionError(
      `Shift4 attempt creation was rejected: ${created.conflictReason || "unknown"}`,
      "invalid_request",
      created.conflictReason
    )
  }
  if (created.outcome === "resumed") {
    // Same key, same request: resume rather than send a second time.
    return resumeExistingAttempt({ merchantId, attemptId, correlationId })
  }

  const createdVersion = created.version ?? 1

  /* ── 5. Call the provider ─────────────────────────────────────────────── */
  let result: Shift4NormalizedOperationResult
  try {
    result = await callShift4({
      request,
      invoice,
      amountMinor,
      currency,
      accessToken: connection.accessToken,
      correlationId,
      attemptId,
      merchantId,
      connectionId,
      paymentId,
    })
  } catch (error) {
    // An unknown outcome is NOT a failure. The issuer may have approved before
    // the failure, so the attempt is parked for invoice-based recovery and the
    // payment's canonical status is left untouched.
    if (isShift4UnknownOutcomeError(error)) {
      const window = SHIFT4_RECOVERY_DELAY_MS[connection.environment]
      const nextCheckAt = new Date(Date.now() + window.maxMs).toISOString()

      const parked = await applyShift4AttemptEvidence({
        merchantId,
        attemptId,
        expectedVersion: createdVersion,
        state: "unresolved",
        recoveryState: "pending_lookup",
        targetStatus: null,
        shift4Event:
          error instanceof Shift4RestTransportError
            ? "shift4.timeout_unknown"
            : "shift4.communication_failure_unknown",
        evidenceSource: "transport_failure",
        timeoutClassification:
          error instanceof Shift4RestTransportError
            ? "timeout"
            : error instanceof Shift4RestApiError
              ? "communication_failure"
              : "invalid_response",
        resolutionReason: null,
        nextCheckAt,
        firstUnknownAt: new Date().toISOString(),
        markDispatched: true,
      })

      console.warn("[shift4-engine] unknown_outcome_parked", {
        paymentId,
        attemptId,
        invoice,
        correlationId,
        nextCheckAt,
      })

      return {
        attemptId,
        invoice,
        correlationId,
        appliedStatus: null,
        recommendedStatus: null,
        attemptState: parked.attemptState ?? "unresolved",
        outcome: "unknown",
        terminal: false,
        lookupRequired: parked.attemptRecoveryState === "pending_lookup",
        reconciliationRequired:
          parked.attemptState === "reconciliation_required" ||
          parked.reconciliationRequired,
        retryClassification: "lookup_required",
        nextCheckAt: parked.attemptNextCheckAt,
        providerReferences: {
          authorizationCode: null,
          retrievalReference: null,
          responseCode: null,
          approvedAmountMinor: null,
        },
        actionRequired: null,
        resumed: false,
      }
    }

    // A determinate provider or configuration error. The attempt row stays as
    // durable evidence that this invoice was consumed; it is NOT deleted, so a
    // retry derives a new attempt rather than silently reusing the invoice.
    await applyShift4AttemptEvidence({
      merchantId,
      attemptId,
      expectedVersion: createdVersion,
      state: "reconciliation_required",
      recoveryState: "blocked",
      targetStatus: null,
      shift4Event: "shift4.reconciliation_required",
      evidenceSource: "engine_error",
      resolutionReason: "provider_call_failed",
      markDispatched: true,
    }).catch((evidenceError) => {
      console.error("[shift4-engine] failed_to_record_execute_failure", {
        paymentId,
        attemptId,
        reason: evidenceError instanceof Error ? evidenceError.message : "unknown",
      })
    })

    console.warn("[shift4-engine] execute_failed", {
      paymentId,
      attemptId,
      correlationId,
      ...describeShift4Error(error),
    })
    throw error
  }

  /* ── 6. Evidence, transition, and ledger in ONE transaction ───────────── */
  const mapping = mapShift4Evidence({
    operation: request.operation,
    result,
    requestedAmountMinor: amountMinor,
  })

  const evidence = projectEvidence(result)

  // The authorization amount is DERIVED IN THE DATABASE from provider evidence.
  //
  // The previous `evidence.approvedAmountMinor ?? amountMinor` fallback let an
  // approval with no amount evidence invent its authorized amount from the
  // request, and a later capture would then have settled against a figure
  // Shift4 never stated. Nothing here supplies an authorization amount.

  const applied = await applyShift4AttemptEvidence({
    merchantId,
    attemptId,
    expectedVersion: createdVersion,
    state: mapping.attemptState,
    recoveryState: mapping.lookupRequired
      ? "pending_lookup"
      : mapping.reconciliationRequired
        ? "blocked"
        : "resolved",
    targetStatus: mapping.status,
    shift4Event: eventNameForState(mapping.attemptState),
    evidenceSource: "provider_response",
    resolutionReason: mapping.reason,
    markDispatched: true,
    ...evidence,
  })

  if (applied.outcome === "version_conflict" || applied.outcome === "lease_conflict") {
    throw new Shift4ExecutionError(
      "The Shift4 attempt was modified by another writer before this response could be applied.",
      "version_conflict",
      applied.conflictReason
    )
  }

  return {
    attemptId,
    invoice,
    correlationId,
    appliedStatus: normalizeAppliedStatus(applied.appliedStatus),
    recommendedStatus: mapping.status,
    attemptState: applied.attemptState ?? mapping.attemptState,
    outcome: result.outcome,
    terminal: mapping.terminal,
    lookupRequired: applied.attemptRecoveryState === "pending_lookup",
    reconciliationRequired:
      applied.attemptState === "reconciliation_required" ||
      applied.outcome === "reconciliation_required",
    retryClassification: mapping.retryClassification,
    nextCheckAt: applied.attemptNextCheckAt,
    providerReferences: {
      authorizationCode: result.authorizationCode,
      retrievalReference: result.retrievalReference,
      responseCode: result.responseCode ?? null,
      approvedAmountMinor: result.approvedAmountMinor,
    },
    actionRequired: mapping.actionRequired,
    resumed: false,
  }
}

function normalizeAppliedStatus(value: string | null): Shift4ExecuteResult["appliedStatus"] {
  if (!value) return null
  const allowed = [
    "CREATED", "PENDING", "PROCESSING", "CONFIRMED",
    "FAILED", "EXPIRED", "CANCELED", "INCOMPLETE",
  ] as const
  const match = allowed.find((candidate) => candidate === value)
  return match ?? null
}

/** Resume a stored attempt without contacting Shift4. */
async function resumeExistingAttempt(input: {
  merchantId: string
  attemptId: string
  correlationId: string
}): Promise<Shift4ExecuteResult> {
  const stored = await getShift4PaymentAttempt(input.merchantId, input.attemptId)

  return {
    attemptId: input.attemptId,
    invoice: stored?.invoice || "",
    correlationId: stored?.correlation_id || input.correlationId,
    appliedStatus: null,
    recommendedStatus: null,
    attemptState: stored?.state || "created",
    outcome: "not_attempted",
    terminal: stored?.state === "approved" || stored?.state === "declined",
    lookupRequired: stored?.recovery_state === "pending_lookup",
    reconciliationRequired: stored?.state === "reconciliation_required",
    retryClassification:
      stored?.recovery_state === "pending_lookup" ? "lookup_required" : "terminal_no_retry",
    nextCheckAt: stored?.next_check_at || null,
    providerReferences: {
      authorizationCode: stored?.authorization_code || null,
      retrievalReference: stored?.retrieval_reference || null,
      responseCode: stored?.response_code || null,
      approvedAmountMinor: stored?.approved_amount_minor ?? null,
    },
    actionRequired: null,
    resumed: true,
  }
}

/** Dispatch to the correct typed Phase 1 wrapper. */
async function callShift4(input: {
  request: Shift4ExecuteRequest
  invoice: string
  amountMinor: number
  currency: string
  accessToken: string
  correlationId: string
  attemptId: string
  merchantId: string
  connectionId: string
  paymentId: string
}): Promise<Shift4NormalizedOperationResult> {
  const context = {
    correlationId: input.correlationId,
    merchantId: input.merchantId,
    merchantProviderConnectionId: input.connectionId,
    pineTreePaymentId: input.paymentId,
    pineTreePaymentAttemptId: input.attemptId,
    requestedAmountMinor: input.request.operation === "void" ? undefined : input.amountMinor,
    entryContext: input.request.entryContext,
  }

  const base = {
    invoice: input.invoice,
    amountMinor: input.amountMinor,
    taxAmountMinor: input.request.taxAmountMinor ?? 0,
    clerkNumericId: input.request.clerkNumericId ?? 1,
    card: { tokenValue: String(input.request.cardTokenValue || "") },
    accessToken: input.accessToken,
    currencyCode: input.currency,
    merchantTimeZone: input.request.merchantTimeZone,
    context,
  }

  switch (input.request.operation) {
    case "sale":
      return sale(base)
    case "authorization":
      if (input.request.attemptRole === "manual_authorization") {
        return manualAuthorization({
          ...base,
          authorizationCode: String(input.request.manualAuthorizationCode),
          certificationScopeConfirmed: true,
        })
      }
      return authorize(base)
    case "capture":
      return capture(base)
    case "refund": {
      const refundReference = createInvoiceReference({
        merchantProviderConnectionId: input.connectionId,
        pineTreePaymentId: input.paymentId,
        pineTreePaymentAttemptId: input.attemptId,
        purpose: "refund",
        refundId: String(input.request.refundId),
      })
      return refundTransaction({ ...base, refundInvoiceReference: refundReference })
    }
    case "void":
      return voidInvoice({
        invoice: input.invoice,
        accessToken: input.accessToken,
        reason: "merchant_initiated",
        context,
      })
    default:
      throw new Shift4ExecutionError(
        `Unsupported Shift4 operation: ${String(input.request.operation)}`,
        "operation_not_permitted"
      )
  }
}
