export const BUSINESS_PROFILE_FIELD_LABELS = {
  legal_business_name: "Legal Business Name",
  business_dba: "DBA / Doing Business As",
  contact_email: "Business Email",
  business_type: "Business Type",
  business_country: "Business Country",
  business_state: "Business State",
  business_city: "Business City",
  business_address_line1: "Business Address",
  business_address_line2: "Address Line 2",
  business_postal_code: "Postal Code",
  business_phone: "Business Phone",
  business_website: "Business Website",
  owner_first_name: "Owner First Name",
  owner_last_name: "Owner Last Name",
  owner_email: "Owner Email",
  owner_phone: "Owner Phone",
} as const

export type BusinessProfileField = keyof typeof BUSINESS_PROFILE_FIELD_LABELS

export const BUSINESS_PROFILE_REQUIRED_FIELDS = [
  "legal_business_name",
  "contact_email",
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
  "owner_phone",
] as const satisfies readonly BusinessProfileField[]

export const BUSINESS_PROFILE_OPTIONAL_FIELDS = [
  "business_dba",
  "business_address_line2",
  "business_website",
] as const satisfies readonly BusinessProfileField[]

export function isBusinessProfileFieldRequired(field: BusinessProfileField) {
  return BUSINESS_PROFILE_REQUIRED_FIELDS.includes(field as (typeof BUSINESS_PROFILE_REQUIRED_FIELDS)[number])
}
