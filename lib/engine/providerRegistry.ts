import { ProviderAdapter } from "@/types/provider"

const registry: Record<string, ProviderAdapter> = {}
const providerHealth: Record<string, boolean> = {}

function registerProvider(name: string, adapter: ProviderAdapter) {
  registry[name] = adapter
  providerHealth[name] = true // Assume healthy on registration
}

function getProvider(name: string): ProviderAdapter {
  const provider = registry[name]

  if (!provider) {
    throw new Error(`Provider not registered: ${name}`)
  }

  return provider
}

function getAllProviders() {
  return registry
}

function isProviderHealthy(name: string): boolean {
  return providerHealth[name] ?? true
}

function setProviderHealth(name: string, healthy: boolean): void {
  providerHealth[name] = healthy
}

function getProviderHealthStatus(): Record<string, boolean> {
  return { ...providerHealth }
}

export {
  registerProvider,
  getProvider,
  getAllProviders,
  isProviderHealthy,
  setProviderHealth,
  getProviderHealthStatus
}