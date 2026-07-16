import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), createManual: vi.fn() }))

vi.mock("@/lib/api/stripeTerminalAuth", () => ({ requireStripeCardMerchant: mocks.auth }))
vi.mock("@/lib/api/merchantAuth", () => ({
  getRouteErrorStatus: (error: unknown) => typeof error === "object" && error && "status" in error ? Number((error as { status: number }).status) : 500
}))
vi.mock("@/engine/stripeTerminal", () => ({ createManualEntryPaymentEngine: mocks.createManual }))

import { POST } from "@/app/api/payments/stripe/manual/route"

describe("authenticated Stripe manual-entry configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ merchantId: "merchant_session", terminalId: "pos_terminal_1" })
    mocks.createManual.mockResolvedValue({
      paymentId: "pay_manual",
      clientSecret: "pi_manual_secret_short_lived",
      stripeAccountId: "acct_connected_context",
      status: "PENDING",
      secretKey: "sk_test_must_not_leak",
      webhookSecret: "whsec_must_not_leak",
      credentials: { stripe_account_id: "acct_unrelated" }
    })
  })

  it("returns only the direct-charge account context and payment-session fields", async () => {
    const request = new NextRequest("https://app.test/api/payments/stripe/manual", {
      method: "POST",
      headers: { Authorization: "Bearer terminal-session", "Content-Type": "application/json" },
      body: JSON.stringify({ merchantId: "attacker", accountId: "acct_attacker", amount: 12 })
    })
    const response = await POST(request)
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store, private")
    const payload = await response.json()
    expect(payload).toEqual({ paymentId: "pay_manual", clientSecret: "pi_manual_secret_short_lived", stripeAccountId: "acct_connected_context", status: "PENDING" })
    expect(JSON.stringify(payload)).not.toMatch(/sk_test|whsec|credentials|acct_attacker|acct_unrelated/)
    expect(mocks.createManual).toHaveBeenCalledWith(expect.objectContaining({ merchantId: "merchant_session", posTerminalId: "pos_terminal_1" }))
  })

  it("rejects unauthenticated callers before creating a PaymentIntent", async () => {
    mocks.auth.mockRejectedValue(Object.assign(new Error("Unauthorized"), { status: 401 }))
    const response = await POST(new NextRequest("https://app.test/api/payments/stripe/manual", { method: "POST", body: "{}" }))
    expect(response.status).toBe(401)
    expect(mocks.createManual).not.toHaveBeenCalled()
  })
})
