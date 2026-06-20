import { StripeClient } from "./client"
import { normalizeStripePaymentStatus } from "./createPayment"

export async function getPaymentStatus(providerReference: string) {
  const client = new StripeClient()
  const response = await client.retrievePaymentIntent(providerReference)

  return {
    provider: "stripe" as const,
    providerReference: response.id,
    status: normalizeStripePaymentStatus(response.status),
    raw: response
  }
}
