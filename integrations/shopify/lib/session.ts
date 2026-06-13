// Types for the shopify_connections database table and Admin API helpers.

export type ShopifyConnectionStatus = "active" | "uninstalled"

// One row per (shop, merchant_id) pair in shopify_connections.
// The access_token is encrypted at the application layer before storage —
// never read directly in queries or written to logs.
export type ShopifyConnection = {
  id: string
  shop: string                     // e.g. "mystore.myshopify.com"
  merchant_id: string              // PineTree auth.users.id
  access_token: string             // Encrypted Shopify access token
  scopes: string                   // Comma-separated granted scopes
  status: ShopifyConnectionStatus
  installed_at: string             // ISO 8601
  uninstalled_at: string | null
}

// Normalise a shop domain: lowercase, strip protocol and trailing slash.
// Input might come from URL params or user input.
export function normalizeShopDomain(input: string): string {
  return input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "")
}

// Build the Shopify Admin REST API base URL for a connected shop.
export function shopAdminBaseUrl(shop: string, apiVersion: string): string {
  return `https://${shop}/admin/api/${apiVersion}`
}

// Headers required to call the Shopify Admin API on behalf of a connected shop.
// Never log or expose the access token value.
export function buildAdminApiHeaders(accessToken: string): Record<string, string> {
  return {
    "X-Shopify-Access-Token": accessToken,
    "Content-Type": "application/json",
    Accept: "application/json",
  }
}
