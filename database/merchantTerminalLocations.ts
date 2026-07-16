import { supabase, supabaseAdmin } from "./supabase"

const db = supabaseAdmin || supabase

/**
 * Provider terminal locations (one row per merchant per provider location).
 * PineTree's own `locations` table models business locations; this table
 * maps provider Terminal locations (e.g. Stripe Terminal Locations) into
 * PineTree. Service-role access only — merchants reach their rows through
 * authenticated API routes.
 */
export type MerchantTerminalLocation = {
  id: string
  merchant_id: string
  provider: string
  provider_location_id: string
  display_name: string
  address: Record<string, unknown>
  status: string
  created_at?: string
  updated_at?: string
}

export async function listMerchantTerminalLocations(
  merchantId: string,
  provider = "stripe"
): Promise<MerchantTerminalLocation[]> {
  const { data, error } = await db
    .from("merchant_terminal_locations")
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("provider", provider)
    .order("created_at", { ascending: true })

  if (error) throw new Error(`Failed to list terminal locations: ${error.message}`)
  return (data || []) as MerchantTerminalLocation[]
}

export async function getMerchantTerminalLocationById(
  merchantId: string,
  locationId: string
): Promise<MerchantTerminalLocation | null> {
  const { data, error } = await db
    .from("merchant_terminal_locations")
    .select("*")
    .eq("id", locationId)
    .eq("merchant_id", merchantId)
    .maybeSingle()

  if (error) throw new Error(`Failed to load terminal location: ${error.message}`)
  return (data as MerchantTerminalLocation) || null
}

export async function upsertMerchantTerminalLocation(input: {
  merchantId: string
  provider?: string
  providerLocationId: string
  displayName: string
  address: Record<string, unknown>
  status?: string
}): Promise<MerchantTerminalLocation> {
  const now = new Date().toISOString()
  const { data, error } = await db
    .from("merchant_terminal_locations")
    .upsert(
      {
        merchant_id: input.merchantId,
        provider: input.provider || "stripe",
        provider_location_id: input.providerLocationId,
        display_name: input.displayName,
        address: input.address,
        status: input.status || "active",
        updated_at: now
      },
      { onConflict: "merchant_id,provider,provider_location_id" }
    )
    .select("*")
    .single()

  if (error || !data) throw new Error(`Failed to save terminal location: ${error?.message || "unknown error"}`)
  return data as MerchantTerminalLocation
}
