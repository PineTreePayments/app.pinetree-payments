import { NextRequest } from "next/server"
import { assertOperationName, executeMerchantShift4Operation } from "@/engine/shift4/services"
import { requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { readJsonObject, requireIdempotencyKey, requiredMinorUnits, requiredString, shift4Error, shift4Success } from "@/lib/api/shift4Routes"
import type { Shift4AttemptRole } from "@/database/shift4PaymentAttempts"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest, context: { params: Promise<{ operation: string }> }) {
  try {
    const merchantId = await requireMerchantIdFromRequest(request, "checkout.sessions:write")
    const operation = assertOperationName((await context.params).operation)
    const body = await readJsonObject(request)
    if ("adapter" in body) {
      throw Object.assign(new Error("Production routes do not accept adapter selection"), { status: 400, code: "invalid_adapter" })
    }
    const idempotencyKey = requireIdempotencyKey(request.headers)
    const channel = body.channel === "retail" ? "retail" : body.channel === "ecommerce" ? "ecommerce" : null
    if (!channel) throw Object.assign(new Error("channel must be ecommerce or retail"), { status: 400, code: "invalid_request" })
    const attemptRole: Shift4AttemptRole | undefined = body.manualAuthorizationCode
      ? "manual_authorization"
      : undefined

    const result = await executeMerchantShift4Operation(merchantId, {
      merchantProviderConnectionId: requiredString(body, "merchantProviderConnectionId"),
      paymentId: requiredString(body, "paymentId"),
      operation,
      channel,
      amountMinor: requiredMinorUnits(body),
      taxAmountMinor: Number.isSafeInteger(body.taxAmountMinor) ? Number(body.taxAmountMinor) : undefined,
      currency: requiredString(body, "currency"),
      idempotencyKey,
      cardTokenValue: typeof body.cardToken === "string" ? body.cardToken.trim() : undefined,
      authorizationAttemptId: typeof body.authorizationAttemptId === "string" ? body.authorizationAttemptId.trim() : undefined,
      relatedAttemptId: typeof body.relatedAttemptId === "string" ? body.relatedAttemptId.trim() : undefined,
      refundId: typeof body.refundId === "string" ? body.refundId.trim() : undefined,
      attemptRole,
      manualAuthorizationCode: typeof body.manualAuthorizationCode === "string" ? body.manualAuthorizationCode.trim() : undefined,
      certificationScopeConfirmed: attemptRole ? body.certificationScopeConfirmed === true : undefined,
      correlationId: request.headers.get("x-correlation-id") || undefined,
      entryContext: body.entryContext === "device_pin_pad" ? "device_pin_pad" : "standard",
      additionalTender: body.additionalTender === true,
    })
    return shift4Success(result)
  } catch (error) {
    return shift4Error(error, "Shift4 payment operation failed")
  }
}
