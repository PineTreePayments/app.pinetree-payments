import { NextRequest, NextResponse } from "next/server"
import { getMerchantShopifyConnection } from "@/database/shopifyConnections"
import { isValidShopDomain } from "@/integrations/shopify/lib/oauth"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"

// GET /api/shopify/status?shop=mystore.myshopify.com
//
// Returns the authenticated merchant's connection status for a Shopify shop.
export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const shop = req.nextUrl.searchParams.get("shop") ?? ""

    if (!shop || !isValidShopDomain(shop)) {
      return NextResponse.json(
        { error: "Missing or invalid shop parameter. Expected format: mystore.myshopify.com" },
        { status: 400 }
      )
    }

    const connection = await getMerchantShopifyConnection(shop, merchantId)
    const status = connection?.status ?? "not_found"
    return NextResponse.json({ shop, connected: status === "active", status })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load Shopify status" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
