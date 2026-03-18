import { onEvent } from "./eventBus"

export function registerPaymentEvents() {

  onEvent("payment.confirmed", async (payload) => {

    console.log("Payment confirmed:", payload.paymentId)

    // future:
    // ledger entry
    // merchant analytics
    // tax record

  })

  onEvent("payment.failed", async (payload) => {

    console.log("Payment failed:", payload.paymentId)

  })

  onEvent("payment.processing", async (payload) => {

    console.log("Payment processing:", payload.paymentId)

  })

}