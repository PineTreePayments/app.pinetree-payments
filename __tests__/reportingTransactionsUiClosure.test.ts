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

  it("persists combined transaction filters in the URL and requests stable server pagination", () => {
    const page = read("app/dashboard/transactions/page.tsx")
    const engine = read("engine/transactionsDashboard.ts")
    for (const filter of ["provider", "network", "channel", "status", "rail", "asset", "method", "startDate", "endDate"]) {
      expect(page).toContain(`setFilter("${filter}"`)
    }
    expect(page).toContain("window.history.replaceState")
    expect(engine).toContain('.order("created_at", { ascending: false })')
    expect(engine).toContain('.order("id", { ascending: false })')
    expect(engine).toContain('metadata->>selectedAsset.eq.${asset}')
  })
})
