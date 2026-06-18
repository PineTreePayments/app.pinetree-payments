import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"

describe("webhook retry metadata", () => {
  it("makes failed deliveries durably retryable", () => {
    const migration = fs.readFileSync(
      path.join(
        process.cwd(),
        "database/migrations/20260612_add_webhook_delivery_retry_metadata.sql"
      ),
      "utf8"
    )
    const source = fs.readFileSync(
      path.join(process.cwd(), "database/merchantWebhooks.ts"),
      "utf8"
    )
    expect(migration).toContain("next_attempt_at timestamptz")
    expect(migration).toContain("where status = 'failed'")
    expect(source).toContain("WEBHOOK_MAX_DELIVERY_ATTEMPTS = 10")
    expect(source).toContain('"dead_letter"')
    expect(source).toContain('.eq("status", "failed")')
    expect(source).toContain('.lte("next_attempt_at", now)')
  })

  it("documents dead-letter retry exhaustion", () => {
    const migration = fs.readFileSync(
      path.join(
        process.cwd(),
        "database/migrations/20260618_add_webhook_dead_letter_status.sql"
      ),
      "utf8"
    )
    const docs = fs.readFileSync(
      path.join(process.cwd(), "docs/api/webhook-deliveries.md"),
      "utf8"
    )

    expect(migration).toContain("dead_lettered_at timestamptz")
    expect(migration).toContain("'dead_letter'")
    expect(docs).toContain("After attempt 10 fails")
    expect(docs).toContain("60, 120, 240, 480, 960, 1800, 3600")
  })
})
