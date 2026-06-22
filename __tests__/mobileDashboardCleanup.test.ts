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

  it("shows readable Online Checkout metrics in an integrated split row", () => {
    const checkout = read("app/dashboard/checkout/page.tsx")
    const metrics = checkout.match(/data-checkout-hero-metrics[\s\S]*?\.map/)?.[0] ?? ""

    expect(metrics).toContain('"Active links", isLoading ? "—" : String(activeLinks)')
    expect(metrics).toContain('"Button", activeLinks > 0 ? "Ready" : "Set up"')
    expect(metrics).toContain('"Activity", isLoading ? "—" : String(stats?.confirmedPayments ?? 0)')
    expect(metrics).not.toContain("truncate")
    expect(metrics).not.toContain("text-ellipsis")
    expect(metrics).toContain("grid-cols-3")
    expect(metrics).toContain("divide-x")
    expect(metrics).toContain("border-t")
    expect(metrics).not.toContain("overflow-hidden")
    expect(metrics).not.toContain("rounded-full")
    expect(checkout).toContain('className="mt-1 text-xl font-semibold leading-tight text-gray-950">{value}</p>')
    expect(checkout).not.toContain('text-gray-950 sm:text-2xl">{value}</p>')
    expect(checkout).not.toContain("BUTTON S...")
    expect(checkout).not.toContain("RECENT ACTI...")
  })

  it("integrates Transactions hero metrics without an inner box", () => {
    const transactions = read("app/dashboard/transactions/page.tsx")
    const metrics = transactions.match(/data-transactions-hero-metrics[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? ""

    expect(metrics).toContain("Transactions")
    expect(metrics).toContain("Success Rate")
    expect(metrics).toContain("divide-x")
    expect(metrics).toContain("border-t")
    expect(metrics).not.toContain("rounded-xl")
    expect(metrics).not.toContain("bg-white")
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
