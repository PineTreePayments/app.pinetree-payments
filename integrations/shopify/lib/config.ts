// Shopify app constants for the PineTree integration.
// All runtime values are read from environment variables — never hardcoded here.

export const SHOPIFY_APP_CONFIG = {
  // Shopify Admin API version used for all API calls.
  API_VERSION: "2025-01",

  // OAuth scopes required for the PineTree payment integration.
  // read_orders / write_orders — retrieve and update order status after payment.
  // read_checkouts — access checkout data to build session params.
  REQUIRED_SCOPES: "read_orders,write_orders,read_checkouts",

  // Webhook topics PineTree subscribes to on install.
  WEBHOOK_TOPICS: [
    "orders/paid",
    "orders/cancelled",
    "orders/updated",
    "app/uninstalled",
  ] as const,
} as const

export type ShopifyWebhookTopic =
  (typeof SHOPIFY_APP_CONFIG.WEBHOOK_TOPICS)[number]

// Names of the environment variables this integration reads.
// Centralised here so they're easy to audit and grep.
export const ENV_KEYS = {
  SHOPIFY_CLIENT_ID:              "SHOPIFY_CLIENT_ID",
  SHOPIFY_CLIENT_SECRET:          "SHOPIFY_CLIENT_SECRET",
  SHOPIFY_SCOPES:                 "SHOPIFY_SCOPES",
  SHOPIFY_APP_URL:                "SHOPIFY_APP_URL",
  // 64-char hex (32 bytes) used by lib/crypto.ts to AES-256-GCM-encrypt access tokens.
  SHOPIFY_TOKEN_ENCRYPTION_KEY:   "SHOPIFY_TOKEN_ENCRYPTION_KEY",
} as const
