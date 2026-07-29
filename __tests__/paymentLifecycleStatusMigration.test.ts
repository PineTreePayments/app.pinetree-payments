import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const migrationPath = path.join(
  process.cwd(),
  "database/migrations/20260728_expand_payment_lifecycle_statuses.sql"
)
const sql = fs.readFileSync(migrationPath, "utf8")
const normalized = sql.toUpperCase().replace(/\s+/g, " ")

describe("payment lifecycle status migration", () => {
  it("stores EXPIRED, CANCELED, and INCOMPLETE as distinct canonical values", () => {
    expect(normalized).toContain("ADD CONSTRAINT PAYMENTS_STATUS_LIFECYCLE_CHECK")
    expect(normalized).toContain("'EXPIRED'")
    expect(normalized).toContain("'CANCELED'")
    expect(normalized).toContain("'INCOMPLETE'")
    expect(normalized).toContain("VALIDATE CONSTRAINT PAYMENTS_STATUS_LIFECYCLE_CHECK")

    const constraint = normalized.slice(
      normalized.indexOf("ADD CONSTRAINT PAYMENTS_STATUS_LIFECYCLE_CHECK"),
      normalized.indexOf("VALIDATE CONSTRAINT PAYMENTS_STATUS_LIFECYCLE_CHECK")
    )
    expect(constraint).not.toContain("'CANCELLED'")
    expect(constraint).not.toContain("'REFUNDED'")
    expect(constraint).not.toContain("'DISPUTED'")
  })

  it("normalizes only legacy CANCELLED spelling without forging a lifecycle timestamp", () => {
    expect(normalized).toContain("SET STATUS = 'CANCELED' WHERE UPPER(BTRIM(STATUS::TEXT)) = 'CANCELLED'")
    expect(normalized).not.toMatch(/SET\s+UPDATED_AT\s*=/)
    expect(normalized).not.toMatch(/UPDATE\s+PUBLIC\.PAYMENT_EVENTS|DELETE\s+FROM\s+PUBLIC\.PAYMENT_EVENTS/)
    expect(normalized).not.toMatch(/UPDATE\s+PUBLIC\.TRANSACTIONS|DELETE\s+FROM\s+PUBLIC\.TRANSACTIONS/)
  })

  it("fails closed on schema drift or unknown history and replaces only status-only checks", () => {
    expect(normalized).toContain("EXPECTED TEXT OR CHARACTER VARYING")
    expect(normalized).toContain("UNSUPPORTED STATUSES")
    expect(normalized).toContain("CARDINALITY(CONSTRAINT_DEFINITION.CONKEY) = 1")
    expect(normalized).toContain("CONSTRAINT_DEFINITION.CONKEY @> ARRAY[STATUS_ATTRIBUTE.ATTNUM]::SMALLINT[]")
    expect(normalized).toContain("NOT VALID")
  })

  it("is forward-only and does not perform destructive table or policy operations", () => {
    expect(normalized).not.toMatch(/DROP\s+TABLE|TRUNCATE|DELETE\s+FROM\s+PUBLIC\.PAYMENTS/)
    expect(normalized).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY|DROP\s+POLICY/)
    expect(normalized).toMatch(/BEGIN; DO \$MIGRATION\$/)
    expect(normalized).toMatch(/NOTIFY PGRST, 'RELOAD SCHEMA'; COMMIT;/)
    expect(normalized).toContain("NOTIFY PGRST, 'RELOAD SCHEMA'")
  })
})
