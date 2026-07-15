/**
 * Stripe Connect onboarding tests.
 *
 * Guards:
 * - start route delegates Stripe to Connect (not STRIPE_APPLICATION_URL)
 * - engine reuses existing stripe_account_id
 * - no STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET exposed in API responses
 * - sync route stores provider account fields but returns normalized readiness
 * - return page calls sync endpoint
 * - refresh page calls connect/start endpoint
 * - providers page reads normalized card readiness for status
 */

import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

const ENGINE_SETUP = read("engine/cardProviderSetup.ts")
const ENGINE_CONNECT = read("engine/stripeConnect.ts")
const STRIPE_ONBOARDING = read("providers/stripe/onboarding.ts")
const ROUTE_START = read("app/api/providers/stripe/connect/start/route.ts")
const ROUTE_SYNC = read("app/api/providers/stripe/connect/sync/route.ts")
const RETURN_PAGE = read("app/dashboard/providers/stripe/return/page.tsx")
const REFRESH_PAGE = read("app/dashboard/providers/stripe/refresh/page.tsx")
const PROVIDERS_PAGE = read("app/dashboard/providers/page.tsx")

describe("Stripe Connect onboarding", () => {
  it("cardProviderSetup delegates Stripe to Connect — not STRIPE_APPLICATION_URL", () => {
    expect(ENGINE_SETUP).toContain("startStripeConnectOnboarding")
    expect(ENGINE_SETUP).toContain('if (args.provider === "stripe")')
    // Stripe must not fall through to buildCardSetupRedirectUrl
    const stripeBlock = ENGINE_SETUP.slice(
      ENGINE_SETUP.indexOf('if (args.provider === "stripe")'),
      ENGINE_SETUP.indexOf("const redirectUrl = buildCardSetupRedirectUrl")
    )
    expect(stripeBlock).toContain("return startStripeConnectOnboarding")
  })

  it("stripeConnect engine reuses existing stripe_account_id when present", () => {
    expect(ENGINE_CONNECT).toContain("stripe_account_id")
    expect(ENGINE_CONNECT).toContain("createStripeConnectedAccount")
    // Only creates account if none exists
    expect(ENGINE_CONNECT).toMatch(/if\s*\(\s*!stripeAccountId\s*\)/)
  })

  it("stripeConnect engine creates account link with return_url and refresh_url from env vars", () => {
    expect(ENGINE_CONNECT).toContain("NEXT_PUBLIC_STRIPE_CONNECT_RETURN_URL")
    expect(ENGINE_CONNECT).toContain("NEXT_PUBLIC_STRIPE_CONNECT_REFRESH_URL")
    expect(ENGINE_CONNECT).toContain("createStripeOnboardingLink")
    expect(STRIPE_ONBOARDING).toContain("createAccountLink")
    expect(STRIPE_ONBOARDING).toContain("return_url")
    expect(STRIPE_ONBOARDING).toContain("refresh_url")
  })

  it("stripeConnect engine returns error when env vars are missing", () => {
    expect(ENGINE_CONNECT).toContain("Stripe Connect is not configured yet.")
  })

  it("stripeConnect sync persists provider account fields but returns normalized readiness", () => {
    expect(ENGINE_CONNECT).toContain("details_submitted")
    expect(ENGINE_CONNECT).toContain("charges_enabled")
    expect(ENGINE_CONNECT).toContain("payouts_enabled")
    expect(ENGINE_CONNECT).toContain("connect_last_synced_at")
    expect(ENGINE_CONNECT).toContain("retrieveStripeConnectedAccount")
    expect(ENGINE_CONNECT).toContain("readyForPayments")
    expect(ENGINE_CONNECT).toContain("onboardingStatus")
  })

  it("stripeConnect sync sets status=active and enabled=true when charges_enabled", () => {
    expect(ENGINE_CONNECT).toContain('if (credentials?.charges_enabled === true) return { status: "active", enabled: true }')
    expect(ENGINE_CONNECT).toContain('return { status: "pending", enabled: false }')
    expect(ENGINE_CONNECT).toContain('return { status: "not_started", enabled: false }')
  })

  it("connect/start route requires merchant auth and returns only url — no secret key", () => {
    expect(ROUTE_START).toContain("requireMerchantIdFromRequest")
    expect(ROUTE_START).toContain("startStripeConnectOnboarding")
    expect(ROUTE_START).toContain('{ url: result.url }')
    expect(ROUTE_START).not.toContain('{ ok: true, url: result.url }')
    expect(ROUTE_START).not.toContain("stripe_account_id")
    expect(ROUTE_START).not.toContain("STRIPE_SECRET_KEY")
    expect(ROUTE_START).not.toContain("STRIPE_WEBHOOK_SECRET")
  })

  it("connect/sync route requires merchant auth and does not expose secret keys", () => {
    expect(ROUTE_SYNC).toContain("requireMerchantIdFromRequest")
    expect(ROUTE_SYNC).toContain("syncStripeConnectAccount")
    expect(ROUTE_SYNC).not.toContain("STRIPE_SECRET_KEY")
    expect(ROUTE_SYNC).not.toContain("STRIPE_WEBHOOK_SECRET")
  })

  it("return page calls sync endpoint on mount", () => {
    expect(RETURN_PAGE).toContain("/api/providers/stripe/connect/sync")
    expect(RETURN_PAGE).toContain("useEffect")
    expect(RETURN_PAGE).toContain("readyForPayments")
    expect(RETURN_PAGE).not.toContain("charges_enabled")
  })

  it("return page shows Stripe setup received message", () => {
    expect(RETURN_PAGE).toContain("Stripe Setup Received")
    expect(RETURN_PAGE).toContain("Stripe Connected")
    expect(RETURN_PAGE).toContain("/dashboard/providers")
  })

  it("refresh page calls connect/start to create a new onboarding link", () => {
    expect(REFRESH_PAGE).toContain("/api/providers/stripe/connect/start")
    expect(REFRESH_PAGE).toContain("useEffect")
    expect(REFRESH_PAGE).toContain("window.location.assign")
  })

  it("providers page derives Stripe status from normalized card readiness, not raw provider credentials", () => {
    expect(PROVIDERS_PAGE).toContain("cardReadiness")
    expect(PROVIDERS_PAGE).not.toContain("charges_enabled")
    expect(PROVIDERS_PAGE).not.toContain("stripe_account_id")
    expect(PROVIDERS_PAGE).not.toContain("application_status")
    expect(PROVIDERS_PAGE).toContain("getStripeConnectCtaLabel")
  })

  it("providers page shows Continue Setup label when account exists but incomplete", () => {
    expect(PROVIDERS_PAGE).toContain('"Continue Setup"')
    expect(PROVIDERS_PAGE).toContain("Start Stripe Setup")
  })

  it("providers page existing tests: start-setup fetch call still present", () => {
    expect(PROVIDERS_PAGE).toContain('fetch(`/api/providers/${provider}/start-setup`')
  })

  it("no STRIPE_SECRET_KEY exposed in any Connect-facing file", () => {
    expect(ROUTE_START).not.toContain("STRIPE_SECRET_KEY")
    expect(ROUTE_SYNC).not.toContain("STRIPE_SECRET_KEY")
    expect(RETURN_PAGE).not.toContain("STRIPE_SECRET_KEY")
    expect(REFRESH_PAGE).not.toContain("STRIPE_SECRET_KEY")
    expect(PROVIDERS_PAGE).not.toContain("STRIPE_SECRET_KEY")
  })

  it("sanitizes merchant_providers.credentials to the approved Stripe fields", () => {
    expect(ENGINE_CONNECT).toContain("sanitizeConnectCredentials")
    expect(ENGINE_CONNECT).not.toContain("[key: string]: unknown")
  })

  it("engine never imports the raw Stripe client directly", () => {
    expect(ENGINE_CONNECT).not.toContain("@/providers/stripe/client")
    expect(STRIPE_ONBOARDING).toContain('from "./client"')
  })
})
