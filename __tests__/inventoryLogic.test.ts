import { describe, expect, it } from "vitest"

import {
  deriveInventoryStatus,
  merchantVisibleInventoryItems,
  merchantVisibleInventoryMovements,
  summarizeInventory
} from "@/engine/inventoryLogic"

type TestItem = {
  status: "ACTIVE" | "ARCHIVED"
  quantity: number
  low_stock_threshold: number
  cost: number | null
  price: number
  updated_at: string
  id: string
}

function item(overrides: Partial<TestItem> = {}): TestItem {
  return {
    id: "item-1",
    price: 5,
    cost: 2,
    quantity: 10,
    low_stock_threshold: 3,
    status: "ACTIVE",
    updated_at: "2026-06-07T12:00:00.000Z",
    ...overrides
  }
}

describe("inventory stock status", () => {
  it("keeps archived status regardless of quantity", () => {
    expect(deriveInventoryStatus(item({ status: "ARCHIVED", quantity: 0 }))).toBe("ARCHIVED")
  })

  it("derives out of stock at zero quantity", () => {
    expect(deriveInventoryStatus(item({ quantity: 0 }))).toBe("OUT_OF_STOCK")
  })

  it("derives low stock at or below the threshold", () => {
    expect(deriveInventoryStatus(item({ quantity: 3, low_stock_threshold: 3 }))).toBe("LOW_STOCK")
    expect(deriveInventoryStatus(item({ quantity: 2, low_stock_threshold: 3 }))).toBe("LOW_STOCK")
  })

  it("derives active above the threshold", () => {
    expect(deriveInventoryStatus(item({ quantity: 4, low_stock_threshold: 3 }))).toBe("ACTIVE")
  })
})

describe("inventory summary", () => {
  it("removes archived items and archive history from merchant-facing inventory", () => {
    const visibleItems = merchantVisibleInventoryItems([
      { id: "active-item", status: "ACTIVE" as const },
      { id: "archived-item", status: "ARCHIVED" as const }
    ])

    expect(visibleItems).toEqual([{ id: "active-item", status: "ACTIVE" }])

    const visibleMovements = merchantVisibleInventoryMovements(
      [
        { item_id: "active-item", type: "SALE" },
        { item_id: "active-item", type: "RESTORE" },
        { item_id: "archived-item", type: "ARCHIVE" }
      ],
      new Set(visibleItems.map((entry) => entry.id))
    )

    expect(visibleMovements).toEqual([{ item_id: "active-item", type: "SALE" }])
  })

  it("excludes archived items from active counts and value", () => {
    const summary = summarizeInventory([
      item({ id: "active", quantity: 4, cost: 2 }),
      item({ id: "low", quantity: 2, low_stock_threshold: 3, cost: null, price: 5 }),
      item({ id: "out", quantity: 0 }),
      item({ id: "archived", status: "ARCHIVED", quantity: 100, cost: 20 })
    ])

    expect(summary.catalogItems).toBe(4)
    expect(summary.activeItems).toBe(3)
    expect(summary.totalItems).toBe(3)
    expect(summary.lowStock).toBe(1)
    expect(summary.outOfStock).toBe(1)
    expect(summary.inventoryValue).toBe(18)
  })
})
