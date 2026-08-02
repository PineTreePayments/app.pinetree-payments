import { NextRequest } from "next/server"
import { recoverMerchantShift4Attempt } from "@/engine/shift4/services"
import { requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { readJsonObject, requiredString, shift4Error, shift4Success } from "@/lib/api/shift4Routes"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(request, "checkout.sessions:write")
    const body = await readJsonObject(request)
    return shift4Success(await recoverMerchantShift4Attempt(merchantId, requiredString(body, "attemptId")))
  } catch (error) {
    return shift4Error(error, "Shift4 recovery failed")
  }
}
