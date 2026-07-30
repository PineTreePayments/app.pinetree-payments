/**
 * DELETE /transactions/invoice - Void.
 *
 * Shift4: "Used to void and reverse an invoice. This will attempt to reverse the
 * transaction with the processor and will mark the transaction as voided in
 * Shift4's Gateway."
 *
 * The invoice travels in the `Invoice` request header. The DELETE does not
 * support a request body, so none is sent.
 *
 * ── Critical safety rule ─────────────────────────────────────────────────────
 * The timeout guide states plainly: "If a transaction fails, do not send a Void
 * request. Your interface should log the error condition for the merchant's
 * review." A void therefore must never be used as timeout cleanup or as a
 * reflex after a failure. This wrapper refuses to run unless the caller passes
 * an explicit, non-recovery reason, so a future recovery path cannot casually
 * reach for it.
 */

import { shift4RestRequest, type Shift4RequestContext } from "../client"
import type { Shift4RestConfig } from "../config"
import { Shift4RestApiError } from "../errors"
import type { Shift4NormalizedOperationResult } from "../normalizeResponse"
import { assertValidShift4Invoice } from "./invoiceReference"

/**
 * Why a void is being issued.
 *
 *   merchant_initiated  A merchant or clerk explicitly cancelled the sale.
 *   duplicate_confirmed A duplicate was positively identified by invoice lookup.
 *
 * There is deliberately no "timeout" or "failure" reason: Shift4 forbids voiding
 * in those cases.
 */
export type Shift4VoidReason = "merchant_initiated" | "duplicate_confirmed"

export type VoidShift4InvoiceInput = {
  invoice: string
  accessToken: string
  reason: Shift4VoidReason
  context?: Omit<Shift4RequestContext, "invoice">
  /** Documented optional header parameters on this endpoint. */
  reversalReason?: string
  receiptColumns?: number
  token?: string
  config?: Shift4RestConfig
  fetchImpl?: typeof fetch
}

const PERMITTED_VOID_REASONS: readonly Shift4VoidReason[] = [
  "merchant_initiated",
  "duplicate_confirmed",
]

export async function voidInvoice(
  input: VoidShift4InvoiceInput
): Promise<Shift4NormalizedOperationResult> {
  const invoice = assertValidShift4Invoice(input.invoice)

  if (!PERMITTED_VOID_REASONS.includes(input.reason)) {
    throw new Shift4RestApiError(
      "A Shift4 void requires an explicit permitted reason. Shift4 forbids voiding a failed or timed-out transaction; log it for merchant review instead.",
      { diagnostics: { operation: "void", invoice } }
    )
  }

  const response = await shift4RestRequest({
    operation: "void",
    accessToken: input.accessToken,
    headerParameters: {
      ReversalReason: input.reversalReason,
      ReceiptColumns: input.receiptColumns,
      Token: input.token,
    },
    context: { ...(input.context ?? {}), invoice },
    config: input.config,
    fetchImpl: input.fetchImpl,
  })

  return response.result
}
