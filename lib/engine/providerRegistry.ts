import { ProviderAdapter } from "@/types/provider"

const registry: Record<string, ProviderAdapter> = {}

export function registerProvider(name: string, adapter: ProviderAdapter) {
  registry[name] = adapter
}

export function getProvider(name: string): ProviderAdapter {
  const provider = registry[name]

  if (!provider) {
    throw new Error(`Provider not registered: ${name}`)
  }

  return provider
}

export function getAllProviders() {
  return registry
}