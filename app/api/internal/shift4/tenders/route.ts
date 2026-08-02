import { NextRequest } from "next/server"
import { getShift4TenderProgress } from "@/engine/shift4/tenders"
import { requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { shift4Error, shift4Success } from "@/lib/api/shift4Routes"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(request, "payments:read")
    const paymentId = request.nextUrl.searchParams.get("paymentId") || ""
    if (!paymentId) throw Object.assign(new Error("paymentId is required"), { status: 400, code: "invalid_request" })
    return shift4Success(await getShift4TenderProgress(merchantId, paymentId))
  } catch (error) {
    return shift4Error(error, "Unable to load Shift4 tender progress")
  }
}
