import { getProvider, isProviderHealthy } from "./providerRegistry"
import { loadProviders } from "./loadProviders"
import type { ProviderAdapter } from "@/types/provider"

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

  const provider: ProviderAdapter = getProvider(providerName)

  if (!provider) {
    throw new Error(`Provider not found: ${providerName}`)
  }

  const paymentInput = {
    paymentId: crypto.randomUUID(),
    merchantAmount: input.amount,
    pinetreeFee: 0.15,
    grossAmount: input.amount + 0.15,
    currency: input.currency,
    merchantWallet: "",
    pinetreeWallet: "",
    merchantId: input.merchantId
  }

  if (!provider.createPayment) {
    throw new Error(`Provider does not support createPayment: ${providerName}`)
  }

  return await provider.createPayment(paymentInput)

}