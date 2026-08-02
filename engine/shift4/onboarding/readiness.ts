import type { Shift4OnboardingSessionRow } from "@/database/shift4OnboardingSessions"
import type { Shift4OnboardingReadiness } from "./types"

export function projectShift4OnboardingReadiness(session: Shift4OnboardingSessionRow | null, required: boolean): Shift4OnboardingReadiness {
  if (!required) return Object.freeze({ status: session?.status || "not_started", approved: session?.status === "approved", blocksProduction: false, reason: "Onboarding approval is not required for this configured merchant path" })
  if (!session) return Object.freeze({ status: "not_started", approved: false, blocksProduction: true, reason: "Shift4 merchant onboarding has not started" })
  return Object.freeze({ status: session.status, approved: session.status === "approved", blocksProduction: session.status !== "approved",
    reason: session.status === "approved" ? "Shift4 reports the merchant application approved" : `Shift4 onboarding status is ${session.status}` })
}
