import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { calculatePosTotals, normalizeTerminalTaxConfig } from "@/engine/posTotals"

describe("shared POS total calculation", () => {
  it("calculates a no-tax cash total", () => {
    expect(calculatePosTotals({
      subtotalAmount: 10,
      terminalTax: { taxMode: "none", taxRate: null, taxLabel: "Sales tax" },
      serviceFee: 0.15
    })).toMatchObject({ taxAmount: 0, totalAmount: 10.15 })
  })

  it("calculates custom tax consistently for cash and crypto POS flows", () => {
    const input = {
      subtotalAmount: 10,
      terminalTax: { taxMode: "custom" as const, taxRate: 8.25, taxLabel: "Sales tax" },
      serviceFee: 0.15
    }
    const cash = calculatePosTotals(input)
    const crypto = calculatePosTotals(input)
    expect(cash).toEqual(crypto)
    expect(cash).toMatchObject({ taxAmount: 0.83, taxRate: 8.25, totalAmount: 10.98 })
  })

  it("uses a valid merchant default tax rate", () => {
    expect(calculatePosTotals({
      subtotalAmount: 20,
      terminalTax: { taxMode: "merchant_default", taxRate: null, taxLabel: "Sales tax" },
      merchantDefaultTaxRate: 7.5,
      serviceFee: 0.15
    })).toMatchObject({ taxAmount: 1.5, totalAmount: 21.65 })
  })

  it("rejects invalid custom terminal tax configuration", () => {
    expect(() => normalizeTerminalTaxConfig({ taxMode: "custom", taxRate: 0 })).toThrow("Custom tax rate")
  })

  it("routes cash, crypto, and preview totals through terminal tax calculation", () => {
    const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8")
    const payments = read("engine/posPayments.ts")
    const cashRoute = read("app/api/pos/drawer/sale/route.ts")
    const breakdownRoute = read("app/api/pos/breakdown/route.ts")

    expect(payments.match(/calculatePosTotalsForTerminal\(/g)?.length).toBeGreaterThanOrEqual(4)
    expect(cashRoute).toContain("calculatePosTotalsForTerminal(merchantId, terminalId, subtotalAmount)")
    expect(breakdownRoute).toContain("previewPosBreakdownEngine(merchantId, terminalId, amount)")
  })

  it("uses unbranded service fee labels on payment surfaces", () => {
    const files = [
      "components/pos/POSLayout.tsx",
      "app/pay/PayClient.tsx",
      "lib/help/helpContent.ts",
      "lib/help/pinetreeAssistant.ts"
    ].map((file) => fs.readFileSync(path.join(process.cwd(), file), "utf8")).join("\n")

    expect(files).toContain("Service fee")
    expect(files).not.toMatch(/PineTree Service Fee|PineTree service fee|PineTree fee/)
  })
})
