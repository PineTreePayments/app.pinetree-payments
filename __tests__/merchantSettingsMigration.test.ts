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
