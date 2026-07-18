import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  isTerminalTransactionEvent,
  normalizeTransactionEvent,
} from "@/engine/transactionsDashboard"

describe("merchant transaction event history", () => {
  it("normalizes lifecycle events without exposing provider payloads", () => {
    const event = normalizeTransactionEvent({
      event_type: "payment.failed",
      provider_event: "provider.failure.with.internal.details",
      raw_payload: {
        card_number: "4242424242424242",
        secret: "do-not-expose",
        reason: "provider-internal-reason",
      },
      created_at: "2026-07-18T12:00:00.000Z",
    })

    expect(event).toEqual({
      type: "payment.failed",
      status: "FAILED",
      occurredAt: "2026-07-18T12:00:00.000Z",
      message: "Payment failed.",
    })
    expect(JSON.stringify(event)).not.toContain("provider-internal")
    expect(JSON.stringify(event)).not.toContain("4242")
    expect(JSON.stringify(event)).not.toContain("secret")
  })

  it("queries merchant-scoped event rows and never selects raw payloads", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "engine/transactionsDashboard.ts"),
      "utf8"
    )
    const eventQuery = source.slice(
      source.indexOf('.from("payment_events")'),
      source.indexOf("const startOfDay")
    )

    expect(eventQuery).toContain('.select("payment_id,event_type,provider_event,created_at")')
    expect(eventQuery).not.toContain("raw_payload")
    expect(source).toContain("lifecycle_events: normalizedEvents")
  })

  it("does not treat ordinary lifecycle updates as terminal events", () => {
    expect(isTerminalTransactionEvent(normalizeTransactionEvent({ event_type: "payment.created" }))).toBe(false)
    expect(isTerminalTransactionEvent(normalizeTransactionEvent({ event_type: "payment.processing" }))).toBe(false)
    expect(isTerminalTransactionEvent(normalizeTransactionEvent({ event_type: "payment.confirmed" }))).toBe(true)
    expect(isTerminalTransactionEvent(normalizeTransactionEvent({ event_type: "payment.failed" }))).toBe(true)
  })
})
