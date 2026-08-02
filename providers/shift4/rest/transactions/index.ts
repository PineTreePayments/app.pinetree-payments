/**
 * Typed wrappers for the approved Shift4 transaction operations.
 *
 *   POST /transactions/authorization  - approve funds without capturing
 *   POST /transactions/capture        - close an existing authorization
 *   POST /transactions/sale           - authorize and capture in one request
 *   POST /transactions/refund         - refund full or partial amount
 *
 * All four use the same tokenized request body and the same response envelope,
 * so they share construction and differ only in endpoint and invoice rules.
 *
 * ── Invoice rules that this module enforces ──────────────────────────────────
 * Authorization -> Capture is a SUBSEQUENT request pair and MUST reuse the same
 * invoice. Refund is NOT a subsequent request and MUST use a new invoice:
 * Shift4 documents that reusing the sale's invoice for a refund can leave the
 * consumer with a net credit. `refund()` therefore requires an invoice whose
 * derived purpose is "refund".
 *
 * ── No automatic retries ─────────────────────────────────────────────────────
 * None of these wrappers retry. A timeout or communication failure surfaces as
 * an unknown-outcome error for the Engine to resolve by invoice lookup.
 *
 * These wrappers are intentionally not yet wired to merchant-facing UI. They are
 * typed, validated, and tested so the Engine phase can adopt them unchanged.
 */

import { shift4RestRequest, type Shift4RequestContext } from "../client"
import type { Shift4RestConfig } from "../config"
import { Shift4RestApiError } from "../errors"
import type { Shift4NormalizedOperationResult } from "../normalizeResponse"
import type { Shift4InvoiceReference } from "../invoices/invoiceReference"
import { buildTokenTransactionRequest, type Shift4TransactionRequestInput } from "./request"

export { manualAuthorization } from "./manualAuthorization"

export type Shift4TransactionCallInput = Shift4TransactionRequestInput & {
  accessToken: string
  context?: Omit<Shift4RequestContext, "invoice">
  config?: Shift4RestConfig
  fetchImpl?: typeof fetch
}

async function runTransaction(
  operation: "authorization" | "capture" | "sale" | "refund",
  input: Shift4TransactionCallInput
): Promise<Shift4NormalizedOperationResult> {
  const body = buildTokenTransactionRequest(operation, input)

  const response = await shift4RestRequest({
    operation,
    accessToken: input.accessToken,
    body,
    context: { ...(input.context ?? {}), invoice: body.transaction.invoice },
    config: input.config,
    fetchImpl: input.fetchImpl,
  })

  return response.result
}

/**
 * POST /transactions/authorization
 *
 * Requests processor approval without capturing funds. Shift4 notes that when
 * the invoice already exists, only the additional amount is requested - which is
 * how incremental authorizations share one invoice.
 */
export async function authorize(
  input: Shift4TransactionCallInput
): Promise<Shift4NormalizedOperationResult> {
  return runTransaction("authorization", input)
}

/**
 * POST /transactions/capture
 *
 * Closes an existing authorization, converting it to a sale ready for batching.
 *
 * Requires the SAME invoice as the authorization it closes. Shift4 also notes
 * that when a card is tokenized outside Shift4, capture requires the token
 * returned by the authorization - so `card.tokenValue` should be the token from
 * the authorization response, not the original i4Go token.
 */
export async function capture(
  input: Shift4TransactionCallInput & {
    /** The invoice reference used by the authorization being captured. */
    authorizationInvoiceReference?: Pick<Shift4InvoiceReference, "invoice" | "purpose">
  }
): Promise<Shift4NormalizedOperationResult> {
  if (
    input.authorizationInvoiceReference &&
    input.authorizationInvoiceReference.invoice !== input.invoice
  ) {
    throw new Shift4RestApiError(
      "A Shift4 capture must reuse the invoice number of the authorization it closes.",
      { diagnostics: { operation: "capture", invoice: input.invoice } }
    )
  }
  return runTransaction("capture", input)
}

/**
 * POST /transactions/sale
 *
 * Authorizes and captures in one request.
 */
export async function sale(
  input: Shift4TransactionCallInput
): Promise<Shift4NormalizedOperationResult> {
  return runTransaction("sale", input)
}

/**
 * POST /transactions/refund
 *
 * Refunds a transaction for the full or a partial amount.
 *
 * A refund REQUIRES a new invoice number. Passing the invoice reference proves
 * the caller derived one with purpose "refund"; reusing the sale's invoice is
 * rejected here rather than being discovered later as a net credit.
 */
export async function refund(
  input: Shift4TransactionCallInput & {
    /** The refund's own invoice reference. Its purpose must be "refund". */
    refundInvoiceReference: Pick<Shift4InvoiceReference, "invoice" | "purpose">
  }
): Promise<Shift4NormalizedOperationResult> {
  if (input.refundInvoiceReference.purpose !== "refund") {
    throw new Shift4RestApiError(
      "A Shift4 refund requires an invoice derived with purpose \"refund\". Reusing the sale invoice can leave the consumer with a net credit.",
      { diagnostics: { operation: "refund", invoice: input.invoice } }
    )
  }
  if (input.refundInvoiceReference.invoice !== input.invoice) {
    throw new Shift4RestApiError(
      "The Shift4 refund invoice does not match the supplied refund invoice reference.",
      { diagnostics: { operation: "refund", invoice: input.invoice } }
    )
  }
  return runTransaction("refund", input)
}
