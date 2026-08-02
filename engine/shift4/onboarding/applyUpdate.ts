import { applyShift4OnboardingUpdate as persistUpdate } from "@/database/shift4OnboardingSessions"
import { normalizeShift4OnboardingUpdate } from "@/providers/shift4/onboarding"
import type { ApplyShift4OnboardingInput } from "./types"

export async function applyShift4OnboardingUpdate(input: ApplyShift4OnboardingInput) {
  const update = normalizeShift4OnboardingUpdate(input.update)
  if (update.source === "fixture" && !input.fixtureAuthorized) throw Object.assign(new Error("Fixture onboarding update is not authorized"), { status: 403, code: "fixture_not_authorized" })
  if (!update.verified && update.source !== "fixture") throw Object.assign(new Error("Unverified onboarding update requires manual review"), { status: 409, code: "manual_review_required" })
  return persistUpdate({ merchantId: input.merchantId, update })
}
