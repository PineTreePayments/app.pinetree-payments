import { NextRequest } from "next/server"
import { requireAdminFromRequest } from "@/lib/api/adminAuth"
import { readShift4FeatureFlags, resolveShift4Readiness } from "@/engine/shift4/readiness"
import { shift4Error, shift4Success } from "@/lib/api/shift4Routes"
import { buildShift4SupportDiagnostics } from "@/engine/shift4/diagnostics"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    await requireAdminFromRequest(request)
    if (!readShift4FeatureFlags().certificationMode) {
      throw Object.assign(new Error("Not found"), { status: 404, code: "not_found" })
    }
    const merchantId = request.nextUrl.searchParams.get("merchantId")?.trim() || ""
    if (!merchantId) throw Object.assign(new Error("merchantId is required"), { status: 400, code: "invalid_request" })
    const readiness = await resolveShift4Readiness(merchantId)
    return shift4Success({ merchantId, readiness, diagnostics: buildShift4SupportDiagnostics({ readiness }), certificationMatrix: { ecommerceCases: 23, retailCases: 26, liveExecutionEnabled: false } })
  } catch (error) {
    return shift4Error(error, "Unable to load Shift4 admin readiness")
  }
}
