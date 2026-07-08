import { supabase, supabaseAdmin } from "./supabase"

const db = supabaseAdmin || supabase

export type Merchant = {
  id: string
  business_name: string
  email: string
  created_at: string
  updated_at: string
  status: "active" | "suspended"
  role?: string | null
  owner_first_name?: string | null
  owner_last_name?: string | null
  business_country?: string | null
}

export type MerchantBusinessOwnerProfile = {
  ownerFirstName: string
  ownerLastName: string
  businessCountry: string
}

export type MerchantSettings = {
  merchant_id: string
  default_provider?: string
  pinetree_fee_enabled: boolean
  pinetree_fee_amount: number
  tax_enabled: boolean
  tax_rate: number
  created_at: string
  updated_at: string
}

export type MerchantProvider = {
  merchant_id: string
  provider: string
  status: "connected" | "active" | "disconnected" | "pending" | "denied"
  enabled?: boolean
  credentials?: unknown
  created_at: string
}

/**
 * Get merchant by ID
 */
export async function getMerchantById(merchantId: string) {
  const { data, error } = await db
    .from("merchants")
    .select("*")
    .eq("id", merchantId)
    .single()

  if (error) {
    return null
  }

  return data as Merchant | null
}

/**
 * Returns the merchant's saved business-owner identity fields (first/last name,
 * country), or null if any of them are still missing. These are collected once
 * from the merchant and are required before Speed Custom Connect account
 * creation can run automatically.
 */
export function getMerchantBusinessOwnerProfile(
  merchant: Pick<Merchant, "owner_first_name" | "owner_last_name" | "business_country"> | null | undefined
): MerchantBusinessOwnerProfile | null {
  const ownerFirstName = String(merchant?.owner_first_name || "").trim()
  const ownerLastName = String(merchant?.owner_last_name || "").trim()
  const businessCountry = String(merchant?.business_country || "").trim().toUpperCase()

  if (!ownerFirstName || !ownerLastName || !businessCountry) return null

  return { ownerFirstName, ownerLastName, businessCountry }
}

/**
 * Save the merchant's business-owner identity fields. This is a one-time
 * form filled in by the merchant; it never collects a Speed password —
 * Speed Custom Connect account creation generates and discards one.
 */
export async function updateMerchantBusinessOwnerProfile(
  merchantId: string,
  profile: MerchantBusinessOwnerProfile
): Promise<Merchant> {
  const { data, error } = await db
    .from("merchants")
    .update({
      owner_first_name: profile.ownerFirstName,
      owner_last_name: profile.ownerLastName,
      business_country: profile.businessCountry.toUpperCase(),
      updated_at: new Date().toISOString()
    })
    .eq("id", merchantId)
    .select()
    .single()

  if (error || !data) {
    throw new Error(`Failed to update business owner profile: ${error?.message || "unknown error"}`)
  }

  return data as Merchant
}

/**
 * Get merchant settings
 */
export async function getMerchantSettings(merchantId: string) {
  const { data, error } = await db
    .from("merchant_settings")
    .select("*")
    .eq("merchant_id", merchantId)
    .single()

  if (error) {
    return null
  }

  return data as MerchantSettings | null
}

/**
 * Update merchant settings
 */
export async function updateMerchantSettings(
  merchantId: string,
  settings: Partial<MerchantSettings>
) {
  const { data, error } = await db
    .from("merchant_settings")
    .update({
      ...settings,
      updated_at: new Date().toISOString()
    })
    .eq("merchant_id", merchantId)
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to update merchant settings: ${error.message}`)
  }

  return data as MerchantSettings
}

/**
 * Get merchant's connected providers
 */
export async function getMerchantProviders(merchantId: string) {
  const { data, error } = await db
    .from("merchant_providers")
    .select("*")
    .eq("merchant_id", merchantId)
    .in("status", ["connected", "active"])

  if (error) {
    return []
  }

  return data as MerchantProvider[]
}

/**
 * Get merchant's default provider
 */
export async function getMerchantDefaultProvider(merchantId: string) {
  const settings = await getMerchantSettings(merchantId)
  return settings?.default_provider || null
}

/**
 * Check if merchant has a provider connected
 */
export async function hasProviderConnected(
  merchantId: string,
  provider: string
) {
  const { data, error } = await db
    .from("merchant_providers")
    .select("id")
    .eq("merchant_id", merchantId)
    .eq("provider", provider)
    .in("status", ["connected", "active"])
    .maybeSingle()

  if (error || !data) {
    return false
  }

  return true
}

/**
 * Get merchant tax settings
 */
export async function getMerchantTaxSettings(merchantId: string) {
  const { data, error } = await db
    .from("merchant_tax_settings")
    .select("tax_enabled,tax_rate")
    .eq("merchant_id", merchantId)
    .maybeSingle()

  if (!error && data) {
    return {
      taxEnabled: Boolean(data.tax_enabled),
      taxRate: Number(data.tax_rate || 0)
    }
  }

  const settings = await getMerchantSettings(merchantId)
  if (!settings) {
    return {
      taxEnabled: false,
      taxRate: 0
    }
  }

  return {
    taxEnabled: Boolean(settings.tax_enabled),
    taxRate: Number(settings.tax_rate || 0)
  }
}

/**
 * Get merchant credential for a provider
 */
export async function getMerchantCredential(
  merchantId: string,
  credentialKey: string
) {
  const { data, error } = await db
    .from("merchant_credentials")
    .select("value")
    .eq("merchant_id", merchantId)
    .eq("credential_key", credentialKey)
    .maybeSingle()

  if (error || !data) {
    return null
  }

  return data.value
}

/**
 * Store merchant credential
 */
export async function storeMerchantCredential(
  merchantId: string,
  credentialKey: string,
  value: string
) {
  const { error } = await db
    .from("merchant_credentials")
    .upsert({
      merchant_id: merchantId,
      credential_key: credentialKey,
      value
    })

  if (error) {
    throw new Error(`Failed to store credential: ${error.message}`)
  }
}
