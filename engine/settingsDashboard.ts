import {
  ensureDefaultReceiptDevices,
  listReceiptDevices,
  supabaseAdmin,
  supabase,
  type ReceiptDevice
} from "@/database"

const db = supabaseAdmin || supabase

export type MerchantSettingsPayload = {
  business_name: string | null
  legal_business_name?: string | null
  business_dba?: string | null
  contact_email: string | null
  address: string | null
  address_line_2: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
  business_country?: string | null
  business_state?: string | null
  business_city?: string | null
  business_address_line1?: string | null
  business_address_line2?: string | null
  business_postal_code?: string | null
  business_phone?: string | null
  business_website?: string | null
  phone: string | null
  website: string | null
  business_type: string | null
  owner_first_name?: string | null
  owner_last_name?: string | null
  owner_email?: string | null
  owner_phone?: string | null
  profile_status?: "incomplete" | "complete" | "needs_attention"
  completed_at?: string | null
  closeout_time: string
  report_toast: boolean
}

export type MerchantTaxSettingsPayload = {
  tax_enabled: boolean
  tax_rate: number
  tax_name: string
}

export type MerchantOperationsSettingsPayload = {
  show_business_name: boolean
  show_business_address: boolean
  show_transaction_id: boolean
  show_network: boolean
  show_provider: boolean
  show_wallet_reference: boolean
  receipt_footer: string | null
  auto_print: boolean
  email_receipt_enabled: boolean
  sms_receipt_enabled: boolean
  cash_drawer_enabled: boolean
  require_cashier_note: boolean
  default_terminal_label: string | null
  receipt_prompt_after_payment: boolean
  tipping_enabled: boolean
  successful_payment_alerts: boolean
  failed_payment_alerts: boolean
  incomplete_payment_alerts: boolean
  daily_summary: boolean
  low_inventory_alerts: boolean
}

export type SettingsDashboardData = {
  settings: MerchantSettingsPayload
  tax: MerchantTaxSettingsPayload
  operations: MerchantOperationsSettingsPayload
  receiptDevices: ReceiptDevice[]
  schemaReady: boolean
}

export type MerchantSettingsReadiness = {
  complete: boolean
  missing: string[]
  reason?: string
}

const DEFAULT_SETTINGS: MerchantSettingsPayload = {
  business_name: null,
  legal_business_name: null,
  business_dba: null,
  contact_email: null,
  address: null,
  address_line_2: null,
  city: null,
  state: null,
  zip: null,
  country: null,
  business_country: null,
  business_state: null,
  business_city: null,
  business_address_line1: null,
  business_address_line2: null,
  business_postal_code: null,
  business_phone: null,
  business_website: null,
  phone: null,
  website: null,
  business_type: null,
  owner_first_name: null,
  owner_last_name: null,
  owner_email: null,
  owner_phone: null,
  profile_status: "incomplete",
  completed_at: null,
  closeout_time: "12:00",
  report_toast: true
}

const DEFAULT_TAX: MerchantTaxSettingsPayload = {
  tax_enabled: false,
  tax_rate: 0,
  tax_name: "Sales Tax"
}

const DEFAULT_OPERATIONS: MerchantOperationsSettingsPayload = {
  show_business_name: true,
  show_business_address: true,
  show_transaction_id: true,
  show_network: true,
  show_provider: true,
  show_wallet_reference: false,
  receipt_footer: null,
  auto_print: false,
  email_receipt_enabled: false,
  sms_receipt_enabled: false,
  cash_drawer_enabled: false,
  require_cashier_note: false,
  default_terminal_label: null,
  receipt_prompt_after_payment: true,
  tipping_enabled: false,
  successful_payment_alerts: true,
  failed_payment_alerts: true,
  incomplete_payment_alerts: true,
  daily_summary: false,
  low_inventory_alerts: true
}

function text(value: unknown, maxLength: number) {
  const normalized = String(value || "").trim()
  if (!normalized) return null
  if (normalized.length > maxLength) throw new Error("Settings field is too long")
  return normalized
}

function bool(value: unknown) {
  return value === true
}

function normalizeSettings(input: Partial<MerchantSettingsPayload>): MerchantSettingsPayload {
  const closeoutTime = String(input.closeout_time || "12:00")
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(closeoutTime)) {
    throw new Error("Closeout time must use HH:MM format")
  }

  const legalBusinessName = text(input.legal_business_name ?? input.business_name, 160)
  const businessCountry = text(input.business_country ?? input.country, 2)?.toUpperCase() || null
  if (businessCountry && !/^[A-Z]{2}$/.test(businessCountry)) {
    throw new Error("Business country must be a 2-letter country code")
  }
  const businessState = text(input.business_state ?? input.state, 120)
  const businessCity = text(input.business_city ?? input.city, 120)
  const businessAddressLine1 = text(input.business_address_line1 ?? input.address, 240)
  const businessAddressLine2 = text(input.business_address_line2 ?? input.address_line_2, 240)
  const businessPostalCode = text(input.business_postal_code ?? input.zip, 32)
  const businessPhone = text(input.business_phone ?? input.phone, 50)
  const businessWebsite = text(input.business_website ?? input.website, 500)
  const ownerEmail = text(input.owner_email, 320)
  if (ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(ownerEmail)) {
    throw new Error("Owner email must be a valid email address")
  }
  const requiredProfileFields = [
    legalBusinessName,
    input.business_type,
    businessCountry,
    businessState,
    businessCity,
    businessAddressLine1,
    businessPostalCode,
    businessPhone,
    input.owner_first_name,
    input.owner_last_name,
    ownerEmail,
  ]
  const profileStatus = requiredProfileFields.every((value) => String(value || "").trim())
    ? "complete"
    : "incomplete"

  return {
    business_name: legalBusinessName,
    legal_business_name: legalBusinessName,
    business_dba: text(input.business_dba, 160),
    contact_email: text(input.contact_email, 320),
    address: businessAddressLine1,
    address_line_2: businessAddressLine2,
    city: businessCity,
    state: businessState,
    zip: businessPostalCode,
    country: businessCountry,
    business_country: businessCountry,
    business_state: businessState,
    business_city: businessCity,
    business_address_line1: businessAddressLine1,
    business_address_line2: businessAddressLine2,
    business_postal_code: businessPostalCode,
    business_phone: businessPhone,
    business_website: businessWebsite,
    phone: businessPhone,
    website: businessWebsite,
    business_type: text(input.business_type, 80),
    owner_first_name: text(input.owner_first_name, 120),
    owner_last_name: text(input.owner_last_name, 120),
    owner_email: ownerEmail,
    owner_phone: text(input.owner_phone, 50),
    profile_status: profileStatus,
    completed_at: profileStatus === "complete" ? text(input.completed_at, 80) || new Date().toISOString() : null,
    closeout_time: closeoutTime,
    report_toast: input.report_toast !== false
  }
}

export function normalizeTax(input: Partial<MerchantTaxSettingsPayload>): MerchantTaxSettingsPayload {
  const taxEnabled = bool(input.tax_enabled)
  const rate = Number(input.tax_rate ?? 0)

  if (taxEnabled && (!Number.isFinite(rate) || rate <= 0 || rate > 100)) {
    throw new Error("Tax rate is required and must be between 0 and 100 when taxes are enabled")
  }

  if (!taxEnabled && (!Number.isFinite(rate) || rate < 0 || rate > 100)) {
    throw new Error("Tax rate must be between 0 and 100")
  }

  return {
    tax_enabled: taxEnabled,
    tax_rate: taxEnabled ? rate : rate || 0,
    tax_name: text(input.tax_name, 80) || "Sales Tax"
  }
}

function normalizeOperations(
  input: Partial<MerchantOperationsSettingsPayload>
): MerchantOperationsSettingsPayload {
  return {
    show_business_name: input.show_business_name !== false,
    show_business_address: input.show_business_address !== false,
    show_transaction_id: input.show_transaction_id !== false,
    show_network: input.show_network !== false,
    show_provider: input.show_provider !== false,
    show_wallet_reference: bool(input.show_wallet_reference),
    receipt_footer: text(input.receipt_footer, 500),
    auto_print: bool(input.auto_print),
    email_receipt_enabled: bool(input.email_receipt_enabled),
    sms_receipt_enabled: bool(input.sms_receipt_enabled),
    cash_drawer_enabled: bool(input.cash_drawer_enabled),
    require_cashier_note: bool(input.require_cashier_note),
    default_terminal_label: text(input.default_terminal_label, 120),
    receipt_prompt_after_payment: input.receipt_prompt_after_payment !== false,
    tipping_enabled: bool(input.tipping_enabled),
    successful_payment_alerts: input.successful_payment_alerts !== false,
    failed_payment_alerts: input.failed_payment_alerts !== false,
    incomplete_payment_alerts: input.incomplete_payment_alerts !== false,
    daily_summary: bool(input.daily_summary),
    low_inventory_alerts: input.low_inventory_alerts !== false
  }
}

function isSchemaMissing(message: string) {
  const normalized = message.toLowerCase()
  return normalized.includes("schema cache") ||
    normalized.includes("does not exist") ||
    normalized.includes("column")
}

export async function getSettingsDashboardEngine(merchantId: string): Promise<SettingsDashboardData> {
  let schemaReady = true
  let settingsResult = await db
    .from("merchant_settings")
    .select("business_name,legal_business_name,business_dba,contact_email,address,address_line_2,city,state,zip,country,business_country,business_state,business_city,business_address_line1,business_address_line2,business_postal_code,business_phone,business_website,phone,website,business_type,owner_first_name,owner_last_name,owner_email,owner_phone,profile_status,completed_at,closeout_time,report_toast")
    .eq("merchant_id", merchantId)
    .maybeSingle()

  if (settingsResult.error && isSchemaMissing(settingsResult.error.message)) {
    schemaReady = false
    settingsResult = await db
      .from("merchant_settings")
      .select("business_name,address,city,state,zip,country,phone,business_type,closeout_time,report_toast")
      .eq("merchant_id", merchantId)
      .maybeSingle()
  }

  const [taxResult, operationsResult, deviceResult] = await Promise.all([
    db
      .from("merchant_tax_settings")
      .select("tax_enabled,tax_rate,tax_name")
      .eq("merchant_id", merchantId)
      .maybeSingle(),
    db
      .from("merchant_operations_settings")
      .select("*")
      .eq("merchant_id", merchantId)
      .maybeSingle(),
    listReceiptDevices(merchantId)
  ])

  if (settingsResult.error) throw new Error(`Failed to load settings: ${settingsResult.error.message}`)
  if (taxResult.error) throw new Error(`Failed to load tax settings: ${taxResult.error.message}`)
  if (operationsResult.error) {
    if (isSchemaMissing(operationsResult.error.message)) {
      schemaReady = false
    } else {
      throw new Error(`Failed to load operations settings: ${operationsResult.error.message}`)
    }
  }
  if (!deviceResult.available) schemaReady = false
  if (deviceResult.available && deviceResult.devices.length < 4) {
    await ensureDefaultReceiptDevices(merchantId)
    const refreshed = await listReceiptDevices(merchantId)
    deviceResult.devices.splice(0, deviceResult.devices.length, ...refreshed.devices)
  }

  return {
    settings: { ...DEFAULT_SETTINGS, ...(settingsResult.data || {}) },
    tax: { ...DEFAULT_TAX, ...(taxResult.data || {}) },
    operations: { ...DEFAULT_OPERATIONS, ...(operationsResult.data || {}) },
    receiptDevices: deviceResult.devices,
    schemaReady
  }
}

export async function saveSettingsDashboardEngine(
  merchantId: string,
  settingsInput: Partial<MerchantSettingsPayload>,
  taxInput: Partial<MerchantTaxSettingsPayload>,
  operationsInput: Partial<MerchantOperationsSettingsPayload>
) {
  const settings = normalizeSettings(settingsInput)
  const tax = normalizeTax(taxInput)
  const operations = normalizeOperations(operationsInput)
  const updatedAt = new Date().toISOString()
  const schema = await getSettingsDashboardEngine(merchantId)
  if (!schema.schemaReady) {
    throw new Error("Settings database migration required before saving extended preferences")
  }

  const [settingsResult, taxResult, operationsResult] = await Promise.all([
    db.from("merchant_settings").upsert(
      { merchant_id: merchantId, ...settings, updated_at: updatedAt },
      { onConflict: "merchant_id" }
    ),
    db.from("merchant_tax_settings").upsert(
      { merchant_id: merchantId, ...tax, updated_at: updatedAt },
      { onConflict: "merchant_id" }
    ),
    db.from("merchant_operations_settings").upsert(
      { merchant_id: merchantId, ...operations, updated_at: updatedAt },
      { onConflict: "merchant_id" }
    )
  ])

  if (settingsResult.error) throw new Error(`Failed to save settings: ${settingsResult.error.message}`)
  if (taxResult.error) throw new Error(`Failed to save tax settings: ${taxResult.error.message}`)
  if (operationsResult.error) {
    throw new Error(`Failed to save operations settings: ${operationsResult.error.message}`)
  }
}

export function getMissingSettingsRequirements(input: {
  settings: Partial<MerchantSettingsPayload> | null
  tax: Partial<MerchantTaxSettingsPayload> | null
  operations?: unknown
  hasSettingsRow: boolean
  hasTaxRow: boolean
  hasOperationsRow: boolean
}): string[] {
  const missing: string[] = []
  const businessName = String(input.settings?.business_name || "").trim()
  const taxEnabled = input.tax?.tax_enabled === true
  const taxRate = Number(input.tax?.tax_rate ?? 0)

  if (!input.hasSettingsRow || !businessName) {
    missing.push("Business name")
  }

  if (!input.hasTaxRow) {
    missing.push("Tax enabled or disabled decision")
  } else if (taxEnabled && (!Number.isFinite(taxRate) || taxRate <= 0 || taxRate > 100)) {
    missing.push("Valid tax rate")
  }

  if (!input.hasOperationsRow) {
    missing.push("POS preferences")
  }

  return missing
}

export async function getMerchantSettingsReadiness(merchantId: string): Promise<MerchantSettingsReadiness> {
  const [settingsResult, taxResult, operationsResult] = await Promise.all([
    db
      .from("merchant_settings")
      .select("business_name")
      .eq("merchant_id", merchantId)
      .maybeSingle(),
    db
      .from("merchant_tax_settings")
      .select("tax_enabled,tax_rate")
      .eq("merchant_id", merchantId)
      .maybeSingle(),
    db
      .from("merchant_operations_settings")
      .select("merchant_id")
      .eq("merchant_id", merchantId)
      .maybeSingle()
  ])

  if (settingsResult.error) throw new Error(`Failed to load settings readiness: ${settingsResult.error.message}`)
  if (taxResult.error) throw new Error(`Failed to load tax readiness: ${taxResult.error.message}`)
  if (operationsResult.error) {
    if (isSchemaMissing(operationsResult.error.message)) {
      return {
        complete: false,
        missing: ["POS preferences"],
        reason: "Settings database migration required before POS terminals can be enabled."
      }
    }
    throw new Error(`Failed to load POS readiness: ${operationsResult.error.message}`)
  }

  const missing = getMissingSettingsRequirements({
    settings: settingsResult.data || null,
    tax: taxResult.data || null,
    operations: operationsResult.data || null,
    hasSettingsRow: Boolean(settingsResult.data),
    hasTaxRow: Boolean(taxResult.data),
    hasOperationsRow: Boolean(operationsResult.data)
  })

  return {
    complete: missing.length === 0,
    missing,
    reason: missing.length
      ? "Complete your business and tax settings before enabling POS terminals."
      : undefined
  }
}

export async function isMerchantSettingsComplete(merchantId: string) {
  return (await getMerchantSettingsReadiness(merchantId)).complete
}
