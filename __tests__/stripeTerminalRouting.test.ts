import { describe, expect, it } from "vitest"
import { resolveRecommendedCardMethod } from "@/engine/cardCaptureRouting"
import { isStripeTestMode } from "@/providers/stripe/terminal/simulatedReaders"
import { resolveStripeConnectChargeContext } from "@/providers/stripe/chargeModel"

describe("Stripe card capture routing", () => {
  it("prefers an online reader by default", () => {
    expect(resolveRecommendedCardMethod({ routingPreference: "automatic", hasUsableReader: true, tapToPayAvailable: true, manualEntryEnabled: true, paymentLinkAvailable: true })).toBe("terminal_reader")
  })

  it("honors tap-to-pay-first only when native capability is truly available", () => {
    expect(resolveRecommendedCardMethod({ routingPreference: "tap_to_pay_first", hasUsableReader: true, tapToPayAvailable: false, manualEntryEnabled: true, paymentLinkAvailable: true })).toBe("terminal_reader")
    expect(resolveRecommendedCardMethod({ routingPreference: "tap_to_pay_first", hasUsableReader: true, tapToPayAvailable: true, manualEntryEnabled: true, paymentLinkAvailable: true })).toBe("tap_to_pay")
  })

  it("falls back to manual entry and then payment link", () => {
    expect(resolveRecommendedCardMethod({ routingPreference: "automatic", hasUsableReader: false, tapToPayAvailable: false, manualEntryEnabled: true, paymentLinkAvailable: true })).toBe("manual_entry")
    expect(resolveRecommendedCardMethod({ routingPreference: "automatic", hasUsableReader: false, tapToPayAvailable: false, manualEntryEnabled: false, paymentLinkAvailable: true })).toBe("payment_link")
  })
})

describe("Stripe Terminal safety defaults", () => {
  it("recognizes only test/restricted test secrets for simulated readers", () => {
    expect(isStripeTestMode("sk_test_example")).toBe(true)
    expect(isStripeTestMode("rk_test_example")).toBe(true)
    expect(isStripeTestMode("sk_live_example")).toBe(false)
  })

  it("defaults to the existing direct charge ownership model", () => {
    const previous = process.env.PINE_TREE_STRIPE_CHARGE_MODEL
    delete process.env.PINE_TREE_STRIPE_CHARGE_MODEL
    expect(resolveStripeConnectChargeContext()).toMatchObject({ chargeModel: "direct", paymentIntentAccount: "connected", terminalReaderAccount: "connected" })
    if (previous === undefined) delete process.env.PINE_TREE_STRIPE_CHARGE_MODEL
    else process.env.PINE_TREE_STRIPE_CHARGE_MODEL = previous
  })
})
