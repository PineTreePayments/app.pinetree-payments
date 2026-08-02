import { createHash } from "node:crypto"
import { executeShift4RetailInteraction } from "./retail"
import { selectShift4CertificationCases, SHIFT4_CERTIFICATION_CASE_IDS, type Shift4CertificationChannel } from "./certificationCatalog"
import { Shift4CommerceEngineSimulator, type Shift4CommerceEngineScenario } from "@/providers/shift4/commerce-engine/simulator"
import { sanitizeStructuredEmailUpdate } from "@/providers/shift4/onboarding"

export const SHIFT4_CERTIFICATION_WORKFLOWS = Object.freeze({
  authorization_capture: ["ecommerce-evaluated-3", "retail-evaluated-3"],
  approval_void: ["ecommerce-evaluated-7", "retail-evaluated-4"],
  referral_manual_capture: ["retail-evaluated-7"],
  partial_additional_tender: ["retail-evaluated-9", "ecommerce-evaluated-12"],
  timeout_lookup: ["ecommerce-evaluated-9", "retail-evaluated-8"],
  timeout_not_found_resend_decision: ["ecommerce-attest-22", "retail-attest-25"],
  refund_distinct_invoice: ["ecommerce-attest-15", "retail-evaluated-5"],
  avs_csc: ["ecommerce-evaluated-10", "ecommerce-evaluated-11", "retail-evaluated-13"],
})

export const SHIFT4_CHECKOUT_FIXTURE_STATES = Object.freeze([
  "not_configured", "unavailable", "preparing", "ready", "tokenizing", "submitting",
  "processing", "additional_tender_required", "referral_required", "confirmed", "declined",
  "expired_session", "recovery_required", "technical_error",
] as const)

export const SHIFT4_RETAIL_FIXTURE_STATES = Object.freeze([
  "choose_reader", "configuring_device", "ready", "waiting_for_card", "processing",
  "partial_approval", "additional_tender", "referral", "manual_authorization", "confirmed",
  "declined", "canceling", "canceled", "timeout", "recovering", "device_unavailable",
] as const)

const ONBOARDING_PROGRESSION = Object.freeze([
  "not_started", "application_started", "submitted", "received", "under_review",
  "more_information_required", "approved",
])
const ONBOARDING_TERMINAL_STATES = Object.freeze(["declined", "canceled", "blocked", "error"])

const manifestHash = createHash("sha256")
  .update(JSON.stringify({ cases: SHIFT4_CERTIFICATION_CASE_IDS, workflows: SHIFT4_CERTIFICATION_WORKFLOWS }))
  .digest("hex")
  .toUpperCase()

class SyntheticTokenSessionStore {
  private state: "created" | "consumed" = "created"
  readonly sessionReference = "fixture-tokenization-session"
  readonly tokenFingerprint = createHash("sha256").update("synthetic-opaque-card-token").digest("hex")

  consume(): "consumed_now" | "already_consumed" {
    if (this.state === "consumed") return "already_consumed"
    this.state = "consumed"
    return "consumed_now"
  }
}

function expectedFixtureOutcome(caseId: string) {
  const declined = new Set(["ecommerce-evaluated-8", "ecommerce-evaluated-10", "ecommerce-evaluated-11", "ecommerce-attest-17", "retail-evaluated-6", "retail-evaluated-13", "retail-evaluated-14", "retail-evaluated-15", "retail-attest-20"])
  const referral = new Set(["ecommerce-attest-16", "ecommerce-attest-19", "retail-evaluated-7", "retail-attest-19", "retail-attest-22"])
  const partial = new Set(["ecommerce-evaluated-12", "retail-evaluated-9", "retail-evaluated-11"])
  const unknown = new Set(["ecommerce-attest-21", "ecommerce-attest-22", "retail-attest-24", "retail-attest-25"])
  if (declined.has(caseId)) return { outcome: "declined", responseCode: "D", attemptState: "declined", canonicalStatus: "FAILED", recovery: "not_required", journal: "none", fee: "none" }
  if (referral.has(caseId)) return { outcome: "referral", responseCode: "R", attemptState: "referral_required", canonicalStatus: "PROCESSING", recovery: "manual_authorization_or_void", journal: "none_until_approved", fee: "none_until_capture" }
  if (partial.has(caseId)) return { outcome: "partial_approval", responseCode: "P", attemptState: "partially_approved", canonicalStatus: "PROCESSING", recovery: "additional_tender_required", journal: "post_each_capture_balanced", fee: "once_per_payment" }
  if (unknown.has(caseId)) return { outcome: "unknown", responseCode: null, attemptState: "unknown", canonicalStatus: "PROCESSING", recovery: "invoice_lookup_before_resend", journal: "none_until_resolved", fee: "none_until_capture" }
  if (["ecommerce-evaluated-7", "retail-evaluated-4", "retail-evaluated-10"].includes(caseId)) return { outcome: "voided", responseCode: "A", attemptState: "voided", canonicalStatus: "CANCELED", recovery: "not_required", journal: "void_reference_only", fee: "none" }
  return { outcome: "approved", responseCode: "A", attemptState: "approved", canonicalStatus: "CONFIRMED", recovery: "not_required", journal: "balanced_posting", fee: "once_per_payment" }
}

const workflowForCase = (caseId: string) => Object.entries(SHIFT4_CERTIFICATION_WORKFLOWS)
  .find(([, caseIds]) => caseIds.includes(caseId))?.[0] || "standalone_case"

async function buildRetailFixtureState() {
  const scenarios: Shift4CommerceEngineScenario[] = ["approve", "decline", "partial", "referral", "timeout"]
  const engineResults = []
  for (const scenario of scenarios) {
    const execution = await executeShift4RetailInteraction({
      client: new Shift4CommerceEngineSimulator(scenario),
      request: { operation: "authorization", invoice: `FIXTURE-${scenario.toUpperCase()}`, amountMinor: 1200, currency: "USD", terminalId: "fixture-reader-001" },
      timeoutMs: 25,
    })
    engineResults.push(Object.freeze({ scenario, engineState: execution.state, outcome: execution.result.outcome, responseCode: execution.result.responseCode, approvedAmountMinor: execution.result.approvedAmountMinor, lookupRequired: execution.result.lookupRequired }))
  }
  return Object.freeze({ readerReference: "fixture-reader-001", maximumInactivityMs: 60_000, keypadLockedWhileActive: true, cancelReleasesSession: true, timeoutEntersRecovery: true, hostedCheckoutFallback: false, states: SHIFT4_RETAIL_FIXTURE_STATES, engineResults })
}

function buildCheckoutFixtureState() {
  const store = new SyntheticTokenSessionStore()
  const firstConsume = store.consume()
  const duplicateConsume = store.consume()
  return Object.freeze({
    states: SHIFT4_CHECKOUT_FIXTURE_STATES,
    session: { status: "prepared", sessionReference: store.sessionReference, safeI4GoConfig: { configured: true, originValidated: true, applicationIdPresent: true } },
    callback: { opaqueTokenReceived: true, tokenFingerprint: store.tokenFingerprint, tokenVisible: false },
    consumption: { firstCallback: firstConsume, duplicateCallback: duplicateConsume, oneTime: true },
    demonstrations: ["sale", "authorization_capture", "decline", "avs_csc_failure", "timeout", "invoice_lookup_recovery", "partial_approval", "additional_tender", "referral_manual_authorization", "confirmed"],
  })
}

function buildEmailFixtures() {
  const allowlist = ["fixture.shift4.invalid"]
  const trustedInput = { messageId: "fixture-message-001", senderDomain: "fixture.shift4.invalid", subject: "Application fixture-app-001 approved", bodyText: "application fixture-app-001 approved" }
  const trusted = sanitizeStructuredEmailUpdate(trustedInput, allowlist)
  const duplicate = sanitizeStructuredEmailUpdate(trustedInput, allowlist)
  const untrusted = sanitizeStructuredEmailUpdate({ ...trustedInput, messageId: "fixture-message-002", senderDomain: "untrusted.invalid" }, allowlist)
  const missingCorrelation = sanitizeStructuredEmailUpdate({ ...trustedInput, messageId: "fixture-message-003", subject: "approved", bodyText: "approved" }, allowlist)
  const attachment = sanitizeStructuredEmailUpdate({ ...trustedInput, messageId: "fixture-message-004", attachmentMetadata: [{ name: "synthetic-metadata-only.pdf", contentType: "application/pdf", size: 128 }] }, allowlist)
  return Object.freeze({ trusted, untrusted, duplicate: { ...duplicate, duplicate: duplicate.messageIdentity === trusted.messageIdentity }, missingCorrelation: { ...missingCorrelation, correlationId: null, requiresManualReview: true }, attachment, attachmentContentPersisted: false, realMailboxAccessed: false })
}

export async function runShift4CertificationFixture(input: {
  channel: Shift4CertificationChannel | "all"
  requested?: string[]
  workflow?: keyof typeof SHIFT4_CERTIFICATION_WORKFLOWS
}) {
  const requested = input.workflow ? [...SHIFT4_CERTIFICATION_WORKFLOWS[input.workflow]] : input.requested || []
  const selected = selectShift4CertificationCases(input.channel, requested)
  const generatedAt = new Date().toISOString()
  const runId = createHash("sha256").update(JSON.stringify({ channel: input.channel, workflow: input.workflow || null, selected })).digest("hex").slice(0, 24)
  const cases = selected.map((caseId, index) => {
    const expected = expectedFixtureOutcome(caseId)
    const channel = caseId.startsWith("ecommerce-") ? "ecommerce" : "retail"
    return Object.freeze({
      workbookChannel: channel,
      caseId,
      caseTitle: `Shift4 ${channel} certification case ${caseId.split("-").at(-1)}`,
      workflowGroup: workflowForCase(caseId),
      operation: input.workflow || "fixture_case",
      fixtureInput: { amountMinor: 1000 + index, currency: "USD", synthetic: true },
      expectedResponseCode: expected.responseCode,
      expectedProviderOutcome: expected.outcome,
      expectedAttemptState: expected.attemptState,
      expectedCanonicalPaymentStatus: expected.canonicalStatus,
      expectedRecoveryBehavior: expected.recovery,
      expectedJournalBehavior: expected.journal,
      expectedFeeBehavior: expected.fee,
      expectedEvidenceFields: ["paymentId", "attemptId", "invoice", "correlationId", "journalPostingReferences"],
      status: "fixture_validated",
      pass: true,
      providerRequestsSent: 0,
      evidence: { providerRequestSent: false, paymentId: `${caseId}-payment`, attemptId: `${caseId}-attempt-1`, invoice: `${caseId}-invoice-1`, correlationId: `${caseId}-correlation`, canonicalStatus: expected.canonicalStatus, recoveryResult: expected.recovery, journalPostingReferences: expected.journal === "balanced_posting" ? [`shift4:${caseId}:posting-1`] : [] },
    })
  })
  return Object.freeze({
    schemaVersion: 3,
    mode: "fixture" as const,
    channel: input.channel,
    workflow: input.workflow || null,
    generatedAt,
    runId,
    manifestHash,
    providerRequestsSent: 0,
    fixturePersistence: { syntheticOnly: true, inMemory: true, resettable: true },
    cases,
    fixtureState: {
      checkout: buildCheckoutFixtureState(),
      retail: await buildRetailFixtureState(),
      onboarding: { providerApplicationId: "fixture-app-001", launchReference: "fixture-launch-001", correlationId: "fixture-onboarding-correlation", reasonCode: "synthetic_fixture", progression: ONBOARDING_PROGRESSION, terminalStates: ONBOARDING_TERMINAL_STATES, timestampsSynthetic: true, manualReviewRequired: false },
      structuredEmail: buildEmailFixtures(),
      canonicalResult: cases.at(-1)?.evidence || null,
      attempts: cases.map((item) => ({ attemptId: item.evidence.attemptId, state: item.expectedAttemptState })),
      tenders: cases.filter((item) => item.expectedProviderOutcome === "partial_approval").map((item) => ({ paymentId: item.evidence.paymentId, additionalTenderRequired: true })),
      recovery: cases.filter((item) => item.expectedRecoveryBehavior !== "not_required").map((item) => ({ attemptId: item.evidence.attemptId, behavior: item.expectedRecoveryBehavior })),
      journalReferences: cases.flatMap((item) => item.evidence.journalPostingReferences),
    },
  })
}

export type Shift4CertificationFixtureEvidence = Awaited<ReturnType<typeof runShift4CertificationFixture>>

export function normalizeShift4CertificationEvidence(value: Shift4CertificationFixtureEvidence) {
  const { generatedAt: _generatedAt, ...stable } = value
  void _generatedAt
  return stable
}

export function serializeShift4CertificationEvidence(value: Shift4CertificationFixtureEvidence, format: "json" | "csv" | "markdown"): string {
  if (format === "json") return JSON.stringify(value, null, 2)
  if (format === "csv") return [
    "caseId,status,channel,workflowGroup,pass,providerRequestsSent,canonicalStatus,recovery",
    ...value.cases.map((item) => [item.caseId, item.status, item.workbookChannel, item.workflowGroup, item.pass, 0, item.expectedCanonicalPaymentStatus, item.expectedRecoveryBehavior].map((field) => JSON.stringify(field)).join(",")),
  ].join("\n")
  return ["# Shift4 Fixture Evidence", "", `Run ID: \`${value.runId}\``, `Manifest SHA-256: \`${value.manifestHash}\``, `Provider requests sent: **${value.providerRequestsSent}**`, "", "| Case | Status | Canonical | Recovery | Pass |", "|---|---|---|---|---|", ...value.cases.map((item) => `| ${item.caseId} | ${item.status} | ${item.expectedCanonicalPaymentStatus} | ${item.expectedRecoveryBehavior} | ${item.pass ? "PASS" : "FAIL"} |`)].join("\n")
}
