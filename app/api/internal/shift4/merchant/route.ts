import { NextRequest } from "next/server"
import { getMerchantShift4CertificationInformation } from "@/engine/shift4/services"
import { requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { shift4Error, shift4Success } from "@/lib/api/shift4Routes"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(request)
    if (request.headers.get("x-shift4-certification-scope") !== "confirmed") {
      throw Object.assign(new Error("Explicit certification scope confirmation is required"), { status: 403, code: "certification_confirmation_required" })
    }
    return shift4Success(await getMerchantShift4CertificationInformation(merchantId))
  } catch (error) {
    return shift4Error(error, "Shift4 merchant information failed")
  }
}
