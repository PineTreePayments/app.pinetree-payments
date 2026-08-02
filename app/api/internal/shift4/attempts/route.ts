import { NextRequest } from "next/server"
import { listMerchantShift4Attempts } from "@/engine/shift4/services"
import { requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { shift4Error, shift4Success } from "@/lib/api/shift4Routes"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(request, "payments:read")
    const paymentId = request.nextUrl.searchParams.get("paymentId") || ""
    return shift4Success(await listMerchantShift4Attempts(merchantId, paymentId))
  } catch (error) {
    return shift4Error(error, "Unable to load Shift4 attempts")
  }
}
