import { persistedStatus, requiredConfiguration } from "./helpers"
import type { InventoryProviderAdapter } from "./types"

export const cloverInventoryAdapter: InventoryProviderAdapter = {
  provider: "CLOVER",
  label: "Clover",
  async getConnectionStatus(merchantId) {
    const configured = Boolean(process.env.CLOVER_CLIENT_ID && process.env.CLOVER_CLIENT_SECRET)
    return persistedStatus(
      merchantId,
      this.provider,
      requiredConfiguration(
        this.label,
        configured
          ? "Clover application credentials are present. OAuth callback and merchant authorization must be completed before catalog sync."
          : "Configure CLOVER_CLIENT_ID, CLOVER_CLIENT_SECRET, and CLOVER_ENV to enable OAuth."
      )
    )
  },
  async startConnection() {
    return {
      status: "REQUIRES_CONFIGURATION",
      message: "Clover OAuth callback and merchant token storage are required before connecting."
    }
  }
}
