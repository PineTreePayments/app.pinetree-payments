import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("mobile dashboard hero cleanup", () => {
  it("uses setup wording when Online Checkout has no active configuration", () => {
    const checkout = read("app/dashboard/checkout/page.tsx")

    expect(checkout).toContain(': "Set up checkout"')
    expect(checkout).toContain("Create a payment link or add a checkout button to start accepting online payments.")
    expect(checkout).not.toContain('? "Needs attention"')
  })

  it("keeps the POS terminal action compact", () => {
    const pos = read("app/dashboard/pos/page.tsx")
    const action = pos.match(/<button[\s\S]*?onClick=\{startCreatingTerminal\}[\s\S]*?<\/button>/)?.[0] ?? ""

    expect(action).toContain("rounded-full")
    expect(action).toContain("px-4 py-2")
    expect(action).toContain("self-end")
    expect(action).not.toContain("w-full")
  })

  it("shows Inventory metrics without a duplicate hero value", () => {
    const inventory = read("app/dashboard/inventory/page.tsx")

    expect(inventory).not.toContain("value={summary.catalogItems}")
    expect(inventory).toContain('label="Active items"')
    expect(inventory).toContain('label="Low stock"')
    expect(inventory).toContain('label="Out of stock"')
    expect(inventory).toContain('label="Inventory value"')
  })

  it("combines Wallets metrics in one divided summary card", () => {
    const wallets = read("app/dashboard/wallets/page.tsx")
    const summary = wallets.match(/<div\s+data-wallet-summary[\s\S]*?<\/div>/)?.[0] ?? ""

    expect(summary).toContain("grid-cols-2")
    expect(summary).toContain("divide-x")
    expect(summary).toContain('label="Connections"')
    expect(summary).toContain('label="Total Value"')
    expect(wallets).not.toContain("<CompactMetricTile")
  })
})
