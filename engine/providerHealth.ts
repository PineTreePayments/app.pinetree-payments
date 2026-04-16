/**
 * PineTree Provider Health Monitor
 * 
 * Tracks provider availability and automatically marks
 * unhealthy providers as unavailable for routing.
 */

/**
 * PineTree Provider Health Monitor
 *
 * Provides a single-execution health check for all registered providers.
 * Called on-demand only (e.g. from the providers dashboard API route).
 * Does NOT schedule repeated checks — no setInterval, no background tasks.
 */

import {
  setProviderHealth,
  getAllProviders
} from "./providerRegistry"

/**
 * Run a health check for every registered provider and update the registry.
 * Single execution — call this on demand, never in a loop.
 */
export async function runProviderHealthChecks() {
  const providers = getAllProviders()
  const results: Record<string, boolean> = {}

  for (const [name, adapter] of Object.entries(providers)) {
    let healthy = true

    if (adapter.healthCheck) {
      try {
        healthy = await adapter.healthCheck()
      } catch {
        healthy = false
      }
    }

    setProviderHealth(name, healthy)
    results[name] = healthy
  }

  return results
}