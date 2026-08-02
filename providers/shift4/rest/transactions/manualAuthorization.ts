import { shift4RestRequest, type Shift4RequestContext } from "../client"
import type { Shift4RestConfig } from "../config"
import { Shift4RestApiError } from "../errors"
import type { Shift4NormalizedOperationResult } from "../normalizeResponse"
import { buildTokenTransactionRequest, type Shift4TransactionRequestInput } from "./request"

/** Backend-only certification flow for a six-character voice approval code. */
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
    throw new Shift4RestApiError(
      "Shift4 Manual Authorization requires exactly six alphanumeric characters.",
      { diagnostics: { operation: "manual_authorization", invoice: input.invoice } }
    )
  }

  const body = buildTokenTransactionRequest("manual_authorization", input)
  body.transaction.authorizationCode = authorizationCode
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
