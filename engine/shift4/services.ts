/** Authenticated application-service boundary for every new Shift4 API route. */
import { randomUUID } from "node:crypto"
import { getShift4RestAccessToken } from "@/database/merchantShift4RestConnections"
import { getShift4PaymentAttempt, listShift4PaymentAttempts } from "@/database/shift4PaymentAttempts"
import { getMerchantInformation } from "@/providers/shift4/rest"
import { executeShift4Transaction } from "./executeTransaction"
import { recoverUnknownOutcome } from "./recoverUnknownOutcome"
import { assertShift4Capability, capabilityForOperation, resolveShift4Readiness } from "./readiness"
import { assertAdditionalTenderAmount, getShift4TenderProgress } from "./tenders"
import type { Shift4Channel, Shift4ExecuteRequest, Shift4EngineOperation } from "./types"

/** Validate a caller-supplied channel. There is no default and no inference. */
export function assertShift4Channel(value: unknown): Shift4Channel {
  if (value === "retail" || value === "ecommerce") return value
  throw Object.assign(
    new Error("channel must be \"retail\" or \"ecommerce\""),
    { status: 400, code: "invalid_channel" }
  )
}

export async function getShift4ReadinessForMerchant(merchantId: string) {
  return resolveShift4Readiness(merchantId)
}

export async function executeMerchantShift4Operation(
  merchantId: string,
  input: Omit<Shift4ExecuteRequest, "merchantId"> & { additionalTender?: boolean }
) {
  const readiness = await resolveShift4Readiness(merchantId)
  assertShift4Capability(readiness, capabilityForOperation(input.operation, input.channel))
  if (input.attemptRole === "manual_authorization") {
    assertShift4Capability(readiness, "manual_authorization")
  }
  if (input.additionalTender) {
    assertShift4Capability(readiness, "split_tender")
    const progress = await getShift4TenderProgress(merchantId, input.paymentId)
    if (!progress) throw Object.assign(new Error("No Shift4 tender group exists for this payment"), { status: 409, code: "tender_group_missing" })
    assertAdditionalTenderAmount(progress, input.amountMinor)
  }
  if (readiness.connectionId !== input.merchantProviderConnectionId) {
    throw Object.assign(new Error("Shift4 connection does not belong to this merchant"), { status: 403, code: "connection_mismatch" })
  }
  const request = { ...input }
  delete request.additionalTender
  return executeShift4Transaction({ ...request, merchantId })
}

export async function listMerchantShift4Attempts(merchantId: string, paymentId: string) {
  if (!paymentId.trim()) throw Object.assign(new Error("paymentId is required"), { status: 400, code: "invalid_request" })
  return listShift4PaymentAttempts(merchantId, paymentId)
}

export async function getMerchantShift4Attempt(merchantId: string, attemptId: string) {
  const attempt = await getShift4PaymentAttempt(merchantId, attemptId)
  if (!attempt) throw Object.assign(new Error("Shift4 attempt not found"), { status: 404, code: "not_found" })
  return attempt
}

export async function recoverMerchantShift4Attempt(merchantId: string, attemptId: string) {
  const readiness = await resolveShift4Readiness(merchantId)
  assertShift4Capability(readiness, "rest_api")
  await getMerchantShift4Attempt(merchantId, attemptId)
  return recoverUnknownOutcome({ merchantId, attemptId })
}

/**
 * Merchant Information for certification evidence.
 *
 * The channel is REQUIRED and never inferred: the lookup authenticates with one
 * channel's access token, so answering for "the merchant" without saying which
 * credential was used would be misleading evidence.
 */
export async function getMerchantShift4CertificationInformation(
  merchantId: string,
  channel: Shift4Channel
) {
  const readiness = await resolveShift4Readiness(merchantId)
  if (!readiness.flags.certificationMode) {
    throw Object.assign(new Error("Shift4 certification mode is disabled"), { status: 403, code: "certification_disabled" })
  }
  assertShift4Capability(readiness, "rest_api")
  // Explicit legacy compatibility: a merchant connected before the channel map
  // existed still has one usable credential.
  const connection = await getShift4RestAccessToken(merchantId, {
    channel,
    allowLegacySharedCredential: true,
  })
  if (!connection) throw Object.assign(new Error(`Shift4 authentication is unavailable for the ${channel} channel`), { status: 503, code: "connection_unavailable" })
  return getMerchantInformation({
    accessToken: connection.accessToken,
    certificationScopeConfirmed: true,
    context: { correlationId: randomUUID() },
  })
}

export function assertOperationName(value: string): Shift4EngineOperation {
  if (value === "manual-authorization") return "authorization"
  if (["sale", "authorization", "capture", "refund", "void"].includes(value)) {
    return value as Shift4EngineOperation
  }
  throw Object.assign(new Error("Unsupported Shift4 operation"), { status: 404, code: "not_found" })
}
