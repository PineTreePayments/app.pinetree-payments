import { afterEach, describe, expect, it, vi } from "vitest"
import { normalizeReportNetwork } from "@/engine/reportDisplayNormalization"
import {
  cashTransactionSecondaryLabel,
  formatTransactionProviderLabel
} from "@/lib/transactionRailDisplay"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("cash transaction rail display", () => {
  it("uses USD as the shared cash secondary label", () => {
    expect(cashTransactionSecondaryLabel("cash")).toBe("USD")
    expect(cashTransactionSecondaryLabel("base")).toBeNull()
  })

  it("uses USD in report and export network fields", () => {
    expect(normalizeReportNetwork(null, "cash")).toBe("USD")
    expect(normalizeReportNetwork("cash", "cash")).toBe("USD")
  })

  it("provides the Cash and USD labels consumed by generated receipts", () => {
    expect(formatTransactionProviderLabel("cash")).toBe("Cash")
    expect(cashTransactionSecondaryLabel("cash")).toBe("USD")
  })

  it("renders Cash and USD in receipt HTML", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key")

    const { renderReceiptHtml } = await import("@/engine/receipts")
    const html = renderReceiptHtml({
      paymentId: "payment-id",
      transactionId: "transaction-id",
      businessName: "Merchant",
      businessAddress: null,
      createdAt: "2026-06-10T12:00:00Z",
      amount: 10,
      currency: "USD",
      provider: "cash",
      network: null,
      status: "CONFIRMED",
      reference: "cash-reference",
      footer: null
    })

    expect(html).toContain("<dd>Cash</dd>")
    expect(html).toContain("<dd>USD</dd>")
  })
})
