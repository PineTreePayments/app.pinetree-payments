import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8")
}

describe("POS Card button behavior", () => {
  const pos = read("components/pos/POSLayout.tsx")
  const engine = read("engine/posPayments.ts")
  const hostedCheckout = read("app/pay/PayClient.tsx")

  it("has an active Card handler that requests the Stripe rail", () => {
    expect(pos).toContain("async function startCard()")
    expect(pos).toContain("onClick={() => void startCard()}")
    expect(pos).toContain('network: "stripe"')
  })

  it("does not silently no-op and exposes loading, fallback, and failure UI", () => {
    expect(pos).toContain("Preparing card payment…")
    expect(pos).toContain("Open secure card checkout")
    expect(pos).toContain("Card payments are not ready yet.")
    expect(pos).toContain("setPaymentError(")
    expect(pos).toContain('setStatus("failed")')
  })

  it("limits POS card intents to Stripe instead of Shift4, and limits POS crypto intents to the canonical crypto-only rails (never Stripe)", () => {
    expect(engine).toContain("allowedNetworks: requestedAllowedNetworks")
    expect(engine).toContain('preferredNetwork ? [preferredNetwork] : getRailsForCategory("crypto")')
    expect(engine).toContain('preferredNetwork === "stripe"')
  })

  it("keeps Cash and Crypto handlers wired", () => {
    expect(pos).toContain("function startCash()")
    expect(pos).toContain("onClick={startCash}")
    expect(pos).toContain("async function startCrypto()")
    expect(pos).toContain("onClick={startCrypto}")
  })

  it("leaves hosted Stripe PaymentElement behavior in place", () => {
    expect(hostedCheckout).toContain('<StripeCardPayment')
    expect(hostedCheckout).toContain('asset.network === "stripe"')
    expect(hostedCheckout).toContain("handleStripePay()")
  })
})
