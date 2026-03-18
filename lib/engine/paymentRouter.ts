import { getProvider } from "./providerRegistry"
import { loadProviders } from "./loadProviders"
import { isProviderHealthy } from "./providerHealth"

let providersLoaded = false

async function ensureProvidersLoaded() {
  if (!providersLoaded) {
    await loadProviders()
    providersLoaded = true
  }
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

  const provider: any = getProvider(providerName)

  if (!provider) {
    throw new Error(`Provider not found: ${providerName}`)
  }

  const paymentInput = {
    paymentId: crypto.randomUUID(),
    amount: input.amount,
    currency: input.currency,
    merchantId: input.merchantId
  }

  return await provider.createPayment(paymentInput)

}