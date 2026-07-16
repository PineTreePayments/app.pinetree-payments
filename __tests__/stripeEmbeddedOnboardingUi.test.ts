import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Stripe embedded onboarding UI guards:
 *  - onboarding stays inside PineTree (embedded Connect component, no
 *    hosted redirect from the Providers screen)
 *  - the Providers page renders every normalized connection state
 *  - only the publishable key reaches the browser; no secrets, no raw
 *    Stripe credential field names
 */

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

const ONBOARDING_COMPONENT = read("components/dashboard/StripeConnectOnboarding.tsx")
const PROVIDERS_PAGE = read("app/dashboard/providers/page.tsx")
const ROUTE_ACCOUNT = read("app/api/providers/stripe/account/route.ts")
const ROUTE_ACCOUNT_SESSION = read("app/api/providers/stripe/account-session/route.ts")
const ROUTE_STATUS = read("app/api/providers/stripe/status/route.ts")

describe("Stripe embedded onboarding UI", () => {
  it("uses Stripe Connect embedded components inside PineTree", () => {
    expect(ONBOARDING_COMPONENT).toContain('from "@stripe/connect-js"')
    expect(ONBOARDING_COMPONENT).toContain('from "@stripe/react-connect-js"')
    expect(ONBOARDING_COMPONENT).toContain("loadConnectAndInitialize")
    expect(ONBOARDING_COMPONENT).toContain("ConnectComponentsProvider")
    expect(ONBOARDING_COMPONENT).toContain("ConnectAccountOnboarding")
    expect(ONBOARDING_COMPONENT).toContain("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY")
  })

  it("never exposes secret configuration or logs the client secret", () => {
    expect(ONBOARDING_COMPONENT).not.toContain("STRIPE_SECRET_KEY")
    expect(ONBOARDING_COMPONENT).not.toMatch(/console\.\w+\([^)]*[cC]lientSecret/)
    expect(PROVIDERS_PAGE).not.toContain("STRIPE_SECRET_KEY")
    expect(PROVIDERS_PAGE).not.toMatch(/console\.\w+\([^)]*[cC]lientSecret/)
  })

  it("providers page fetches normalized status and account sessions from the server", () => {
    expect(PROVIDERS_PAGE).toContain('"/api/providers/stripe/status"')
    expect(PROVIDERS_PAGE).toContain('"/api/providers/stripe/account-session"')
    expect(PROVIDERS_PAGE).toContain("StripeConnectOnboarding")
    // No hosted redirect for Stripe from the Providers screen.
    expect(PROVIDERS_PAGE).not.toContain("stripe.com")
  })

  it("renders every normalized Stripe connection state", () => {
    expect(PROVIDERS_PAGE).toContain('"Connect Stripe"')
    expect(PROVIDERS_PAGE).toContain('"Continue setup"')
    expect(PROVIDERS_PAGE).toContain('"Verification pending"')
    expect(PROVIDERS_PAGE).toContain('"Action required"')
    expect(PROVIDERS_PAGE).toContain('"Setup needed"')
    expect(PROVIDERS_PAGE).toContain('"Disabled"')
    expect(PROVIDERS_PAGE).toContain("not_connected")
    expect(PROVIDERS_PAGE).toContain("onboarding_required")
    expect(PROVIDERS_PAGE).toContain("pending_verification")
    expect(PROVIDERS_PAGE).toContain("restricted")
  })

  it("shows outstanding requirement information and charge/payout readiness", () => {
    expect(PROVIDERS_PAGE).toContain("outstandingRequirementCount")
    expect(PROVIDERS_PAGE).toContain("} outstanding`")
    expect(PROVIDERS_PAGE).toContain("chargesEnabled")
    expect(PROVIDERS_PAGE).toContain("payoutsEnabled")
    // Connected state is not claimed from a bare account ID: it derives
    // from the normalized connection status only.
    expect(PROVIDERS_PAGE).toContain('status === "active"')
  })

  it("keeps raw Stripe credential field names out of the browser page", () => {
    for (const banned of ["charges_enabled", "payouts_enabled", "details_submitted", "stripe_account_id", "application_status"]) {
      expect(PROVIDERS_PAGE).not.toContain(banned)
    }
  })

  it("all Stripe Connect routes authenticate the merchant and call the engine", () => {
    for (const source of [ROUTE_ACCOUNT, ROUTE_ACCOUNT_SESSION, ROUTE_STATUS]) {
      expect(source).toContain("requireMerchantIdFromRequest")
      expect(source).toContain('from "@/engine/stripeConnect"')
      expect(source).not.toContain("STRIPE_SECRET_KEY")
      expect(source).not.toContain("@/providers/stripe")
    }
    expect(ROUTE_ACCOUNT).toContain("ensureStripeConnectedAccountEngine")
    expect(ROUTE_ACCOUNT_SESSION).toContain("createStripeAccountSessionEngine")
    expect(ROUTE_STATUS).toContain("syncStripeConnectionEngine")
  })

  it("routes never read a merchant ID or account ID from the request body", () => {
    for (const source of [ROUTE_ACCOUNT, ROUTE_ACCOUNT_SESSION, ROUTE_STATUS]) {
      expect(source).not.toContain("req.json()")
      expect(source).not.toContain("merchant_id")
      expect(source).not.toContain("accountId")
    }
  })
})
