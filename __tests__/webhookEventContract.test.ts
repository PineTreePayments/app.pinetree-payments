import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  WEBHOOK_SCHEMA,
  WEBHOOK_SCHEMA_HEADER,
  LEGACY_SCHEMA_HEADER,
} from "@/lib/webhooks/events"

describe("webhook event contract", () => {
  it("exposes the unified payments-v1 event set", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "lib/webhooks/events.ts"),
      "utf8"
    )

    for (const event of [
      "payment.created",
      "payment.pending",
      "payment.processing",
      "payment.confirmed",
      "payment.failed",
      "payment.expired",
      "payment.canceled",
      "payment.incomplete",
      "payment.refunded",
      "checkout.session.created",
      "checkout.session.processing",
      "checkout.session.completed",
      "checkout.session.failed",
      "checkout.session.expired",
      "checkout.session.canceled",
      "payment_link.created",
      "payment_link.disabled",
      "payment_link.expired",
    ]) {
      expect(source).toContain(`"${event}"`)
    }
    expect(source).toContain('"checkout.session.paid"')
    expect(source).toContain("normalizeWebhookEventType")
  })

  it("header constants are canonical and do not drift", () => {
    expect(WEBHOOK_SCHEMA).toBe("payments-v1")
    expect(WEBHOOK_SCHEMA_HEADER).toBe("PineTree-Event-Schema")
    expect(LEGACY_SCHEMA_HEADER).toBe("PineTree-Webhook-Version")
  })

  it("engine delivery source file sends both canonical and legacy schema headers", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "engine/webhookDelivery.ts"),
      "utf8"
    )
    expect(source).toContain("WEBHOOK_SCHEMA_HEADER")
    expect(source).toContain("LEGACY_SCHEMA_HEADER")
  })

  it("SDK types file exports WEBHOOK_SCHEMA_HEADER and LEGACY_SCHEMA_HEADER", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "packages/pinetree-node/src/types.ts"),
      "utf8"
    )
    expect(source).toContain('WEBHOOK_SCHEMA_HEADER = "PineTree-Event-Schema"')
    expect(source).toContain('LEGACY_SCHEMA_HEADER = "PineTree-Webhook-Version"')
  })
})
