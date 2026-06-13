import { NextRequest, NextResponse } from "next/server"
import {
  validateShopifyOrderContext,
  buildPineTreeSessionParams,
  type ShopifyOrderContext,
} from "@/integrations/shopify/lib/checkout"
import { getActiveShopifyConnection } from "@/database/shopifyConnections"
import { createCheckoutSessionEngine } from "@/engine/checkoutSessions"

// POST /api/shopify/session
//
// Creates a PineTree checkout session from a Shopify order context.
// Called by the Shopify app when a customer reaches checkout and the merchant
// has configured PineTree as their payment method.
//
// Request body: ShopifyOrderContext (JSON)
// Response: { sessionId: string, checkoutUrl: string }
export async function POST(req: NextRequest) {
  let body: Partial<ShopifyOrderContext>
  try {
    body = await req.json() as Partial<ShopifyOrderContext>
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
  }

  if (!validateShopifyOrderContext(body)) {
    return NextResponse.json(
      { error: "Missing or invalid order context fields." },
      { status: 422 }
    )
  }

  const ctx = body as ShopifyOrderContext

  let sessionParams
  try {
    sessionParams = buildPineTreeSessionParams(ctx)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: "Cannot build session params.", detail: message }, { status: 422 })
  }

  try {
    const connection = await getActiveShopifyConnection(ctx.shop)
    if (!connection) return NextResponse.json({ error: "Shop not connected." }, { status: 403 })
    const session = await createCheckoutSessionEngine({
      merchantId: connection.merchant_id,
      amount: sessionParams.amount,
      currency: sessionParams.currency,
      orderId: sessionParams.reference,
      customerEmail: sessionParams.customer?.email,
      successUrl: sessionParams.successUrl,
      cancelUrl: sessionParams.cancelUrl,
      metadata: sessionParams.metadata,
    })
    return NextResponse.json({ sessionId: session.sessionId, checkoutUrl: session.checkoutUrl })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: "PineTree session request failed.", detail: message }, { status: 502 })
  }
}
