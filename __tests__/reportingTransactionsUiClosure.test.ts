import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8")

describe("reporting and transaction UI closure", () => {
  it("exposes every server-supported report period and reuses one boundary builder for visible and exported reports", () => {
    const page = read("app/dashboard/reports/page.tsx")
    for (const period of ["end_of_day", "today", "weekly", "month", "year", "custom"]) {
      expect(page).toContain(`value: "${period}"`)
    }
    expect(page).toContain("reportQuery(period, activeStart, activeEnd)")
    expect(page).toContain('params.set("format", format)')
    expect(page).toContain("providerMatchesGross")
    expect(page).toContain("transactionsTruncated")
  })

  it("persists lightweight transaction filters in the URL and requests stable server pagination", () => {
    const page = read("app/dashboard/transactions/page.tsx")
    const engine = read("engine/transactionsDashboard.ts")
    const canonicalDatabase = read("database/canonicalTransactions.ts")
    const canonicalEngine = read("engine/canonicalTransactions.ts")
    for (const filter of ["network", "time"]) {
      expect(page).toContain(`setFilter("${filter}"`)
    }
    for (const removedFilter of ["provider", "channel", "status", "rail", "asset", "currency", "source", "method"]) {
      expect(page).not.toContain(`setFilter("${removedFilter}"`)
    }
    expect(page).toContain('params.set("timeFilter", timeFilter)')
    expect(page).not.toContain("getTimeFilterBounds(timeFilter)")
    expect(page).not.toContain('params.set("startDate", timeBounds.startDate)')
    expect(page).not.toContain('params.set("endDate", timeBounds.endDate)')
    expect(page).toContain("window.history.replaceState")
    expect(engine).toContain("getCanonicalTransactionPage({")
    expect(engine).toContain("getAllCanonicalTransactions({")
    expect(engine).toContain('scope: { type: "merchant", merchantId }')
    expect(canonicalDatabase).toContain('.from("payments")')
    expect(canonicalDatabase).toContain('.order("created_at", { ascending: false })')
    expect(canonicalDatabase).toContain('.order("id", { ascending: false })')
    expect(canonicalDatabase).not.toContain('.from("transactions")')
    expect(canonicalDatabase).not.toContain('metadata->>selectedAsset.eq.${asset}')
    expect(canonicalDatabase).toContain('query.eq("status", statuses[0])')
    expect(canonicalEngine).toContain("hasCanonicalProjectionFilters(input)")
    expect(canonicalEngine).toContain("matchesCanonicalTransactionFilters(row, input)")
    expect(canonicalDatabase).toContain("result.status === 416")
    expect(canonicalDatabase).toContain('errorCode === "PGRST103"')
  })
})
