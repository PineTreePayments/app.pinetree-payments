import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

describe("report database schema compatibility", () => {
  it("selects only merchant columns that exist in the production schema", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "database/reports.ts"), "utf8")

    expect(source).toContain('.select("id,business_name,email")')
    expect(source).not.toContain('.select("id,name,business_name,email")')
    expect(source).not.toContain("merchant.name")
  })
})
