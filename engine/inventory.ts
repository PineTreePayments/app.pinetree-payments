import {
  createInventoryItem,
  listInventoryItems,
  updateInventoryItem,
  type InventoryItem,
  type InventoryItemInput
} from "@/database"

function requiredText(value: unknown, label: string, maxLength = 160) {
  const normalized = String(value || "").trim()
  if (!normalized) throw new Error(`${label} is required`)
  if (normalized.length > maxLength) throw new Error(`${label} is too long`)
  return normalized
}

function optionalText(value: unknown, maxLength = 160) {
  const normalized = String(value || "").trim()
  if (!normalized) return null
  if (normalized.length > maxLength) throw new Error("Inventory field is too long")
  return normalized
}

function nonNegativeNumber(value: unknown, label: string) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${label} must be zero or greater`)
  }
  return number
}

function nonNegativeInteger(value: unknown, label: string) {
  const number = nonNegativeNumber(value, label)
  if (!Number.isInteger(number)) throw new Error(`${label} must be a whole number`)
  return number
}

function normalizeInput(body: Record<string, unknown>): InventoryItemInput {
  const costValue = body.cost === "" || body.cost === null || body.cost === undefined
    ? null
    : nonNegativeNumber(body.cost, "Cost")

  return {
    name: requiredText(body.name, "Item name"),
    sku: optionalText(body.sku, 80),
    category: optionalText(body.category, 80),
    price: nonNegativeNumber(body.price, "Price"),
    cost: costValue,
    quantity: nonNegativeInteger(body.quantity, "Quantity"),
    low_stock_threshold: nonNegativeInteger(body.lowStockThreshold, "Low-stock threshold")
  }
}

function summarize(items: InventoryItem[]) {
  const activeItems = items.filter((item) => item.status === "ACTIVE")
  const lowStock = activeItems.filter(
    (item) => item.quantity > 0 && item.quantity <= item.low_stock_threshold
  )
  const outOfStock = activeItems.filter((item) => item.quantity === 0)

  return {
    totalItems: activeItems.length,
    lowStock: lowStock.length,
    outOfStock: outOfStock.length,
    inventoryValue: activeItems.reduce(
      (sum, item) => sum + Number(item.cost ?? item.price) * item.quantity,
      0
    ),
    lastUpdatedAt: items[0]?.updated_at || null
  }
}

export async function getInventoryEngine(merchantId: string) {
  const result = await listInventoryItems(merchantId)
  return {
    available: result.available,
    items: result.items,
    summary: summarize(result.items)
  }
}

export async function createInventoryItemEngine(
  merchantId: string,
  body: Record<string, unknown>
) {
  return createInventoryItem(merchantId, normalizeInput(body))
}

export async function updateInventoryItemEngine(
  merchantId: string,
  itemId: string,
  body: Record<string, unknown>
) {
  requiredText(itemId, "Item ID")
  return updateInventoryItem(merchantId, itemId, normalizeInput(body))
}

export async function archiveInventoryItemEngine(merchantId: string, itemId: string) {
  requiredText(itemId, "Item ID")
  return updateInventoryItem(merchantId, itemId, { status: "ARCHIVED" })
}
