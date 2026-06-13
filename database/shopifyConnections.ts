import { supabaseAdmin } from "./supabase"

export type ShopifyConnectionRow = {
  id: string
  shop: string
  merchant_id: string
  access_token: string
  scopes: string
  status: "active" | "uninstalled"
  installed_at: string
  uninstalled_at: string | null
  updated_at: string
}

function db() {
  if (!supabaseAdmin) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for Shopify integration storage")
  }
  return supabaseAdmin
}

export async function upsertShopifyConnection(input: {
  shop: string
  merchantId: string
  encryptedToken: string
  scopes: string
}) {
  await markShopifyConnectionUninstalled(input.shop)
  const { data, error } = await db()
    .from("shopify_connections")
    .insert({
      shop: input.shop,
      merchant_id: input.merchantId,
      access_token: input.encryptedToken,
      scopes: input.scopes,
      status: "active",
    })
    .select()
    .single()
  if (error) throw new Error(`Failed to persist Shopify connection: ${error.message}`)
  return data as ShopifyConnectionRow
}

export async function getActiveShopifyConnection(shop: string) {
  const { data, error } = await db()
    .from("shopify_connections")
    .select("*")
    .eq("shop", shop)
    .eq("status", "active")
    .maybeSingle()
  if (error) throw new Error(`Failed to load Shopify connection: ${error.message}`)
  return (data ?? null) as ShopifyConnectionRow | null
}

export async function getMerchantShopifyConnection(shop: string, merchantId: string) {
  const { data, error } = await db()
    .from("shopify_connections")
    .select("*")
    .eq("shop", shop)
    .eq("merchant_id", merchantId)
    .order("installed_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Failed to load Shopify connection status: ${error.message}`)
  return (data ?? null) as ShopifyConnectionRow | null
}

export async function markShopifyConnectionUninstalled(shop: string, merchantId?: string) {
  let query = db()
    .from("shopify_connections")
    .update({
      status: "uninstalled",
      uninstalled_at: new Date().toISOString(),
    })
    .eq("shop", shop)
    .eq("status", "active")
  if (merchantId) query = query.eq("merchant_id", merchantId)
  const { data, error } = await query.select("id")
  if (error) throw new Error(`Failed to disconnect Shopify connection: ${error.message}`)
  return (data ?? []).length > 0
}
