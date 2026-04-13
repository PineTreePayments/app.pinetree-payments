import { ProviderAdapter, type ProviderAdapterMetadata } from "@/types/provider"

const registry: Record<string, ProviderAdapter> = {}
const providerMetadata: Record<string, ProviderAdapterMetadata> = {}
const providerHealth: Record<string, boolean> = {}

function registerProvider(
  name: string,
  adapter: ProviderAdapter,
  metadata?: ProviderAdapterMetadata
) {
  registry[name] = adapter
  providerMetadata[name] = metadata || adapter.metadata || {
    adapterId: name,
    displayName: name,
    supportedNetworks: []
  }
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

function getProviderMetadata(name: string): ProviderAdapterMetadata | null {
  return providerMetadata[name] || null
}

function getProvidersForNetwork(network: string): string[] {
  return Object.entries(providerMetadata)
    .filter(([, metadata]) => metadata.supportedNetworks.includes(network as never))
    .map(([name]) => name)
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
  getProviderMetadata,
  getProvidersForNetwork,
  isProviderHealthy,
  setProviderHealth,
  getProviderHealthStatus
}