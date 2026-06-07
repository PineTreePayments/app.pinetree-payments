import { getMerchantCredential } from "@/database"
import { persistedStatus, requiredConfiguration } from "./helpers"
import type { InventoryProviderAdapter } from "./types"

export const shift4InventoryAdapter: InventoryProviderAdapter = {
  provider: "SHIFT4_SKYTAB",
  label: "Shift4 / SkyTab",
  async getConnectionStatus(merchantId) {
    const merchantKey = await getMerchantCredential(merchantId, "shift4_api_key")
    const catalogApiUrl = String(process.env.SHIFT4_INVENTORY_API_URL || "").trim()
    const fallback = requiredConfiguration(
      this.label,
      merchantKey && catalogApiUrl
        ? "Shift4 payment credentials exist, but catalog access must be verified before sync is enabled."
        : "Shift4/SkyTab inventory sync requires Shift4 partner inventory/catalog API access."
    )
    return persistedStatus(merchantId, this.provider, fallback)
  },
  async startConnection() {
    return {
      status: "REQUIRES_CONFIGURATION",
      message: "Request Shift4 partner inventory/catalog API access and configure SHIFT4_INVENTORY_API_URL."
    }
  }
}
