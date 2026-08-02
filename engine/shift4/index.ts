/**
 * PineTree Engine - Shift4 service surface.
 *
 * Backend-only. Internal/authenticated routes and default-disabled UI adapters
 * call this surface; browser components never import it directly.
 *
 * Attempts are stored in `public.shift4_payment_attempts`. Nothing in this
 * surface reads or writes `payments.metadata`.
 */

export {
  executeShift4Transaction,
  Shift4ExecutionError,
} from "./executeTransaction"

export {
  readShift4FeatureFlags,
  resolveShift4Readiness,
  assertShift4Capability,
  capabilityForOperation,
  Shift4ReadinessError,
  type Shift4Capability,
  type Shift4CapabilityState,
  type Shift4FeatureFlags,
  type Shift4Readiness,
} from "./readiness"

export {
  recoverUnknownOutcome,
  recoverClaimedAttempt,
  evaluateResendPolicy,
  MAX_LOOKUP_PASSES,
  MAX_RESENDS,
  type Shift4RecoveryOutcome,
  type Shift4ResendPolicyDecision,
} from "./recoverUnknownOutcome"

export {
  reconcileShift4Payments,
  type Shift4ReconciliationScope,
  type Shift4ReconciliationSummary,
} from "./reconcileShift4Payments"

export { mapShift4Evidence } from "./mapShift4Evidence"
export { startShift4Onboarding, applyShift4OnboardingUpdate, projectShift4OnboardingReadiness } from "./onboarding"
export { runShift4CertificationFixture, normalizeShift4CertificationEvidence, serializeShift4CertificationEvidence, SHIFT4_CERTIFICATION_WORKFLOWS, SHIFT4_CHECKOUT_FIXTURE_STATES, SHIFT4_RETAIL_FIXTURE_STATES, type Shift4CertificationFixtureEvidence } from "./certificationService"
export { buildShift4SupportDiagnostics, type Shift4SupportDiagnostics } from "./diagnostics"

export {
  deriveAttemptId,
  buildRequestFingerprint,
  fingerprintCardToken,
  projectEvidence,
  eventNameForState,
  type Shift4EventName,
} from "./attempt"

export type {
  Shift4Attempt,
  Shift4AttemptState,
  Shift4Channel,
  Shift4EngineOperation,
  Shift4EvidenceInput,
  Shift4EvidenceMapping,
  Shift4ExecuteRequest,
  Shift4ExecuteResult,
  Shift4RetryClassification,
} from "./types"
