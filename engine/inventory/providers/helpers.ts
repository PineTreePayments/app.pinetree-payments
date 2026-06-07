import { getInventoryIntegration } from "@/database"
import type { ConnectionStatusResult } from "./types"

export async function persistedStatus(
  merchantId: string,
  provider: string,
  fallback: ConnectionStatusResult
): Promise<ConnectionStatusResult> {
  const integration = await getInventoryIntegration(merchantId, provider)
  if (!integration) return fallback
  if (integration.status === "ERROR") {
    return {
      ...fallback,
      status: "ERROR",
      lastSyncAt: integration.last_sync_at,
      detail: integration.last_error || fallback.detail
    }
  }
  if (integration.status === "CONNECTED") {
    return { ...fallback, status: "CONNECTED", canSync: true, canDisconnect: true, lastSyncAt: integration.last_sync_at }
  }
  if (integration.status === "DISABLED") {
    return { ...fallback, status: "DISABLED", canConnect: true }
  }
  return fallback
}

export function requiredConfiguration(label: string, detail: string): ConnectionStatusResult {
  return {
    status: "REQUIRES_CONFIGURATION",
    label,
    detail,
    canConnect: true,
    canSync: false,
    canDisconnect: false
  }
}
