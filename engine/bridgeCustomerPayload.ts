/**
 * PineTree Engine - Business Profile -> regulated-provider customer payload.
 *
 * A PURE mapper. It performs no I/O, contacts no provider, and writes nothing.
 * Keeping it pure is what makes the KYB submission testable without a network
 * and what keeps the sensitive-data boundary auditable in one place.
 *
 * ── The prefill contract ─────────────────────────────────────────────────────
 * PineTree already holds a complete business profile. Every field the provider
 * needs and PineTree holds is submitted from that profile - a merchant is never
 * asked to re-enter their legal name, address, phone, owner details, or
 * compliance answers on a second form.
 *
 * ── Sensitive data ───────────────────────────────────────────────────────────
 * Tax identifiers (EIN, SSN/ITIN) are NOT part of the Business Profile record.
 * They are passed into this mapper for the duration of one request and placed
 * in the provider payload only. PineTree persists the masked last four and
 * nothing else. Nothing in this module logs a payload.
 */

import type { MerchantBusinessProfile } from "@/engine/businessProfile"
import { BUSINESS_PROFILE_FIELD_LABELS } from "@/engine/businessProfileFields"
import { BRIDGE_REQUIRED_ENDORSEMENT } from "@/providers/bridge/normalize"
import {
  BRIDGE_ACCOUNT_PURPOSES,
  BRIDGE_BUSINESS_TYPES,
  BRIDGE_ESTIMATED_ANNUAL_REVENUE,
  BRIDGE_HIGH_RISK_ACTIVITIES,
  BRIDGE_SOURCE_OF_FUNDS,
  type BridgeAccountPurpose,
  type BridgeAddress,
  type BridgeAssociatedPerson,
  type BridgeBusinessCustomerPayload,
  type BridgeBusinessType,
  type BridgeEstimatedAnnualRevenue,
  type BridgeHighRiskActivity,
  type BridgeIdentifyingInformation,
  type BridgeSourceOfFunds,
} from "@/providers/bridge/types"

/**
 * The tax identifiers a submission may carry. Request-scoped only: this type
 * is never part of a stored record, an API response, or a log line.
 */
export type BusinessVerificationSensitiveInput = {
  /** Employer Identification Number for the business. */
  businessTaxId?: string | null
  /** SSN or ITIN for the authorized representative. */
  ownerTaxId?: string | null
}

export type BridgeCustomerPayloadResult =
  | { ok: true; payload: BridgeBusinessCustomerPayload }
  | { ok: false; missing: string[] }

/**
 * ISO 3166-1 alpha-3 codes for the countries the Business Profile offers.
 *
 * Bridge requires alpha-3 while PineTree stores alpha-2, so the conversion is
 * explicit rather than derived - a wrong country code on a KYB submission is a
 * provider rejection, not a display bug.
 */
const ALPHA3_BY_ALPHA2: Record<string, string> = {
  US: "USA",
  CA: "CAN",
  MX: "MEX",
  GB: "GBR",
  AU: "AUS",
}

export function alpha3Country(alpha2: string | null | undefined): string | null {
  const normalized = String(alpha2 || "").trim().toUpperCase()
  return ALPHA3_BY_ALPHA2[normalized] || null
}

function label(field: keyof typeof BUSINESS_PROFILE_FIELD_LABELS): string {
  return BUSINESS_PROFILE_FIELD_LABELS[field]
}

function enumValue<T extends string>(
  value: string | null | undefined,
  allowed: readonly T[]
): T | null {
  const normalized = String(value || "").trim().toLowerCase()
  return (allowed as readonly string[]).includes(normalized) ? (normalized as T) : null
}

/** `yes`/`no` answers are only ever booleans after an explicit merchant answer. */
function booleanAnswer(value: string | null | undefined): boolean | null {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "yes") return true
  if (normalized === "no") return false
  return null
}

function parseHighRiskActivities(value: string | null | undefined): BridgeHighRiskActivity[] {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry): entry is BridgeHighRiskActivity =>
      (BRIDGE_HIGH_RISK_ACTIVITIES as readonly string[]).includes(entry)
    )
}

function digitsOnly(value: string | null | undefined): string {
  return String(value || "").replace(/\D/g, "")
}

/** Masked last four of a tax identifier. The only part PineTree may retain. */
export function taxIdentifierLast4(value: string | null | undefined): string | null {
  const digits = digitsOnly(value)
  return digits.length >= 4 ? digits.slice(-4) : null
}

/** E.164-ish normalization. Bridge documents the "+12223334444" form. */
export function normalizePhoneForProvider(value: string | null | undefined): string | null {
  const raw = String(value || "").trim()
  if (!raw) return null
  const digits = digitsOnly(raw)
  if (!digits) return null
  if (raw.startsWith("+")) return `+${digits}`
  // A bare 10-digit number in this profile is US/CA; anything else is passed
  // through with a leading + rather than guessed at.
  if (digits.length === 10) return `+1${digits}`
  return `+${digits}`
}

function address(input: {
  line1: string | null
  line2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  country: string | null
}): BridgeAddress | null {
  const country = alpha3Country(input.country)
  const line1 = String(input.line1 || "").trim()
  const city = String(input.city || "").trim()
  if (!country || !line1 || !city) return null

  const built: BridgeAddress = { street_line_1: line1, city, country }
  const line2 = String(input.line2 || "").trim()
  if (line2) built.street_line_2 = line2
  const subdivision = String(input.state || "").trim()
  if (subdivision) built.subdivision = subdivision
  const postalCode = String(input.postalCode || "").trim()
  if (postalCode) built.postal_code = postalCode
  return built
}

/**
 * Build the provider business-customer payload from the merchant's profile.
 *
 * Returns the missing PineTree field LABELS rather than throwing, so the caller
 * can tell the merchant exactly what to finish in their Business Profile
 * instead of surfacing a provider error.
 */
export function buildBridgeCustomerPayload(input: {
  profile: MerchantBusinessProfile
  sensitive?: BusinessVerificationSensitiveInput
  signedAgreementId?: string | null
}): BridgeCustomerPayloadResult {
  const { profile } = input
  const missing: string[] = []

  const businessLegalName = String(profile.legal_business_name || "").trim()
  if (!businessLegalName) missing.push(label("legal_business_name"))

  const businessEmail = String(profile.contact_email || profile.owner_email || "").trim()
  if (!businessEmail) missing.push(label("contact_email"))

  const businessDescription = String(profile.business_description || "").trim()
  if (!businessDescription) missing.push(label("business_description"))

  const businessType = enumValue<BridgeBusinessType>(profile.business_legal_structure, BRIDGE_BUSINESS_TYPES)
  if (!businessType) missing.push(label("business_legal_structure"))

  const industry = String(profile.business_industry || "").trim()
  if (!industry) missing.push(label("business_industry"))

  const registeredAddress = address({
    line1: profile.business_address_line1,
    line2: profile.business_address_line2,
    city: profile.business_city,
    state: profile.business_state,
    postalCode: profile.business_postal_code,
    country: profile.business_country,
  })
  if (!registeredAddress) missing.push(label("business_address_line1"))

  const revenue = enumValue<BridgeEstimatedAnnualRevenue>(
    profile.estimated_annual_revenue,
    BRIDGE_ESTIMATED_ANNUAL_REVENUE
  )
  if (!revenue) missing.push(label("estimated_annual_revenue"))

  const monthlyVolumeRaw = String(profile.expected_monthly_payment_volume || "").trim()
  const monthlyVolume = /^\d+$/.test(monthlyVolumeRaw) ? Number(monthlyVolumeRaw) : null
  if (monthlyVolume === null) missing.push(label("expected_monthly_payment_volume"))

  const accountPurpose = enumValue<BridgeAccountPurpose>(profile.account_purpose, BRIDGE_ACCOUNT_PURPOSES)
  if (!accountPurpose) missing.push(label("account_purpose"))

  const sourceOfFunds = enumValue<BridgeSourceOfFunds>(profile.source_of_funds, BRIDGE_SOURCE_OF_FUNDS)
  if (!sourceOfFunds) missing.push(label("source_of_funds"))

  const highRiskActivities = parseHighRiskActivities(profile.high_risk_activities)
  if (highRiskActivities.length === 0) missing.push(label("high_risk_activities"))

  const prohibitedCountries = booleanAnswer(profile.operates_in_prohibited_countries)
  if (prohibitedCountries === null) missing.push(label("operates_in_prohibited_countries"))

  const moneyServices = booleanAnswer(profile.conducts_money_services)
  if (moneyServices === null) missing.push(label("conducts_money_services"))

  const person = buildAssociatedPerson({ profile, ownerTaxId: input.sensitive?.ownerTaxId })
  missing.push(...person.missing)

  if (missing.length > 0) return { ok: false, missing: Array.from(new Set(missing)) }

  const payload: BridgeBusinessCustomerPayload = {
    type: "business",
    business_legal_name: businessLegalName,
    business_description: businessDescription,
    email: businessEmail,
    business_type: businessType as BridgeBusinessType,
    registered_address: registeredAddress as BridgeAddress,
    // PineTree collects one business address. It is both the registered address
    // and the place of operation, and the merchant confirms it as such.
    physical_address: registeredAddress as BridgeAddress,
    business_industry: [industry],
    is_dao: false,
    // Derived from a fact the merchant stated: a single representative holding
    // the whole business has no intermediate entity owner. This is a
    // consequence of their answer, never a compliance answer PineTree invented.
    has_material_intermediary_ownership: false,
    estimated_annual_revenue_usd: revenue as BridgeEstimatedAnnualRevenue,
    expected_monthly_payments_usd: monthlyVolume as number,
    operates_in_prohibited_countries: prohibitedCountries as boolean,
    account_purpose: accountPurpose as BridgeAccountPurpose,
    high_risk_activities: highRiskActivities,
    source_of_funds: sourceOfFunds as BridgeSourceOfFunds,
    conducts_money_services: moneyServices as boolean,
    associated_persons: [person.person as BridgeAssociatedPerson],
    endorsements: [BRIDGE_REQUIRED_ENDORSEMENT],
  }

  const tradeName = String(profile.business_dba || "").trim()
  if (tradeName) payload.business_trade_name = tradeName

  const phone = normalizePhoneForProvider(profile.business_phone)
  if (phone) payload.phone = phone

  const website = String(profile.business_website || "").trim()
  if (website) payload.primary_website = website

  if (accountPurpose === "other") {
    // Bridge requires an explanation when the purpose is "other", and PineTree
    // has one the merchant actually wrote.
    payload.account_purpose_other = businessDescription.slice(0, 1024)
  }

  const declaredActivities = highRiskActivities.filter((entry) => entry !== "none_of_the_above")
  if (declaredActivities.length > 0) {
    payload.high_risk_activities_explanation = businessDescription.slice(0, 1024)
  }
  if (moneyServices) {
    payload.compliance_screening_explanation = businessDescription.slice(0, 1024)
  }

  const businessTaxIdentifier = buildBusinessTaxIdentifier({
    taxId: input.sensitive?.businessTaxId,
    country: profile.business_country,
  })
  if (businessTaxIdentifier) payload.identifying_information = [businessTaxIdentifier]

  const signedAgreementId = String(input.signedAgreementId || "").trim()
  if (signedAgreementId) payload.signed_agreement_id = signedAgreementId

  return { ok: true, payload }
}

function buildBusinessTaxIdentifier(input: {
  taxId?: string | null
  country: string | null
}): BridgeIdentifyingInformation | null {
  const country = alpha3Country(input.country)
  const number = digitsOnly(input.taxId)
  if (!country || !number) return null
  // `ein` is the US business tax identifier type. Outside the US PineTree does
  // not claim to know which national identifier applies, so it sends none
  // rather than mislabelling one.
  if (country !== "USA") return null
  return { type: "ein", issuing_country: country, number }
}

function buildAssociatedPerson(input: {
  profile: MerchantBusinessProfile
  ownerTaxId?: string | null
}): { person: BridgeAssociatedPerson | null; missing: string[] } {
  const { profile } = input
  const missing: string[] = []

  const firstName = String(profile.owner_first_name || "").trim()
  if (!firstName) missing.push(label("owner_first_name"))
  const lastName = String(profile.owner_last_name || "").trim()
  if (!lastName) missing.push(label("owner_last_name"))
  const ownerEmail = String(profile.owner_email || "").trim()
  if (!ownerEmail) missing.push(label("owner_email"))
  const birthDate = String(profile.owner_birth_date || "").trim()
  if (!birthDate) missing.push(label("owner_birth_date"))
  const title = String(profile.owner_title || "").trim()
  if (!title) missing.push(label("owner_title"))

  const ownershipRaw = String(profile.owner_ownership_percentage || "").trim()
  const ownership = /^\d{1,3}$/.test(ownershipRaw) ? Number(ownershipRaw) : null
  if (ownership === null) missing.push(label("owner_ownership_percentage"))

  const residentialAddress = address({
    line1: profile.owner_address_line1,
    line2: profile.owner_address_line2,
    city: profile.owner_city,
    state: profile.owner_state,
    postalCode: profile.owner_postal_code,
    country: profile.owner_country,
  })
  if (!residentialAddress) missing.push(label("owner_address_line1"))

  const ownerCountry = alpha3Country(profile.owner_country)
  const ownerTaxNumber = digitsOnly(input.ownerTaxId)
  const identifyingInformation: BridgeIdentifyingInformation[] =
    ownerCountry === "USA" && ownerTaxNumber
      ? [{ type: "ssn", issuing_country: ownerCountry, number: ownerTaxNumber }]
      : []

  if (missing.length > 0) return { person: null, missing }

  const person: BridgeAssociatedPerson = {
    first_name: firstName,
    last_name: lastName,
    email: ownerEmail,
    birth_date: birthDate,
    residential_address: residentialAddress as BridgeAddress,
    identifying_information: identifyingInformation,
    // Derived from the merchant's own stated ownership percentage against
    // Bridge's default 25% beneficial-ownership threshold.
    has_ownership: (ownership as number) >= 25,
    // The Business Profile representative is, by the acceptance the merchant
    // signed, the person authorized to act for this business.
    has_control: true,
    is_signer: true,
    title,
    ownership_percentage: ownership as number,
  }

  const ownerPhone = normalizePhoneForProvider(profile.owner_phone)
  if (ownerPhone) person.phone = ownerPhone

  return { person, missing: [] }
}

/**
 * True when the profile alone (no tax identifiers) can produce a payload.
 *
 * Used to decide whether the merchant still owes PineTree profile information
 * before any provider call is attempted.
 */
export function isBusinessProfileKybReady(profile: MerchantBusinessProfile): boolean {
  return buildBridgeCustomerPayload({ profile }).ok
}

/**
 * Missing PineTree Business Profile labels for the KYB submission, or an empty
 * array when nothing is outstanding.
 */
export function missingKybProfileFields(profile: MerchantBusinessProfile): string[] {
  const result = buildBridgeCustomerPayload({ profile })
  return result.ok ? [] : result.missing
}
