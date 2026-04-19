import { supabase, supabaseAdmin } from "./supabase"

const db = supabaseAdmin || supabase

export type Merchant = {
  id: string
  business_name: string
  email: string
  created_at: string
  updated_at: string
  status: "active" | "suspended"
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
  status: "connected" | "active" | "disconnected"
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