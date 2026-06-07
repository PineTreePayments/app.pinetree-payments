import { upsertInventoryIntegration } from "@/database"
import { getInventoryProviderAdapter, inventoryProviderAdapters } from "./providers"

export async function listInventoryIntegrationStatuses(merchantId: string) {
  return Promise.all(inventoryProviderAdapters.map(async (adapter) => ({
    provider: adapter.provider,
    ...(await adapter.getConnectionStatus(merchantId))
  })))
}

export async function connectInventoryProvider(merchantId: string, provider: string) {
  const adapter = getInventoryProviderAdapter(provider)
  if (!adapter) throw new Error("Unknown inventory provider")
  if (!adapter.startConnection) throw new Error("This inventory provider does not require a connection")

  const result = await adapter.startConnection(merchantId)
  await upsertInventoryIntegration(merchantId, adapter.provider, {
    status: result.status,
    last_error: result.status === "ERROR" ? result.message : null,
    external_account_label: null,
    last_sync_at: null,
    sync_direction: "IMPORT",
    metadata: {}
  })
  return result
}

export async function syncInventoryProvider(merchantId: string, provider: string) {
  const adapter = getInventoryProviderAdapter(provider)
  if (!adapter) throw new Error("Unknown inventory provider")
  if (!adapter.syncInventory) throw new Error("Inventory sync requires provider configuration")
  return adapter.syncInventory(merchantId)
}

export async function disconnectInventoryProvider(merchantId: string, provider: string) {
  const adapter = getInventoryProviderAdapter(provider)
  if (!adapter) throw new Error("Unknown inventory provider")
  if (adapter.disconnect) await adapter.disconnect(merchantId)
  await upsertInventoryIntegration(merchantId, adapter.provider, {
    status: "DISABLED",
    last_error: null,
    external_account_label: null,
    last_sync_at: null,
    sync_direction: "IMPORT",
    metadata: {}
  })
  return { status: "DISABLED" as const }
}
