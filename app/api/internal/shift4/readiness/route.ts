import { NextRequest } from "next/server"
import { getShift4ReadinessForMerchant } from "@/engine/shift4/services"
import { requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { shift4Error, shift4Success } from "@/lib/api/shift4Routes"
import { buildShift4SupportDiagnostics } from "@/engine/shift4/diagnostics"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(request)
    const readiness = await getShift4ReadinessForMerchant(merchantId)
    return shift4Success({ ...readiness, diagnostics: buildShift4SupportDiagnostics({ readiness }) })
  } catch (error) {
    return shift4Error(error, "Unable to load Shift4 readiness")
  }
}
