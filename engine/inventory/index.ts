import {
  createInventoryMovement,
  createInventoryItem,
  deleteInventoryItem,
  listInventoryItems,
  listInventoryMovements,
  updateInventoryItem,
  type InventoryItem,
  type InventoryItemInput
} from "@/database"
import {
  deriveInventoryStatus,
  merchantVisibleInventoryItems,
  merchantVisibleInventoryMovements,
  summarizeInventory,
  type InventoryEffectiveStatus
} from "../inventoryLogic"
import { listInventoryIntegrationStatuses } from "./integrations"

export type InventoryItemView = InventoryItem & { effective_status: InventoryEffectiveStatus }

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

export function normalizeInventoryInput(body: Record<string, unknown>): InventoryItemInput {
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

export async function getInventoryEngine(merchantId: string) {
  const [result, movementResult, integrations] = await Promise.all([
    listInventoryItems(merchantId),
    listInventoryMovements(merchantId),
    listInventoryIntegrationStatuses(merchantId)
  ])
  const merchantVisibleItems = merchantVisibleInventoryItems(result.items)
  const merchantVisibleItemIds = new Set(merchantVisibleItems.map((item) => item.id))
  const merchantVisibleMovements = merchantVisibleInventoryMovements(
    movementResult.movements,
    merchantVisibleItemIds
  )

  return {
    available: result.available && movementResult.available,
    movementsAvailable: movementResult.available,
    integrationsAvailable: true,
    items: merchantVisibleItems.map((item): InventoryItemView => ({
      ...item,
      effective_status: deriveInventoryStatus(item)
    })),
    summary: summarizeInventory(merchantVisibleItems),
    movements: merchantVisibleMovements,
    integrations
  }
}

export async function createInventoryItemEngine(
  merchantId: string,
  body: Record<string, unknown>
) {
  const input = normalizeInventoryInput(body)
  const item = await createInventoryItem(merchantId, input)
  await createInventoryMovement(
    merchantId,
    item.id,
    "CREATE",
    item.quantity,
    "Inventory item created"
  )
  return { ...item, effective_status: deriveInventoryStatus(item) }
}

export async function updateInventoryItemEngine(
  merchantId: string,
  itemId: string,
  body: Record<string, unknown>
) {
  requiredText(itemId, "Item ID")
  const current = (await listInventoryItems(merchantId)).items.find((item) => item.id === itemId)
  if (!current) throw new Error("Inventory item not found")

  const input = normalizeInventoryInput(body)
  const item = await updateInventoryItem(merchantId, itemId, input)
  const quantityDelta = item.quantity - current.quantity
  if (quantityDelta !== 0) {
    await createInventoryMovement(
      merchantId,
      item.id,
      "ADJUST",
      quantityDelta,
      optionalText(body.adjustmentReason, 240) || "Quantity updated from inventory editor"
    )
  }
  return { ...item, effective_status: deriveInventoryStatus(item) }
}

export async function deleteInventoryItemEngine(merchantId: string, itemId: string) {
  requiredText(itemId, "Item ID")
  const item = await deleteInventoryItem(merchantId, itemId)
  if (!item) throw new Error("Inventory item not found")
  return item
}
