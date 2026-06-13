import { NextRequest, NextResponse } from "next/server"
import { markShopifyConnectionUninstalled } from "@/database/shopifyConnections"
import { isValidShopDomain } from "@/integrations/shopify/lib/oauth"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"

// POST /api/shopify/disconnect
// Body: { shop: string }
//
// Marks the merchant-owned connection as uninstalled so it cannot create new
// checkout sessions. Shopify revokes its token through app/uninstalled.
export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    let body: { shop?: string }
    try {
      body = await req.json() as { shop?: string }
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
    }

    const shop = (body.shop ?? "").trim()
    if (!shop || !isValidShopDomain(shop)) {
      return NextResponse.json(
        { error: "Missing or invalid shop domain. Expected format: mystore.myshopify.com" },
        { status: 400 }
      )
    }

    const disconnected = await markShopifyConnectionUninstalled(shop, merchantId)
    if (!disconnected) {
      return NextResponse.json({ error: "No active connection found for this shop." }, { status: 404 })
    }
    return NextResponse.json({ shop, disconnected: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to disconnect Shopify" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
