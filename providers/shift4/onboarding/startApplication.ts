import { createHash, randomUUID } from "node:crypto"
import { getShift4OnboardingConfig } from "./config"
import type { Shift4OnboardingLaunch } from "./types"

export function startShift4Application(input: { merchantId: string; correlationId: string; fixture?: boolean }): Shift4OnboardingLaunch {
  if (input.fixture) {
    const suffix = createHash("sha256").update(`${input.merchantId}|${input.correlationId}`).digest("hex").slice(0, 16)
    return Object.freeze({ providerApplicationId: `fixture-app-${suffix}`, launchReference: `fixture-launch-${suffix}`, hostedApplicationUrl: null, status: "application_started", fixture: true })
  }
  const config = getShift4OnboardingConfig()
  if (!config.configured) throw Object.assign(new Error(config.reason || "Shift4 onboarding is not configured"), { status: 503, code: "onboarding_contract_unavailable" })
  // Exact provider session creation is intentionally blocked until Shift4 supplies it.
  throw Object.assign(new Error("Shift4 onboarding session creation contract requires provider documentation"), { status: 503, code: "onboarding_contract_unavailable", correlationId: input.correlationId || randomUUID() })
}
