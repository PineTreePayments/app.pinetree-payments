import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("merchant settings timestamp migration", () => {
  it("adds timestamps, backfills updated_at, and attaches the updated_at trigger", () => {
    const migration = read("database/migrations/20260621_add_merchant_settings_timestamps.sql")

    expect(migration).toContain("ALTER TABLE merchant_settings")
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS created_at")
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS updated_at")
    expect(migration).toContain("SET updated_at = COALESCE(updated_at, created_at, now())")
    expect(migration).toContain("CREATE TRIGGER merchant_settings_updated_at")
    expect(migration).toContain("FOR EACH ROW EXECUTE FUNCTION set_updated_at()")
  })
})

describe("merchant tax settings timestamp migration", () => {
  it("adds timestamps, backfills updated_at, and attaches the updated_at trigger", () => {
    const migration = read("database/migrations/20260709_add_merchant_tax_settings_timestamps.sql")

    expect(migration).toContain("ALTER TABLE merchant_tax_settings")
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS created_at")
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS updated_at")
    expect(migration).toContain("SET updated_at = COALESCE(updated_at, created_at, now())")
    expect(migration).toContain("CREATE TRIGGER merchant_tax_settings_updated_at")
    expect(migration).toContain("FOR EACH ROW EXECUTE FUNCTION set_updated_at()")
  })

  it("does not require updated_at in the tax settings upsert and hides schema details", () => {
    const engine = read("engine/settingsDashboard.ts")
    const taxUpsert = engine.slice(
      engine.indexOf('db.from("merchant_tax_settings").upsert('),
      engine.indexOf('db.from("merchant_operations_settings").upsert(')
    )

    expect(taxUpsert).not.toContain("updated_at")
    expect(engine).toContain("TAX_SETTINGS_NOT_READY_MESSAGE")
    expect(engine).not.toContain("Failed to save tax settings: ${taxResult.error.message}")
    expect(engine).not.toContain("Failed to load tax settings: ${taxResult.error.message}")
  })
})
