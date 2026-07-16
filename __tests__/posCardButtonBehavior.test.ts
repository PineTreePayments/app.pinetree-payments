import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8")
}

describe("dedicated PineTree POS Card experience", () => {
  const pos = read("components/pos/POSLayout.tsx")
  const card = read("components/pos/PosCardPaymentExperience.tsx")
  const posPaymentRoute = read("app/api/pos/payment/route.ts")
  const paymentLinkRoute = read("app/api/pos/card/payment-link/route.ts")
  const terminalEngine = read("engine/stripeTerminal.ts")
  const hostedCheckout = read("app/pay/PayClient.tsx")

  it("opens inside POS and never sends the Card tap to hosted checkout", () => {
    const startCard = pos.slice(pos.indexOf("async function startCard()"), pos.indexOf("async function loadCardCapabilities"))
    expect(pos).toContain("onClick={() => void startCard()}")
    expect(startCard).toContain('setPaymentMode("card")')
    expect(startCard).toContain('setCardView("loading")')
    expect(startCard).toContain("await loadCardCapabilities(true)")
    expect(startCard).not.toContain("window.location")
    expect(startCard).not.toContain("router.push")
    expect(startCard).not.toContain("/pay")
    expect(startCard).not.toContain("/checkout")
    expect(startCard).not.toContain("/api/pos/payment")
  })

  it("cannot turn the general POS payment endpoint into a hosted Stripe checkout", () => {
    expect(posPaymentRoute).toContain('if (normalizedNetwork === "stripe")')
    expect(posPaymentRoute).toContain("Use the explicit POS card payment-link fallback.")
    expect(posPaymentRoute).not.toContain('preferredNetwork: normalizedNetwork === "stripe"')
  })

  it("never renders hosted-checkout or crypto language in the POS Card component", () => {
    expect(card).not.toContain("Choose Payment Asset")
    expect(card).not.toContain("Pay with Card / Fiat")
    expect(card).not.toContain("Choose a wallet below")
    expect(card).not.toContain("Reveal payment options")
    expect(card).not.toContain("Continue to Card Payment")
    expect(card).not.toMatch(/accordion/i)
    expect(card).not.toMatch(/crypto/i)
  })

  it("renders the reader-available collection and selection state", () => {
    expect(card).toContain('props.view === "collect"')
    expect(card).toContain("Collect Card Payment")
    expect(card).toContain("Recommended")
    expect(card).toContain("Stripe Card Reader")
    expect(card).toContain("Online and ready")
    expect(card).toContain("Send to Reader")
    expect(card).toContain("Choose a Stripe Card Reader")
  })

  it("renders the dedicated no-reader fallback state", () => {
    expect(card).toContain('props.view === "no-reader"')
    expect(card).toContain("No Stripe Card Reader Connected")
    expect(card).toContain("Refresh Readers")
    expect(card).toContain("Register Reader")
    expect(card).toContain("Tap to Pay requires the PineTree mobile app.")
  })

  it("renders waiting, processing, approved, and declined states", () => {
    expect(card).toContain("Waiting for Customer")
    expect(card).toContain("Tap, insert, or swipe card")
    expect(card).toContain("Processing Payment")
    expect(card).toContain("Keep the card near the reader.")
    expect(card).toContain("Payment Approved")
    expect(card).toContain("View Receipt")
    expect(card).toContain("Payment Declined")
    expect(card).toContain("Try again or choose another payment method.")
  })

  it("keeps manual entry inside POS and mounts Stripe Payment Element", () => {
    expect(pos).toContain('fetch("/api/payments/stripe/manual"')
    expect(card).toContain('props.view === "manual"')
    expect(card).toContain("Enter Card Details")
    expect(card).toContain("<StripeCardPayment")
    expect(card).toContain("This is manual card entry.")
    expect(card).toContain("submitLabel={`Pay ${props.amount}`}")
  })

  it("makes payment links explicit and secondary", () => {
    expect(card).toContain("Other ways to collect")
    expect(card).toContain("Send Payment Link")
    expect(pos).toContain('fetch("/api/pos/card/payment-link"')
    expect(paymentLinkRoute).toContain('preferredNetwork: "stripe"')
    expect(paymentLinkRoute).toContain("The primary POS Card action never calls this route")
  })

  it("keeps PineTree register IDs distinct from Stripe provider reader IDs", () => {
    expect(pos).toContain("readerId: reader.id")
    expect(pos).not.toContain("readerId: terminalContext?.terminalId")
    expect(terminalEngine).toContain("getMerchantTerminalReaderById(input.merchantId, input.readerId)")
    expect(terminalEngine).toContain("stripeReaderId: reader.provider_reader_id")
    expect(terminalEngine).toContain("terminal_reader_id: reader.id")
  })

  it("leaves online hosted Stripe checkout unchanged", () => {
    expect(hostedCheckout).toContain("<StripeCardPayment")
    expect(hostedCheckout).toContain('asset.network === "stripe"')
    expect(hostedCheckout).toContain("handleStripePay()")
  })

  it("keeps Cash and Crypto handlers wired", () => {
    expect(pos).toContain("function startCash()")
    expect(pos).toContain("onClick={startCash}")
    expect(pos).toContain("async function startCrypto()")
    expect(pos).toContain("onClick={startCrypto}")
  })
})
