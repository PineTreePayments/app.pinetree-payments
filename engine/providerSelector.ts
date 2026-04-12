/**
 * PineTree Provider Selector & Smart Routing
 * 
 * Automatically selects the best available provider and wallet
 * for a given merchant based on priority, health, and availability.
 */

import { getMerchantProviders } from "@/database/merchants"
import { selectBestWallet } from "@/database/merchantWallets"
import { getProvider, isProviderHealthy } from "./providerRegistry"

/**
 * Choose the best available provider for a merchant
 */
export async function chooseBestProvider(
  merchantId: string,
  preferredNetwork?: string
) {
  void preferredNetwork
  // Get all connected providers for this merchant
  const providers = await getMerchantProviders(merchantId)

  for (const provider of providers) {
    const adapter = getProvider(provider.provider)

    if (!adapter) {
      continue
    }

    // Check if provider is healthy
    if (!isProviderHealthy(provider.provider)) {
      continue
    }

    // Check if merchant has wallet for this provider
    const hasWallet = await selectBestWallet(
      merchantId,
      provider.provider
    )

    if (hasWallet) {
      return provider.provider
    }
  }

  // Fallback to first connected provider
  if (providers.length > 0) {
    return providers[0].provider
  }

  return null
}

/**
 * Get available payment networks for a merchant
 */
export async function getAvailableNetworks(merchantId: string) {
  const providers = await getMerchantProviders(merchantId)
  
  const networks = []

  for (const provider of providers) {
    if (isProviderHealthy(provider.provider)) {
      networks.push(provider.provider)
    }
  }

  return networks
}