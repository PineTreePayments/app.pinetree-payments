import { supabase, supabaseAdmin } from "@/database"
import {
  normalizeBusinessCountry,
  normalizeBusinessState
} from "@/engine/businessProfileLocation"
import {
  BUSINESS_PROFILE_FIELD_LABELS,
  BUSINESS_PROFILE_REQUIRED_FIELDS,
  BUSINESS_PROFILE_SELECT_OPTIONS,
  BUSINESS_HIGH_RISK_ACTIVITY_OPTIONS,
  isBusinessProfileFieldRequired
} from "@/engine/businessProfileFields"

const db = supabaseAdmin || supabase

export type BusinessProfileStatus = "incomplete" | "complete" | "needs_attention"

export type MerchantBusinessProfile = {
  legal_business_name: string | null
  business_dba: string | null
  contact_email: string | null
  business_type: string | null
  business_legal_structure: string | null
  business_industry: string | null
  business_description: string | null
  business_country: string | null
  business_state: string | null
  business_city: string | null
  business_address_line1: string | null
  business_address_line2: string | null
  business_postal_code: string | null
  business_phone: string | null
  business_website: string | null
  estimated_annual_revenue: string | null
  expected_monthly_payment_volume: string | null
  account_purpose: string | null
  source_of_funds: string | null
  /** Comma-separated controlled values. Never empty once answered. */
  high_risk_activities: string | null
  operates_in_prohibited_countries: string | null
  conducts_money_services: string | null
  owner_first_name: string | null
  owner_last_name: string | null
  owner_email: string | null
  owner_phone: string | null
  owner_title: string | null
  owner_birth_date: string | null
  owner_ownership_percentage: string | null
  owner_address_line1: string | null
  owner_address_line2: string | null
  owner_city: string | null
  owner_state: string | null
  owner_postal_code: string | null
  owner_country: string | null
  profile_status: BusinessProfileStatus
  completed_at: string | null
  missing_fields: string[]
}

export type MerchantBusinessProfileInput = Partial<Omit<
  MerchantBusinessProfile,
  "profile_status" | "completed_at" | "missing_fields"
>>

export { BUSINESS_PROFILE_FIELD_LABELS, BUSINESS_PROFILE_REQUIRED_FIELDS, isBusinessProfileFieldRequired }

function text(value: unknown, maxLength = 320, fieldName = "Business Profile field") {
  const normalized = String(value || "").trim()
  if (!normalized) return null
  if (normalized.length > maxLength) throw new Error(`${fieldName} is too long`)
  return normalized
}

function email(value: unknown, fieldName = "Owner email") {
  const normalized = text(value, 254, fieldName)
  if (normalized && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalized)) {
    throw new Error(`${fieldName} must be a valid email address`)
  }
  return normalized
}

/**
 * Accept only a value from the controlled list for this field.
 *
 * Rejecting an unknown value here rather than passing it through is what stops
 * a malformed compliance answer from reaching the regulated provider, where it
 * would be a hard rejection instead of a fixable validation error.
 */
function choice(value: unknown, field: keyof typeof BUSINESS_PROFILE_SELECT_OPTIONS, fieldName: string) {
  const normalized = text(value, 80, fieldName)
  if (!normalized) return null
  const allowed = BUSINESS_PROFILE_SELECT_OPTIONS[field] || []
  if (!allowed.some((option) => option.value === normalized)) {
    throw new Error(`${fieldName} must be one of the available options`)
  }
  return normalized
}

function yesNo(value: unknown, fieldName: string) {
  const normalized = text(value, 8, fieldName)?.toLowerCase()
  if (!normalized) return null
  if (normalized !== "yes" && normalized !== "no") {
    throw new Error(`${fieldName} must be answered yes or no`)
  }
  return normalized
}

const HIGH_RISK_ACTIVITY_VALUES = new Set(
  BUSINESS_HIGH_RISK_ACTIVITY_OPTIONS.map((option) => option.value)
)

/**
 * Normalize the regulated-activity answer.
 *
 * "None of the above" is a real answer that must be selected on its own - an
 * answer that also lists an activity is contradictory, and PineTree refuses it
 * rather than silently choosing which half to believe.
 */
function highRiskActivities(value: unknown) {
  const raw = Array.isArray(value) ? value.join(",") : String(value || "")
  const entries = Array.from(
    new Set(
      raw
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length > 0)
    )
  )
  if (entries.length === 0) return null

  for (const entry of entries) {
    if (!HIGH_RISK_ACTIVITY_VALUES.has(entry as (typeof BUSINESS_HIGH_RISK_ACTIVITY_OPTIONS)[number]["value"])) {
      throw new Error("Regulated or high-risk activities must be selected from the available options")
    }
  }
  if (entries.includes("none_of_the_above") && entries.length > 1) {
    throw new Error('Regulated or high-risk activities cannot be "None of the above" and also list an activity')
  }
  return entries.join(",")
}

function isoDate(value: unknown, fieldName: string) {
  const normalized = text(value, 10, fieldName)
  if (!normalized) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`${fieldName} must use the format YYYY-MM-DD`)
  }
  const parsed = Date.parse(`${normalized}T00:00:00Z`)
  if (!Number.isFinite(parsed)) throw new Error(`${fieldName} is not a valid date`)
  // Bridge requires an associated person to be at least 18. Checking here turns
  // a provider rejection into a correctable form error.
  const eighteenYearsAgo = Date.UTC(
    new Date().getUTCFullYear() - 18,
    new Date().getUTCMonth(),
    new Date().getUTCDate()
  )
  if (parsed > eighteenYearsAgo) throw new Error(`${fieldName} must be at least 18 years ago`)
  return normalized
}

function wholePercentage(value: unknown, fieldName: string) {
  const normalized = text(value, 6, fieldName)
  if (!normalized) return null
  if (!/^\d{1,3}$/.test(normalized)) {
    throw new Error(`${fieldName} must be a whole number between 0 and 100`)
  }
  const parsed = Number(normalized)
  if (parsed > 100) throw new Error(`${fieldName} must be a whole number between 0 and 100`)
  return String(parsed)
}

function wholeUsdAmount(value: unknown, fieldName: string) {
  const normalized = text(value, 15, fieldName)?.replace(/[,$\s]/g, "")
  if (!normalized) return null
  if (!/^\d{1,12}$/.test(normalized)) {
    throw new Error(`${fieldName} must be a whole dollar amount`)
  }
  // Leading zeros are stripped so the persisted value and the provider payload
  // agree on one canonical representation.
  return String(Number(normalized))
}

function read(row: Record<string, unknown> | null | undefined, canonical: string, legacy?: string) {
  return text(row?.[canonical] ?? (legacy ? row?.[legacy] : null))
}

export function normalizeBusinessProfile(input: MerchantBusinessProfileInput): MerchantBusinessProfile {
  const businessCountry = normalizeBusinessCountry(input.business_country)
  const ownerCountry = normalizeBusinessCountry(input.owner_country)
  const profile: MerchantBusinessProfile = {
    legal_business_name: text(input.legal_business_name, 160, "Legal business name"),
    business_dba: text(input.business_dba, 160, "Business DBA"),
    contact_email: email(input.contact_email, "Business email"),
    business_type: text(input.business_type, 80, "Business type"),
    business_legal_structure: choice(input.business_legal_structure, "business_legal_structure", "Business structure"),
    business_industry: choice(input.business_industry, "business_industry", "Industry"),
    business_description: text(input.business_description, 1024, "What the business does"),
    business_country: businessCountry,
    business_state: normalizeBusinessState(input.business_state, businessCountry),
    business_city: text(input.business_city, 120, "Business city"),
    business_address_line1: text(input.business_address_line1, 240, "Business address"),
    business_address_line2: text(input.business_address_line2, 240, "Business address line 2"),
    business_postal_code: text(input.business_postal_code, 32, "Business postal code"),
    business_phone: text(input.business_phone, 50, "Business phone"),
    business_website: text(input.business_website, 500, "Business website"),
    estimated_annual_revenue: choice(input.estimated_annual_revenue, "estimated_annual_revenue", "Estimated annual revenue"),
    expected_monthly_payment_volume: wholeUsdAmount(
      input.expected_monthly_payment_volume,
      "Expected monthly payment volume"
    ),
    account_purpose: choice(input.account_purpose, "account_purpose", "Primary account purpose"),
    source_of_funds: choice(input.source_of_funds, "source_of_funds", "Primary source of funds"),
    high_risk_activities: highRiskActivities(input.high_risk_activities),
    operates_in_prohibited_countries: yesNo(
      input.operates_in_prohibited_countries,
      "Operates in prohibited countries"
    ),
    conducts_money_services: yesNo(input.conducts_money_services, "Offers money services or financial products"),
    owner_first_name: text(input.owner_first_name, 120, "Owner first name"),
    owner_last_name: text(input.owner_last_name, 120, "Owner last name"),
    owner_email: email(input.owner_email),
    owner_phone: text(input.owner_phone, 50, "Owner phone"),
    owner_title: text(input.owner_title, 120, "Owner title"),
    owner_birth_date: isoDate(input.owner_birth_date, "Owner date of birth"),
    owner_ownership_percentage: wholePercentage(input.owner_ownership_percentage, "Ownership percentage"),
    owner_address_line1: text(input.owner_address_line1, 240, "Owner home address"),
    owner_address_line2: text(input.owner_address_line2, 240, "Owner address line 2"),
    owner_city: text(input.owner_city, 120, "Owner city"),
    owner_state: normalizeBusinessState(input.owner_state, ownerCountry),
    owner_postal_code: text(input.owner_postal_code, 32, "Owner postal code"),
    owner_country: ownerCountry,
    profile_status: "incomplete",
    completed_at: null,
    missing_fields: [],
  }

  profile.missing_fields = BUSINESS_PROFILE_REQUIRED_FIELDS.filter((field) => !profile[field])
  profile.profile_status = profile.missing_fields.length === 0 ? "complete" : "incomplete"
  return profile
}

function profileFromRows(settings: Record<string, unknown> | null, merchant: Record<string, unknown> | null): MerchantBusinessProfile {
  const profile = normalizeBusinessProfile({
    legal_business_name: read(settings, "legal_business_name", "business_name") || text(merchant?.business_name, 160),
    business_dba: read(settings, "business_dba"),
    contact_email: read(settings, "contact_email") || text(merchant?.email, 254),
    business_type: read(settings, "business_type"),
    business_legal_structure: read(settings, "business_legal_structure"),
    business_industry: read(settings, "business_industry"),
    business_description: read(settings, "business_description"),
    business_country: read(settings, "business_country", "country") || text(merchant?.business_country, 2),
    business_state: read(settings, "business_state", "state"),
    business_city: read(settings, "business_city", "city"),
    business_address_line1: read(settings, "business_address_line1", "address"),
    business_address_line2: read(settings, "business_address_line2", "address_line_2"),
    business_postal_code: read(settings, "business_postal_code", "zip"),
    business_phone: read(settings, "business_phone", "phone"),
    business_website: read(settings, "business_website", "website"),
    estimated_annual_revenue: read(settings, "estimated_annual_revenue"),
    expected_monthly_payment_volume: read(settings, "expected_monthly_payment_volume"),
    account_purpose: read(settings, "account_purpose"),
    source_of_funds: read(settings, "source_of_funds"),
    high_risk_activities: read(settings, "high_risk_activities"),
    operates_in_prohibited_countries: read(settings, "operates_in_prohibited_countries"),
    conducts_money_services: read(settings, "conducts_money_services"),
    owner_first_name: read(settings, "owner_first_name") || text(merchant?.owner_first_name, 120),
    owner_last_name: read(settings, "owner_last_name") || text(merchant?.owner_last_name, 120),
    owner_email: read(settings, "owner_email") || text(merchant?.email, 320),
    owner_phone: read(settings, "owner_phone"),
    owner_title: read(settings, "owner_title"),
    owner_birth_date: read(settings, "owner_birth_date"),
    owner_ownership_percentage: read(settings, "owner_ownership_percentage"),
    owner_address_line1: read(settings, "owner_address_line1"),
    owner_address_line2: read(settings, "owner_address_line2"),
    owner_city: read(settings, "owner_city"),
    owner_state: read(settings, "owner_state"),
    owner_postal_code: read(settings, "owner_postal_code"),
    owner_country: read(settings, "owner_country"),
  })

  const storedStatus = String(settings?.profile_status || "").trim() as BusinessProfileStatus
  if (storedStatus === "needs_attention") profile.profile_status = "needs_attention"
  profile.completed_at = profile.profile_status === "complete"
    ? text(settings?.completed_at) || null
    : null

  return profile
}

/**
 * Some stored profiles predate the verification fields. A stored value that no
 * longer satisfies the current contract must not make the whole profile
 * unreadable, so a per-row normalization failure degrades to "read what we can"
 * rather than throwing on a GET.
 */
function safeProfileFromRows(
  settings: Record<string, unknown> | null,
  merchant: Record<string, unknown> | null
): MerchantBusinessProfile {
  try {
    return profileFromRows(settings, merchant)
  } catch (error) {
    console.warn("[business-profile] stored_profile_normalization_failed", {
      reason: error instanceof Error ? error.message : "unknown",
    })
    return profileFromRows({ ...(settings || {}) , business_legal_structure: null, business_industry: null,
      estimated_annual_revenue: null, account_purpose: null, source_of_funds: null,
      high_risk_activities: null, operates_in_prohibited_countries: null,
      conducts_money_services: null, owner_birth_date: null, owner_ownership_percentage: null,
      expected_monthly_payment_volume: null }, merchant)
  }
}

export async function getMerchantBusinessProfile(merchantId: string): Promise<MerchantBusinessProfile> {
  const [settingsResult, merchantResult] = await Promise.all([
    db.from("merchant_settings").select("*").eq("merchant_id", merchantId).maybeSingle(),
    db.from("merchants").select("*").eq("id", merchantId).maybeSingle(),
  ])

  if (settingsResult.error) throw new Error(`Failed to load Business Profile: ${settingsResult.error.message}`)
  if (merchantResult.error) throw new Error(`Failed to load merchant: ${merchantResult.error.message}`)

  return safeProfileFromRows(
    (settingsResult.data || null) as Record<string, unknown> | null,
    (merchantResult.data || null) as Record<string, unknown> | null
  )
}

export async function isMerchantBusinessProfileComplete(merchantId: string) {
  return (await getMerchantBusinessProfile(merchantId)).profile_status === "complete"
}

export async function assertMerchantBusinessProfileComplete(merchantId: string) {
  const profile = await getMerchantBusinessProfile(merchantId)
  if (profile.profile_status !== "complete") {
    const error = new Error("Complete your Business Profile to activate payments.")
    ;(error as Error & { status?: number }).status = 409
    throw error
  }
  return profile
}

/**
 * Columns added after the original Business Profile shipped. A deployment that
 * has not yet run the migration must still be able to save the original
 * profile, so a missing-column write retries without them rather than failing
 * the merchant's save outright.
 */
const BUSINESS_PROFILE_EXTENDED_COLUMNS = [
  "business_legal_structure",
  "business_industry",
  "business_description",
  "estimated_annual_revenue",
  "expected_monthly_payment_volume",
  "account_purpose",
  "source_of_funds",
  "high_risk_activities",
  "operates_in_prohibited_countries",
  "conducts_money_services",
  "owner_title",
  "owner_birth_date",
  "owner_ownership_percentage",
  "owner_address_line1",
  "owner_address_line2",
  "owner_city",
  "owner_state",
  "owner_postal_code",
  "owner_country",
] as const

function isMissingExtendedProfileColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  if (error.code === "PGRST204" || error.code === "42703") return true
  return BUSINESS_PROFILE_EXTENDED_COLUMNS.some((column) => (error.message || "").includes(column))
}

export async function saveMerchantBusinessProfile(
  merchantId: string,
  input: MerchantBusinessProfileInput
): Promise<MerchantBusinessProfile> {
  const existing = await getMerchantBusinessProfile(merchantId)
  const next = normalizeBusinessProfile({ ...existing, ...input })
  const completedAt = next.profile_status === "complete"
    ? existing.completed_at || new Date().toISOString()
    : null

  const row: Record<string, unknown> = {
    merchant_id: merchantId,
    legal_business_name: next.legal_business_name,
    business_dba: next.business_dba,
    contact_email: next.contact_email,
    business_type: next.business_type,
    business_legal_structure: next.business_legal_structure,
    business_industry: next.business_industry,
    business_description: next.business_description,
    business_country: next.business_country,
    business_state: next.business_state,
    business_city: next.business_city,
    business_address_line1: next.business_address_line1,
    business_address_line2: next.business_address_line2,
    business_postal_code: next.business_postal_code,
    business_phone: next.business_phone,
    business_website: next.business_website,
    estimated_annual_revenue: next.estimated_annual_revenue,
    expected_monthly_payment_volume: next.expected_monthly_payment_volume,
    account_purpose: next.account_purpose,
    source_of_funds: next.source_of_funds,
    high_risk_activities: next.high_risk_activities,
    operates_in_prohibited_countries: next.operates_in_prohibited_countries,
    conducts_money_services: next.conducts_money_services,
    owner_first_name: next.owner_first_name,
    owner_last_name: next.owner_last_name,
    owner_email: next.owner_email,
    owner_phone: next.owner_phone,
    owner_title: next.owner_title,
    owner_birth_date: next.owner_birth_date,
    owner_ownership_percentage: next.owner_ownership_percentage,
    owner_address_line1: next.owner_address_line1,
    owner_address_line2: next.owner_address_line2,
    owner_city: next.owner_city,
    owner_state: next.owner_state,
    owner_postal_code: next.owner_postal_code,
    owner_country: next.owner_country,
    profile_status: next.profile_status,
    completed_at: completedAt,
    business_name: next.legal_business_name,
    address: next.business_address_line1,
    address_line_2: next.business_address_line2,
    city: next.business_city,
    state: next.business_state,
    zip: next.business_postal_code,
    country: next.business_country,
    phone: next.business_phone,
    website: next.business_website,
    updated_at: new Date().toISOString(),
  }

  let { error } = await db.from("merchant_settings").upsert(row, { onConflict: "merchant_id" })

  if (isMissingExtendedProfileColumn(error)) {
    const legacyRow = { ...row }
    for (const column of BUSINESS_PROFILE_EXTENDED_COLUMNS) delete legacyRow[column]
    ;({ error } = await db.from("merchant_settings").upsert(legacyRow, { onConflict: "merchant_id" }))
  }

  if (error) throw new Error(`Failed to save Business Profile: ${error.message}`)

  await db
    .from("merchants")
    .update({
      owner_first_name: next.owner_first_name,
      owner_last_name: next.owner_last_name,
      business_country: next.business_country,
      updated_at: new Date().toISOString(),
    })
    .eq("id", merchantId)

  return { ...next, completed_at: completedAt }
}
