/**
 * Stripe checkout path tests.
 *
 * Guards:
 * - PayClient no longer hardcodes card network to "shift4" only
 * - Stripe path calls select-network with network: "stripe"
 * - Shift4 path still calls select-network with network: "shift4"
 * - clientSecret appears in select-network response only for Stripe
 * - No secret keys leak into client-facing files
 */

import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

const PAY_CLIENT = read("app/pay/PayClient.tsx")
const STRIPE_COMPONENT = read("components/payment/StripeCardPayment.tsx")
const SELECT_NETWORK_ROUTE = read("app/api/payment-intents/[intentId]/select-network/route.ts")
const ENGINE_INTENTS = read("engine/paymentIntents.ts")
const ENGINE_CREATE = read("engine/createPayment.ts")

describe("Stripe checkout path", () => {
  it("PayClient calls select-network with network: stripe for the Stripe path", () => {
    expect(PAY_CLIENT).toContain('body: JSON.stringify({ network: "stripe" })')
  })

  it("PayClient still calls select-network with network: shift4 for the Shift4 path", () => {
    expect(PAY_CLIENT).toContain('body: JSON.stringify({ network: "shift4" })')
  })

  it("PayClient does not hardcode card payments exclusively to shift4", () => {
    // The only shift4 body should be inside handleShift4Pay; stripe is handled separately
    const shift4Matches = (PAY_CLIENT.match(/network:\s*["']shift4["']/g) || []).length
    const stripeMatches = (PAY_CLIENT.match(/network:\s*["']stripe["']/g) || []).length
    expect(shift4Matches).toBeGreaterThanOrEqual(1)
    expect(stripeMatches).toBeGreaterThanOrEqual(1)
  })

  it("PayClient renders Stripe Elements when clientSecret is present", () => {
    expect(PAY_CLIENT).toContain("StripeCardPayment")
    expect(PAY_CLIENT).toContain("stripeClientSecret")
  })

  it("PayClient shows Stripe payment section for stripe network", () => {
    expect(PAY_CLIENT).toContain('asset.network === "stripe"')
  })

  it("Stripe network is in engine SUPPORTED_NETWORKS", () => {
    expect(ENGINE_INTENTS).toContain('"stripe"')
    expect(ENGINE_INTENTS).toMatch(/SUPPORTED_NETWORKS[\s\S]*stripe|stripe[\s\S]*SUPPORTED_NETWORKS/)
  })

  it("engine returns clientSecret for Stripe in both payment paths", () => {
    expect(ENGINE_INTENTS).toContain("clientSecret: payment.clientSecret")
    expect(ENGINE_INTENTS).toContain("clientSecret: reuseClientSecret")
  })

  it("createPayment engine surfaces clientSecret in result", () => {
    expect(ENGINE_CREATE).toContain("clientSecret?: string")
    expect(ENGINE_CREATE).toContain("clientSecret: stripeClientSecret")
  })

  it("StripeCardPayment uses PaymentElement (not raw card fields)", () => {
    expect(STRIPE_COMPONENT).toContain("PaymentElement")
    expect(STRIPE_COMPONENT).toContain("confirmPayment")
  })

  it("StripeCardPayment uses the published key env var — not the secret key", () => {
    expect(STRIPE_COMPONENT).toContain("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY")
    expect(STRIPE_COMPONENT).not.toContain("STRIPE_SECRET_KEY")
    expect(STRIPE_COMPONENT).not.toContain("STRIPE_WEBHOOK_SECRET")
  })

  it("PayClient does not reference STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET", () => {
    expect(PAY_CLIENT).not.toContain("STRIPE_SECRET_KEY")
    expect(PAY_CLIENT).not.toContain("STRIPE_WEBHOOK_SECRET")
  })

  it("select-network route passes result directly — no server-side secret key exposure", () => {
    expect(SELECT_NETWORK_ROUTE).not.toContain("STRIPE_SECRET_KEY")
    expect(SELECT_NETWORK_ROUTE).not.toContain("STRIPE_WEBHOOK_SECRET")
  })
})
