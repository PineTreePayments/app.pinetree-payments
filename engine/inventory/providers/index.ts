import { cloverInventoryAdapter } from "./clover"
import { csvInventoryAdapter } from "./csv"
import { shift4InventoryAdapter } from "./shift4"
import { shopifyInventoryAdapter } from "./shopify"
import { squareInventoryAdapter } from "./square"

export const inventoryProviderAdapters = [
  shift4InventoryAdapter,
  cloverInventoryAdapter,
  squareInventoryAdapter,
  shopifyInventoryAdapter,
  csvInventoryAdapter
]

export function getInventoryProviderAdapter(provider: string) {
  return inventoryProviderAdapters.find((adapter) => adapter.provider === provider.toUpperCase()) || null
}
