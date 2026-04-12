import { supabaseAdmin, supabase } from "@/database"

const db = supabaseAdmin || supabase

export type MerchantSettingsPayload = {
  business_name: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
  phone: string | null
  business_type: string | null
  closeout_time: string
  report_toast: boolean
}

export type MerchantTaxSettingsPayload = {
  tax_enabled: boolean
  tax_rate: number
  tax_name: string
}

export type SettingsDashboardData = {
  settings: MerchantSettingsPayload
  tax: MerchantTaxSettingsPayload
}

const DEFAULT_SETTINGS: MerchantSettingsPayload = {
  business_name: null,
  address: null,
  city: null,
  state: null,
  zip: null,
  country: null,
  phone: null,
  business_type: null,
  closeout_time: "12:00",
  report_toast: true
}

const DEFAULT_TAX: MerchantTaxSettingsPayload = {
  tax_enabled: false,
  tax_rate: 0,
  tax_name: "Sales Tax"
}

export async function getSettingsDashboardEngine(merchantId: string): Promise<SettingsDashboardData> {
  const { data: settingsData, error: settingsError } = await db
    .from("merchant_settings")
    .select("business_name,address,city,state,zip,country,phone,business_type,closeout_time,report_toast")
    .eq("merchant_id", merchantId)
    .maybeSingle()

  if (settingsError) {
    throw new Error(`Failed to load settings: ${settingsError.message}`)
  }

  const { data: taxData, error: taxError } = await db
    .from("merchant_tax_settings")
    .select("tax_enabled,tax_rate,tax_name")
    .eq("merchant_id", merchantId)
    .maybeSingle()

  if (taxError) {
    throw new Error(`Failed to load tax settings: ${taxError.message}`)
  }

  const settings = {
    ...DEFAULT_SETTINGS,
    ...(settingsData || {})
  }

  const tax = {
    ...DEFAULT_TAX,
    ...(taxData || {})
  }

  if (!settingsData) {
    await db
      .from("merchant_settings")
      .insert({ merchant_id: merchantId, ...DEFAULT_SETTINGS })
  }

  if (!taxData) {
    await db
      .from("merchant_tax_settings")
      .insert({ merchant_id: merchantId, ...DEFAULT_TAX })
  }

  return { settings, tax }
}

export async function saveSettingsDashboardEngine(
  merchantId: string,
  settings: MerchantSettingsPayload,
  tax: MerchantTaxSettingsPayload
) {
  const { error: settingsError } = await db
    .from("merchant_settings")
    .upsert(
      {
        merchant_id: merchantId,
        ...settings
      },
      { onConflict: "merchant_id" }
    )

  if (settingsError) {
    throw new Error(`Failed to save settings: ${settingsError.message}`)
  }

  const { error: taxError } = await db
    .from("merchant_tax_settings")
    .upsert(
      {
        merchant_id: merchantId,
        ...tax
      },
      { onConflict: "merchant_id" }
    )

  if (taxError) {
    throw new Error(`Failed to save tax settings: ${taxError.message}`)
  }
}
