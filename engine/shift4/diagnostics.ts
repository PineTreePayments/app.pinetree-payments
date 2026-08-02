import type { Shift4Readiness } from "./readiness"

export type Shift4SupportDiagnostics = Readonly<{
  railDisabledReason: string | null; checkoutBlockedReason: string | null; posBlockedReason: string | null;
  merchantApproved: boolean; certificationComplete: boolean; awaitingRecovery: boolean;
  journalPostingExists: boolean; additionalTenderRequired: boolean; tokenizationStatus: "created" | "consumed" | "expired" | "not_found" | null;
  capabilityExplanations: Readonly<Record<"rest" | "hostedCheckout" | "retail" | "manualAuthorization" | "partialApproval" | "splitTender" | "production", Readonly<{ state: "blocked" | "disabled" | "configuration_required" | "certification_required" | "onboarding_required" | "device_required" | "enabled"; reason: string }>>>
}>

export function buildShift4SupportDiagnostics(input: {
  readiness: Shift4Readiness; onboardingStatus?: string | null; attemptState?: string | null; recoveryState?: string | null;
  journalPostingExists?: boolean; remainingAmountMinor?: number | null; tokenizationStatus?: Shift4SupportDiagnostics["tokenizationStatus"]
}): Shift4SupportDiagnostics {
  const blocked = (capability: keyof Shift4Readiness["capabilities"]) => input.readiness.capabilities[capability].ready ? null : input.readiness.capabilities[capability].reason
  const explain = (capability: keyof Shift4Readiness["capabilities"]): { state: "blocked" | "disabled" | "configuration_required" | "certification_required" | "onboarding_required" | "device_required" | "enabled"; reason: string } => {
    const value = input.readiness.capabilities[capability]
    const reason = value.reason
    if (value.ready) return { state: "enabled", reason }
    if (value.state === "disabled") return { state: "disabled", reason }
    if (/certification/i.test(reason)) return { state: "certification_required", reason }
    if (/onboarding|approval/i.test(reason)) return { state: "onboarding_required", reason }
    if (/terminal|reader|device/i.test(reason)) return { state: "device_required", reason }
    if (value.state === "not_configured" || value.state === "configured" || /configur/i.test(reason)) return { state: "configuration_required", reason }
    return { state: "blocked", reason }
  }
  return Object.freeze({ railDisabledReason: blocked("production_processing"), checkoutBlockedReason: blocked("hosted_checkout"), posBlockedReason: blocked("retail"),
    merchantApproved: input.onboardingStatus === "approved" || !input.readiness.flags.onboardingRequired,
    certificationComplete: input.readiness.capabilities.certification.ready,
    awaitingRecovery: input.attemptState === "unknown" || ["lookup_pending", "manual_review", "reconciliation_required"].includes(String(input.recoveryState || "")),
    journalPostingExists: input.journalPostingExists === true, additionalTenderRequired: Number(input.remainingAmountMinor || 0) > 0,
    tokenizationStatus: input.tokenizationStatus ?? null,
    capabilityExplanations: Object.freeze({ rest: explain("rest_api"), hostedCheckout: explain("hosted_checkout"), retail: explain("retail"), manualAuthorization: explain("manual_authorization"), partialApproval: explain("partial_approval"), splitTender: explain("split_tender"), production: explain("production_processing") }) })
}
