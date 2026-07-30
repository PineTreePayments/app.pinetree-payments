import { StripeClient } from "./client"
import { normalizeStripePaymentStatus } from "./payments"

export async function getPaymentStatus(providerReference: string, connectedAccountId?: string) {
  const client = new StripeClient()
  const response = await client.retrievePaymentIntent(providerReference, connectedAccountId)

  return {
    provider: "stripe" as const,
    providerReference: response.id,
    status: normalizeStripePaymentStatus(response.status),
    raw: response
  }
}
