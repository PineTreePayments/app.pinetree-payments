import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const appliedMigrationPath = path.join(
  process.cwd(),
  "database/migrations/20260729_add_unknown_payment_recovery.sql"
)
const correctionMigrationPath = path.join(
  process.cwd(),
  "database/migrations/20260729_restore_canonical_payment_lifecycle.sql"
)
const appliedSql = fs.readFileSync(appliedMigrationPath, "utf8")
const correctionSql = fs.readFileSync(correctionMigrationPath, "utf8")
const normalized = correctionSql.toUpperCase().replace(/\s+/g, " ")

describe("canonical payment recovery correction migration", () => {
  it("does not rewrite the migration that has already run in production", () => {
    expect(createHash("sha256").update(appliedSql).digest("hex").toUpperCase()).toBe(
      "47DC2E7F1D87F24080E734C99EE9C81F55905A60EFBF56E9776DA420843E2166"
    )
  })

  it("aborts before constraints change if invalid payment history exists", () => {
    expect(normalized).toContain("WHERE STATUS::TEXT = 'UNKNOWN'")
    expect(normalized).toContain("PAYMENT ROW(S) HAVE STATUS UNKNOWN; INVESTIGATE EXPLICITLY BEFORE RETRYING")
    expect(normalized).toContain("WHERE EVENT_TYPE::TEXT = 'PAYMENT.UNKNOWN'")
    expect(normalized).toContain("PAYMENT.UNKNOWN EVENT(S) EXIST; INVESTIGATE EXPLICITLY BEFORE RETRYING")
    expect(normalized.indexOf("WHERE STATUS::TEXT = 'UNKNOWN'")).toBeLessThan(
      normalized.indexOf("ALTER TABLE PUBLIC.PAYMENTS DROP CONSTRAINT")
    )
    expect(normalized.indexOf("WHERE EVENT_TYPE::TEXT = 'PAYMENT.UNKNOWN'")).toBeLessThan(
      normalized.indexOf("ALTER TABLE PUBLIC.PAYMENT_EVENTS DROP CONSTRAINT")
    )
  })

  it("installs exactly the eight canonical payment states", () => {
    const constraint = normalized.slice(
      normalized.indexOf("ADD CONSTRAINT PAYMENTS_STATUS_LIFECYCLE_CHECK"),
      normalized.indexOf("VALIDATE CONSTRAINT PAYMENTS_STATUS_LIFECYCLE_CHECK")
    )
    for (const status of [
      "CREATED",
      "PENDING",
      "PROCESSING",
      "CONFIRMED",
      "FAILED",
      "EXPIRED",
      "CANCELED",
      "INCOMPLETE",
    ]) {
      expect(constraint).toContain(`'${status}'`)
    }
    expect(constraint).not.toContain("'UNKNOWN'")
    expect(constraint).not.toContain("'REFUNDED'")
    expect(constraint).not.toContain("'DISPUTED'")
  })

  it("removes payment.unknown from the event constraint without rewriting history", () => {
    const constraint = normalized.slice(
      normalized.indexOf("ADD CONSTRAINT PAYMENT_EVENTS_EVENT_TYPE_CHECK"),
      normalized.indexOf("VALIDATE CONSTRAINT PAYMENT_EVENTS_EVENT_TYPE_CHECK")
    )
    expect(constraint).not.toContain("'PAYMENT.UNKNOWN'")
    expect(normalized).not.toMatch(/UPDATE\s+PUBLIC\.(PAYMENTS|PAYMENT_EVENTS)/)
    expect(normalized).not.toMatch(/DELETE\s+FROM\s+PUBLIC\.(PAYMENTS|PAYMENT_EVENTS)/)
    expect(normalized).not.toMatch(/TRUNCATE|DROP\s+TABLE/)
  })

  it("is transactional and preserves recovery coordination infrastructure", () => {
    expect(normalized).toMatch(/^-- .* BEGIN;/)
    expect(normalized.trim()).toMatch(/NOTIFY PGRST, 'RELOAD SCHEMA'; COMMIT;$/)
    expect(normalized).not.toMatch(/DROP\s+FUNCTION|DROP\s+INDEX|DROP\s+POLICY/)
    expect(normalized).toContain("PAYMENT_RECOVERY_SCHEMA_READY()")
    expect(normalized).toContain("PAYMENT_MAINTENANCE_LEASES")
    expect(normalized).toContain("CLAIM_PAYMENT_MAINTENANCE_RUN()")
  })
})
