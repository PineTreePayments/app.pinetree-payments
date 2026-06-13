import { NextRequest, NextResponse } from "next/server"
import { isValidShopDomain } from "@/integrations/shopify/lib/oauth"

// GET /api/shopify/status?shop=mystore.myshopify.com
//
// Returns the PineTree connection status for a given Shopify shop.
// Used by the Developer dashboard to show whether a store is connected.
//
// Response shape:
//   { shop: string, connected: boolean, status: "active" | "uninstalled" | "not_found" }
//
// Status: STUB — returns a static placeholder. Requires database access.
// See integrations/shopify/README.md for the implementation checklist.
export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get("shop") ?? ""

  if (!shop || !isValidShopDomain(shop)) {
    return NextResponse.json(
      { error: "Missing or invalid shop parameter. Expected format: mystore.myshopify.com" },
      { status: 400 }
    )
  }

  // TODO: query the database once merchant sessions and DB access are wired:
  //
  //   const row = await db.query(
  //     "SELECT status FROM shopify_connections WHERE shop = $1 ORDER BY installed_at DESC LIMIT 1",
  //     [shop]
  //   )
  //   const status = row.rows[0]?.status ?? "not_found"
  //   return NextResponse.json({ shop, connected: status === "active", status })

  return NextResponse.json({
    shop,
    connected: false,
    status:    "not_found",
    _stub:     true,
    message:   "Status lookup not yet wired to database. See integrations/shopify/README.md.",
  })
}
