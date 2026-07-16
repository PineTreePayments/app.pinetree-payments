import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const posSource = readFileSync("components/pos/POSLayout.tsx", "utf8")
const elementSource = readFileSync("components/payment/StripeCardPayment.tsx", "utf8")

describe("PineTree POS manual-entry UI", () => {
  it("initializes direct-charge Stripe.js with the platform key and authenticated account context", () => {
    expect(elementSource).toContain("process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY")
    expect(elementSource).toContain("loadStripe(publishableKey, { stripeAccount: stripeAccountId })")
    expect(posSource).toContain('fetch("/api/payments/stripe/manual"')
    expect(posSource).toContain("stripeAccountId={manualStripeAccountId}")
  })

  it("keeps account/client-secret context in component state rather than browser storage", () => {
    expect(posSource).toContain('useState("")')
    expect(posSource).not.toMatch(/localStorage[^\n]*(manualStripeAccountId|manualClientSecret)/)
    expect(posSource).not.toMatch(/sessionStorage[^\n]*(manualStripeAccountId|manualClientSecret)/)
    expect(posSource).not.toMatch(/console\.(log|info|warn|error)[^\n]*(manualStripeAccountId|manualClientSecret)/)
  })

  it("waits for PineTree state after Stripe.js confirmation", () => {
    expect(posSource).toContain('setStatus("processing")')
    expect(posSource).toContain("Waiting for PineTree to confirm the verified Stripe webhook.")
    expect(posSource).toContain("/api/payments/status?")
    expect(posSource).not.toMatch(/onSuccess=\{\(\) => \{[\s\S]*?setStatus\("confirmed"\)/)
  })
})
