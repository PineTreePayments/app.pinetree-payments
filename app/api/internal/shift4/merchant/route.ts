import { NextRequest } from "next/server"
import { assertShift4Channel, getMerchantShift4CertificationInformation } from "@/engine/shift4/services"
import { requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { shift4Error, shift4Success } from "@/lib/api/shift4Routes"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(request)
    if (request.headers.get("x-shift4-certification-scope") !== "confirmed") {
      throw Object.assign(new Error("Explicit certification scope confirmation is required"), { status: 403, code: "certification_confirmation_required" })
    }
    // The channel selects which stored credential authenticates the lookup.
    const channel = assertShift4Channel(request.nextUrl.searchParams.get("channel")?.trim())
    return shift4Success(await getMerchantShift4CertificationInformation(merchantId, channel))
  } catch (error) {
    return shift4Error(error, "Shift4 merchant information failed")
  }
}
