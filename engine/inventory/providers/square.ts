import { persistedStatus, requiredConfiguration } from "./helpers"
import type { InventoryProviderAdapter } from "./types"

export const squareInventoryAdapter: InventoryProviderAdapter = {
  provider: "SQUARE",
  label: "Square",
  async getConnectionStatus(merchantId) {
    const configured = Boolean(process.env.SQUARE_APPLICATION_ID && process.env.SQUARE_ACCESS_TOKEN)
    return persistedStatus(
      merchantId,
      this.provider,
      requiredConfiguration(
        this.label,
        configured
          ? "Square credentials are present, but merchant-scoped catalog authorization must be verified before sync."
          : "Configure Square application credentials or a merchant OAuth credential path."
      )
    )
  },
  async startConnection() {
    return {
      status: "REQUIRES_CONFIGURATION",
      message: "Square merchant OAuth and token storage are required before connecting."
    }
  }
}
