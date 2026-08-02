import { createShift4OnboardingSession } from "@/database/shift4OnboardingSessions"
import { startShift4Application } from "@/providers/shift4/onboarding"
import { resolveShift4Readiness } from "../readiness"
import type { StartShift4OnboardingInput, StartShift4OnboardingResult } from "./types"

export async function startShift4Onboarding(input: StartShift4OnboardingInput): Promise<StartShift4OnboardingResult> {
  const readiness = await resolveShift4Readiness(input.merchantId)
  if (!readiness.flags.restApi) throw Object.assign(new Error("Shift4 REST onboarding gate is disabled"), { status: 503, code: "shift4_not_ready" })
  if (readiness.connectionId !== input.merchantProviderConnectionId) throw Object.assign(new Error("Shift4 connection does not belong to this merchant"), { status: 403, code: "connection_mismatch" })
  if (input.fixture && !readiness.flags.certificationMode) throw Object.assign(new Error("Fixture onboarding requires certification mode"), { status: 403, code: "certification_disabled" })
  const launch = startShift4Application(input)
  const session = await createShift4OnboardingSession({ ...input, providerApplicationId: launch.providerApplicationId,
    launchReference: launch.launchReference, hostedApplicationUrl: launch.hostedApplicationUrl, status: launch.status })
  return Object.freeze({ launch, session })
}
