import { NextRequest } from "next/server"
import { getLatestShift4OnboardingSession } from "@/database/shift4OnboardingSessions"
import { requireAdminFromRequest } from "@/lib/api/adminAuth"
import { readShift4FeatureFlags } from "@/engine/shift4/readiness"
import { shift4Error, shift4Success } from "@/lib/api/shift4Routes"

export const dynamic = "force-dynamic"
export async function GET(request: NextRequest) {
  try {
    await requireAdminFromRequest(request)
    if (!readShift4FeatureFlags().certificationMode) throw Object.assign(new Error("Not found"), { status: 404, code: "not_found" })
    const merchantId = request.nextUrl.searchParams.get("merchantId")?.trim() || ""
    if (!merchantId) throw Object.assign(new Error("merchantId is required"), { status: 400, code: "invalid_request" })
    return shift4Success(await getLatestShift4OnboardingSession(merchantId))
  } catch (error) { return shift4Error(error, "Unable to load Shift4 onboarding") }
}
