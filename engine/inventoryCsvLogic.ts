import type { InventoryItemInput } from "@/database/inventoryItems"

const OPTIONAL_HEADERS = [
  "sku",
  "category",
  "price",
  "cost",
  "quantity",
  "low_stock_threshold"
] as const

export type CsvInventoryRow = InventoryItemInput & { rowNumber: number }
export type CsvValidationResult = {
  rows: CsvInventoryRow[]
  errors: Array<{ row: number; message: string }>
}

export function parseCsv(text: string) {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]
    if (char === "\"" && quoted && next === "\"") {
      field += "\""
      index += 1
    } else if (char === "\"") {
      quoted = !quoted
    } else if (char === "," && !quoted) {
      row.push(field)
      field = ""
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1
      row.push(field)
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      field = ""
    } else {
      field += char
    }
  }
  row.push(field)
  if (row.some((value) => value.trim())) rows.push(row)
  return rows
}

function numberField(value: string | undefined, label: string, integer = false) {
  if (!String(value || "").trim()) return 0
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || (integer && !Number.isInteger(parsed))) {
    throw new Error(`${label} must be ${integer ? "a non-negative whole number" : "zero or greater"}`)
  }
  return parsed
}

export function validateInventoryCsv(text: string): CsvValidationResult {
  const parsed = parseCsv(text)
  if (!parsed.length) return { rows: [], errors: [{ row: 1, message: "CSV file is empty" }] }

  const headers = parsed[0].map((header) => header.trim().toLowerCase())
  if (!headers.includes("name")) {
    return { rows: [], errors: [{ row: 1, message: "Required header \"name\" is missing" }] }
  }
  const allowed = new Set<string>(["name", ...OPTIONAL_HEADERS])
  const unknown = headers.filter((header) => header && !allowed.has(header))
  if (unknown.length) {
    return { rows: [], errors: [{ row: 1, message: `Unsupported headers: ${unknown.join(", ")}` }] }
  }

  const rows: CsvInventoryRow[] = []
  const errors: Array<{ row: number; message: string }> = []
  parsed.slice(1).forEach((values, index) => {
    const rowNumber = index + 2
    const record = Object.fromEntries(headers.map((header, column) => [header, values[column]?.trim() || ""]))
    try {
      const name = record.name
      if (!name) throw new Error("Name is required")
      if (name.length > 160) throw new Error("Name is too long")
      rows.push({
        rowNumber,
        name,
        sku: record.sku || null,
        category: record.category || null,
        price: numberField(record.price, "Price"),
        cost: record.cost ? numberField(record.cost, "Cost") : null,
        quantity: numberField(record.quantity, "Quantity", true),
        low_stock_threshold: record.low_stock_threshold
          ? numberField(record.low_stock_threshold, "Low-stock threshold", true)
          : 5
      })
    } catch (error) {
      errors.push({ row: rowNumber, message: error instanceof Error ? error.message : "Invalid row" })
    }
  })
  return { rows, errors }
}
