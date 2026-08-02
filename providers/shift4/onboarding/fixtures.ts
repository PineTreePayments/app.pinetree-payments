import type { Shift4OnboardingStatus, Shift4OnboardingUpdate } from "./types"

export function shift4OnboardingFixture(input: { providerApplicationId: string; status: Shift4OnboardingStatus; sequence?: number }): Shift4OnboardingUpdate {
  const sequence = Math.max(1, input.sequence || 1)
  return Object.freeze({ providerApplicationId: input.providerApplicationId, updateReference: `fixture-update-${sequence}`, status: input.status,
    reasonCode: input.status === "more_information_required" ? "fixture.more_information" : null,
    occurredAt: new Date(Date.UTC(2026, 7, 1, 12, sequence, 0)).toISOString(), correlationId: `fixture-onboarding-${sequence}`,
    verified: true, source: "fixture" })
}
