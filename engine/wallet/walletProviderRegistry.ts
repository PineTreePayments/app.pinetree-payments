/**
 * In-memory registry of wallet provider adapters. Adapters register
 * themselves via registerWalletProviderAdapter() - see
 * engine/wallet/loadWalletProviders.ts for the single place that happens.
 * Nothing outside engine/wallet/* should call registerWalletProviderAdapter
 * directly.
 */

import type { WalletProviderAdapter } from "./walletProviderAdapter"

const registry = new Map<string, WalletProviderAdapter>()

export function registerWalletProviderAdapter(adapter: WalletProviderAdapter): void {
  registry.set(adapter.provider, adapter)
}

export function getWalletProviderAdapter(provider: string): WalletProviderAdapter | null {
  return registry.get(provider) ?? null
}

/**
 * Priority-ordered list of provider names the engine checks when resolving
 * which provider a merchant is configured for. Extend this (and register a
 * matching adapter) to add a new wallet provider - no other file needs to
 * change.
 */
export function listRegisteredWalletProviders(): string[] {
  return [...registry.keys()]
}
