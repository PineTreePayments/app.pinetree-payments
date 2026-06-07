import { persistedStatus, requiredConfiguration } from "./helpers"
import type { InventoryProviderAdapter } from "./types"

export const shopifyInventoryAdapter: InventoryProviderAdapter = {
  provider: "SHOPIFY",
  label: "Shopify",
  async getConnectionStatus(merchantId) {
    const configured = Boolean(
      process.env.SHOPIFY_CLIENT_ID &&
      process.env.SHOPIFY_CLIENT_SECRET &&
      process.env.SHOPIFY_APP_URL
    )
    return persistedStatus(
      merchantId,
      this.provider,
      requiredConfiguration(
        this.label,
        configured
          ? "Shopify app credentials are present. Store installation and offline access token storage are still required."
          : "Configure SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, and SHOPIFY_APP_URL."
      )
    )
  },
  async startConnection() {
    return {
      status: "REQUIRES_CONFIGURATION",
      message: "Shopify store installation and offline token storage are required before connecting."
    }
  }
}
