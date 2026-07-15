/**
 * Registers every available wallet provider adapter. Mirrors the lazy
 * singleton pattern in engine/loadProviders.ts. Call
 * ensureWalletProvidersRegistered() before resolving a merchant's provider
 * (engine/wallet/walletProviderResolution.ts already does this) - nothing
 * else needs to import provider adapter modules directly.
 *
 * Adding a new wallet provider (Dynamic, Fireblocks, Coinbase, ...) means
 * creating its adapter under providers/<name>/ and registering it here -
 * no route, engine function, or UI component needs to change.
 */

import { registerWalletProviderAdapter } from "./walletProviderRegistry"

let registered = false

export async function ensureWalletProvidersRegistered(): Promise<void> {
  if (registered) return
  const { speedWalletAdapter } = await import("@/providers/lightning/speedWalletAdapter")
  registerWalletProviderAdapter(speedWalletAdapter)
  registered = true
}
