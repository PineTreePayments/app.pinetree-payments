import { describe, expect, it } from "vitest"

import {
  deriveStripeConnectionStatus,
  normalizeStripeAccountStatus
} from "@/providers/stripe/capabilities"
import type { StripeConnectedAccountDetails } from "@/providers/stripe/types"

type AccountDetailsOverrides = Partial<Omit<StripeConnectedAccountDetails, "requirements">> & {
  requirements?: Partial<StripeConnectedAccountDetails["requirements"]>
}

function accountDetails(overrides: AccountDetailsOverrides = {}): StripeConnectedAccountDetails {
  const { requirements, ...rest } = overrides
  return {
    id: "acct_test_1",
    detailsSubmitted: false,
    chargesEnabled: false,
    payoutsEnabled: false,
    capabilities: {},
    metadata: {},
    ...rest,
    requirements: {
      currentlyDue: [],
      eventuallyDue: [],
      pastDue: [],
      pendingVerification: [],
      disabledReason: null,
      ...requirements
    }
  }
}

describe("Stripe connection status normalization", () => {
  it("maps a missing account to not_connected", () => {
    expect(deriveStripeConnectionStatus(null)).toBe("not_connected")
    const normalized = normalizeStripeAccountStatus(null)
    expect(normalized.connectionStatus).toBe("not_connected")
    expect(normalized.accountConnected).toBe(false)
  })

  it("maps an unsubmitted account to onboarding_required", () => {
    const status = deriveStripeConnectionStatus(accountDetails({
      detailsSubmitted: false,
      requirements: { currentlyDue: ["business_profile.url", "external_account"] }
    }))
    expect(status).toBe("onboarding_required")
  })

  it("maps a brand-new unsubmitted account to onboarding_required even when Stripe marks requirements past_due", () => {
    // Live-API behavior for requirement_collection=application accounts:
    // Stripe reports every requirement past_due immediately on creation.
    const status = deriveStripeConnectionStatus(accountDetails({
      detailsSubmitted: false,
      requirements: {
        currentlyDue: ["business_profile.url", "external_account"],
        pastDue: ["business_profile.url", "external_account"],
        disabledReason: "requirements.past_due"
      }
    }))
    expect(status).toBe("onboarding_required")
  })

  it("maps submitted-with-newly-due-requirements to onboarding_required", () => {
    const status = deriveStripeConnectionStatus(accountDetails({
      detailsSubmitted: true,
      chargesEnabled: false,
      requirements: { currentlyDue: ["individual.verification.document"] }
    }))
    expect(status).toBe("onboarding_required")
  })

  it("maps submitted-under-review to pending_verification", () => {
    const status = deriveStripeConnectionStatus(accountDetails({
      detailsSubmitted: true,
      chargesEnabled: false,
      payoutsEnabled: false,
      requirements: { pendingVerification: ["company.tax_id"] }
    }))
    expect(status).toBe("pending_verification")
  })

  it("maps past-due requirements to restricted even when charges remain enabled", () => {
    const status = deriveStripeConnectionStatus(accountDetails({
      detailsSubmitted: true,
      chargesEnabled: true,
      payoutsEnabled: true,
      requirements: { pastDue: ["company.owners"] }
    }))
    expect(status).toBe("restricted")
  })

  it("maps disabled_reason requirements.past_due to restricted", () => {
    const status = deriveStripeConnectionStatus(accountDetails({
      detailsSubmitted: true,
      requirements: { disabledReason: "requirements.past_due" }
    }))
    expect(status).toBe("restricted")
  })

  it("maps terminal disabled reasons to disabled", () => {
    for (const disabledReason of ["rejected.fraud", "rejected.terms_of_service", "listed", "platform_paused", "other"]) {
      const status = deriveStripeConnectionStatus(accountDetails({
        detailsSubmitted: true,
        requirements: { disabledReason }
      }))
      expect(status).toBe("disabled")
    }
  })

  it("maps fully enabled charges and payouts to active", () => {
    const status = deriveStripeConnectionStatus(accountDetails({
      detailsSubmitted: true,
      chargesEnabled: true,
      payoutsEnabled: true
    }))
    expect(status).toBe("active")
  })

  it("normalizes the full safe connection shape without leaking extra fields", () => {
    const normalized = normalizeStripeAccountStatus(accountDetails({
      detailsSubmitted: true,
      chargesEnabled: true,
      payoutsEnabled: true,
      capabilities: { card_payments: "active", transfers: "active" }
    }))

    expect(normalized).toEqual({
      provider: "stripe",
      connectionStatus: "active",
      accountConnected: true,
      detailsSubmitted: true,
      chargesEnabled: true,
      payoutsEnabled: true,
      requirementsCurrentlyDue: [],
      requirementsEventuallyDue: [],
      requirementsPastDue: [],
      requirementsPendingVerification: [],
      disabledReason: null,
      capabilities: { card_payments: "active", transfers: "active" }
    })
    // The normalized shape must never carry the Stripe account ID.
    expect(JSON.stringify(normalized)).not.toContain("acct_")
  })
})
