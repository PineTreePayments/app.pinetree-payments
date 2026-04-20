/**
 * PineTree Adapter Selector & Smart Routing
 * 
 * Engine-owned selection of the best available adapter for a merchant
 * based on network support, merchant configuration, and adapter health.
 */

import { getMerchantDefaultProvider, getMerchantProviders } from "@/database/merchants"
import type { PaymentAdapterId } from "@/types/payment"
import { normalizeProvider, normalizeWalletNetwork } from "./providerMappings"
import { getProviderMetadata, isProviderHealthy } from "./providerRegistry"
import { loadProviders } from "./loadProviders"

// Wallet-rail adapter per network — used when merchant_providers has no rows yet
const NETWORK_DEFAULT_ADAPTER: Partial<Record<string, PaymentAdapterId>> = {
  solana: "solana",
  base: "base",
  ethereum: "base"
}

function sortAdapterIds(
  adapterIds: PaymentAdapterId[],
  defaultAdapterId?: PaymentAdapterId | null
): PaymentAdapterId[] {
  const preferred = String(defaultAdapterId || "").toLowerCase().trim()
  return [...adapterIds].sort((left, right) => {
    if (left === preferred && right !== preferred) return -1
    if (right === preferred && left !== preferred) return 1
    return left.localeCompare(right)
  })
}

/**
 * Choose the best available adapter for a merchant network.
 */
export async function chooseBestAdapter(input: {
  merchantId: string
  network: string
  requestedAdapterId?: string
}): Promise<PaymentAdapterId | null> {
  await loadProviders()

  const network = normalizeWalletNetwork(input.network)
  if (!network) {
    throw new Error("Unsupported payment network")
  }

  const merchantProviders = await getMerchantProviders(input.merchantId)
  const connectedAdapterIds = merchantProviders
    .map((provider) => normalizeProvider(provider.provider))
    .filter((value): value is PaymentAdapterId => Boolean(value))

  const defaultAdapterId = normalizeProvider(
    String(await getMerchantDefaultProvider(input.merchantId) || "")
  )

  const requestedAdapterId = normalizeProvider(input.requestedAdapterId)

  if (requestedAdapterId) {
    const metadata = getProviderMetadata(requestedAdapterId)
    if (!connectedAdapterIds.includes(requestedAdapterId)) {
      throw new Error(`Requested payment adapter is not connected: ${requestedAdapterId}`)
    }
    if (!metadata || !metadata.supportedNetworks.includes(network)) {
      throw new Error(`Requested payment adapter does not support ${network}`)
    }
    if (!isProviderHealthy(requestedAdapterId)) {
      throw new Error(`Requested payment adapter is unhealthy: ${requestedAdapterId}`)
    }
    return requestedAdapterId
  }

  const candidates = connectedAdapterIds.filter((adapterId) => {
    const metadata = getProviderMetadata(adapterId)
    return Boolean(
      metadata &&
      metadata.supportedNetworks.includes(network) &&
      isProviderHealthy(adapterId)
    )
  })

  const sortedCandidates = sortAdapterIds(candidates, defaultAdapterId)
  if (sortedCandidates[0]) return sortedCandidates[0]

  // No merchant_providers rows yet — infer the wallet-rail adapter from network
  const inferredAdapter = NETWORK_DEFAULT_ADAPTER[network]
  if (inferredAdapter && isProviderHealthy(inferredAdapter)) {
    return inferredAdapter
  }

  return null
}

/**
 * Get available payment networks for a merchant
 */
export async function getAvailableNetworks(merchantId: string) {
  await loadProviders()

  const providers = await getMerchantProviders(merchantId)

  const networks = new Set<string>()

  for (const provider of providers) {
    const adapterId = normalizeProvider(provider.provider)
    const metadata = adapterId ? getProviderMetadata(adapterId) : null

    if (adapterId && metadata && isProviderHealthy(adapterId)) {
      metadata.supportedNetworks.forEach((network) => networks.add(network))
    }
  }

  return [...networks]
}