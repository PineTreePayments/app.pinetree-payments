import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { normalizeShift4OnboardingUpdate, sanitizeStructuredEmailUpdate, shift4OnboardingFixture, startShift4Application } from "@/providers/shift4/onboarding"
import { projectShift4OnboardingReadiness } from "@/engine/shift4/onboarding"
import { runShift4CertificationFixture, serializeShift4CertificationEvidence } from "@/engine/shift4/certificationService"
import { safeShift4LogFields } from "@/engine/shift4/observability"
import { buildShift4SupportDiagnostics } from "@/engine/shift4/diagnostics"
import { resolveShift4Readiness, type Shift4FeatureFlags } from "@/engine/shift4/readiness"

const source = (path: string) => readFileSync(path, "utf8")
const flags: Shift4FeatureFlags = Object.freeze({ restApi: true, ecommerce: true, retail: true, certificationMode: true,
  manualAuthorization: true, partialApproval: true, splitTender: true, applePay: false, googlePay: false,
  production: false, onboardingRequired: true, commerceEngineConfigured: true })
const connection = { connectionId: "connection-1", status: "connected", enabled: true, connected: true, environment: "test" as const,
  accessTokenPresent: true, accessTokenFingerprint: "safe-fingerprint", interfaceName: null, interfaceVersion: null, companyName: null,
  connectedAt: null, lastExchangeCorrelationId: null, lastExchangeServerName: null, channel: "shared" as const, cardProcessingVerified: true }

describe("Shift4 end-to-end completion contracts", () => {
  it("keeps real onboarding fail-closed and fixture onboarding deterministic", () => {
    expect(() => startShift4Application({ merchantId: "merchant-1", correlationId: "correlation-1" })).toThrow(/contract/i)
    expect(startShift4Application({ merchantId: "merchant-1", correlationId: "correlation-1", fixture: true })).toEqual(expect.objectContaining({ fixture: true, status: "application_started" }))
  })

  it("normalizes only safe onboarding status evidence", () => {
    const update = shift4OnboardingFixture({ providerApplicationId: "fixture-app-123456", status: "approved" })
    expect(normalizeShift4OnboardingUpdate(update).status).toBe("approved")
    expect(() => normalizeShift4OnboardingUpdate({ ...update, reasonCode: "tax id: 123" })).toThrow(/reasonCode/)
    expect(projectShift4OnboardingReadiness(null, true).blocksProduction).toBe(true)
  })

  it("sanitizes structured email metadata and forces manual review", () => {
    const result = sanitizeStructuredEmailUpdate({ messageId: "fixture-message", senderDomain: "untrusted.example", subject: "Application app-123456 approved", bodyText: "approved", attachmentMetadata: [{ name: "identity.pdf", contentType: "application/pdf", size: 20 }] })
    expect(result).toEqual(expect.objectContaining({ senderAllowed: false, attachmentCount: 1, requiresManualReview: true }))
    expect(JSON.stringify(result)).not.toContain("identity.pdf")
  })

  it("runs all certification cases through the service boundary and exports three formats", async () => {
    const report = await runShift4CertificationFixture({ channel: "all" })
    expect(report.cases).toHaveLength(49); expect(report.providerRequestsSent).toBe(0)
    expect(serializeShift4CertificationEvidence(report, "json")).toContain('"providerRequestsSent": 0')
    expect(serializeShift4CertificationEvidence(report, "csv")).toContain("caseId,status")
    expect(serializeShift4CertificationEvidence(report, "markdown")).toContain("Shift4 Fixture Evidence")
  })

  it("redacts dangerous nested and disguised logger input", () => {
    const dangerous = { merchantId: "merchant-1", safeStatusReason: "Bearer super-secret-value", payload: { cardToken: "opaque-token", pan: "4111111111111111", cvv: "123" }, authorizationCode: "ABC123", durationMs: 12 }
    const safe = safeShift4LogFields(dangerous)
    expect(safe).toEqual({ merchantId: "merchant-1", durationMs: 12 })
    expect(JSON.stringify(safe)).not.toMatch(/super-secret|411111|opaque-token|ABC123|123/)
  })

  it("explains every support blocker without returning secrets", async () => {
    const readiness = await resolveShift4Readiness("merchant-1", { flags, getConnection: async () => connection, listReaders: async () => [], getOnboarding: async () => null, i4goConfigured: true })
    const diagnostics = buildShift4SupportDiagnostics({ readiness, onboardingStatus: "under_review", attemptState: "unknown", recoveryState: "lookup_pending", remainingAmountMinor: 50, tokenizationStatus: "consumed" })
    expect(diagnostics).toEqual(expect.objectContaining({ merchantApproved: false, awaitingRecovery: true, additionalTenderRequired: true, tokenizationStatus: "consumed" }))
  })

  it("keeps browser code outside Engine/provider layers and generic checkout behind readiness", () => {
    for (const file of ["components/payment/Shift4HostedCheckoutPanel.tsx", "components/payment/Shift4RetailTerminalPanel.tsx"]) {
      expect(source(file)).not.toMatch(/from ["']@\/engine|from ["']@\/providers|supabaseAdmin|SERVICE_ROLE/)
    }
    expect(source("engine/paymentIntents.ts")).toContain("resolveShift4Readiness")
    expect(source("engine/paymentIntents.ts")).toContain("capabilities.hosted_checkout.ready")
  })

  it("defines strict onboarding SQL and an offline release package", () => {
    const migration = source("database/migrations/20260801161000_create_shift4_onboarding_sessions.sql")
    expect((migration.match(/^begin;$/gm) || [])).toHaveLength(1); expect((migration.match(/^commit;$/gm) || [])).toHaveLength(1)
    expect(migration).toContain("enable row level security"); expect(migration).toContain("force row level security")
    expect(migration).toContain("on delete restrict"); expect(migration).not.toMatch(/create\s+or\s+replace|grant\s+all/i)
    expect(source("scripts/shift4-database/release.mjs")).toContain("contactedDatabase: false")
  })
})
