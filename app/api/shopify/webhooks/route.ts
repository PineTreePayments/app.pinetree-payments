import { NextRequest, NextResponse } from "next/server"
import { verifyShopifyWebhook } from "@/integrations/shopify/lib/hmac"
import type { ShopifyWebhookTopic } from "@/integrations/shopify/lib/config"

// POST /api/shopify/webhooks
//
// Receives Shopify webhook events. Raw body must be read before any JSON
// parsing so the HMAC is computed over the exact bytes Shopify sent.
export async function POST(req: NextRequest) {
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET
  if (!clientSecret) {
    return NextResponse.json(
      { error: "Shopify integration is not configured on this server." },
      { status: 503 }
    )
  }

  const hmacHeader = req.headers.get("x-shopify-hmac-sha256") ?? ""
  const topic      = (req.headers.get("x-shopify-topic") ?? "") as ShopifyWebhookTopic
  const shop       = req.headers.get("x-shopify-shop-domain") ?? ""

  // Read raw body as text — must happen before calling .json() which consumes
  // the stream. Shopify signs the raw bytes, not the parsed object.
  const rawBody = await req.text()

  if (!verifyShopifyWebhook(rawBody, hmacHeader, clientSecret)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 })
  }

  switch (topic) {
    case "orders/paid":
      await handleOrderPaid(shop, payload)
      break
    case "orders/cancelled":
      await handleOrderCancelled(shop, payload)
      break
    case "orders/updated":
      await handleOrderUpdated(shop, payload)
      break
    case "app/uninstalled":
      await handleAppUninstalled(shop)
      break
    default:
      // Unknown topic — acknowledge receipt without processing.
      break
  }

  // Shopify requires a 200 response within 5 seconds or it retries.
  return new NextResponse(null, { status: 200 })
}

// ── Stub handlers — wire to PineTree checkout session logic ──────────────────

async function handleOrderPaid(shop: string, payload: unknown): Promise<void> {
  // TODO: look up the PineTree checkout session by shopify_order_id from
  // payload, then mark the session as paid if still in a pending state.
  void shop
  void payload
}

async function handleOrderCancelled(shop: string, payload: unknown): Promise<void> {
  // TODO: look up the PineTree checkout session and mark as cancelled.
  void shop
  void payload
}

async function handleOrderUpdated(shop: string, payload: unknown): Promise<void> {
  // TODO: sync status changes that PineTree should reflect (e.g., refunded).
  void shop
  void payload
}

async function handleAppUninstalled(shop: string): Promise<void> {
  // TODO: update shopify_connections set status = 'uninstalled',
  //       uninstalled_at = now() where shop = $1 and status = 'active'
  void shop
}
