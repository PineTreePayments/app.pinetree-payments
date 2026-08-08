/**
 * KYB submission - Business Profile mapping, sensitive-data handling, sandbox
 * behavior, deterministic idempotency, and the webhook/config contract.
 *
 * The two rules under test: the merchant enters their business information ONCE
 * in the PineTree Business Profile, and PineTree never persists a tax
 * identifier it forwards.
 *
 * Every identifier, name, and number here is fabricated.
 */

import { readFileSync } from "node:fs"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  alpha3Country,
  buildBridgeCustomerPayload,
  isBusinessProfileKybReady,
  missingKybProfileFields,
  normalizePhoneForProvider,
  taxIdentifierLast4,
} from "@/engine/bridgeCustomerPayload"
import {
  BUSINESS_PROFILE_REQUIRED_FIELDS,
  BUSINESS_PROFILE_SECTIONS,
  BUSINESS_PROFILE_SENSITIVE_FIELDS,
} from "@/engine/businessProfileFields"
import { normalizeBusinessProfile, type MerchantBusinessProfile } from "@/engine/businessProfile"
import {
  bridgeCustomerIdempotencyKey,
  bridgeCustomerUpdateIdempotencyKey,
  bridgeExternalAccountIdempotencyKey,
  bridgeLiquidationAddressIdempotencyKey,
} from "@/providers/bridge/idempotency"
import { getBridgeWebhookPublicKey, isBridgeSandbox } from "@/providers/bridge/config"
import { SUPPORTED_BRIDGE_EVENT_CATEGORIES, translateBridgeEvent } from "@/providers/bridge/translateEvent"
import { redactBridgePayload } from "@/providers/bridge/redact"

const repoRoot = path.resolve(__dirname, "..")
const read = (relative: string) => readFileSync(path.join(repoRoot, relative), "utf8")

const FAKE_EIN = "12-3456789"
const FAKE_SSN = "123-45-6789"

function completeProfile(overrides: Partial<MerchantBusinessProfile> = {}): MerchantBusinessProfile {
  return normalizeBusinessProfile({
    legal_business_name: "Fake Test Business LLC",
    business_dba: "Fake Test",
    contact_email: "contact@fake-merchant.test",
    business_type: "retail",
    business_legal_structure: "llc",
    business_industry: "453998",
    business_description: "Sells fabricated goods for testing.",
    business_country: "US",
    business_state: "CA",
    business_city: "Testville",
    business_address_line1: "100 Fake Street",
    business_postal_code: "90210",
    business_phone: "5550000000",
    business_website: "https://fake-merchant.test",
    estimated_annual_revenue: "100000_999999",
    expected_monthly_payment_volume: "25,000",
    account_purpose: "receive_payments_for_goods_and_services",
    source_of_funds: "sales_of_goods_and_services",
    high_risk_activities: "none_of_the_above",
    operates_in_prohibited_countries: "no",
    conducts_money_services: "no",
    owner_first_name: "Fake",
    owner_last_name: "Owner",
    owner_email: "owner@fake-merchant.test",
    owner_phone: "5550000001",
    owner_title: "Managing Member",
    owner_birth_date: "1990-01-01",
    owner_ownership_percentage: "100",
    owner_address_line1: "200 Fake Avenue",
    owner_city: "Testville",
    owner_state: "CA",
    owner_postal_code: "90210",
    owner_country: "US",
    ...overrides,
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("Business Profile is the one KYB entry point", () => {
  it("builds the whole submission from the profile with nothing re-collected", () => {
    const result = buildBridgeCustomerPayload({ profile: completeProfile() })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.payload).toMatchObject({
      type: "business",
      business_legal_name: "Fake Test Business LLC",
      business_trade_name: "Fake Test",
      business_type: "llc",
      business_industry: ["453998"],
      estimated_annual_revenue_usd: "100000_999999",
      expected_monthly_payments_usd: 25000,
      account_purpose: "receive_payments_for_goods_and_services",
      source_of_funds: "sales_of_goods_and_services",
      high_risk_activities: ["none_of_the_above"],
      operates_in_prohibited_countries: false,
      conducts_money_services: false,
    })
    // Country codes are converted, not passed through.
    expect(result.payload.registered_address.country).toBe("USA")
    expect(result.payload.registered_address.subdivision).toBe("CA")
  })

  it("names missing PineTree fields rather than surfacing a provider rejection", () => {
    const profile = completeProfile({ business_description: null, owner_title: null })
    const result = buildBridgeCustomerPayload({ profile })

    expect(result.ok).toBe(false)
    if (result.ok) return
    // Human labels, never raw column names.
    expect(result.missing).toContain("What the Business Does")
    expect(result.missing).toContain("Owner Title")
    expect(missingKybProfileFields(profile).length).toBeGreaterThan(0)
    expect(isBusinessProfileKybReady(profile)).toBe(false)
  })

  it("requires every KYB field through the shared required-field contract", () => {
    // The required-field list and the submission mapper must agree, or a
    // "complete" profile could still fail at the provider.
    for (const field of ["business_legal_structure", "business_industry", "business_description",
      "estimated_annual_revenue", "expected_monthly_payment_volume", "account_purpose",
      "source_of_funds", "high_risk_activities", "operates_in_prohibited_countries",
      "conducts_money_services", "owner_title", "owner_birth_date",
      "owner_ownership_percentage", "owner_address_line1", "owner_country"] as const) {
      expect(BUSINESS_PROFILE_REQUIRED_FIELDS).toContain(field)
    }
    expect(isBusinessProfileKybReady(completeProfile())).toBe(true)
  })

  it("keeps every required field reachable in a rendered section", () => {
    const sectioned = new Set(BUSINESS_PROFILE_SECTIONS.flatMap((section) => section.fields))
    for (const field of BUSINESS_PROFILE_REQUIRED_FIELDS) {
      expect(sectioned.has(field), field).toBe(true)
    }
  })

  it("derives beneficial ownership from the merchant's own stated percentage", () => {
    const majority = buildBridgeCustomerPayload({ profile: completeProfile() })
    expect(majority.ok && majority.payload.associated_persons?.[0].has_ownership).toBe(true)

    const minority = buildBridgeCustomerPayload({
      profile: completeProfile({ owner_ownership_percentage: "10" }),
    })
    expect(minority.ok && minority.payload.associated_persons?.[0].has_ownership).toBe(false)
    expect(minority.ok && minority.payload.associated_persons?.[0].ownership_percentage).toBe(10)
  })

  it("carries the merchant's own compliance answers, never a default", () => {
    const declared = buildBridgeCustomerPayload({
      profile: completeProfile({
        high_risk_activities: "gambling,money_services",
        operates_in_prohibited_countries: "yes",
        conducts_money_services: "yes",
      }),
    })

    expect(declared.ok).toBe(true)
    if (!declared.ok) return
    expect(declared.payload.high_risk_activities).toEqual(["gambling", "money_services"])
    expect(declared.payload.operates_in_prohibited_countries).toBe(true)
    expect(declared.payload.conducts_money_services).toBe(true)
    // The provider requires an explanation once these are declared.
    expect(declared.payload.high_risk_activities_explanation).toBeTruthy()
    expect(declared.payload.compliance_screening_explanation).toBeTruthy()
  })

  it("refuses an unanswered compliance question instead of assuming no", () => {
    const unanswered = buildBridgeCustomerPayload({
      profile: completeProfile({ operates_in_prohibited_countries: null }),
    })
    expect(unanswered.ok).toBe(false)
    if (unanswered.ok) return
    expect(unanswered.missing).toContain("Operates in Prohibited Countries")
  })

  it("rejects a contradictory regulated-activity answer", () => {
    expect(() =>
      normalizeBusinessProfile({ high_risk_activities: "none_of_the_above,gambling" })
    ).toThrow(/None of the above/i)
  })

  it("rejects a value outside the controlled option list", () => {
    expect(() => normalizeBusinessProfile({ account_purpose: "laundering" })).toThrow(/available options/i)
    expect(() => normalizeBusinessProfile({ business_legal_structure: "sole-prop" })).toThrow(/available options/i)
  })

  it("rejects an under-18 representative before the provider does", () => {
    const thisYear = new Date().getUTCFullYear()
    expect(() => normalizeBusinessProfile({ owner_birth_date: `${thisYear - 5}-01-01` })).toThrow(/18/)
  })

  it("normalizes phone numbers to the documented provider format", () => {
    expect(normalizePhoneForProvider("(555) 000-0000")).toBe("+15550000000")
    expect(normalizePhoneForProvider("+44 20 7946 0000")).toBe("+442079460000")
    expect(normalizePhoneForProvider("")).toBeNull()
  })

  it("converts only the countries the profile actually offers", () => {
    expect(alpha3Country("US")).toBe("USA")
    expect(alpha3Country("gb")).toBe("GBR")
    expect(alpha3Country("ZZ")).toBeNull()
  })
})

describe("Sensitive identifiers are transit-only", () => {
  it("places a tax identifier in the payload and nowhere else", () => {
    const result = buildBridgeCustomerPayload({
      profile: completeProfile(),
      sensitive: { businessTaxId: FAKE_EIN, ownerTaxId: FAKE_SSN },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.payload.identifying_information).toEqual([
      { type: "ein", issuing_country: "USA", number: "123456789" },
    ])
    expect(result.payload.associated_persons?.[0].identifying_information).toEqual([
      { type: "ssn", issuing_country: "USA", number: "123456789" },
    ])
  })

  it("keeps tax identifiers out of the stored Business Profile shape entirely", () => {
    const profile = normalizeBusinessProfile({
      legal_business_name: "Fake Test Business LLC",
      // A caller passing these through must not be able to persist them.
      ...({ business_tax_id: FAKE_EIN, owner_tax_id: FAKE_SSN } as Record<string, string>),
    })
    expect(JSON.stringify(profile)).not.toContain("3456789")
    expect(Object.keys(profile)).not.toContain("business_tax_id")
    expect(Object.keys(profile)).not.toContain("owner_tax_id")
  })

  it("retains only the masked last four", () => {
    expect(taxIdentifierLast4(FAKE_EIN)).toBe("6789")
    expect(taxIdentifierLast4(FAKE_SSN)).toBe("6789")
    expect(taxIdentifierLast4("12")).toBeNull()
    expect(taxIdentifierLast4(null)).toBeNull()
  })

  it("omits an identifier PineTree was not given rather than reusing one", () => {
    const result = buildBridgeCustomerPayload({ profile: completeProfile() })
    expect(result.ok && result.payload.identifying_information).toBeUndefined()
    expect(result.ok && result.payload.associated_persons?.[0].identifying_information).toEqual([])
  })

  it("redacts identity material before anything can be logged", () => {
    const redacted = JSON.stringify(
      redactBridgePayload(
        buildBridgeCustomerPayload({
          profile: completeProfile(),
          sensitive: { businessTaxId: FAKE_EIN, ownerTaxId: FAKE_SSN },
        }) as unknown
      )
    )
    expect(redacted).not.toContain("123456789")
    expect(redacted).not.toContain("owner@fake-merchant.test")
    expect(redacted).not.toContain("100 Fake Street")
  })

  it("never persists a tax identifier through the credentials allowlist", () => {
    const persistence = read("database/merchantBridgeConnections.ts")
    expect(persistence).not.toContain("bridge_business_tax_id\"")
    expect(persistence).not.toContain("bridge_owner_tax_id\"")
    // Only the masks are allowed through.
    expect(persistence).toContain("bridge_business_tax_id_last4")
    expect(persistence).toContain("bridge_owner_tax_id_last4")
  })

  it("declares the sensitive fields separately from the persisted contract", () => {
    for (const field of BUSINESS_PROFILE_SENSITIVE_FIELDS) {
      expect(BUSINESS_PROFILE_REQUIRED_FIELDS as readonly string[]).not.toContain(field)
    }
  })

  it("never writes a raw bank account number", () => {
    const persistence = read("database/merchantBankDestinations.ts")
    const migration = read(
      "database/migrations/20260807120000_create_bridge_bank_withdrawal_foundation.sql"
    )
    expect(persistence).not.toContain("account_number")
    expect(persistence).not.toContain("routing_number")
    expect(migration).not.toContain("account_number ")
    expect(migration).not.toContain("routing_number ")
    expect(migration).toContain("account_last4")
  })
})

describe("Deterministic idempotency prevents duplicate provider objects", () => {
  it("derives a stable customer key from the merchant", () => {
    const first = bridgeCustomerIdempotencyKey({ merchantId: "merchant_alpha" })
    const second = bridgeCustomerIdempotencyKey({ merchantId: "merchant_alpha" })
    expect(first).toBe(second)
    expect(first).not.toBe(bridgeCustomerIdempotencyKey({ merchantId: "merchant_beta" }))
    // A PineTree identifier never travels verbatim in a provider header.
    expect(first).not.toContain("merchant_alpha")
  })

  it("gives create and update different keys so neither replays the other", () => {
    expect(bridgeCustomerIdempotencyKey({ merchantId: "merchant_alpha" })).not.toBe(
      bridgeCustomerUpdateIdempotencyKey({ merchantId: "merchant_alpha", revision: "rev1" })
    )
    expect(
      bridgeCustomerUpdateIdempotencyKey({ merchantId: "merchant_alpha", revision: "rev1" })
    ).not.toBe(bridgeCustomerUpdateIdempotencyKey({ merchantId: "merchant_alpha", revision: "rev2" }))
  })

  it("keys a bank account on the PineTree row, never on the account number", () => {
    const key = bridgeExternalAccountIdempotencyKey({
      merchantId: "merchant_alpha",
      destinationId: "dest_1",
    })
    expect(key).toBe(
      bridgeExternalAccountIdempotencyKey({ merchantId: "merchant_alpha", destinationId: "dest_1" })
    )
    expect(key).not.toContain("dest_1")
  })

  it("keys a settlement route on its complete identity", () => {
    const identity = {
      merchantId: "merchant_alpha",
      chain: "base",
      currency: "usdc",
      externalAccountId: "fake_ea_1",
      destinationPaymentRail: "ach",
      destinationCurrency: "usd",
    }
    expect(bridgeLiquidationAddressIdempotencyKey(identity)).toBe(
      bridgeLiquidationAddressIdempotencyKey(identity)
    )
    // A different source chain is a different permanent route.
    expect(bridgeLiquidationAddressIdempotencyKey(identity)).not.toBe(
      bridgeLiquidationAddressIdempotencyKey({ ...identity, chain: "solana" })
    )
  })

  it("refuses to derive a key from an incomplete identity", () => {
    expect(() => bridgeCustomerIdempotencyKey({ merchantId: "" })).toThrow()
    expect(() =>
      bridgeLiquidationAddressIdempotencyKey({
        merchantId: "merchant_alpha",
        chain: "",
        currency: "usdc",
        externalAccountId: "fake_ea_1",
        destinationPaymentRail: "ach",
        destinationCurrency: "usd",
      })
    ).toThrow()
  })
})

describe("Webhook public key configuration", () => {
  const PEM = [
    "-----BEGIN PUBLIC KEY-----",
    "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAfakekeymaterialfake",
    "-----END PUBLIC KEY-----",
  ].join("\n")

  it("accepts a genuinely multiline PEM", () => {
    expect(getBridgeWebhookPublicKey(PEM)).toBe(PEM)
  })

  it("restores a one-line value whose newlines were escaped by a deployment variable", () => {
    // Deployment variables cannot carry real newlines, so the configured value
    // is a single line containing literal backslash-n sequences.
    const escaped = PEM.replace(/\n/g, "\\n")
    expect(escaped).not.toContain("\n")
    expect(getBridgeWebhookPublicKey(escaped)).toBe(PEM)
  })

  it("tolerates surrounding whitespace and a trailing escaped newline", () => {
    expect(getBridgeWebhookPublicKey(`  ${PEM.replace(/\n/g, "\\n")}\\n  `)).toBe(PEM)
  })

  it("fails closed on an unset or non-PEM value", () => {
    expect(() => getBridgeWebhookPublicKey("")).toThrow(/not configured/i)
    expect(() => getBridgeWebhookPublicKey("not-a-key")).toThrow(/PEM/i)
  })

  it("never reaches the browser", () => {
    for (const file of ["providers/bridge/config.ts", "providers/bridge/verifyWebhook.ts"]) {
      const source = read(file)
      expect(source, file).not.toMatch(/process\.env\.NEXT_PUBLIC_/)
    }
  })
})

describe("Sandbox behavior is explicit and fails closed", () => {
  const originalEnvironment = process.env.BRIDGE_ENVIRONMENT
  const originalKey = process.env.BRIDGE_API_KEY
  const originalRedirect = process.env.BRIDGE_KYC_REDIRECT_URL

  function configure(environment: string | undefined) {
    if (environment === undefined) delete process.env.BRIDGE_ENVIRONMENT
    else process.env.BRIDGE_ENVIRONMENT = environment
    process.env.BRIDGE_API_KEY = "sk_test_bridgefake0000000000000000"
    process.env.BRIDGE_KYC_REDIRECT_URL = "https://app.pinetree.test/dashboard/wallet-setup"
  }

  function restore() {
    if (originalEnvironment === undefined) delete process.env.BRIDGE_ENVIRONMENT
    else process.env.BRIDGE_ENVIRONMENT = originalEnvironment
    if (originalKey === undefined) delete process.env.BRIDGE_API_KEY
    else process.env.BRIDGE_API_KEY = originalKey
    if (originalRedirect === undefined) delete process.env.BRIDGE_KYC_REDIRECT_URL
    else process.env.BRIDGE_KYC_REDIRECT_URL = originalRedirect
  }

  it("reports sandbox only for an explicit sandbox environment", () => {
    configure("sandbox")
    expect(isBridgeSandbox()).toBe(true)
    configure("production")
    expect(isBridgeSandbox()).toBe(false)
    // An unset or invalid value is not sandbox: no shortcut can leak into
    // production through a misconfiguration.
    configure(undefined)
    expect(isBridgeSandbox()).toBe(false)
    configure("staging")
    expect(isBridgeSandbox()).toBe(false)
    restore()
  })

  it("guards the simulated approval in the Engine and again in the client", () => {
    expect(read("engine/bridgeConnect.ts")).toContain("if (!isBridgeSandbox())")
    expect(read("providers/bridge/client.ts")).toContain('config.environment !== "sandbox"')
    // Never rendered to a merchant.
    expect(read("app/dashboard/settings/page.tsx")).not.toContain("simulate")
    expect(read("app/dashboard/wallet-setup/page.tsx")).not.toContain("simulate_kyc_approval")
  })

  it("synthesizes a signed agreement only inside the sandbox branch", () => {
    const engine = read("engine/bridgeConnect.ts")
    const branch = engine.slice(
      engine.indexOf("function resolveSignedAgreement"),
      engine.indexOf("export type BridgeTermsLinkResult")
    )
    expect(branch).toContain("if (!isBridgeSandbox()) return { agreementId: null, synthetic: false }")
  })
})

describe("Webhook categories match the configured endpoint", () => {
  it("supports customer, kyc_link, external_account, and drain events", () => {
    expect([...SUPPORTED_BRIDGE_EVENT_CATEGORIES]).toEqual([
      "customer",
      "kyc_link",
      "external_account",
      "liquidation_address.drain",
    ])
  })

  it("translates an external account event to its own identifier", () => {
    const event = translateBridgeEvent({
      event_id: "evt_fake_ea",
      event_category: "external_account",
      event_type: "external_account.updated.status_transitioned",
      event_object_id: "fake_ea_1",
      event_object: { id: "fake_ea_1", customer_id: "cust_fake", active: false },
      event_created_at: "2026-08-07T00:00:00.000Z",
    })

    expect(event).toMatchObject({
      category: "external_account",
      externalAccountId: "fake_ea_1",
      customerId: "cust_fake",
      drainId: null,
    })
  })

  it("translates a drain event with its route and state", () => {
    const event = translateBridgeEvent({
      event_id: "evt_fake_drain",
      event_category: "liquidation_address.drain",
      event_type: "liquidation_address.drain.updated.status_transitioned",
      event_object_id: "fake_drain_1",
      event_object: {
        id: "fake_drain_1",
        customer_id: "cust_fake",
        liquidation_address_id: "fake_la_1",
        state: "payment_processed",
      },
      event_created_at: "2026-08-07T00:00:00.000Z",
    })

    expect(event).toMatchObject({
      category: "liquidation_address.drain",
      drainId: "fake_drain_1",
      liquidationAddressId: "fake_la_1",
      objectStatus: "payment_processed",
      statusTransition: true,
    })
  })

  it("still refuses an unsupported category rather than guessing", () => {
    expect(
      translateBridgeEvent({
        event_id: "evt_fake_card",
        event_category: "card_transaction",
        event_object: { id: "fake_card_1" },
      })
    ).toBeNull()
  })

  it("keeps the inbox constraint aligned with the supported categories", () => {
    const migration = read(
      "database/migrations/20260807120000_create_bridge_bank_withdrawal_foundation.sql"
    )
    for (const category of SUPPORTED_BRIDGE_EVENT_CATEGORIES) {
      expect(migration, category).toContain(`'${category}'`)
    }
  })
})
