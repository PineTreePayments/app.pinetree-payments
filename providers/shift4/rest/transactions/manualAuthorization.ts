import { shift4RestRequest, type Shift4RequestContext } from "../client"
import type { Shift4RestConfig } from "../config"
import { Shift4RestApiError } from "../errors"
import type { Shift4NormalizedOperationResult } from "../normalizeResponse"
import { buildTokenTransactionRequest, type Shift4TransactionRequestInput } from "./request"

/**
 * Manual Authorization — the GTV-token variant.
 *
 * Shift4 documents this operation for all four integration methods, including
 * Commerce Engine For Cloud. This adapter sends the TOKEN variant, which is what
 * the referral flow uses when the original authorization retained a card token:
 * the customer does not present the card a second time. The Commerce Engine For
 * Cloud body variant is built by `providers/shift4/commerce-engine/cloud`.
 *
 * `transaction.purchaseCard` is required by this schema and is supplied by the
 * caller from `engine/shift4/purchaseCardData.ts`.
 *
 * SECURITY: the authorization code is validated and attached to the request. It
 * is never logged here, never returned, and never placed in an error message.
 */
export async function manualAuthorization(input: Shift4TransactionRequestInput & {
  accessToken: string
  authorizationCode: string
  certificationScopeConfirmed: true
  context?: Omit<Shift4RequestContext, "invoice">
  config?: Shift4RestConfig
  fetchImpl?: typeof fetch
}): Promise<Shift4NormalizedOperationResult> {
  if (input.certificationScopeConfirmed !== true) {
    throw new Shift4RestApiError(
      "Shift4 Manual Authorization requires confirmed certification scope.",
      { diagnostics: { operation: "manual_authorization", invoice: input.invoice } }
    )
  }
  const authorizationCode = String(input.authorizationCode).trim()
  if (!/^[A-Za-z0-9]{6}$/.test(authorizationCode)) {
    // The rejected value is deliberately not echoed into the error.
    throw new Shift4RestApiError(
      "Shift4 Manual Authorization requires exactly six alphanumeric characters.",
      { diagnostics: { operation: "manual_authorization", invoice: input.invoice } }
    )
  }

  const body = buildTokenTransactionRequest("manual_authorization", input)
  // Normalized to uppercase after validation, as the code is case-insensitive
  // and the issuer reads it out rather than typing it.
  body.transaction.authorizationCode = authorizationCode.toUpperCase()
  const response = await shift4RestRequest({
    operation: "manual_authorization",
    accessToken: input.accessToken,
    body,
    context: { ...(input.context ?? {}), invoice: body.transaction.invoice },
    config: input.config,
    fetchImpl: input.fetchImpl,
  })
  return response.result
}
