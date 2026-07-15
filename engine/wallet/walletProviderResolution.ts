/**
 * Resolves which wallet provider (if any) a PineTree merchant is configured
 * for, and returns the matching registered adapter + adapter-scoped
 * context. This is the ONLY place a merchant id is turned into a provider
 * account context - every generic engine function in
 * engine/wallet/walletOperations.ts and walletPreferences.ts goes through
 * this first. Never accepts a provider or account id from the caller.
 */

import { WalletApiRouteError } from "./walletErrors"
import { getWalletProviderAdapter, listRegisteredWalletProviders } from "./walletProviderRegistry"
import { ensureWalletProvidersRegistered } from "./loadWalletProviders"
import type { WalletAdapterContext, WalletProviderAdapter } from "./walletProviderAdapter"

export type WalletProviderResolution = {
  provider: string
  adapter: WalletProviderAdapter
  context: WalletAdapterContext
}

export async function resolveMerchantWalletProvider(merchantId: string): Promise<WalletProviderResolution> {
  if (!merchantId) {
    throw new WalletApiRouteError("UNAUTHORIZED", "Missing authenticated merchant.")
  }

  await ensureWalletProvidersRegistered()
  const providers = listRegisteredWalletProviders()

  let sawConfiguredButNotReady = false

  for (const providerName of providers) {
    const adapter = getWalletProviderAdapter(providerName)
    if (!adapter) continue

    const resolution = await adapter.resolveContext(merchantId)
    if (!resolution.configured) continue
    if (!resolution.ready) {
      sawConfiguredButNotReady = true
      continue
    }

    return { provider: providerName, adapter, context: resolution.context }
  }

  if (sawConfiguredButNotReady) {
    throw new WalletApiRouteError(
      "WALLET_PROVIDER_NOT_READY",
      "Your wallet provider connection is not ready yet.",
      false
    )
  }

  throw new WalletApiRouteError(
    "WALLET_PROVIDER_NOT_CONFIGURED",
    "No wallet provider is configured for this merchant.",
    false
  )
}

/**
 * Same resolution, but never throws - used by the capabilities endpoint,
 * which must report an unconfigured/not-ready state as data, not an error.
 */
export async function tryResolveMerchantWalletProvider(
  merchantId: string
): Promise<WalletProviderResolution | null> {
  try {
    return await resolveMerchantWalletProvider(merchantId)
  } catch (error) {
    if (error instanceof WalletApiRouteError) return null
    throw error
  }
}
