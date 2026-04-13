import { isProviderHealthy } from "./providerRegistry"
import { loadProviders } from "./loadProviders"
import { createPayment } from "./createPayment"

async function ensureProvidersLoaded() {
  await loadProviders()
}

type PaymentRouterInput = {
  provider: string
  amount: number
  currency: string
  merchantId: string
}

export async function paymentRouter(input: PaymentRouterInput) {

  await ensureProvidersLoaded()

  let providerName = input.provider

  if (!isProviderHealthy(providerName)) {

    console.warn(`Provider ${providerName} unhealthy, switching to fallback`)

    providerName = "coinbase"

  }

  return createPayment({
    amount: input.amount,
    currency: input.currency,
    merchantId: input.merchantId,
    provider: providerName as never,
    channel: "api"
  })

}