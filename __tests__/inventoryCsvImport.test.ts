import { describe, expect, it } from "vitest"

import { parseCsv, validateInventoryCsv } from "@/engine/inventoryCsvLogic"

describe("inventory CSV parsing", () => {
  it("parses quoted commas", () => {
    expect(parseCsv("name,category\n\"Coffee, Large\",Drinks")).toEqual([
      ["name", "category"],
      ["Coffee, Large", "Drinks"]
    ])
  })

  it("requires a name header", () => {
    const result = validateInventoryCsv("sku,price\nABC,10")
    expect(result.rows).toHaveLength(0)
    expect(result.errors[0]?.message).toContain("name")
  })

  it("validates row numbers and non-negative numeric fields", () => {
    const result = validateInventoryCsv("name,price,quantity\nCoffee,-1,2\nTea,3,1.5")
    expect(result.rows).toHaveLength(0)
    expect(result.errors).toEqual([
      { row: 2, message: "Price must be zero or greater" },
      { row: 3, message: "Quantity must be a non-negative whole number" }
    ])
  })

  it("normalizes optional fields and defaults low stock threshold", () => {
    const result = validateInventoryCsv("name,sku,price,quantity\nCoffee,C1,4.50,8")
    expect(result.errors).toEqual([])
    expect(result.rows[0]).toMatchObject({
      name: "Coffee",
      sku: "C1",
      price: 4.5,
      quantity: 8,
      low_stock_threshold: 5
    })
  })
})
