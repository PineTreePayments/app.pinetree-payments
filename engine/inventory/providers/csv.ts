import type { InventoryProviderAdapter } from "./types"

export const csvInventoryAdapter: InventoryProviderAdapter = {
  provider: "MANUAL_CSV",
  label: "Manual CSV Import",
  async getConnectionStatus() {
    return {
      status: "AVAILABLE",
      label: this.label,
      detail: "Upload a CSV file to create inventory items. Existing SKUs are skipped.",
      canConnect: false,
      canSync: false,
      canDisconnect: false
    }
  }
}
