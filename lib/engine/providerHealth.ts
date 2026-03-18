type ProviderHealth = {
  healthy: boolean
  lastCheck: number
}

const providerHealth: Record<string, ProviderHealth> = {}

export function setProviderHealth(name: string, healthy: boolean) {
  providerHealth[name] = {
    healthy,
    lastCheck: Date.now()
  }
}

export function isProviderHealthy(name: string) {

  const health = providerHealth[name]

  if (!health) return true

  return health.healthy
}