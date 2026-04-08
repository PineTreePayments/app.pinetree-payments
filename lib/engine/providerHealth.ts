/**
 * PineTree Provider Health Monitor
 * 
 * Tracks provider availability and automatically marks
 * unhealthy providers as unavailable for routing.
 */

import { setProviderHealth, getProviderHealthStatus, getAllProviders } from "./providerRegistry"
import { HEALTH_CHECK_CONFIG } from "./config"

/**
 * Run health check for all providers
 */
export async function runProviderHealthChecks() {
  const providers = getAllProviders()
  const results: Record<string, boolean> = {}

  for (const [name, adapter] of Object.entries(providers)) {
    let healthy = true

    if (adapter.healthCheck) {
      try {
        healthy = await adapter.healthCheck()
      } catch (error) {
        healthy = false
      }
    }

    setProviderHealth(name, healthy)
    results[name] = healthy
  }

  return results
}

/**
 * Start periodic health check daemon
 */
export function startHealthCheckDaemon() {
  setInterval(async () => {
    await runProviderHealthChecks()
  }, HEALTH_CHECK_CONFIG.checkInterval)
}