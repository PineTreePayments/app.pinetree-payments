import {
  createInventoryMovement,
  createInventoryItem,
  listInventoryIntegrations,
  listInventoryItems,
  listInventoryMovements,
  updateInventoryItem,
  type InventoryItem,
  type InventoryItemInput,
  type InventoryIntegration,
  type InventoryIntegrationStatus
} from "@/database"
import {
  deriveInventoryStatus,
  summarizeInventory,
  type InventoryEffectiveStatus
} from "./inventoryLogic"

export type InventoryItemView = InventoryItem & { effective_status: InventoryEffectiveStatus }

const INVENTORY_PROVIDERS = [
  { provider: "SHIFT4_SKYTAB", label: "Shift4 / SkyTab" },
  { provider: "CLOVER", label: "Clover" },
  { provider: "SQUARE", label: "Square" },
  { provider: "SHOPIFY", label: "Shopify" },
  { provider: "MANUAL_CSV", label: "Manual CSV Import" }
] as const

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

function integrationViews(records: InventoryIntegration[]) {
  const byProvider = new Map(records.map((record) => [record.provider, record]))
  return INVENTORY_PROVIDERS.map(({ provider, label }) => {
    const record = byProvider.get(provider)
    const status: InventoryIntegrationStatus = record?.status || "PLANNED"
    return {
      provider,
      label,
      status,
      lastSyncAt: record?.last_sync_at || null
    }
  })
}

export async function getInventoryEngine(merchantId: string) {
  const [result, movementResult, integrationResult] = await Promise.all([
    listInventoryItems(merchantId),
    listInventoryMovements(merchantId),
    listInventoryIntegrations(merchantId)
  ])

  return {
    available: result.available && movementResult.available && integrationResult.available,
    movementsAvailable: movementResult.available,
    integrationsAvailable: integrationResult.available,
    items: result.items.map((item): InventoryItemView => ({
      ...item,
      effective_status: deriveInventoryStatus(item)
    })),
    summary: summarizeInventory(result.items),
    movements: movementResult.movements,
    integrations: integrationViews(integrationResult.integrations)
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

export async function archiveInventoryItemEngine(merchantId: string, itemId: string) {
  requiredText(itemId, "Item ID")
  const current = (await listInventoryItems(merchantId)).items.find((item) => item.id === itemId)
  if (!current) throw new Error("Inventory item not found")
  if (current.status === "ARCHIVED") return { ...current, effective_status: "ARCHIVED" as const }

  const item = await updateInventoryItem(merchantId, itemId, { status: "ARCHIVED" })
  await createInventoryMovement(merchantId, item.id, "ARCHIVE", 0, "Inventory item archived")
  return { ...item, effective_status: "ARCHIVED" as const }
}

export async function restoreInventoryItemEngine(merchantId: string, itemId: string) {
  requiredText(itemId, "Item ID")
  const current = (await listInventoryItems(merchantId)).items.find((item) => item.id === itemId)
  if (!current) throw new Error("Inventory item not found")

  const item = await updateInventoryItem(merchantId, itemId, { status: "ACTIVE" })
  if (current.status === "ARCHIVED") {
    await createInventoryMovement(merchantId, item.id, "RESTORE", 0, "Inventory item restored")
  }
  return { ...item, effective_status: deriveInventoryStatus(item) }
}
