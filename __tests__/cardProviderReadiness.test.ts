import { describe, expect, it } from "vitest"
import {
  canCardProviderProcessPayments,
  isLegacyCardProviderApproved,
  isStripeConnectReady
} from "@/providers/cardProviderReadiness"

const activeStripe = {
  provider: "stripe",
  status: "active",
  enabled: true,
  credentials: {
    stripe_account_id: "acct_123",
    details_submitted: true,
    charges_enabled: true,
    payouts_enabled: true
  }
}

describe("card provider readiness", () => {
  it("recognizes an active Stripe Connect row as connected and card-ready", () => {
    expect(isStripeConnectReady(activeStripe)).toBe(true)
    expect(canCardProviderProcessPayments(activeStripe)).toBe(true)
  })

  it("does not make Stripe card-ready when the provider is disabled", () => {
    expect(canCardProviderProcessPayments({ ...activeStripe, enabled: false })).toBe(false)
  })

  it("does not make Stripe card-ready when charges are disabled", () => {
    expect(canCardProviderProcessPayments({
      ...activeStripe,
      credentials: { ...activeStripe.credentials, charges_enabled: false }
    })).toBe(false)
  })

  it("preserves Shift4 approval behavior", () => {
    expect(isLegacyCardProviderApproved({
      provider: "shift4",
      status: "pending",
      enabled: true,
      credentials: { application_status: "approved" }
    })).toBe(true)
    expect(isLegacyCardProviderApproved({
      provider: "shift4",
      status: "pending",
      enabled: true,
      credentials: { application_status: "pending" }
    })).toBe(false)
  })

  it("preserves FluidPay approval behavior", () => {
    expect(isLegacyCardProviderApproved({
      provider: "fluidpay",
      status: "pending",
      enabled: true,
      credentials: { application_status: "approved" }
    })).toBe(true)
    expect(isLegacyCardProviderApproved({
      provider: "fluidpay",
      status: "pending",
      enabled: true,
      credentials: { application_status: "denied" }
    })).toBe(false)
  })
})
