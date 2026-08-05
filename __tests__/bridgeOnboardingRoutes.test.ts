/**
 * Bridge (by Stripe) - Engine onboarding/enablement behavior and API route
 * authorization.
 *
 * All Bridge identifiers and payloads are fully fabricated.
 */

import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getMerchantBridgeConnection: vi.fn(),
  upsertMerchantBridgeConnection: vi.fn(),
  findMerchantByBridgeIdentifiers: vi.fn(),
  claimBridgeWebhookEvent: vi.fn(),
  markBridgeWebhookEventProcessed: vi.fn(),
  insertMerchantAuditEvent: vi.fn(),
  getMerchantBusinessProfile: vi.fn(),
  connectMerchant: vi.fn(),
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
    findMerchantByBridgeIdentifiers: mocks.findMerchantByBridgeIdentifiers,
    claimBridgeWebhookEvent: mocks.claimBridgeWebhookEvent,
    markBridgeWebhookEventProcessed: mocks.markBridgeWebhookEventProcessed,
  }
})

vi.mock("@/database/merchantAuditEvents", () => ({
  insertMerchantAuditEvent: mocks.insertMerchantAuditEvent,
}))

vi.mock("@/engine/businessProfile", () => ({
  getMerchantBusinessProfile: mocks.getMerchantBusinessProfile,
}))

vi.mock("@/providers/bridge/adapter", () => ({
  bridgeAdapter: {
    connectMerchant: mocks.connectMerchant,
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
  getBridgeConnectionEngine,
  setBridgeEnabledEngine,
  startBridgeOnboardingEngine,
  syncBridgeConnectionEngine,
} from "@/engine/bridgeConnect"
import { POST as startOnboardingRoute } from "@/app/api/providers/bridge/onboarding/start/route"
import { GET as statusRoute } from "@/app/api/providers/bridge/status/route"
import { POST as syncRoute } from "@/app/api/providers/bridge/sync/route"
import { POST as enableRoute } from "@/app/api/providers/bridge/enable/route"
import { POST as disableRoute } from "@/app/api/providers/bridge/disable/route"

const FAKE_CUSTOMER_ID = "cust_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const FAKE_KYC_LINK_ID = "kyc_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const FAKE_KYC_URL = "https://bridge.test/kyc?session=fake-capability-token"

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

const INCOMPLETE_CONNECTION = {
  ...APPROVED_CONNECTION,
  rawCustomerStatus: "incomplete",
  rawKycStatus: "incomplete",
  kycStatus: "incomplete" as const,
  customerStatus: "incomplete" as const,
  tosStatus: "pending" as const,
  endorsements: [
    {
      name: "base",
      status: "incomplete" as const,
      approved: false,
      missingRequirements: ["proof_of_address"],
      pendingRequirements: [],
      issues: [],
    },
  ],
  baseEndorsementApproved: false,
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

function bridgeRequest(url: string, method: "GET" | "POST" = "POST") {
  return new NextRequest(url, { method, headers: { Authorization: "Bearer dashboard-token" } })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})

  process.env.BRIDGE_ENVIRONMENT = "sandbox"
  process.env.BRIDGE_API_KEY = "sk_test_bridgefake0000000000000000"
  process.env.BRIDGE_KYC_REDIRECT_URL = "https://app.pinetree.test/dashboard/providers"

  mocks.getMerchantBridgeConnection.mockResolvedValue(null)
  mocks.upsertMerchantBridgeConnection.mockResolvedValue(undefined)
  mocks.insertMerchantAuditEvent.mockResolvedValue(undefined)
  mocks.getMerchantBusinessProfile.mockResolvedValue({
    legal_business_name: "Fake Test Business LLC",
    owner_email: "owner@fake-merchant.test",
    contact_email: "contact@fake-merchant.test",
  })
  mocks.connectMerchant.mockResolvedValue({
    kycLinkId: FAKE_KYC_LINK_ID,
    customerId: FAKE_CUSTOMER_ID,
    kycUrl: FAKE_KYC_URL,
    tosUrl: "https://bridge.test/tos?session=fake-capability-token",
    connection: INCOMPLETE_CONNECTION,
    correlationId: "corr_fake",
  })
  mocks.syncAccount.mockResolvedValue({
    connection: APPROVED_CONNECTION,
    correlationId: "corr_fake",
  })
  mocks.getKycLink.mockResolvedValue({ data: { kyc_link: FAKE_KYC_URL, tos_link: null } })
  mocks.requireMerchantAuth.mockResolvedValue({
    merchantId: "merchant_alpha",
    authUserId: "user_alpha",
    email: "owner@fake-merchant.test",
    verifiedEmail: "owner@fake-merchant.test",
    source: "supabase",
  })
})

describe("Bridge onboarding deduplication", () => {
  it("creates a Bridge customer only when the merchant has selected Bridge", async () => {
    const result = await startBridgeOnboardingEngine({ merchantId: "merchant_alpha" })

    expect(result.ok).toBe(true)
    expect(mocks.connectMerchant).toHaveBeenCalledTimes(1)
    expect(mocks.connectMerchant).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: "merchant_alpha",
        legalBusinessName: "Fake Test Business LLC",
        ownerEmail: "owner@fake-merchant.test",
      })
    )
  })

  it("reuses an existing Bridge customer instead of creating a second one", async () => {
    mocks.getMerchantBridgeConnection.mockResolvedValue(
      connectionRow({
        bridge_customer_id: FAKE_CUSTOMER_ID,
        bridge_kyc_link_id: FAKE_KYC_LINK_ID,
        onboarding_requested_at: "2026-08-01T00:00:00.000Z",
      })
    )

    const result = await startBridgeOnboardingEngine({ merchantId: "merchant_alpha" })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.reused).toBe(true)
    // Restarting onboarding must never create a second Bridge customer.
    expect(mocks.connectMerchant).not.toHaveBeenCalled()
    expect(mocks.syncAccount).toHaveBeenCalledTimes(1)
  })

  it("resumes from a KYC link alone, before any customer exists", async () => {
    mocks.getMerchantBridgeConnection.mockResolvedValue(
      connectionRow({ bridge_kyc_link_id: FAKE_KYC_LINK_ID })
    )

    const result = await startBridgeOnboardingEngine({ merchantId: "merchant_alpha" })

    expect(result.ok).toBe(true)
    expect(mocks.connectMerchant).not.toHaveBeenCalled()
  })

  it("never persists the hosted onboarding URLs", async () => {
    await startBridgeOnboardingEngine({ merchantId: "merchant_alpha" })

    const [saved] = mocks.upsertMerchantBridgeConnection.mock.calls[0] as [
      { credentials: Record<string, unknown> }
    ]
    const serialized = JSON.stringify(saved.credentials)

    // No hosted URL value, and no URL-bearing key, is ever written. The
    // `bridge_kyc_link_id` IDENTIFIER is expected and is asserted below.
    expect(serialized).not.toContain("fake-capability-token")
    expect(serialized).not.toContain("https://bridge.test")
    expect(serialized).not.toContain('"kyc_link"')
    expect(serialized).not.toContain('"tos_link"')
    expect(saved.credentials).not.toHaveProperty("kyc_link")
    expect(saved.credentials).not.toHaveProperty("tos_link")
    // Identifiers and normalized status ARE persisted.
    expect(saved.credentials.bridge_kyc_link_id).toBe(FAKE_KYC_LINK_ID)
    expect(saved.credentials.bridge_customer_id).toBe(FAKE_CUSTOMER_ID)
  })

  it("blocks onboarding when the legal business name or owner email is missing", async () => {
    mocks.getMerchantBusinessProfile.mockResolvedValue({
      legal_business_name: "",
      owner_email: "",
      contact_email: "",
    })

    const result = await startBridgeOnboardingEngine({ merchantId: "merchant_alpha" })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/legal business name/i)
    expect(mocks.connectMerchant).not.toHaveBeenCalled()
  })

  it("reports Coming soon rather than an error when Bridge is unconfigured", async () => {
    delete process.env.BRIDGE_API_KEY

    const result = await startBridgeOnboardingEngine({ merchantId: "merchant_alpha" })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("Bridge is not available yet.")
    expect(mocks.connectMerchant).not.toHaveBeenCalled()
  })

  it("treats a provider timeout as retryable and never as a lost onboarding", async () => {
    const { BridgeTransportError } = await import("@/providers/bridge/errors")
    mocks.connectMerchant.mockRejectedValue(
      new BridgeTransportError("Bridge request timed out.", {
        timedOut: true,
        outcomeUncertain: true,
      })
    )

    const result = await startBridgeOnboardingEngine({ merchantId: "merchant_alpha" })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.retryable).toBe(true)
      expect(result.error).toMatch(/Nothing was lost/i)
      // The merchant must not be told onboarding failed.
      expect(result.error).not.toMatch(/failed/i)
    }
    expect(mocks.upsertMerchantBridgeConnection).not.toHaveBeenCalled()
  })

  it("writes an onboarding audit event bound to the merchant", async () => {
    await startBridgeOnboardingEngine({ merchantId: "merchant_alpha", actorId: "user_alpha" })

    expect(mocks.insertMerchantAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: "merchant_alpha",
        eventType: "provider.bridge_onboarding_started",
        actorId: "user_alpha",
      })
    )
  })
})

describe("Bridge status read and sync", () => {
  it("reads stored state without contacting Bridge", async () => {
    mocks.getMerchantBridgeConnection.mockResolvedValue(
      connectionRow({
        bridge_customer_id: FAKE_CUSTOMER_ID,
        bridge_kyc_link_id: FAKE_KYC_LINK_ID,
        bridge_customer_status: "active",
        bridge_kyc_status: "approved",
        bridge_tos_status: "approved",
        bridge_base_endorsement_approved: true,
        onboarding_requested_at: "2026-08-01T00:00:00.000Z",
      })
    )

    const result = await getBridgeConnectionEngine({ merchantId: "merchant_alpha" })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.connection.approved).toBe(true)
      expect(result.connection.stateLabel).toBe("Connected")
    }
    expect(mocks.syncAccount).not.toHaveBeenCalled()
  })

  it("reports Coming soon for a merchant with no Bridge connection", async () => {
    const result = await getBridgeConnectionEngine({ merchantId: "merchant_alpha" })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.connection.stateLabel).toBe("Coming soon")
      expect(result.connection.onboardingStarted).toBe(false)
    }
  })

  it("does not call Bridge on sync when onboarding was never started", async () => {
    const result = await syncBridgeConnectionEngine({ merchantId: "merchant_alpha" })

    expect(result.ok).toBe(true)
    expect(mocks.syncAccount).not.toHaveBeenCalled()
  })

  it("synchronizes from Bridge and records an audit event", async () => {
    mocks.getMerchantBridgeConnection.mockResolvedValue(
      connectionRow({ bridge_customer_id: FAKE_CUSTOMER_ID, bridge_kyc_link_id: FAKE_KYC_LINK_ID })
    )

    const result = await syncBridgeConnectionEngine({ merchantId: "merchant_alpha" })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.connection.approved).toBe(true)
    expect(mocks.insertMerchantAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "provider.bridge_status_synced" })
    )
  })
})

describe("Bridge enablement gate", () => {
  it("refuses to enable Bridge before approval", async () => {
    mocks.getMerchantBridgeConnection.mockResolvedValue(
      connectionRow({
        bridge_customer_id: FAKE_CUSTOMER_ID,
        bridge_kyc_link_id: FAKE_KYC_LINK_ID,
        bridge_customer_status: "under_review",
        bridge_kyc_status: "under_review",
        bridge_tos_status: "approved",
        bridge_base_endorsement_approved: false,
      })
    )

    const result = await setBridgeEnabledEngine({ merchantId: "merchant_alpha", enabled: true })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/has not approved this business yet/i)
    expect(mocks.upsertMerchantBridgeConnection).not.toHaveBeenCalled()
  })

  it("refuses to enable when KYB is cleared but the base endorsement is not approved", async () => {
    mocks.getMerchantBridgeConnection.mockResolvedValue(
      connectionRow({
        bridge_customer_id: FAKE_CUSTOMER_ID,
        bridge_kyc_link_id: FAKE_KYC_LINK_ID,
        bridge_customer_status: "active",
        bridge_kyc_status: "approved",
        bridge_tos_status: "approved",
        bridge_base_endorsement_approved: false,
      })
    )

    const result = await setBridgeEnabledEngine({ merchantId: "merchant_alpha", enabled: true })
    expect(result.ok).toBe(false)
  })

  it("refuses to enable when the merchant has no Bridge connection at all", async () => {
    const result = await setBridgeEnabledEngine({ merchantId: "merchant_alpha", enabled: true })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Start Bridge onboarding/i)
  })

  it("enables an approved connection and records the explicit decision", async () => {
    mocks.getMerchantBridgeConnection.mockResolvedValue(
      connectionRow({
        bridge_customer_id: FAKE_CUSTOMER_ID,
        bridge_kyc_link_id: FAKE_KYC_LINK_ID,
        bridge_customer_status: "active",
        bridge_kyc_status: "approved",
        bridge_tos_status: "approved",
        bridge_base_endorsement_approved: true,
      })
    )

    const result = await setBridgeEnabledEngine({
      merchantId: "merchant_alpha",
      enabled: true,
      actorId: "user_alpha",
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.connection.stateLabel).toBe("Enabled")

    const [saved] = mocks.upsertMerchantBridgeConnection.mock.calls[0] as [
      { status: string; enabled: boolean; credentials: Record<string, unknown> }
    ]
    expect(saved.status).toBe("active")
    expect(saved.enabled).toBe(true)
    expect(saved.credentials.enablement_decision_at).toBeTruthy()

    expect(mocks.insertMerchantAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "provider.bridge_enabled", actorId: "user_alpha" })
    )
  })

  it("disables without disconnecting the approved Bridge connection", async () => {
    mocks.getMerchantBridgeConnection.mockResolvedValue(
      connectionRow(
        {
          bridge_customer_id: FAKE_CUSTOMER_ID,
          bridge_kyc_link_id: FAKE_KYC_LINK_ID,
          bridge_customer_status: "active",
          bridge_kyc_status: "approved",
          bridge_tos_status: "approved",
          bridge_base_endorsement_approved: true,
          enablement_decision_at: "2026-08-02T00:00:00.000Z",
        },
        true
      )
    )

    const result = await setBridgeEnabledEngine({ merchantId: "merchant_alpha", enabled: false })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.connection.stateLabel).toBe("Disabled")

    const [saved] = mocks.upsertMerchantBridgeConnection.mock.calls[0] as [
      { status: string; enabled: boolean; credentials: Record<string, unknown> }
    ]
    // The Bridge customer and its approval are preserved.
    expect(saved.enabled).toBe(false)
    expect(saved.credentials.bridge_customer_id).toBe(FAKE_CUSTOMER_ID)
    expect(saved.status).toBe("connected")
  })
})

describe("Bridge merchant isolation", () => {
  it("scopes every read and write to the authenticated merchant", async () => {
    await getBridgeConnectionEngine({ merchantId: "merchant_alpha" })
    expect(mocks.getMerchantBridgeConnection).toHaveBeenCalledWith("merchant_alpha")

    await startBridgeOnboardingEngine({ merchantId: "merchant_beta" })
    const [saved] = mocks.upsertMerchantBridgeConnection.mock.calls[0] as [{ merchantId: string }]
    expect(saved.merchantId).toBe("merchant_beta")
  })

  it("uses the session merchant id, never one supplied by the client", async () => {
    const req = new NextRequest("https://app.test/api/providers/bridge/status?merchantId=merchant_victim", {
      method: "GET",
      headers: { Authorization: "Bearer dashboard-token" },
    })

    await statusRoute(req)

    expect(mocks.getMerchantBridgeConnection).toHaveBeenCalledWith("merchant_alpha")
    expect(mocks.getMerchantBridgeConnection).not.toHaveBeenCalledWith("merchant_victim")
  })
})

describe("Bridge route authorization", () => {
  const routes: [string, (req: NextRequest) => Promise<Response>, "GET" | "POST"][] = [
    ["onboarding/start", startOnboardingRoute, "POST"],
    ["status", statusRoute, "GET"],
    ["sync", syncRoute, "POST"],
    ["enable", enableRoute, "POST"],
    ["disable", disableRoute, "POST"],
  ]

  it.each(routes)("rejects an unauthenticated request to %s", async (path, handler, method) => {
    mocks.requireMerchantAuth.mockRejectedValue(
      Object.assign(new Error("Missing bearer token"), { status: 401 })
    )

    const response = await handler(bridgeRequest(`https://app.test/api/providers/bridge/${path}`, method))

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.correlationId).toBeTruthy()
  })

  it.each(routes)("rejects a merchant API key on %s", async (path, handler, method) => {
    // Provider onboarding and enablement are account-owner actions; a
    // programmatic integration key must not be able to start KYB or enable a
    // settlement provider.
    mocks.requireMerchantAuth.mockResolvedValue({
      merchantId: "merchant_alpha",
      authUserId: "merchant_alpha",
      email: null,
      verifiedEmail: null,
      source: "api_key",
    })

    const response = await handler(bridgeRequest(`https://app.test/api/providers/bridge/${path}`, method))

    expect(response.status).toBe(403)
    expect(mocks.connectMerchant).not.toHaveBeenCalled()
    expect(mocks.upsertMerchantBridgeConnection).not.toHaveBeenCalled()
  })

  it("returns the hosted onboarding URL to the requesting merchant only", async () => {
    const response = await startOnboardingRoute(
      bridgeRequest("https://app.test/api/providers/bridge/onboarding/start")
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.kycUrl).toBe(FAKE_KYC_URL)
    // No Bridge identifier is exposed alongside it.
    expect(JSON.stringify(body.data.connection)).not.toContain(FAKE_CUSTOMER_ID)
  })

  it("returns a safe error with a correlation id and no provider payload", async () => {
    mocks.getMerchantBridgeConnection.mockResolvedValue(
      connectionRow({ bridge_customer_id: FAKE_CUSTOMER_ID })
    )
    mocks.syncAccount.mockRejectedValue(
      new Error("Bridge said: customer cust_leak has tax_id 000-00-0000")
    )

    const response = await syncRoute(bridgeRequest("https://app.test/api/providers/bridge/sync"))
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.error.message).toBe("Unable to refresh Bridge status right now.")
    // The provider's own text never reaches the merchant.
    expect(JSON.stringify(body)).not.toContain("cust_leak")
    expect(JSON.stringify(body)).not.toContain("000-00-0000")
  })

  it("returns 409 rather than 503 when enablement is blocked by approval", async () => {
    mocks.getMerchantBridgeConnection.mockResolvedValue(
      connectionRow({
        bridge_customer_id: FAKE_CUSTOMER_ID,
        bridge_customer_status: "under_review",
      })
    )

    const response = await enableRoute(bridgeRequest("https://app.test/api/providers/bridge/enable"))

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.error.code).toBe("bridge_not_approved")
  })

  it("disables through the disable route", async () => {
    mocks.getMerchantBridgeConnection.mockResolvedValue(
      connectionRow(
        {
          bridge_customer_id: FAKE_CUSTOMER_ID,
          bridge_kyc_link_id: FAKE_KYC_LINK_ID,
          bridge_customer_status: "active",
          bridge_kyc_status: "approved",
          bridge_tos_status: "approved",
          bridge_base_endorsement_approved: true,
        },
        true
      )
    )

    const response = await disableRoute(bridgeRequest("https://app.test/api/providers/bridge/disable"))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.connection.stateLabel).toBe("Disabled")
  })
})
