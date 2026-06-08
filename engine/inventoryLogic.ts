export type InventoryStoredStatus = "ACTIVE" | "ARCHIVED"
export type InventoryEffectiveStatus = "ACTIVE" | "LOW_STOCK" | "OUT_OF_STOCK" | "ARCHIVED"

export type InventoryStockFields = {
  status: InventoryStoredStatus
  quantity: number
  low_stock_threshold: number
}

export type InventorySummaryFields = InventoryStockFields & {
  cost: number | null
  price: number
  updated_at: string
}

export function deriveInventoryStatus(item: InventoryStockFields): InventoryEffectiveStatus {
  if (item.status === "ARCHIVED") return "ARCHIVED"
  if (item.quantity <= 0) return "OUT_OF_STOCK"
  if (item.quantity <= item.low_stock_threshold) return "LOW_STOCK"
  return "ACTIVE"
}

export function merchantVisibleInventoryItems<T extends { status: InventoryStoredStatus }>(
  items: T[]
): T[] {
  return items.filter((item) => item.status !== "ARCHIVED")
}

export function merchantVisibleInventoryMovements<T extends { item_id: string; type: string }>(
  movements: T[],
  visibleItemIds: Set<string>
): T[] {
  return movements.filter(
    (movement) =>
      visibleItemIds.has(movement.item_id) &&
      movement.type !== "ARCHIVE" &&
      movement.type !== "RESTORE"
  )
}

export function summarizeInventory(items: InventorySummaryFields[]) {
  const activeItems = items.filter((item) => item.status !== "ARCHIVED")
  const views = activeItems.map((item) => ({
    item,
    status: deriveInventoryStatus(item)
  }))

  return {
    catalogItems: items.length,
    activeItems: activeItems.length,
    totalItems: activeItems.length,
    lowStock: views.filter((entry) => entry.status === "LOW_STOCK").length,
    outOfStock: views.filter((entry) => entry.status === "OUT_OF_STOCK").length,
    inventoryValue: activeItems.reduce(
      (sum, item) => sum + Number(item.cost ?? item.price) * item.quantity,
      0
    ),
    lastUpdatedAt: items[0]?.updated_at || null
  }
}
