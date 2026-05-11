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

function providerSupportsFeeAtPaymentTime(name: string): boolean {
  const metadata = getProviderMetadata(name)
  const capabilities = metadata?.capabilities

  if (!metadata) return false

  if (metadata.feeCaptureMethods?.includes("atomic_split")) return true
  if (metadata.feeCaptureMethods?.includes("contract_split")) return true
  if (metadata.feeCaptureMethods?.includes("invoice_split")) {
    return Boolean(
      capabilities?.supportsFeeAtPaymentTime &&
      capabilities?.supportsSplitSettlement
    )
  }

  return false
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
  providerSupportsFeeAtPaymentTime,
  isProviderHealthy,
  setProviderHealth,
  getProviderHealthStatus
}
