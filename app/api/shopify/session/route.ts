import { NextRequest, NextResponse } from "next/server"
import {
  validateShopifyOrderContext,
  buildPineTreeSessionParams,
  type ShopifyOrderContext,
} from "@/integrations/shopify/lib/checkout"

// POST /api/shopify/session
//
// Creates a PineTree checkout session from a Shopify order context.
// Called by the Shopify app when a customer reaches checkout and the merchant
// has configured PineTree as their payment method.
//
// Request body: ShopifyOrderContext (JSON)
// Response: { sessionId: string, checkoutUrl: string }
export async function POST(req: NextRequest) {
  const appUrl = (process.env.SHOPIFY_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")
  if (!appUrl) {
    return NextResponse.json(
      { error: "Server is not configured correctly." },
      { status: 503 }
    )
  }

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

  // TODO: look up the shopify_connections row for ctx.shop and retrieve
  // the PineTree merchant_id + API secret key so we can call the internal
  // checkout session API on their behalf.
  //
  //   const connection = await db.query(
  //     "SELECT merchant_id FROM shopify_connections WHERE shop = $1 AND status = 'active'",
  //     [ctx.shop]
  //   )
  //   if (!connection.rowCount) return NextResponse.json({ error: "Shop not connected." }, { status: 403 })

  // Forward to PineTree internal checkout session creation.
  // Idempotency key prevents duplicate sessions if Shopify retries.
  const idempotencyKey = `shopify-${ctx.orderId}`
  const internalUrl    = `${appUrl}/api/v1/checkout/sessions`

  let sessionId: string
  let checkoutUrl: string
  try {
    const sessionRes = await fetch(internalUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        // TODO: replace with the merchant's API key from shopify_connections
        // "Authorization": `Bearer ${merchantApiKey}`,
      },
      body: JSON.stringify(sessionParams),
    })

    if (!sessionRes.ok) {
      return NextResponse.json(
        { error: "PineTree session creation failed.", detail: `Status ${sessionRes.status}` },
        { status: 502 }
      )
    }

    const data = await sessionRes.json() as { id?: string; sessionId?: string; checkoutUrl?: string }
    const returnedSessionId = data.id ?? data.sessionId
    if (!returnedSessionId || !data.checkoutUrl) {
      return NextResponse.json({ error: "PineTree session response was malformed." }, { status: 502 })
    }
    sessionId   = returnedSessionId
    checkoutUrl = data.checkoutUrl
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: "PineTree session request failed.", detail: message }, { status: 502 })
  }

  return NextResponse.json({ sessionId, checkoutUrl })
}
