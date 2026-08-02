import { NextRequest } from "next/server"
import { randomUUID } from "node:crypto"
import { startShift4Onboarding } from "@/engine/shift4/onboarding"
import { requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { readJsonObject, requiredString, shift4Error, shift4Success } from "@/lib/api/shift4Routes"

export const dynamic = "force-dynamic"
export async function POST(request: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(request, "checkout.sessions:write")
    const body = await readJsonObject(request)
    return shift4Success(await startShift4Onboarding({ merchantId,
      merchantProviderConnectionId: requiredString(body, "merchantProviderConnectionId"),
      correlationId: request.headers.get("x-correlation-id") || randomUUID(), fixture: body.fixture === true }), 201)
  } catch (error) { return shift4Error(error, "Unable to start Shift4 onboarding") }
}
