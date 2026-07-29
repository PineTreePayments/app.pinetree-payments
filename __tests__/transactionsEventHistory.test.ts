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

  it("projects event history from the canonical merchant-scoped read without raw payloads", () => {
    const engineSource = fs.readFileSync(
      path.join(process.cwd(), "engine/transactionsDashboard.ts"),
      "utf8"
    )
    const dataSource = fs.readFileSync(
      path.join(process.cwd(), "database/canonicalTransactions.ts"),
      "utf8"
    )

    expect(dataSource).toContain("payment_events (")
    expect(dataSource).toContain("provider_event")
    expect(dataSource).not.toContain("raw_payload")
    expect(dataSource).toContain("const merchantId = filters.scope.merchantId.trim()")
    expect(dataSource).toContain('.eq("merchant_id", merchantId)')
    expect(dataSource).toContain('.eq("transactions.merchant_id", merchantId)')
    expect(engineSource).toContain("transaction.lifecycleEvents.map")
    expect(engineSource).not.toContain('.from("payment_events")')
  })

  it("does not treat ordinary lifecycle updates as terminal events", () => {
    expect(isTerminalTransactionEvent(normalizeTransactionEvent({ event_type: "payment.created" }))).toBe(false)
    expect(isTerminalTransactionEvent(normalizeTransactionEvent({ event_type: "payment.processing" }))).toBe(false)
    expect(isTerminalTransactionEvent(normalizeTransactionEvent({ event_type: "payment.confirmed" }))).toBe(true)
    expect(isTerminalTransactionEvent(normalizeTransactionEvent({ event_type: "payment.failed" }))).toBe(true)
  })
})
