import { supabase, supabaseAdmin } from "./supabase"

const db = supabaseAdmin || supabase

export type MerchantReportPaymentRow = {
  id: string
  merchant_amount?: number | string | null
  pinetree_fee?: number | string | null
  gross_amount?: number | string | null
  currency?: string | null
  provider?: string | null
  provider_reference?: string | null
  network?: string | null
  status?: string | null
  metadata?: Record<string, unknown> | null
  created_at: string
  transactions?: Array<{
    id?: string | null
    status?: string | null
    provider?: string | null
    provider_transaction_id?: string | null
    network?: string | null
    channel?: string | null
    total_amount?: number | string | null
    subtotal_amount?: number | string | null
    platform_fee?: number | string | null
    created_at?: string | null
  }> | null
}

export type MerchantReportContext = {
  merchant: {
    id: string
    name: string
    email: string | null
  }
  settings: {
    business_name: string | null
    address: string | null
    city: string | null
    state: string | null
    zip: string | null
    country: string | null
    phone: string | null
  }
  tax: {
    tax_enabled: boolean
    tax_rate: number
    tax_name: string
  }
}

type MerchantRow = {
  id?: string | null
  name?: string | null
  business_name?: string | null
  email?: string | null
}

type SettingsRow = {
  business_name?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  country?: string | null
  phone?: string | null
}

type TaxRow = {
  tax_enabled?: boolean | null
  tax_rate?: number | string | null
  tax_name?: string | null
}

export async function getMerchantPaymentsForReport(input: {
  merchantId: string
  startDate: string
  endDate: string
}) {
  const merchantId = String(input.merchantId || "").trim()
  const startDate = String(input.startDate || "").trim()
  const endDate = String(input.endDate || "").trim()

  if (!merchantId || !startDate || !endDate) {
    throw new Error("Missing required report filters")
  }

  const { data, error } = await db
    .from("payments")
    .select(`
      id,
      merchant_amount,
      pinetree_fee,
      gross_amount,
      currency,
      provider,
      provider_reference,
      network,
      status,
      metadata,
      created_at,
      transactions (
        id,
        status,
        provider,
        provider_transaction_id,
        network,
        channel,
        total_amount,
        subtotal_amount,
        platform_fee,
        created_at
      )
    `)
    .eq("merchant_id", merchantId)
    .gte("created_at", startDate)
    .lte("created_at", endDate)
    .order("created_at", { ascending: true })

  if (error) {
    throw new Error(`Failed to load report payments: ${error.message}`)
  }

  return (data || []) as MerchantReportPaymentRow[]
}

export async function getMerchantReportContext(merchantId: string): Promise<MerchantReportContext> {
  const normalizedMerchantId = String(merchantId || "").trim()
  if (!normalizedMerchantId) {
    throw new Error("Missing merchant id")
  }

  const [{ data: merchantData }, { data: settingsData }, { data: taxData }] = await Promise.all([
    db
      .from("merchants")
      .select("id,name,business_name,email")
      .eq("id", normalizedMerchantId)
      .maybeSingle(),
    db
      .from("merchant_settings")
      .select("business_name,address,city,state,zip,country,phone")
      .eq("merchant_id", normalizedMerchantId)
      .maybeSingle(),
    db
      .from("merchant_tax_settings")
      .select("tax_enabled,tax_rate,tax_name")
      .eq("merchant_id", normalizedMerchantId)
      .maybeSingle()
  ])

  const merchant = (merchantData || {}) as MerchantRow
  const settings = (settingsData || {}) as SettingsRow
  const tax = (taxData || {}) as TaxRow
  const businessName = settings.business_name || merchant.business_name || merchant.name || "PineTree Merchant"

  return {
    merchant: {
      id: normalizedMerchantId,
      name: businessName,
      email: merchant.email || null
    },
    settings: {
      business_name: businessName,
      address: settings.address || null,
      city: settings.city || null,
      state: settings.state || null,
      zip: settings.zip || null,
      country: settings.country || null,
      phone: settings.phone || null
    },
    tax: {
      tax_enabled: Boolean(tax.tax_enabled),
      tax_rate: Number(tax.tax_rate || 0),
      tax_name: tax.tax_name || "Sales Tax"
    }
  }
}
