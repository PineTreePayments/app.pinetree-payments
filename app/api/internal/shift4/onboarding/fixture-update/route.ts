import { NextRequest } from "next/server"
import { applyShift4OnboardingUpdate } from "@/engine/shift4/onboarding"
import { readShift4FeatureFlags } from "@/engine/shift4/readiness"
import { shift4OnboardingFixture, SHIFT4_ONBOARDING_STATUSES, type Shift4OnboardingStatus } from "@/providers/shift4/onboarding"
import { requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { readJsonObject, requiredString, shift4Error, shift4Success } from "@/lib/api/shift4Routes"

export const dynamic = "force-dynamic"
export async function POST(request: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(request, "checkout.sessions:write")
    if (!readShift4FeatureFlags().certificationMode) throw Object.assign(new Error("Certification mode is disabled"), { status: 404, code: "not_found" })
    const body = await readJsonObject(request); const status = String(body.status || "") as Shift4OnboardingStatus
    if (!SHIFT4_ONBOARDING_STATUSES.includes(status)) throw Object.assign(new Error("status is invalid"), { status: 400, code: "invalid_request" })
    const update = shift4OnboardingFixture({ providerApplicationId: requiredString(body, "providerApplicationId"), status, sequence: Number(body.sequence || 1) })
    return shift4Success(await applyShift4OnboardingUpdate({ merchantId, update, fixtureAuthorized: true }))
  } catch (error) { return shift4Error(error, "Unable to apply onboarding fixture") }
}
