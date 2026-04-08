import { ProviderAdapter } from "@/types/provider"

const registry: Record<string, ProviderAdapter> = {}
const providerHealth: Record<string, boolean> = {}

export function registerProvider(name: string, adapter: ProviderAdapter) {
  registry[name] = adapter
  providerHealth[name] = true // Assume healthy on registration
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

export function isProviderHealthy(name: string): boolean {
  return providerHealth[name] ?? true
}

export function setProviderHealth(name: string, healthy: boolean): void {
  providerHealth[name] = healthy
}

export function getProviderHealthStatus(): Record<string, boolean> {
  return { ...providerHealth }
}