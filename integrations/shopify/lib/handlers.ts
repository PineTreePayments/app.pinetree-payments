import { buildPineTreeSessionParams, validateShopifyOrderContext, type ShopifyOrderContext } from "./checkout"
import { verifyShopifyOAuthCallback, verifyShopifyWebhook } from "./hmac"
import { buildShopifyAuthUrl, isValidShopDomain } from "./oauth"
import type { ShopifyWebhookTopic } from "./config"

export type ShopifyConnectionStatus = "active" | "uninstalled" | "not_found"

export type ShopifyConnection = {
  shop: string
  status: ShopifyConnectionStatus
  merchantId?: string
  encryptedToken?: string
  scopes?: string
}

export type ShopifyIntegrationDeps = {
  exchangeToken: (input: {
    shop: string
    clientId: string
    clientSecret: string
    code: string
  }) => Promise<{ accessToken: string; scopes: string }>
  encryptToken: (token: string) => string
  persistConnection: (connection: ShopifyConnection) => Promise<void>
  getConnection: (shop: string) => Promise<ShopifyConnection | null>
  createCheckoutSession: (input: {
    shop: string
    idempotencyKey: string
    params: ReturnType<typeof buildPineTreeSessionParams>
  }) => Promise<{ sessionId: string; checkoutUrl: string }>
  markOrderPaid: (shop: string, payload: unknown) => Promise<void>
  markOrderCancelled: (shop: string, payload: unknown) => Promise<void>
  markUninstalled: (shop: string) => Promise<void>
  disconnect: (shop: string) => Promise<boolean>
}

export function createShopifyAuthRequest(input: {
  shop: string
  clientId: string
  redirectUri: string
  state: string
}) {
  if (!isValidShopDomain(input.shop)) throw new Error("invalid_shop")
  if (!input.state) throw new Error("missing_state")
  return {
    state: input.state,
    authUrl: buildShopifyAuthUrl(input),
  }
}

export async function completeShopifyOAuth(
  input: {
    query: Record<string, string>
    stateCookie: string
    clientId: string
    clientSecret: string
    merchantId: string
  },
  deps: ShopifyIntegrationDeps
) {
  const state = input.query.state ?? ""
  const shop = input.query.shop ?? ""
  const code = input.query.code ?? ""
  if (!input.stateCookie || input.stateCookie !== state) throw new Error("state_mismatch")
  if (!verifyShopifyOAuthCallback(input.query, input.clientSecret)) throw new Error("invalid_hmac")
  if (!isValidShopDomain(shop)) throw new Error("invalid_shop")
  if (!code) throw new Error("missing_code")

  const token = await deps.exchangeToken({
    shop,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    code,
  })
  const encryptedToken = deps.encryptToken(token.accessToken)
  await deps.persistConnection({
    shop,
    merchantId: input.merchantId,
    encryptedToken,
    scopes: token.scopes,
    status: "active",
  })
  return { shop, status: "active" as const }
}

export async function lookupShopifyStatus(shop: string, deps: ShopifyIntegrationDeps) {
  if (!isValidShopDomain(shop)) throw new Error("invalid_shop")
  const connection = await deps.getConnection(shop)
  const status = connection?.status ?? "not_found"
  return { shop, connected: status === "active", status }
}

export async function createShopifyCheckoutSession(
  input: Partial<ShopifyOrderContext>,
  deps: ShopifyIntegrationDeps
) {
  if (!validateShopifyOrderContext(input)) throw new Error("invalid_order_context")
  const connection = await deps.getConnection(input.shop)
  if (!connection || connection.status !== "active") throw new Error("shop_not_connected")
  return deps.createCheckoutSession({
    shop: input.shop,
    idempotencyKey: `shopify-${input.orderId}`,
    params: buildPineTreeSessionParams(input),
  })
}

export async function processShopifyWebhook(
  input: {
    rawBody: string
    hmac: string
    topic: ShopifyWebhookTopic
    shop: string
    clientSecret: string
  },
  deps: ShopifyIntegrationDeps
) {
  if (!verifyShopifyWebhook(input.rawBody, input.hmac, input.clientSecret)) {
    throw new Error("invalid_webhook_hmac")
  }
  const payload = JSON.parse(input.rawBody) as unknown
  if (input.topic === "orders/paid") await deps.markOrderPaid(input.shop, payload)
  if (input.topic === "orders/cancelled") await deps.markOrderCancelled(input.shop, payload)
  if (input.topic === "app/uninstalled") await deps.markUninstalled(input.shop)
  return { accepted: true }
}

export async function disconnectShopify(shop: string, deps: ShopifyIntegrationDeps) {
  if (!isValidShopDomain(shop)) throw new Error("invalid_shop")
  return { shop, disconnected: await deps.disconnect(shop) }
}
