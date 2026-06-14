// Pure mapping functions from Shopify order context to PineTree session params.
// No network calls, no side effects.

export type ShopifyOrderContext = {
  shop: string        // "mystore.myshopify.com"
  orderId: string     // Shopify GID: "gid://shopify/Order/123456"
  orderNumber: string // Human-readable "#1042" or "1042" — used as PineTree reference
  totalPrice: string  // Decimal string "49.99"
  currency: string    // ISO 4217 "USD"
  email: string | null
  successUrl: string  // Must be https://
  cancelUrl: string   // Must be https://
}

export type PineTreeSessionParams = {
  amount: number
  currency: string
  reference: string
  customer?: { email: string }
  metadata: { shopify_order_id: string; shop: string }
  successUrl: string
  cancelUrl: string
}

// Map a Shopify order context to PineTree checkout session params.
// Throws if the amount is not a valid positive number.
export function buildPineTreeSessionParams(
  ctx: ShopifyOrderContext
): PineTreeSessionParams {
  const amount = parseFloat(ctx.totalPrice)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid order amount: "${ctx.totalPrice}"`)
  }

  return {
    amount,
    currency: ctx.currency,
    reference: ctx.orderNumber,
    ...(ctx.email ? { customer: { email: ctx.email } } : {}),
    metadata: {
      shopify_order_id: ctx.orderId,
      shop: ctx.shop,
    },
    successUrl: ctx.successUrl,
    cancelUrl: ctx.cancelUrl,
  }
}

// Type guard: all required fields present and structurally valid.
// Does not validate that the shop is a connected PineTree merchant.
export function validateShopifyOrderContext(
  ctx: Partial<ShopifyOrderContext>
): ctx is ShopifyOrderContext {
  return (
    typeof ctx.shop === "string" && ctx.shop.length > 0 &&
    typeof ctx.orderId === "string" && ctx.orderId.length > 0 &&
    typeof ctx.orderNumber === "string" && ctx.orderNumber.length > 0 &&
    typeof ctx.totalPrice === "string" && ctx.totalPrice.length > 0 &&
    typeof ctx.currency === "string" && ctx.currency.length === 3 &&
    (ctx.email === null || typeof ctx.email === "string") &&
    typeof ctx.successUrl === "string" && ctx.successUrl.startsWith("https://") &&
    typeof ctx.cancelUrl === "string" && ctx.cancelUrl.startsWith("https://")
  )
}
