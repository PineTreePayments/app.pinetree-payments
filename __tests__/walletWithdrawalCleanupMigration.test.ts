import { readFileSync } from "fs"
import { join } from "path"
import { describe, expect, it } from "vitest"

function readMigration(name: string) {
  return readFileSync(join(process.cwd(), "database", "migrations", name), "utf8")
}

describe("Speed abandoned CREATED withdrawal cleanup migration", () => {
  it("classifies ambiguous stale CREATED withdrawals as REQUIRES_ACTION, not false FAILED", () => {
    const sql = readMigration("20260722_prevent_false_failure_cleanup_for_ambiguous_speed_withdrawals.sql")

    expect(sql).toContain("ELSE 'REQUIRES_ACTION'")
    expect(sql).toContain("'staleCreatedAmbiguous'")
    expect(sql).toContain("'recoveryRequired', NOT candidates.proven_pre_dispatch_failure")
    expect(sql).not.toContain("'failureStage', 'abandoned_created_cleanup'")
    expect(sql).not.toContain("'recoveryRequired', false")
  })

  it("keeps FAILED cleanup limited to explicit pre-dispatch evidence", () => {
    const sql = readMigration("20260722_prevent_false_failure_cleanup_for_ambiguous_speed_withdrawals.sql")

    expect(sql).toContain("provider_request_attempted IS FALSE")
    expect(sql).toContain('"dispatchNotStarted": true')
    expect(sql).toContain("WHEN candidates.proven_pre_dispatch_failure THEN 'FAILED'")
  })

  it("adds dispatch and provider acceptance evidence columns for future cleanup decisions", () => {
    const sql = readMigration("20260722_prevent_false_failure_cleanup_for_ambiguous_speed_withdrawals.sql")

    for (const column of [
      "dispatch_started_at",
      "dispatch_completed_at",
      "provider_request_key",
      "provider_request_attempted",
      "provider_response_received",
      "provider_acceptance_known",
      "provider_acceptance_unknown",
      "persistence_after_acceptance_failed",
    ]) {
      expect(sql).toContain(column)
    }
  })
})
