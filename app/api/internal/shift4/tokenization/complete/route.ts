import { NextRequest } from "next/server"
import { completeAndExecuteShift4HostedCheckout } from "@/engine/shift4/hostedCheckout"
import { requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { readJsonObject, requireIdempotencyKey, requiredString, shift4Error, shift4Success } from "@/lib/api/shift4Routes"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(request, "checkout.sessions:write")
    const body = await readJsonObject(request)
    const operation = body.operation === "authorization" ? "authorization" : body.operation === "sale" ? "sale" : null
    if (!operation) throw Object.assign(new Error("operation must be sale or authorization"), { status: 400, code: "invalid_request" })
    const result = await completeAndExecuteShift4HostedCheckout({
      merchantId,
      sessionId: requiredString(body, "sessionId"),
      completionSecret: requiredString(body, "completionSecret"),
      cardToken: body.cardToken,
      operation,
      idempotencyKey: requireIdempotencyKey(request.headers),
      correlationId: request.headers.get("x-correlation-id") || undefined,
    })
    return shift4Success(result)
  } catch (error) {
    return shift4Error(error, "Unable to complete Shift4 checkout")
  }
}
