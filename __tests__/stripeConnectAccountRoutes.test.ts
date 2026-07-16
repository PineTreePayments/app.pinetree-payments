import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Route tests for the Stripe Connect embedded onboarding API:
 *  - every route rejects unauthenticated requests
 *  - merchant identity comes only from the authenticated session
 *  - responses expose only the safe normalized shape (no account IDs,
 *    no secret keys, and the account-session response carries only the
 *    short-lived client secret)
 */

const mocks = vi.hoisted(() => ({
  requireMerchantId: vi.fn(),
  assertBusinessProfile: vi.fn(),
  ensureAccount: vi.fn(),
  createSession: vi.fn(),
  syncConnection: vi.fn()
}))

vi.mock("@/lib/api/merchantAuth", () => ({
  requireMerchantIdFromRequest: mocks.requireMerchantId,
  getRouteErrorStatus: (error: unknown) =>
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: number }).status) || 500
      : 500
}))

vi.mock("@/engine/businessProfile", () => ({
  assertMerchantBusinessProfileComplete: mocks.assertBusinessProfile
}))

vi.mock("@/engine/stripeConnect", () => ({
  ensureStripeConnectedAccountEngine: mocks.ensureAccount,
  createStripeAccountSessionEngine: mocks.createSession,
  syncStripeConnectionEngine: mocks.syncConnection
}))

import { POST as postAccount } from "@/app/api/providers/stripe/account/route"
import { POST as postAccountSession } from "@/app/api/providers/stripe/account-session/route"
import { GET as getStatus } from "@/app/api/providers/stripe/status/route"

function request(path: string, method: "GET" | "POST" = "POST") {
  return new NextRequest(`https://app.test${path}`, {
    method,
    headers: { Authorization: "Bearer dashboard-token" }
  })
}

const safeConnection = {
  provider: "stripe",
  connectionStatus: "onboarding_required",
  accountConnected: true,
  detailsSubmitted: false,
  chargesEnabled: false,
  payoutsEnabled: false,
  requirementsCurrentlyDue: ["business_profile.url"],
  requirementsPastDue: [],
  requirementsPendingVerification: [],
  outstandingRequirementCount: 1,
  disabledReason: null,
  lastSyncedAt: null
}

describe("Stripe Connect account routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireMerchantId.mockResolvedValue("merchant_1")
    mocks.assertBusinessProfile.mockResolvedValue({})
    mocks.ensureAccount.mockResolvedValue({ ok: true, created: true, connection: safeConnection })
    mocks.createSession.mockResolvedValue({ ok: true, clientSecret: "accs_secret_test_value" })
    mocks.syncConnection.mockResolvedValue({ ok: true, connection: safeConnection })
  })

  it("rejects unauthenticated requests on all three routes", async () => {
    const error = Object.assign(new Error("Unauthorized"), { status: 401 })
    mocks.requireMerchantId.mockRejectedValue(error)

    const responses = await Promise.all([
      postAccount(request("/api/providers/stripe/account")),
      postAccountSession(request("/api/providers/stripe/account-session")),
      getStatus(request("/api/providers/stripe/status", "GET"))
    ])

    for (const response of responses) {
      expect(response.status).toBe(401)
    }
    expect(mocks.ensureAccount).not.toHaveBeenCalled()
    expect(mocks.createSession).not.toHaveBeenCalled()
    expect(mocks.syncConnection).not.toHaveBeenCalled()
  })

  it("account route resolves the merchant from the session, never the request body", async () => {
    const response = await postAccount(request("/api/providers/stripe/account"))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      created: true,
      connection: safeConnection
    })
    expect(mocks.ensureAccount).toHaveBeenCalledWith({ merchantId: "merchant_1" })
  })

  it("account route requires a complete business profile", async () => {
    const error = Object.assign(new Error("Complete your Business Profile to activate payments."), { status: 409 })
    mocks.assertBusinessProfile.mockRejectedValue(error)

    const response = await postAccount(request("/api/providers/stripe/account"))

    expect(response.status).toBe(409)
    expect(mocks.ensureAccount).not.toHaveBeenCalled()
  })

  it("account-session route returns only the client secret", async () => {
    const response = await postAccountSession(request("/api/providers/stripe/account-session"))

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload).toEqual({ ok: true, clientSecret: "accs_secret_test_value" })
    expect(Object.keys(payload).sort()).toEqual(["clientSecret", "ok"])
    expect(mocks.createSession).toHaveBeenCalledWith({ merchantId: "merchant_1" })
  })

  it("status route synchronizes and returns the safe normalized connection", async () => {
    const response = await getStatus(request("/api/providers/stripe/status", "GET"))

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload).toEqual({ ok: true, connection: safeConnection })
    expect(mocks.syncConnection).toHaveBeenCalledWith({ merchantId: "merchant_1" })

    // Safe shape: no Stripe account identifiers or secret material.
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain("acct_")
    expect(serialized).not.toContain("sk_")
    expect(serialized).not.toContain("stripe_account_id")
  })

  it("status route surfaces a provider failure without leaking internals", async () => {
    mocks.syncConnection.mockResolvedValue({ ok: false, error: "Unable to refresh Stripe status right now." })

    const response = await getStatus(request("/api/providers/stripe/status", "GET"))

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Unable to refresh Stripe status right now."
    })
  })

  it("engine failures on account creation map to a service-unavailable response", async () => {
    mocks.ensureAccount.mockResolvedValue({ ok: false, error: "Unable to set up Stripe for this merchant right now." })

    const response = await postAccount(request("/api/providers/stripe/account"))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Unable to set up Stripe for this merchant right now."
    })
  })
})
