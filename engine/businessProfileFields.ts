/**
 * The PineTree Business Profile field contract.
 *
 * This is the ONE merchant-facing business identity concept. Every field here
 * is entered once and reused everywhere PineTree needs business information,
 * including the background verification submission - merchants are never asked
 * to re-enter any of it on a second form.
 *
 * The fields added for verification are the ones a US business customer
 * genuinely requires. Compliance questions (`high_risk_activities`,
 * `operates_in_prohibited_countries`, `conducts_money_services`,
 * `account_purpose`, `source_of_funds`) are deliberately collected as explicit
 * merchant answers with no default: PineTree must never answer a regulatory
 * question on a merchant's behalf.
 *
 * SENSITIVE: tax identifiers are NOT in this list. They are collected in the
 * Verification section, forwarded straight to the regulated provider, and never
 * persisted - see BUSINESS_PROFILE_SENSITIVE_FIELDS below.
 */

export const BUSINESS_PROFILE_FIELD_LABELS = {
  legal_business_name: "Legal Business Name",
  business_dba: "DBA / Doing Business As",
  contact_email: "Business Email",
  business_type: "Business Type",
  business_legal_structure: "Business Structure",
  business_industry: "Industry",
  business_description: "What the Business Does",
  business_country: "Business Country",
  business_state: "Business State",
  business_city: "Business City",
  business_address_line1: "Business Address",
  business_address_line2: "Address Line 2",
  business_postal_code: "Postal Code",
  business_phone: "Business Phone",
  business_website: "Business Website",
  estimated_annual_revenue: "Estimated Annual Revenue",
  expected_monthly_payment_volume: "Expected Monthly Payment Volume (USD)",
  account_purpose: "Primary Account Purpose",
  source_of_funds: "Primary Source of Funds",
  high_risk_activities: "Regulated or High-Risk Activities",
  operates_in_prohibited_countries: "Operates in Prohibited Countries",
  conducts_money_services: "Offers Money Services or Financial Products",
  owner_first_name: "Owner First Name",
  owner_last_name: "Owner Last Name",
  owner_email: "Owner Email",
  owner_phone: "Owner Phone",
  owner_title: "Owner Title",
  owner_birth_date: "Owner Date of Birth",
  owner_ownership_percentage: "Ownership Percentage",
  owner_address_line1: "Owner Home Address",
  owner_address_line2: "Owner Address Line 2",
  owner_city: "Owner City",
  owner_state: "Owner State",
  owner_postal_code: "Owner Postal Code",
  owner_country: "Owner Country",
} as const

export type BusinessProfileField = keyof typeof BUSINESS_PROFILE_FIELD_LABELS

export const BUSINESS_PROFILE_REQUIRED_FIELDS = [
  "legal_business_name",
  "contact_email",
  "business_type",
  "business_legal_structure",
  "business_industry",
  "business_description",
  "business_country",
  "business_state",
  "business_city",
  "business_address_line1",
  "business_postal_code",
  "business_phone",
  "estimated_annual_revenue",
  "expected_monthly_payment_volume",
  "account_purpose",
  "source_of_funds",
  "high_risk_activities",
  "operates_in_prohibited_countries",
  "conducts_money_services",
  "owner_first_name",
  "owner_last_name",
  "owner_email",
  "owner_phone",
  "owner_title",
  "owner_birth_date",
  "owner_ownership_percentage",
  "owner_address_line1",
  "owner_city",
  "owner_state",
  "owner_postal_code",
  "owner_country",
] as const satisfies readonly BusinessProfileField[]

export const BUSINESS_PROFILE_OPTIONAL_FIELDS = [
  "business_dba",
  "business_address_line2",
  "business_website",
  "owner_address_line2",
] as const satisfies readonly BusinessProfileField[]

export function isBusinessProfileFieldRequired(field: BusinessProfileField) {
  return BUSINESS_PROFILE_REQUIRED_FIELDS.includes(field as (typeof BUSINESS_PROFILE_REQUIRED_FIELDS)[number])
}

/**
 * Sensitive identifiers the Business Profile collects but NEVER persists.
 *
 * They travel browser -> authenticated PineTree API -> regulated provider in a
 * single request. PineTree keeps only the masked last four and the timestamp of
 * the submission that consumed them.
 */
export const BUSINESS_PROFILE_SENSITIVE_FIELDS = ["business_tax_id", "owner_tax_id"] as const
export type BusinessProfileSensitiveField = (typeof BUSINESS_PROFILE_SENSITIVE_FIELDS)[number]

export const BUSINESS_PROFILE_SENSITIVE_FIELD_LABELS: Record<BusinessProfileSensitiveField, string> = {
  business_tax_id: "Employer Identification Number (EIN)",
  owner_tax_id: "Owner SSN or ITIN",
}

/**
 * The sections the Business Profile modal renders, in order.
 *
 * Grouping lives here rather than in the page so the modal, the missing-field
 * messaging, and any future surface all agree on where a field belongs.
 */
export const BUSINESS_PROFILE_SECTIONS = [
  {
    key: "business",
    title: "Business",
    fields: [
      "legal_business_name",
      "business_dba",
      "contact_email",
      "business_phone",
      "business_type",
      "business_legal_structure",
      "business_industry",
      "business_website",
      "business_description",
    ],
  },
  {
    key: "address",
    title: "Address",
    fields: [
      "business_country",
      "business_state",
      "business_city",
      "business_address_line1",
      "business_address_line2",
      "business_postal_code",
    ],
  },
  {
    key: "operations",
    title: "Operations",
    fields: [
      "estimated_annual_revenue",
      "expected_monthly_payment_volume",
      "account_purpose",
      "source_of_funds",
      "high_risk_activities",
      "operates_in_prohibited_countries",
      "conducts_money_services",
    ],
  },
  {
    key: "owners",
    title: "Owners",
    fields: [
      "owner_first_name",
      "owner_last_name",
      "owner_email",
      "owner_phone",
      "owner_title",
      "owner_birth_date",
      "owner_ownership_percentage",
      "owner_country",
      "owner_state",
      "owner_city",
      "owner_address_line1",
      "owner_address_line2",
      "owner_postal_code",
    ],
  },
] as const satisfies readonly { key: string; title: string; fields: readonly BusinessProfileField[] }[]

// ─── Controlled option lists ─────────────────────────────────────────────────
// These are PineTree-facing labels over the values the regulated provider
// accepts. The provider's own vocabulary never reaches a merchant surface.

export const BUSINESS_LEGAL_STRUCTURE_OPTIONS = [
  { value: "sole_prop", label: "Sole proprietorship" },
  { value: "llc", label: "LLC" },
  { value: "corporation", label: "Corporation" },
  { value: "partnership", label: "Partnership" },
  { value: "cooperative", label: "Cooperative" },
  { value: "trust", label: "Trust" },
  { value: "other", label: "Other" },
] as const

/**
 * Industry choices, stored as the NAICS code the regulated provider expects.
 * A curated short list keeps the profile usable; "Other services" is the
 * catch-all rather than a free-text field a merchant could get wrong.
 */
export const BUSINESS_INDUSTRY_OPTIONS = [
  { value: "722511", label: "Restaurant (full service)" },
  { value: "722513", label: "Restaurant (limited service)" },
  { value: "445110", label: "Grocery or convenience store" },
  { value: "448140", label: "Clothing and accessories retail" },
  { value: "453998", label: "Other retail store" },
  { value: "454110", label: "Online retail / e-commerce" },
  { value: "812112", label: "Salon, spa, or personal care" },
  { value: "541511", label: "Software or IT services" },
  { value: "541611", label: "Consulting or professional services" },
  { value: "541990", label: "Other professional services" },
  { value: "236118", label: "Construction or contracting" },
  { value: "811111", label: "Repair and maintenance" },
  { value: "621111", label: "Health or medical practice" },
  { value: "531210", label: "Real estate" },
  { value: "487990", label: "Transportation or delivery" },
  { value: "713940", label: "Fitness or recreation" },
  { value: "611710", label: "Education or training" },
  { value: "812990", label: "Other services" },
] as const

export const BUSINESS_ANNUAL_REVENUE_OPTIONS = [
  { value: "0_99999", label: "Under $100,000" },
  { value: "100000_999999", label: "$100,000 - $999,999" },
  { value: "1000000_9999999", label: "$1M - $9.9M" },
  { value: "10000000_49999999", label: "$10M - $49.9M" },
  { value: "50000000_249999999", label: "$50M - $249.9M" },
  { value: "250000000_plus", label: "$250M or more" },
] as const

export const BUSINESS_ACCOUNT_PURPOSE_OPTIONS = [
  { value: "receive_payments_for_goods_and_services", label: "Receive payments for goods and services" },
  { value: "ecommerce_retail_payments", label: "E-commerce and retail payments" },
  { value: "purchase_goods_and_services", label: "Purchase goods and services" },
  { value: "payroll", label: "Payroll" },
  { value: "treasury_management", label: "Treasury management" },
  { value: "charitable_donations", label: "Charitable donations" },
  { value: "investment_purposes", label: "Investment purposes" },
  { value: "third_party_money_transmission", label: "Third-party money transmission" },
  { value: "other", label: "Other" },
] as const

export const BUSINESS_SOURCE_OF_FUNDS_OPTIONS = [
  { value: "sales_of_goods_and_services", label: "Sales of goods and services" },
  { value: "business_loans", label: "Business loans" },
  { value: "owners_capital", label: "Owner's capital" },
  { value: "investment_proceeds", label: "Investment proceeds" },
  { value: "treasury_reserves", label: "Treasury reserves" },
  { value: "grants", label: "Grants" },
  { value: "inter_company_funds", label: "Inter-company funds" },
  { value: "sale_of_assets", label: "Sale of assets" },
  { value: "legal_settlement", label: "Legal settlement" },
  { value: "third_party_funds", label: "Third-party funds" },
  { value: "pension_retirement", label: "Pension or retirement" },
] as const

/**
 * Regulated / high-risk activities. `none_of_the_above` is a real, explicit
 * merchant answer - it is never assumed when the merchant has not answered.
 */
export const BUSINESS_HIGH_RISK_ACTIVITY_OPTIONS = [
  { value: "none_of_the_above", label: "None of the above" },
  { value: "adult_entertainment", label: "Adult entertainment" },
  { value: "gambling", label: "Gambling" },
  { value: "hold_client_funds", label: "Holding client funds" },
  { value: "investment_services", label: "Investment services" },
  { value: "lending_banking", label: "Lending or banking" },
  { value: "marijuana_or_related_services", label: "Marijuana or related services" },
  { value: "money_services", label: "Money services" },
  { value: "nicotine_tobacco_or_related_services", label: "Nicotine, tobacco, or related" },
  { value: "operate_foreign_exchange_virtual_currencies_brokerage_otc", label: "FX, virtual currency, or OTC brokerage" },
  { value: "pharmaceuticals", label: "Pharmaceuticals" },
  { value: "precious_metals_precious_stones_jewelry", label: "Precious metals, stones, or jewelry" },
  { value: "safe_deposit_box_rentals", label: "Safe deposit box rentals" },
  { value: "third_party_payment_processing", label: "Third-party payment processing" },
  { value: "weapons_firearms_and_explosives", label: "Weapons, firearms, or explosives" },
] as const

/** Fields rendered as an explicit yes/no with no pre-selected answer. */
export const BUSINESS_PROFILE_YES_NO_FIELDS = [
  "operates_in_prohibited_countries",
  "conducts_money_services",
] as const satisfies readonly BusinessProfileField[]

export const BUSINESS_PROFILE_SELECT_OPTIONS: Partial<
  Record<BusinessProfileField, readonly { value: string; label: string }[]>
> = {
  business_legal_structure: BUSINESS_LEGAL_STRUCTURE_OPTIONS,
  business_industry: BUSINESS_INDUSTRY_OPTIONS,
  estimated_annual_revenue: BUSINESS_ANNUAL_REVENUE_OPTIONS,
  account_purpose: BUSINESS_ACCOUNT_PURPOSE_OPTIONS,
  source_of_funds: BUSINESS_SOURCE_OF_FUNDS_OPTIONS,
}
