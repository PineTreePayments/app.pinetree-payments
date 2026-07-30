/**
 * GET /transactions/invoice - Invoice Information.
 *
 * The authoritative resolver for an unknown transaction outcome. Shift4:
 *   "Used to request the status (e.g., approved, declined, error, referral,
 *    etc.) for a specific invoice; it is primarily used after a timeout or
 *    error has occurred. Voided or batched and settled invoices will return an
 *    'Invoice Not Found' error."
 *
 * The invoice travels in the `Invoice` request header. The GET does not support
 * a request body - sending an empty one may cause an error - so none is sent.
 *
 * This is a read-only lookup and therefore the only operation permitted to
 * retry automatically (the guide allows one retry before logging for auditor
 * review).
 */

import {
  shift4LookupWithSingleRetry,
  shift4RestRequest,
  type Shift4RequestContext,
  type Shift4RestRequestResult,
} from "../client"
import { Shift4RestApiError } from "../errors"
import type { Shift4RestConfig } from "../config"
import type { Shift4NormalizedOperationResult } from "../normalizeResponse"
import { assertValidShift4Invoice } from "./invoiceReference"

export type GetShift4InvoiceInput = {
  invoice: string
  accessToken: string
  context?: Omit<Shift4RequestContext, "invoice">
  /** Documented optional header parameters on this endpoint. */
  apiOptions?: string
  receiptColumns?: number
  token?: string
  config?: Shift4RestConfig
  fetchImpl?: typeof fetch
  /** Retry the lookup once on failure, as the guide permits. Default true. */
  allowSingleRetry?: boolean
}

export type Shift4InvoiceLookup =
  | {
      /** Shift4 holds a transaction for this invoice. */
      found: true
      condition: "invoice_present"
      result: Shift4NormalizedOperationResult
    }
  | {
      /**
       * Shift4 answered "Invoice Not Found".
       *
       * This reports only what Shift4 OBSERVED. It deliberately does not
       * authorize a resend, because the documented meaning is ambiguous: Shift4
       * returns "Invoice Not Found" for an invoice that never arrived AND for
       * one that was voided or already batched and settled. Treating this as
       * "safe to resend" would double-charge a customer whose sale actually
       * succeeded and settled.
       *
       * A resend is an Engine decision that additionally requires PineTree's own
       * records to show the invoice never succeeded. The provider client never
       * resends the original operation itself.
       */
      found: false
      condition: "invoice_not_found"
      result: null
    }

export async function getInvoice(input: GetShift4InvoiceInput): Promise<Shift4InvoiceLookup> {
  const invoice = assertValidShift4Invoice(input.invoice)

  const request = {
    accessToken: input.accessToken,
    headerParameters: {
      ApiOptions: input.apiOptions,
      ReceiptColumns: input.receiptColumns,
      Token: input.token,
    },
    context: { ...(input.context ?? {}), invoice },
    config: input.config,
    fetchImpl: input.fetchImpl,
  }

  let response: Shift4RestRequestResult
  try {
    response = input.allowSingleRetry === false
      ? await shift4RestRequest({ ...request, operation: "invoice_information" })
      : await shift4LookupWithSingleRetry(request)
  } catch (error) {
    if (error instanceof Shift4RestApiError && error.invoiceNotFound) {
      return { found: false, condition: "invoice_not_found", result: null }
    }
    throw error
  }

  // Shift4 can also report absence through the normalized outcome rather than
  // by throwing, so both paths are handled.
  if (response.result.outcome === "not_found") {
    return { found: false, condition: "invoice_not_found", result: null }
  }

  return { found: true, condition: "invoice_present", result: response.result }
}
