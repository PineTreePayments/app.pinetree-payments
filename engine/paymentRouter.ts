import { isProviderHealthy } from "./providerRegistry"
import { loadProviders } from "./loadProviders"
import { createPayment } from "./createPayment"

async function ensureProvidersLoaded() {
  await loadProviders()
}

type PaymentRouterInput = {
  amount: number
  currency: string
  merchantId: string
  preferredNetwork?: string
  adapterId?: string
}

export async function paymentRouter(input: PaymentRouterInput) {

  await ensureProvidersLoaded()

  if (input.adapterId && !isProviderHealthy(input.adapterId)) {
    throw new Error(`Requested payment adapter is unhealthy: ${input.adapterId}`)
  }

  return createPayment({
    amount: input.amount,
    currency: input.currency,
    merchantId: input.merchantId,
    adapterId: input.adapterId as never,
    preferredNetwork: input.preferredNetwork,
    channel: "api"
  })

}