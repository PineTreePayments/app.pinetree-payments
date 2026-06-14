import { NextRequest, NextResponse } from "next/server"
import {
  getActiveMerchantShopifyConnection,
  getMerchantShopifyConnection,
} from "@/database/shopifyConnections"
import { isValidShopDomain } from "@/integrations/shopify/lib/oauth"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"

// GET /api/shopify/status?shop=mystore.myshopify.com
//
// Returns the authenticated merchant's connection status for a Shopify shop.
export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const shop = req.nextUrl.searchParams.get("shop")?.trim() ?? ""
    if (shop && !isValidShopDomain(shop)) {
      return NextResponse.json(
        { error: "Invalid shop parameter. Expected format: mystore.myshopify.com" },
        { status: 400 }
      )
    }

    const connection = shop
      ? await getMerchantShopifyConnection(shop, merchantId)
      : await getActiveMerchantShopifyConnection(merchantId)
    const connected = connection?.status === "active"
    return NextResponse.json({
      connected,
      status: connected ? "connected" : "not_connected",
      shop: connected ? connection.shop : null,
      connectedAt: connected ? connection.installed_at : null,
      updatedAt: connected ? connection.updated_at : null,
      configured: Boolean(
        process.env.SHOPIFY_CLIENT_ID &&
        process.env.SHOPIFY_CLIENT_SECRET &&
        process.env.SHOPIFY_SCOPES &&
        (process.env.SHOPIFY_APP_URL || process.env.NEXT_PUBLIC_APP_URL) &&
        process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY
      ),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load Shopify status" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
