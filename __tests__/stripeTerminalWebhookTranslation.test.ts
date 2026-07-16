import { describe, expect, it } from "vitest"
import { translateEvent } from "@/providers/stripe/translateEvent"

function readerEvent(type: string, status: string) {
  return {
    id: `evt_${status}`,
    type,
    account: "acct_merchant",
    data: { object: { id: "tmr_reader", action: { type: "process_payment_intent", status, process_payment_intent: { payment_intent: "pi_terminal" } } } }
  }
}

describe("Stripe Terminal webhook translation", () => {
  it("links reader action updates to the PaymentIntent without exposing the reader object", () => {
    expect(translateEvent(readerEvent("terminal.reader.action_updated", "in_progress"))).toMatchObject({ providerReference: "pi_terminal", event: "payment.processing" })
  })

  it("normalizes reader action failure", () => {
    expect(translateEvent(readerEvent("terminal.reader.action_failed", "failed"))).toMatchObject({ providerReference: "pi_terminal", event: "payment.failed" })
  })

  it("leaves final success to payment_intent.succeeded", () => {
    expect(translateEvent(readerEvent("terminal.reader.action_succeeded", "succeeded"))).toMatchObject({ providerReference: "pi_terminal", event: "payment.processing" })
  })
})
