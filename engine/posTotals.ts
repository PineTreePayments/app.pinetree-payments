import { calculateTax } from "./fees"

export type TerminalTaxMode = "none" | "merchant_default" | "custom"

export type TerminalTaxConfig = {
  taxMode: TerminalTaxMode
  taxRate: number | null
  taxLabel: string
}

export type PosTotalBreakdown = {
  subtotalAmount: number
  taxAmount: number
  taxRate: number
  taxEnabled: boolean
  serviceFee: number
  grossAmount: number
  totalAmount: number
}

export function normalizeTerminalTaxConfig(input: {
  taxMode?: unknown
  taxRate?: unknown
  taxLabel?: unknown
}): TerminalTaxConfig {
  const taxMode = String(input.taxMode || "none") as TerminalTaxMode
  if (!(["none", "merchant_default", "custom"] as string[]).includes(taxMode)) {
    throw new Error("Select a valid tax configuration")
  }

  const parsedRate = input.taxRate === null || input.taxRate === undefined || input.taxRate === ""
    ? null
    : Number(input.taxRate)

  if (taxMode === "custom" && (parsedRate === null || !Number.isFinite(parsedRate) || parsedRate <= 0 || parsedRate > 100)) {
    throw new Error("Custom tax rate must be greater than 0 and no more than 100")
  }

  return {
    taxMode,
    taxRate: taxMode === "custom" ? parsedRate : null,
    taxLabel: String(input.taxLabel || "Sales tax").trim() || "Sales tax"
  }
}

export function calculatePosTotals(input: {
  subtotalAmount: number
  terminalTax: TerminalTaxConfig
  merchantDefaultTaxRate?: number | null
  serviceFee: number
}): PosTotalBreakdown {
  const subtotalAmount = Number(input.subtotalAmount)
  if (!Number.isFinite(subtotalAmount) || subtotalAmount <= 0) {
    throw new Error("Invalid amount")
  }

  let taxRate = 0
  if (input.terminalTax.taxMode === "custom") {
    taxRate = Number(input.terminalTax.taxRate || 0)
  } else if (input.terminalTax.taxMode === "merchant_default") {
    taxRate = Number(input.merchantDefaultTaxRate || 0)
    if (!Number.isFinite(taxRate) || taxRate <= 0 || taxRate > 100) {
      throw new Error("No valid default tax rate is configured")
    }
  }

  const taxAmount = taxRate > 0 ? Math.round(calculateTax(subtotalAmount, taxRate) * 100) / 100 : 0
  const serviceFee = Math.round(Number(input.serviceFee || 0) * 100) / 100
  const totalAmount = Math.round((subtotalAmount + taxAmount + serviceFee) * 100) / 100

  return {
    subtotalAmount,
    taxAmount,
    taxRate,
    taxEnabled: taxRate > 0,
    serviceFee,
    grossAmount: totalAmount,
    totalAmount
  }
}
