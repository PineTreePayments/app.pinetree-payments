import { supabase, supabaseAdmin } from "@/database"
import {
  normalizeBusinessCountry,
  normalizeBusinessState
} from "@/engine/businessProfileLocation"

const db = supabaseAdmin || supabase

export type BusinessProfileStatus = "incomplete" | "complete" | "needs_attention"

export type MerchantBusinessProfile = {
  legal_business_name: string | null
  business_dba: string | null
  business_type: string | null
  business_country: string | null
  business_state: string | null
  business_city: string | null
  business_address_line1: string | null
  business_address_line2: string | null
  business_postal_code: string | null
  business_phone: string | null
  business_website: string | null
  owner_first_name: string | null
  owner_last_name: string | null
  owner_email: string | null
  owner_phone: string | null
  profile_status: BusinessProfileStatus
  completed_at: string | null
  missing_fields: string[]
}

export type MerchantBusinessProfileInput = Partial<Omit<
  MerchantBusinessProfile,
  "profile_status" | "completed_at" | "missing_fields"
>>

const REQUIRED_FIELDS: Array<keyof Omit<MerchantBusinessProfile, "profile_status" | "completed_at" | "missing_fields">> = [
  "legal_business_name",
  "business_type",
  "business_country",
  "business_state",
  "business_city",
  "business_address_line1",
  "business_postal_code",
  "business_phone",
  "owner_first_name",
  "owner_last_name",
  "owner_email",
]

function text(value: unknown, maxLength = 320, fieldName = "Business Profile field") {
  const normalized = String(value || "").trim()
  if (!normalized) return null
  if (normalized.length > maxLength) throw new Error(`${fieldName} is too long`)
  return normalized
}

function email(value: unknown) {
  const normalized = text(value, 254, "Owner email")
  if (normalized && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalized)) {
    throw new Error("Owner email must be a valid email address")
  }
  return normalized
}

function read(row: Record<string, unknown> | null | undefined, canonical: string, legacy?: string) {
  return text(row?.[canonical] ?? (legacy ? row?.[legacy] : null))
}

export function normalizeBusinessProfile(input: MerchantBusinessProfileInput): MerchantBusinessProfile {
  const businessCountry = normalizeBusinessCountry(input.business_country)
  const profile: MerchantBusinessProfile = {
    legal_business_name: text(input.legal_business_name, 160, "Legal business name"),
    business_dba: text(input.business_dba, 160, "Business DBA"),
    business_type: text(input.business_type, 80, "Business type"),
    business_country: businessCountry,
    business_state: normalizeBusinessState(input.business_state, businessCountry),
    business_city: text(input.business_city, 120, "Business city"),
    business_address_line1: text(input.business_address_line1, 240, "Business address"),
    business_address_line2: text(input.business_address_line2, 240, "Business address line 2"),
    business_postal_code: text(input.business_postal_code, 32, "Business postal code"),
    business_phone: text(input.business_phone, 50, "Business phone"),
    business_website: text(input.business_website, 500, "Business website"),
    owner_first_name: text(input.owner_first_name, 120, "Owner first name"),
    owner_last_name: text(input.owner_last_name, 120, "Owner last name"),
    owner_email: email(input.owner_email),
    owner_phone: text(input.owner_phone, 50, "Owner phone"),
    profile_status: "incomplete",
    completed_at: null,
    missing_fields: [],
  }

  profile.missing_fields = REQUIRED_FIELDS.filter((field) => !profile[field])
  profile.profile_status = profile.missing_fields.length === 0 ? "complete" : "incomplete"
  return profile
}

function profileFromRows(settings: Record<string, unknown> | null, merchant: Record<string, unknown> | null): MerchantBusinessProfile {
  const profile = normalizeBusinessProfile({
    legal_business_name: read(settings, "legal_business_name", "business_name") || text(merchant?.business_name, 160),
    business_dba: read(settings, "business_dba"),
    business_type: read(settings, "business_type"),
    business_country: read(settings, "business_country", "country") || text(merchant?.business_country, 2),
    business_state: read(settings, "business_state", "state"),
    business_city: read(settings, "business_city", "city"),
    business_address_line1: read(settings, "business_address_line1", "address"),
    business_address_line2: read(settings, "business_address_line2", "address_line_2"),
    business_postal_code: read(settings, "business_postal_code", "zip"),
    business_phone: read(settings, "business_phone", "phone"),
    business_website: read(settings, "business_website", "website"),
    owner_first_name: read(settings, "owner_first_name") || text(merchant?.owner_first_name, 120),
    owner_last_name: read(settings, "owner_last_name") || text(merchant?.owner_last_name, 120),
    owner_email: read(settings, "owner_email") || text(merchant?.email, 320),
    owner_phone: read(settings, "owner_phone"),
  })

  const storedStatus = String(settings?.profile_status || "").trim() as BusinessProfileStatus
  if (storedStatus === "needs_attention") profile.profile_status = "needs_attention"
  profile.completed_at = profile.profile_status === "complete"
    ? text(settings?.completed_at) || null
    : null

  return profile
}

export async function getMerchantBusinessProfile(merchantId: string): Promise<MerchantBusinessProfile> {
  const [settingsResult, merchantResult] = await Promise.all([
    db.from("merchant_settings").select("*").eq("merchant_id", merchantId).maybeSingle(),
    db.from("merchants").select("*").eq("id", merchantId).maybeSingle(),
  ])

  if (settingsResult.error) throw new Error(`Failed to load Business Profile: ${settingsResult.error.message}`)
  if (merchantResult.error) throw new Error(`Failed to load merchant: ${merchantResult.error.message}`)

  return profileFromRows(
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

export async function saveMerchantBusinessProfile(
  merchantId: string,
  input: MerchantBusinessProfileInput
): Promise<MerchantBusinessProfile> {
  const existing = await getMerchantBusinessProfile(merchantId)
  const next = normalizeBusinessProfile({ ...existing, ...input })
  const completedAt = next.profile_status === "complete"
    ? existing.completed_at || new Date().toISOString()
    : null

  const row = {
    merchant_id: merchantId,
    legal_business_name: next.legal_business_name,
    business_dba: next.business_dba,
    business_type: next.business_type,
    business_country: next.business_country,
    business_state: next.business_state,
    business_city: next.business_city,
    business_address_line1: next.business_address_line1,
    business_address_line2: next.business_address_line2,
    business_postal_code: next.business_postal_code,
    business_phone: next.business_phone,
    business_website: next.business_website,
    owner_first_name: next.owner_first_name,
    owner_last_name: next.owner_last_name,
    owner_email: next.owner_email,
    owner_phone: next.owner_phone,
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

  const { error } = await db
    .from("merchant_settings")
    .upsert(row, { onConflict: "merchant_id" })

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
