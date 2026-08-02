import { NextRequest } from "next/server"
import { getLatestShift4OnboardingSession } from "@/database/shift4OnboardingSessions"
import { requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { shift4Error, shift4Success } from "@/lib/api/shift4Routes"

export const dynamic = "force-dynamic"
export async function GET(request: NextRequest) {
  try { const merchantId = await requireMerchantIdFromRequest(request, "checkout.sessions:read"); return shift4Success(await getLatestShift4OnboardingSession(merchantId)) }
  catch (error) { return shift4Error(error, "Unable to load Shift4 onboarding") }
}
