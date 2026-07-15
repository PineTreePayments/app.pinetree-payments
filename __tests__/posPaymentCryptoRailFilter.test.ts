import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regression coverage for the actual, live root cause of "Stripe appears
 * inside Crypto": components/pos/POSLayout.tsx's "Crypto" button posts to
 * /api/pos/payment with no `network` field, which engine/posPayments.ts's
 * createPosPaymentIntentEngine previously translated into
 * `allowedNetworks: undefined` - createPaymentIntentEngine treats that as
 * "no restriction," so the resulting intent (and its QR-linked
 * /pay?intent=... "Choose Payment Asset" screen) included every network the
 * merchant had enabled, including Stripe, even though the cashier tapped
 * "Crypto." The "Card" button was never affected - it always explicitly
 * passed `preferredNetwork: "stripe"`.
 */

vi.mock("@/engine/createPayment", () => ({ createPayment: vi.fn() }))
vi.mock("@/database/merchants", () => ({ getMerchantTaxSettings: vi.fn() }))
vi.mock("@/database/merchantWallets", () => ({
  hasAnyWalletConnected: vi.fn(),
  selectBestWallet: vi.fn(),
}))
// engine/posPayments.ts's calculatePosTotalsForTerminal reads terminal tax
// config directly via db.from("terminals")... - stub a minimal chainable
// client that resolves to "no tax configured" so the crypto-rail-filter
// call under test is reached without a real database.
const fakeDb = {
  from: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { tax_mode: "none", tax_rate: null, tax_label: "Sales tax" },
            error: null,
          }),
        }),
      }),
    }),
  }),
}
vi.mock("@/database", () => ({
  getPaymentById: vi.fn(),
  supabase: fakeDb,
  supabaseAdmin: fakeDb,
}))
vi.mock("@/engine/providerSelector", () => ({ chooseBestAdapter: vi.fn() }))
vi.mock("@/engine/posTotals", () => ({
  calculatePosTotals: vi.fn().mockReturnValue({
    subtotalAmount: 10,
    taxAmount: 0,
    taxRate: 0,
    serviceFee: 0,
    totalAmount: 10,
  }),
}))

const createPaymentIntentEngine = vi.fn().mockResolvedValue({
  intentId: "intent-1",
  checkoutUrl: "https://app.test/pay?intent=intent-1",
  qrCodeUrl: "data:image/png;base64,",
  availableNetworks: [],
})
vi.mock("@/engine/paymentIntents", () => ({ createPaymentIntentEngine }))

describe("createPosPaymentIntentEngine - crypto rail filter regression", () => {
  beforeEach(() => {
    createPaymentIntentEngine.mockClear()
  })

  it("restricts the intent to crypto-only rails when the cashier taps Crypto (no preferredNetwork sent)", async () => {
    const { createPosPaymentIntentEngine } = await import("@/engine/posPayments")

    await createPosPaymentIntentEngine({
      amount: 10,
      currency: "USD",
      terminal: { merchantId: "merchant-1", terminalId: "terminal-1" },
    })

    expect(createPaymentIntentEngine).toHaveBeenCalledTimes(1)
    const call = createPaymentIntentEngine.mock.calls[0][0]
    expect(call.allowedNetworks).toEqual(["solana", "base", "bitcoin_lightning"])
    // The whole point of the bug: allowedNetworks must never be undefined
    // for the crypto tap, since undefined means "no restriction" downstream.
    expect(call.allowedNetworks).not.toBeUndefined()
    expect(call.allowedNetworks).not.toContain("stripe")
    expect(call.allowedNetworks).not.toContain("shift4")
  })

  it("still restricts the intent to exactly [\"stripe\"] when the cashier taps Card (preferredNetwork: stripe)", async () => {
    const { createPosPaymentIntentEngine } = await import("@/engine/posPayments")

    await createPosPaymentIntentEngine({
      amount: 10,
      currency: "USD",
      terminal: { merchantId: "merchant-1", terminalId: "terminal-1", preferredNetwork: "stripe" },
    })

    const call = createPaymentIntentEngine.mock.calls[0][0]
    expect(call.allowedNetworks).toEqual(["stripe"])
  })
})
