import {
  createInventoryItem,
  createInventoryMovement,
  listInventoryItems,
} from "@/database"
import { validateInventoryCsv } from "../inventoryCsvLogic"

export async function importInventoryCsv(merchantId: string, text: string) {
  const validation = validateInventoryCsv(text)
  const existing = await listInventoryItems(merchantId)
  if (!existing.available) throw new Error("Inventory database migration required")
  const existingSkus = new Set(
    existing.items.map((item) => String(item.sku || "").trim().toLowerCase()).filter(Boolean)
  )
  const seenSkus = new Set(existingSkus)
  let created = 0
  let skipped = 0
  const errors = [...validation.errors]

  for (const row of validation.rows) {
    const sku = String(row.sku || "").trim().toLowerCase()
    if (sku && seenSkus.has(sku)) {
      skipped += 1
      errors.push({ row: row.rowNumber, message: `SKU ${row.sku} already exists; row skipped` })
      continue
    }
    try {
      const item = await createInventoryItem(merchantId, row)
      await createInventoryMovement(
        merchantId,
        item.id,
        "IMPORT",
        item.quantity,
        "Created by manual CSV import",
        { source: "MANUAL_CSV", row: row.rowNumber }
      )
      if (sku) seenSkus.add(sku)
      created += 1
    } catch (error) {
      errors.push({
        row: row.rowNumber,
        message: error instanceof Error ? error.message : "Import failed"
      })
    }
  }

  return { created, skipped, errors }
}
