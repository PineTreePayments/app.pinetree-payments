import type { Shift4OnboardingLaunch, Shift4OnboardingStatus, Shift4OnboardingUpdate } from "@/providers/shift4/onboarding"
import type { Shift4OnboardingSessionRow } from "@/database/shift4OnboardingSessions"

export type StartShift4OnboardingInput = Readonly<{ merchantId: string; merchantProviderConnectionId: string; correlationId: string; fixture?: boolean }>
export type StartShift4OnboardingResult = Readonly<{ launch: Shift4OnboardingLaunch; session: Shift4OnboardingSessionRow }>
export type ApplyShift4OnboardingInput = Readonly<{ merchantId: string; update: Shift4OnboardingUpdate; fixtureAuthorized?: boolean }>
export type Shift4OnboardingReadiness = Readonly<{ status: Shift4OnboardingStatus; approved: boolean; blocksProduction: boolean; reason: string }>
