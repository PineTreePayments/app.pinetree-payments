import { NextRequest, NextResponse } from "next/server"
import { isValidShopDomain } from "@/integrations/shopify/lib/oauth"

// POST /api/shopify/disconnect
// Body: { shop: string }
//
// Disconnects a Shopify store from PineTree. Marks the shopify_connections row
// as uninstalled so the shop cannot create new checkout sessions until
// reinstalled. Does NOT revoke the Shopify access token via Admin API — that
// is handled by the app/uninstalled webhook automatically when the merchant
// uninstalls from their Shopify admin panel.
//
// Status: STUB — requires merchant session lookup and database access.
// See integrations/shopify/README.md for the implementation checklist.
export async function POST(req: NextRequest) {
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

  // TODO: verify that the caller is authenticated as a PineTree merchant and
  // owns this shop (i.e., shopify_connections.merchant_id matches the session).

  // TODO: execute disconnect:
  //   await db.query(
  //     `UPDATE shopify_connections
  //        SET status         = 'uninstalled',
  //            uninstalled_at = now(),
  //            updated_at     = now()
  //      WHERE shop        = $1
  //        AND status      = 'active'`,
  //     [shop]
  //   )
  //
  //   if (result.rowCount === 0) {
  //     return NextResponse.json({ error: "No active connection found for this shop." }, { status: 404 })
  //   }

  return NextResponse.json(
    {
      error: "Disconnect not yet implemented.",
      detail: "Merchant session lookup and database access are required. See integrations/shopify/README.md.",
    },
    { status: 501 }
  )
}
