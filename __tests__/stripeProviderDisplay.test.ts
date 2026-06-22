import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const providersPage = fs.readFileSync(
  path.join(process.cwd(), "app/dashboard/providers/page.tsx"),
  "utf8"
)
const dashboardEngine = fs.readFileSync(
  path.join(process.cwd(), "engine/providersDashboard.ts"),
  "utf8"
)

describe("Stripe provider display", () => {
  it("passes safe Stripe Connect readiness fields through the Providers API payload", () => {
    expect(dashboardEngine).toContain("sanitizeStripeProviderRow")
    expect(dashboardEngine).toContain("stripe_account_id")
    expect(dashboardEngine).toContain("charges_enabled")
    expect(dashboardEngine).toContain("details_submitted")
    expect(dashboardEngine).toContain("payouts_enabled")
  })

  it("displays active Stripe Connect as Connected", () => {
    expect(providersPage).toContain("isStripeConnectReady")
    expect(providersPage).toContain('return "Connected"')
  })

  it("does not display Application: Not started for connected Stripe", () => {
    expect(providersPage).toContain('provider === "stripe" ?')
    expect(providersPage).toContain("Card processing enabled")
    expect(providersPage).toContain("Stripe account not connected")
  })
})
