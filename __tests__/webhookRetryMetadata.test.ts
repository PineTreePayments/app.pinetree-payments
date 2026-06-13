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
    expect(source).toContain('input.status === "failed"')
    expect(source).toContain('.eq("status", "failed")')
    expect(source).toContain('.lte("next_attempt_at", now)')
  })
})
