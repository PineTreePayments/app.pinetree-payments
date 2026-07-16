import { afterEach, describe, expect, it, vi } from "vitest"
import { createCardPresentPaymentIntent, createManualEntryPaymentIntent } from "@/providers/stripe/terminal/paymentIntents"

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe("Stripe manual-entry PaymentIntent isolation", () => {
  it("uses card and a separate idempotency scope from card_present", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_provider_only")
    const fetchSpy = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = init.body as URLSearchParams
      const manual = body.get("payment_method_types[0]") === "card"
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: manual ? "pi_manual" : "pi_terminal", client_secret: manual ? "pi_manual_secret" : null, status: "requires_payment_method", amount: 1000, currency: "usd" }) }
    })
    vi.stubGlobal("fetch", fetchSpy)

    await createCardPresentPaymentIntent({ connectedAccountId: "acct_merchant", paymentId: "pay_1", merchantId: "merchant_1", grossAmount: 10, currency: "USD", captureMethod: "terminal_reader" })
    await createManualEntryPaymentIntent({ connectedAccountId: "acct_merchant", paymentId: "pay_1", merchantId: "merchant_1", grossAmount: 10, currency: "USD" })

    const terminalInit = fetchSpy.mock.calls[0][1] as RequestInit
    const manualInit = fetchSpy.mock.calls[1][1] as RequestInit
    const terminalBody = terminalInit.body as URLSearchParams
    const manualBody = manualInit.body as URLSearchParams
    expect(terminalBody.get("payment_method_types[0]")).toBe("card_present")
    expect(manualBody.get("payment_method_types[0]")).toBe("card")
    expect((terminalInit.headers as Record<string, string>)["Idempotency-Key"]).toBe("pay_1:card_present")
    expect((manualInit.headers as Record<string, string>)["Idempotency-Key"]).toBe("pay_1:manual_entry")
    expect((manualInit.headers as Record<string, string>)["Stripe-Account"]).toBe("acct_merchant")
  })
})
