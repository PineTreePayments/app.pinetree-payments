/**
 * PineTree business verification - the unified merchant onboarding flow.
 *
 * Merchants complete ONE PineTree onboarding. They never connect, enable, or
 * manage the underlying wallet/settlement infrastructure, and no merchant-
 * facing surface may name it or expose its identifiers.
 *
 * All provider identifiers and payloads here are fully fabricated.
 */

import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getMerchantBridgeConnection: vi.fn(),
  upsertMerchantBridgeConnection: vi.fn(),
  getLatestServiceTermsAcceptance: vi.fn(),
  recordServiceTermsAcceptance: vi.fn(),
  insertMerchantAuditEvent: vi.fn(),
  getMerchantBusinessProfile: vi.fn(),
  connectMerchant: vi.fn(),
  updateMerchant: vi.fn(),
  getHostedVerificationUrl: vi.fn(),
  syncAccount: vi.fn(),
  getKycLink: vi.fn(),
  requireMerchantAuth: vi.fn(),
}))

vi.mock("@/database/merchantBridgeConnections", async () => {
  const actual = await vi.importActual<typeof import("@/database/merchantBridgeConnections")>(
    "@/database/merchantBridgeConnections"
  )
  return {
    ...actual,
    getMerchantBridgeConnection: mocks.getMerchantBridgeConnection,
    upsertMerchantBridgeConnection: mocks.upsertMerchantBridgeConnection,
  }
})

vi.mock("@/database/merchantServiceTerms", async () => {
  const actual = await vi.importActual<typeof import("@/database/merchantServiceTerms")>(
    "@/database/merchantServiceTerms"
  )
  return {
    ...actual,
    getLatestServiceTermsAcceptance: mocks.getLatestServiceTermsAcceptance,
    recordServiceTermsAcceptance: mocks.recordServiceTermsAcceptance,
  }
})

vi.mock("@/database/merchantAuditEvents", () => ({
  insertMerchantAuditEvent: mocks.insertMerchantAuditEvent,
}))

vi.mock("@/engine/businessProfile", async () => {
  const fields = await vi.importActual<typeof import("@/engine/businessProfileFields")>(
    "@/engine/businessProfileFields"
  )
  return {
    getMerchantBusinessProfile: mocks.getMerchantBusinessProfile,
    BUSINESS_PROFILE_FIELD_LABELS: fields.BUSINESS_PROFILE_FIELD_LABELS,
  }
})

vi.mock("@/providers/bridge/adapter", () => ({
  bridgeAdapter: {
    connectMerchant: mocks.connectMerchant,
    updateMerchant: mocks.updateMerchant,
    getHostedVerificationUrl: mocks.getHostedVerificationUrl,
    syncAccount: mocks.syncAccount,
  },
}))

vi.mock("@/providers/bridge/client", async () => {
  const actual = await vi.importActual<typeof import("@/providers/bridge/client")>(
    "@/providers/bridge/client"
  )
  return { ...actual, getKycLink: mocks.getKycLink }
})

vi.mock("@/lib/api/merchantAuth", () => ({
  requireMerchantAuthFromRequest: mocks.requireMerchantAuth,
  requireMerchantIdFromRequest: async (...args: unknown[]) =>
    (await mocks.requireMerchantAuth(...args)).merchantId,
  getRouteErrorStatus: (error: unknown, fallback = 500) =>
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: number }).status) || fallback
      : fallback,
}))

import {
  BUSINESS_VERIFICATION_STATUS_LABELS,
  acceptServiceTermsEngine,
  canSubmitForVerification,
  continueBusinessVerificationEngine,
  getBusinessVerificationEngine,
} from "@/engine/businessVerification"
import { CURRENT_SERVICE_TERMS_VERSION } from "@/database/merchantServiceTerms"
import { GET as verificationRoute } from "@/app/api/onboarding/business-verification/route"
import { POST as consentRoute } from "@/app/api/onboarding/business-verification/consent/route"
import { POST as continueRoute } from "@/app/api/onboarding/business-verification/continue/route"
import { POST as refreshRoute } from "@/app/api/onboarding/business-verification/refresh/route"

const FAKE_CUSTOMER_ID = "cust_dddddddd-dddd-4ddd-8ddd-dddddddddddd"
const FAKE_KYC_LINK_ID = "kyc_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
const FAKE_KYC_URL = "https://bridge.test/kyc?session=fake-capability-token"

/**
 * A profile complete enough to build the whole KYB submission from - which is
 * the point: PineTree collects this once and never asks the merchant again.
 * Every value is fabricated.
 */
function completeProfile(overrides: Record<string, unknown> = {}) {
  return {
    legal_business_name: "Fake Test Business LLC",
    business_dba: "Fake Test",
    contact_email: "contact@fake-merchant.test",
    business_type: "retail",
    business_legal_structure: "llc",
    business_industry: "453998",
    business_description: "Sells fabricated goods for testing.",
    business_country: "US",
    business_state: "CA",
    business_city: "Testville",
    business_address_line1: "100 Fake Street",
    business_address_line2: null,
    business_postal_code: "90210",
    business_phone: "+15550000000",
    business_website: "https://fake-merchant.test",
    estimated_annual_revenue: "100000_999999",
    expected_monthly_payment_volume: "25000",
    account_purpose: "receive_payments_for_goods_and_services",
    source_of_funds: "sales_of_goods_and_services",
    high_risk_activities: "none_of_the_above",
    operates_in_prohibited_countries: "no",
    conducts_money_services: "no",
    owner_first_name: "Fake",
    owner_last_name: "Owner",
    owner_email: "owner@fake-merchant.test",
    owner_phone: "+15550000001",
    owner_title: "Managing Member",
    owner_birth_date: "1990-01-01",
    owner_ownership_percentage: "100",
    owner_address_line1: "200 Fake Avenue",
    owner_address_line2: null,
    owner_city: "Testville",
    owner_state: "CA",
    owner_postal_code: "90210",
    owner_country: "US",
    profile_status: "complete",
    missing_fields: [],
    ...overrides,
  }
}

function incompleteProfile(missing: string[] = ["business_phone", "owner_phone"]) {
  return {
    ...completeProfile(),
    business_phone: null,
    owner_phone: null,
    profile_status: "incomplete",
    missing_fields: missing,
  }
}

function acceptance(overrides: Record<string, unknown> = {}) {
  return {
    id: "consent_fake_1",
    merchantId: "merchant_alpha",
    termsVersion: CURRENT_SERVICE_TERMS_VERSION,
    disclosedProviders: ["bridge"],
    actorUserId: "user_alpha",
    acceptedAt: "2026-08-06T00:00:00.000Z",
    ...overrides,
  }
}

const APPROVED_CONNECTION = {
  customerId: FAKE_CUSTOMER_ID,
  kycLinkId: FAKE_KYC_LINK_ID,
  customerType: "business" as const,
  rawCustomerStatus: "active",
  rawKycStatus: "approved",
  rawTosStatus: "approved",
  kycStatus: "approved" as const,
  tosStatus: "approved" as const,
  customerStatus: "active" as const,
  endorsements: [
    {
      name: "base",
      status: "approved" as const,
      approved: true,
      missingRequirements: [],
      pendingRequirements: [],
      issues: [],
    },
  ],
  baseEndorsementApproved: true,
  requirementsDue: [],
  futureRequirementsDue: [],
  providerCreatedAt: "2026-08-01T00:00:00.000Z",
  providerUpdatedAt: "2026-08-02T00:00:00.000Z",
}

const SUBMITTED_CONNECTION = {
  ...APPROVED_CONNECTION,
  rawCustomerStatus: "under_review",
  rawKycStatus: "under_review",
  kycStatus: "under_review" as const,
  customerStatus: "under_review" as const,
  baseEndorsementApproved: false,
  endorsements: [
    {
      name: "base",
      status: "incomplete" as const,
      approved: false,
      missingRequirements: [],
      pendingRequirements: [],
      issues: [],
    },
  ],
}

const INCOMPLETE_CONNECTION = {
  ...SUBMITTED_CONNECTION,
  rawCustomerStatus: "incomplete",
  rawKycStatus: "incomplete",
  kycStatus: "incomplete" as const,
  customerStatus: "incomplete" as const,
  tosStatus: "pending" as const,
  requirementsDue: ["external_account"],
}

function connectionRow(credentials: Record<string, unknown>, enabled = false) {
  return {
    id: "row_fake_1",
    merchantId: "merchant_alpha",
    status: "connected",
    enabled,
    credentials,
    createdAt: null,
    updatedAt: null,
  }
}

function request(url: string, method: "GET" | "POST" = "POST", body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { Authorization: "Bearer dashboard-token", "content-type": "application/json" },
    // A GET may not carry a body.
    ...(body && method !== "GET" ? { body: JSON.stringify(body) } : {}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})

  process.env.BRIDGE_ENVIRONMENT = "sandbox"
  process.env.BRIDGE_API_KEY = "sk_test_bridgefake0000000000000000"
  process.env.BRIDGE_KYC_REDIRECT_URL = "https://app.pinetree.test/dashboard/wallet-setup"
  delete process.env.BRIDGE_CAPABILITY_ROLLOUT_ENABLED

  mocks.getMerchantBridgeConnection.mockResolvedValue(null)
  mocks.upsertMerchantBridgeConnection.mockResolvedValue(undefined)
  mocks.insertMerchantAuditEvent.mockResolvedValue(undefined)
  mocks.getMerchantBusinessProfile.mockResolvedValue(completeProfile())
  mocks.getLatestServiceTermsAcceptance.mockResolvedValue(acceptance())
  mocks.recordServiceTermsAcceptance.mockResolvedValue(acceptance())
  mocks.connectMerchant.mockResolvedValue({
    customerId: FAKE_CUSTOMER_ID,
    connection: INCOMPLETE_CONNECTION,
    correlationId: "corr_fake",
  })
  mocks.updateMerchant.mockResolvedValue({
    connection: INCOMPLETE_CONNECTION,
    correlationId: "corr_fake",
  })
  mocks.getHostedVerificationUrl.mockResolvedValue(FAKE_KYC_URL)
  mocks.syncAccount.mockResolvedValue({ connection: APPROVED_CONNECTION, correlationId: "corr_fake" })
  mocks.getKycLink.mockResolvedValue({ data: { kyc_link: FAKE_KYC_URL, tos_link: null } })
  mocks.requireMerchantAuth.mockResolvedValue({
    merchantId: "merchant_alpha",
    authUserId: "user_alpha",
    email: "owner@fake-merchant.test",
    verifiedEmail: "owner@fake-merchant.test",
    source: "supabase",
  })
})

describe("Merchant-facing vocabulary", () => {
  it("uses PineTree verification terminology only", () => {
    expect(Object.values(BUSINESS_VERIFICATION_STATUS_LABELS)).toEqual([
      "Not started",
      "In progress",
      "Under review",
      "Additional information required",
      "Verified",
      "Temporarily unavailable",
    ])
  })
})

describe("Business information is entered once", () => {
  it("submits verification from the existing PineTree business profile", async () => {
    await getBusinessVerificationEngine({ merchantId: "merchant_alpha" })

    // The canonical profile is the source; nothing re-asks the merchant.
    expect(mocks.connectMerchant).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: "merchant_alpha",
        payload: expect.objectContaining({
          type: "business",
          business_legal_name: "Fake Test Business LLC",
          email: "contact@fake-merchant.test",
          business_type: "llc",
          business_industry: ["453998"],
        }),
      })
    )

    // Owner details are submitted from the same profile, not re-collected.
    const submitted = mocks.connectMerchant.mock.calls[0][0] as {
      payload: { associated_persons?: { first_name?: string; email?: string }[] }
    }
    expect(submitted.payload.associated_persons?.[0]).toMatchObject({
      first_name: "Fake",
      email: "owner@fake-merchant.test",
    })
  })

  it("never sends a tax identifier PineTree was not given this request", async () => {
    await getBusinessVerificationEngine({ merchantId: "merchant_alpha" })

    const submitted = mocks.connectMerchant.mock.calls[0][0] as {
      payload: { identifying_information?: unknown[]; associated_persons?: { identifying_information?: unknown[] }[] }
    }
    // PineTree stores no tax identifiers, so a submission made without them
    // carries none rather than inventing or reusing one.
    expect(submitted.payload.identifying_information).toBeUndefined()
    expect(submitted.payload.associated_persons?.[0]?.identifying_information).toEqual([])
  })

  it("blocks submission and names the missing profile fields safely", async () => {
    mocks.getMerchantBusinessProfile.mockResolvedValue(incompleteProfile())

    const result = await getBusinessVerificationEngine({ merchantId: "merchant_alpha" })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.verification.status).toBe("in_progress")
      expect(result.verification.primaryAction.kind).toBe("complete_profile")
      // Human labels, never raw column names.
      expect(result.verification.missingProfileFields).toEqual(["Business Phone", "Owner Phone"])
    }
    expect(mocks.connectMerchant).not.toHaveBeenCalled()
  })

  it("reports Not started for a merchant who has entered nothing", async () => {
    mocks.getMerchantBusinessProfile.mockResolvedValue({
      legal_business_name: "",
      contact_email: "",
      owner_email: "",
      profile_status: "incomplete",
      missing_fields: ["legal_business_name"],
    })

    const result = await getBusinessVerificationEngine({ merchantId: "merchant_alpha" })
    expect(result.ok && result.verification.statusLabel).toBe("Not started")
  })
})

describe("Consent gates provider submission", () => {
  it("never creates a provider customer before terms are accepted", async () => {
    mocks.getLatestServiceTermsAcceptance.mockResolvedValue(null)

    const result = await getBusinessVerificationEngine({ merchantId: "merchant_alpha" })

    expect(mocks.connectMerchant).not.toHaveBeenCalled()
    expect(result.ok && result.verification.primaryAction.kind).toBe("review_and_consent")
    expect(result.ok && result.verification.termsAccepted).toBe(false)
  })

  it("treats a superseded terms version as no consent", async () => {
    mocks.getLatestServiceTermsAcceptance.mockResolvedValue(
      acceptance({ termsVersion: "2020-01-01.v0" })
    )

    await getBusinessVerificationEngine({ merchantId: "merchant_alpha" })
    expect(mocks.connectMerchant).not.toHaveBeenCalled()
  })

  it("treats an acceptance that did not disclose the provider as no consent", async () => {
    mocks.getLatestServiceTermsAcceptance.mockResolvedValue(acceptance({ disclosedProviders: [] }))

    await getBusinessVerificationEngine({ merchantId: "merchant_alpha" })
    expect(mocks.connectMerchant).not.toHaveBeenCalled()
  })

  it("records consent with version, actor, and disclosed providers, then submits", async () => {
    mocks.getLatestServiceTermsAcceptance.mockResolvedValue(null)

    const result = await acceptServiceTermsEngine({
      merchantId: "merchant_alpha",
      actorId: "user_alpha",
      termsVersion: CURRENT_SERVICE_TERMS_VERSION,
      sourceIp: "203.0.113.7",
      userAgent: "Mozilla/5.0 (fake)",
    })

    expect(mocks.recordServiceTermsAcceptance).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: "merchant_alpha",
        termsVersion: CURRENT_SERVICE_TERMS_VERSION,
        actorUserId: "user_alpha",
        sourceIp: "203.0.113.7",
      })
    )
    expect(mocks.insertMerchantAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "onboarding.service_terms_accepted" })
    )
    expect(result.ok).toBe(true)
  })

  it("refuses consent recorded against a stale terms version", async () => {
    const result = await acceptServiceTermsEngine({
      merchantId: "merchant_alpha",
      actorId: "user_alpha",
      termsVersion: "2020-01-01.v0",
    })

    expect(result.ok).toBe(false)
    expect(mocks.recordServiceTermsAcceptance).not.toHaveBeenCalled()
  })

  it("refuses consent before the business profile is complete", async () => {
    mocks.getMerchantBusinessProfile.mockResolvedValue(incompleteProfile())

    const result = await acceptServiceTermsEngine({
      merchantId: "merchant_alpha",
      actorId: "user_alpha",
      termsVersion: CURRENT_SERVICE_TERMS_VERSION,
    })

    expect(result.ok).toBe(false)
    expect(mocks.recordServiceTermsAcceptance).not.toHaveBeenCalled()
  })

  it("exposes the eligibility rule as a pure, testable predicate", () => {
    expect(
      canSubmitForVerification({
        profile: completeProfile() as never,
        acceptance: acceptance() as never,
        providerConfigured: true,
      })
    ).toBe(true)

    expect(
      canSubmitForVerification({
        profile: completeProfile() as never,
        acceptance: acceptance() as never,
        providerConfigured: false,
      })
    ).toBe(false)
  })
})

describe("Duplicate protection", () => {
  it("reuses an existing provider customer instead of creating a second", async () => {
    mocks.getMerchantBridgeConnection.mockResolvedValue(
      connectionRow({
        bridge_customer_id: FAKE_CUSTOMER_ID,
        bridge_kyc_link_id: FAKE_KYC_LINK_ID,
        onboarding_requested_at: "2026-08-01T00:00:00.000Z",
      })
    )

    await getBusinessVerificationEngine({ merchantId: "merchant_alpha" })
    expect(mocks.connectMerchant).not.toHaveBeenCalled()
  })

  it("does not create a second customer when submission times out", async () => {
    const { BridgeTransportError } = await import("@/providers/bridge/errors")
    mocks.connectMerchant.mockRejectedValue(
      new BridgeTransportError("Bridge request timed out.", {
        timedOut: true,
        outcomeUncertain: true,
      })
    )

    const result = await getBusinessVerificationEngine({ merchantId: "merchant_alpha" })

    // The merchant sees a neutral in-progress state, never a failure they
    // caused, and no second create is attempted in the same pass.
    expect(result.ok).toBe(true)
    expect(result.ok && result.verification.status).toBe("in_progress")
    expect(mocks.connectMerchant).toHaveBeenCalledTimes(1)
    expect(mocks.upsertMerchantBridgeConnection).not.toHaveBeenCalled()
  })

  it("submits at most once per read for a consented merchant", async () => {
    await getBusinessVerificationEngine({ merchantId: "merchant_alpha" })
    expect(mocks.connectMerchant).toHaveBeenCalledTimes(1)
  })
})

describe("Merchant-facing projections", () => {
  it("projects Under review without offering an action", async () => {
    mocks.getMerchantBridgeConnection.mockResolvedValue(
      connectionRow({
        bridge_customer_id: FAKE_CUSTOMER_ID,
        bridge_kyc_link_id: FAKE_KYC_LINK_ID,
        bridge_customer_status: "under_review",
        bridge_kyc_status: "under_review",
        bridge_tos_status: "approved",
      })
    )

    const result = await getBusinessVerificationEngine({ merchantId: "merchant_alpha" })

    expect(result.ok && result.verification.statusLabel).toBe("Under review")
    expect(result.ok && result.verification.primaryAction.kind).toBe("none")
  })

  it("projects Additional information required with one action", async () => {
    mocks.getMerchantBridgeConnection.mockResolvedValue(
      connectionRow({
        bridge_customer_id: FAKE_CUSTOMER_ID,
        bridge_kyc_link_id: FAKE_KYC_LINK_ID,
        bridge_customer_status: "incomplete",
        bridge_kyc_status: "incomplete",
        bridge_tos_status: "pending",
      })
    )

    const result = await getBusinessVerificationEngine({ merchantId: "merchant_alpha" })

    expect(result.ok && result.verification.statusLabel).toBe("Additional information required")
    expect(result.ok && result.verification.primaryAction.kind).toBe("continue_verification")
  })

  it("projects Verified and active capabilities after approval", async () => {
    mocks.getMerchantBridgeConnection.mockResolvedValue(
      connectionRow(
        {
          bridge_customer_id: FAKE_CUSTOMER_ID,
          bridge_kyc_link_id: FAKE_KYC_LINK_ID,
          bridge_customer_status: "active",
          bridge_kyc_status: "approved",
          bridge_tos_status: "approved",
          bridge_base_endorsement_approved: true,
          auto_activated_at: "2026-08-05T00:00:00.000Z",
        },
        true
      )
    )

    const result = await getBusinessVerificationEngine({ merchantId: "merchant_alpha" })

    expect(result.ok && result.verification.statusLabel).toBe("Verified")
    expect(result.ok && result.verification.walletCapabilitiesActive).toBe(true)
    expect(result.ok && result.verification.primaryAction.kind).toBe("none")
  })

  it("projects a neutral Temporarily unavailable when the provider is unconfigured", async () => {
    delete process.env.BRIDGE_API_KEY

    const result = await getBusinessVerificationEngine({ merchantId: "merchant_alpha" })

    expect(result.ok && result.verification.statusLabel).toBe("Temporarily unavailable")
    expect(result.ok && result.verification.primaryAction.kind).toBe("none")
    // Never a "Coming soon" provider offer.
    expect(JSON.stringify(result)).not.toContain("Coming soon")
    expect(mocks.connectMerchant).not.toHaveBeenCalled()
  })

  it("never leaks provider identifiers, names, or raw statuses to the merchant", async () => {
    mocks.getMerchantBridgeConnection.mockResolvedValue(
      connectionRow({
        bridge_customer_id: FAKE_CUSTOMER_ID,
        bridge_kyc_link_id: FAKE_KYC_LINK_ID,
        bridge_customer_status: "under_review",
        bridge_kyc_status: "under_review",
        bridge_tos_status: "approved",
      })
    )

    const result = await getBusinessVerificationEngine({ merchantId: "merchant_alpha" })
    const verification = result.ok ? result.verification : null
    const serialized = JSON.stringify(verification ?? {})

    // No provider identifier, name, or provider-specific vocabulary.
    expect(serialized).not.toContain(FAKE_CUSTOMER_ID)
    expect(serialized).not.toContain(FAKE_KYC_LINK_ID)
    expect(serialized.toLowerCase()).not.toContain("bridge")
    expect(serialized.toLowerCase()).not.toContain("kyc")
    expect(serialized.toLowerCase()).not.toContain("endorsement")

    // Every DISPLAYED string is PineTree copy. `status` is PineTree's own
    // machine-readable enum for the UI to switch on and is never rendered;
    // `statusLabel` is what a merchant actually reads.
    expect(verification?.statusLabel).toBe("Under review")
    for (const displayed of [verification?.headline, verification?.detail]) {
      expect(displayed).not.toMatch(/under_review|kyc|endorsement|bridge/i)
    }
  })
})

describe("Browser return is never approval", () => {
  it("re-reads the provider on refresh rather than trusting a return", async () => {
    mocks.getMerchantBridgeConnection.mockResolvedValue(
      connectionRow({
        bridge_customer_id: FAKE_CUSTOMER_ID,
        bridge_kyc_link_id: FAKE_KYC_LINK_ID,
        bridge_customer_status: "under_review",
        bridge_kyc_status: "under_review",
      })
    )

    await getBusinessVerificationEngine({ merchantId: "merchant_alpha", refresh: true })
    expect(mocks.syncAccount).toHaveBeenCalledTimes(1)
  })

  it("does not contact the provider on an ordinary page render", async () => {
    mocks.getMerchantBridgeConnection.mockResolvedValue(
      connectionRow({ bridge_customer_id: FAKE_CUSTOMER_ID, bridge_kyc_link_id: FAKE_KYC_LINK_ID })
    )

    await getBusinessVerificationEngine({ merchantId: "merchant_alpha" })
    expect(mocks.syncAccount).not.toHaveBeenCalled()
  })

  it("keeps the stored status when the provider lookup fails", async () => {
    mocks.getMerchantBridgeConnection.mockResolvedValue(
      connectionRow({
        bridge_customer_id: FAKE_CUSTOMER_ID,
        bridge_kyc_link_id: FAKE_KYC_LINK_ID,
        bridge_customer_status: "under_review",
        bridge_kyc_status: "under_review",
        bridge_tos_status: "approved",
      })
    )
    mocks.syncAccount.mockRejectedValue(new Error("provider unavailable"))

    const result = await getBusinessVerificationEngine({ merchantId: "merchant_alpha", refresh: true })

    // A provider outage must not regress or falsely advance the merchant.
    expect(result.ok && result.verification.statusLabel).toBe("Under review")
  })
})

describe("Hosted verification handoff", () => {
  it("returns a single-use hosted URL and never persists it", async () => {
    mocks.getMerchantBridgeConnection.mockResolvedValue(
      connectionRow({
        bridge_customer_id: FAKE_CUSTOMER_ID,
        bridge_kyc_link_id: FAKE_KYC_LINK_ID,
        bridge_customer_status: "incomplete",
        bridge_kyc_status: "incomplete",
      })
    )
    // The provider still wants something PineTree does not hold, which is the
    // only situation in which a hosted step is offered at all.
    mocks.syncAccount.mockResolvedValue({
      connection: INCOMPLETE_CONNECTION,
      correlationId: "corr_fake",
    })

    const result = await continueBusinessVerificationEngine({ merchantId: "merchant_alpha" })

    expect(result.ok && result.verificationUrl).toBe(FAKE_KYC_URL)

    for (const call of mocks.upsertMerchantBridgeConnection.mock.calls) {
      const [saved] = call as [{ credentials: Record<string, unknown> }]
      expect(JSON.stringify(saved.credentials)).not.toContain("fake-capability-token")
    }
  })

  it("offers no hosted step once the provider has approved the merchant", async () => {
    mocks.getMerchantBridgeConnection.mockResolvedValue(
      connectionRow({ bridge_customer_id: FAKE_CUSTOMER_ID })
    )

    const result = await continueBusinessVerificationEngine({ merchantId: "merchant_alpha" })

    expect(result.ok && result.verificationUrl).toBeNull()
    expect(mocks.getHostedVerificationUrl).not.toHaveBeenCalled()
  })

  it("refuses to continue before consent exists", async () => {
    mocks.getLatestServiceTermsAcceptance.mockResolvedValue(null)

    const result = await continueBusinessVerificationEngine({ merchantId: "merchant_alpha" })

    expect(result.ok).toBe(false)
    expect(mocks.connectMerchant).not.toHaveBeenCalled()
  })
})

describe("Business verification API routes", () => {
  const routes: [string, (req: NextRequest) => Promise<Response>, "GET" | "POST"][] = [
    ["", verificationRoute, "GET"],
    ["/consent", consentRoute, "POST"],
    ["/continue", continueRoute, "POST"],
    ["/refresh", refreshRoute, "POST"],
  ]

  it.each(routes)("rejects unauthenticated requests to %s", async (path, handler, method) => {
    mocks.requireMerchantAuth.mockRejectedValue(
      Object.assign(new Error("Missing bearer token"), { status: 401 })
    )

    const response = await handler(
      request(`https://app.test/api/onboarding/business-verification${path}`, method, {
        accepted: true,
        termsVersion: CURRENT_SERVICE_TERMS_VERSION,
      })
    )

    expect(response.status).toBe(401)
  })

  it.each(routes)("rejects merchant API keys on %s", async (path, handler, method) => {
    // No approved API-key scope exists for accepting legal terms or advancing
    // regulated verification on a business's behalf.
    mocks.requireMerchantAuth.mockResolvedValue({
      merchantId: "merchant_alpha",
      authUserId: "merchant_alpha",
      email: null,
      verifiedEmail: null,
      source: "api_key",
    })

    const response = await handler(
      request(`https://app.test/api/onboarding/business-verification${path}`, method, {
        accepted: true,
        termsVersion: CURRENT_SERVICE_TERMS_VERSION,
      })
    )

    expect(response.status).toBe(403)
    expect(mocks.recordServiceTermsAcceptance).not.toHaveBeenCalled()
    expect(mocks.connectMerchant).not.toHaveBeenCalled()
  })

  it("resolves the merchant from the session, never from the query string", async () => {
    await verificationRoute(
      request(
        "https://app.test/api/onboarding/business-verification?merchantId=merchant_victim",
        "GET"
      )
    )

    expect(mocks.getMerchantBusinessProfile).toHaveBeenCalledWith("merchant_alpha")
    expect(mocks.getMerchantBusinessProfile).not.toHaveBeenCalledWith("merchant_victim")
  })

  it("returns the terms disclosure the consent step must display", async () => {
    const response = await verificationRoute(
      request("https://app.test/api/onboarding/business-verification", "GET")
    )
    const body = await response.json()

    expect(body.ok).toBe(true)
    expect(body.data.terms.version).toBe(CURRENT_SERVICE_TERMS_VERSION)
    // Naming the partner IS correct here - this is the required disclosure.
    expect(body.data.terms.providers[0].name).toBe("Bridge")
    expect(body.data.terms.summary.join(" ")).toMatch(/approval is not guaranteed/i)
  })

  it("rejects a consent request that does not affirmatively accept", async () => {
    const response = await consentRoute(
      request("https://app.test/api/onboarding/business-verification/consent", "POST", {
        accepted: false,
        termsVersion: CURRENT_SERVICE_TERMS_VERSION,
      })
    )

    expect(response.status).toBe(400)
    expect(mocks.recordServiceTermsAcceptance).not.toHaveBeenCalled()
  })

  it("returns safe errors without provider payloads", async () => {
    mocks.getMerchantBusinessProfile.mockRejectedValue(
      new Error("Bridge said: customer cust_leak has tax_id 000-00-0000")
    )

    const response = await verificationRoute(
      request("https://app.test/api/onboarding/business-verification", "GET")
    )
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(JSON.stringify(body)).not.toContain("cust_leak")
    expect(JSON.stringify(body)).not.toContain("000-00-0000")
    expect(body.error.correlationId).toBeTruthy()
  })
})
