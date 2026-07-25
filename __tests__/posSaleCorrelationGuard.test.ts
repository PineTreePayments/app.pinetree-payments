import { describe, expect, it } from "vitest"
import { evaluatePosSaleUpdate, logStalePosSaleUpdate } from "@/lib/pos/posSaleCorrelationGuard"

/**
 * Regression coverage for the production incident: a completed Solana
 * payment (intent a5879ca9.../payment 2555d11f...) was followed immediately
 * by a new $0.10 POS sale (intent 5b73b81f...) that had no child payment
 * created yet. Despite that, the POS screen changed to "Complete" — a
 * delayed status update belonging to the PREVIOUS payment was applied to
 * the NEW sale.
 *
 * Root cause: the previous correlation check
 * (`sourcePaymentId !== activePaymentId`) only fired when activePaymentId
 * was already non-empty — it did nothing during the window a fresh sale
 * has an intent but no child payment yet, which is exactly the window the
 * stale update slipped through in.
 *
 * These are direct, behavioral tests of the pure decision function (see
 * lib/pos/posSaleCorrelationGuard.ts), not string assertions against
 * components/pos/POSLayout.tsx — a separate structural suite
 * (posLayoutSaleCorrelationWiring.test.ts) proves POSLayout.tsx actually
 * wires this function in at every pathway.
 */

describe("evaluatePosSaleUpdate", () => {
  it("1. a delayed CONFIRMED result from the previous Solana payment cannot complete a newly created sale with no child payment yet", () => {
    // Exactly the reported production shape: the new sale's intent exists,
    // but activePaymentId is still "" (no network selected, no payment
    // created), and the generation has already moved on.
    const result = evaluatePosSaleUpdate(
      {
        source: "realtime_direct_payment",
        generation: 1, // captured when the OLD payment's subscription was set up
        status: "CONFIRMED",
        sourcePaymentId: "2555d11f-be06-4263-9d03-b1994a80dd86"
      },
      {
        generation: 2, // resetSale() already ran once for the new sale
        intentId: "5b73b81f-f311-4bd6-a03c-f5e7e2e472b2",
        paymentId: "" // no child payment created yet — the exact vulnerable window
      }
    )

    expect(result.stale).toBe(true)
  })

  it("2. a delayed poll response from an old intent is ignored", () => {
    const result = evaluatePosSaleUpdate(
      {
        source: "poll",
        generation: 1,
        status: "CONFIRMED",
        sourceIntentId: "a5879ca9-d107-4d4b-8151-183bf447337e"
      },
      {
        generation: 2,
        intentId: "5b73b81f-f311-4bd6-a03c-f5e7e2e472b2",
        paymentId: ""
      }
    )

    expect(result.stale).toBe(true)
  })

  it("3. a delayed realtime event from an old payment is ignored, even once the new sale HAS a child payment of its own", () => {
    const result = evaluatePosSaleUpdate(
      {
        source: "realtime_intent_resolved_payment",
        generation: 1,
        status: "CONFIRMED",
        sourcePaymentId: "2555d11f-be06-4263-9d03-b1994a80dd86",
        sourceIntentId: "a5879ca9-d107-4d4b-8151-183bf447337e"
      },
      {
        generation: 2,
        intentId: "5b73b81f-f311-4bd6-a03c-f5e7e2e472b2",
        paymentId: "9f000000-0000-4000-8000-000000000001"
      }
    )

    expect(result.stale).toBe(true)
  })

  it("4. a stale callback captured before resetSale() is rejected after the generation changes, purely on the generation mismatch — even with no intentId/paymentId in the event at all", () => {
    const result = evaluatePosSaleUpdate(
      { source: "poll", generation: 5, status: "CONFIRMED" },
      { generation: 6, intentId: "current-intent", paymentId: "current-payment" }
    )

    expect(result.stale).toBe(true)
  })

  it("5. the correct active intent still completes normally (same generation, matching intentId, no paymentId yet)", () => {
    const result = evaluatePosSaleUpdate(
      {
        source: "poll",
        generation: 2,
        status: "CONFIRMED",
        sourceIntentId: "5b73b81f-f311-4bd6-a03c-f5e7e2e472b2"
      },
      {
        generation: 2,
        intentId: "5b73b81f-f311-4bd6-a03c-f5e7e2e472b2",
        paymentId: ""
      }
    )

    expect(result).toEqual({ stale: false })
  })

  it("6. the correct active child payment still completes normally (same generation, matching paymentId and intentId)", () => {
    const result = evaluatePosSaleUpdate(
      {
        source: "realtime_direct_payment",
        generation: 2,
        status: "CONFIRMED",
        sourcePaymentId: "9f000000-0000-4000-8000-000000000001",
        sourceIntentId: "5b73b81f-f311-4bd6-a03c-f5e7e2e472b2"
      },
      {
        generation: 2,
        intentId: "5b73b81f-f311-4bd6-a03c-f5e7e2e472b2",
        paymentId: "9f000000-0000-4000-8000-000000000001"
      }
    )

    expect(result).toEqual({ stale: false })
  })

  it("rejects on a payment-id mismatch alone, even when the generation and intentId both match (a second payment resolved under the same intent)", () => {
    const result = evaluatePosSaleUpdate(
      {
        source: "realtime_intent_resolved_payment",
        generation: 3,
        status: "PROCESSING",
        sourcePaymentId: "old-payment-under-same-intent",
        sourceIntentId: "shared-intent"
      },
      {
        generation: 3,
        intentId: "shared-intent",
        paymentId: "new-payment-under-same-intent"
      }
    )

    expect(result.stale).toBe(true)
  })

  it("the stale log payload matches the exact required structured shape, with no secrets/QR/invoice data", () => {
    const result = evaluatePosSaleUpdate(
      {
        source: "realtime_direct_payment",
        generation: 1,
        status: "CONFIRMED",
        sourcePaymentId: "2555d11f-be06-4263-9d03-b1994a80dd86",
        sourceIntentId: "a5879ca9-d107-4d4b-8151-183bf447337e"
      },
      {
        generation: 2,
        intentId: "5b73b81f-f311-4bd6-a03c-f5e7e2e472b2",
        paymentId: ""
      }
    )

    expect(result.stale).toBe(true)
    if (!result.stale) throw new Error("unreachable")
    expect(result.logPayload).toEqual({
      source: "realtime_direct_payment",
      eventIntentId: "a5879ca9-d107-4d4b-8151-183bf447337e",
      eventPaymentId: "2555d11f-be06-4263-9d03-b1994a80dd86",
      activeIntentId: "5b73b81f-f311-4bd6-a03c-f5e7e2e472b2",
      activePaymentId: null,
      eventGeneration: 1,
      activeGeneration: 2,
      status: "CONFIRMED"
    })
    // No wallet addresses, QR payloads, invoices, or transaction data.
    const serialized = JSON.stringify(result.logPayload)
    expect(serialized).not.toMatch(/lightning:|wc:|solana-pay:|0x[a-fA-F0-9]{40,}/)
  })

  it("logStalePosSaleUpdate logs under the exact required console.warn prefix", () => {
    const calls: unknown[][] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => calls.push(args)
    try {
      logStalePosSaleUpdate({
        stale: true,
        logPayload: { source: "poll", eventIntentId: null, eventPaymentId: null, activeIntentId: null, activePaymentId: null, eventGeneration: 1, activeGeneration: 2, status: "CONFIRMED" }
      })
    } finally {
      console.warn = originalWarn
    }
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe("[pos] stale payment update ignored")
  })
})
