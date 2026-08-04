/**
 * Manual Authorization after a voice referral.
 *
 * Shift4 documents `POST /transactions/manualauthorization` for all four
 * integration methods including Commerce Engine For Cloud, and a referral is a
 * `transaction.responseCode` of `R`. These tests hold the lineage rules that
 * stop a genuine phone approval being attached to a different transaction.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  assertShift4ReferralLineage,
  buildShift4ManualAuthorizationPlan,
  normalizeShift4AuthorizationCode,
  selectShift4ManualAuthorizationVariant,
  SHIFT4_MANUAL_AUTHORIZATION_FORBIDDEN_FIELDS,
  SHIFT4_REFERRAL_RESPONSE_CODE,
  Shift4ManualAuthorizationError,
  type Shift4ReferralAttemptEvidence,
} from "@/engine/shift4/manualAuthorization"
import {
  buildShift4CloudTransactionRequest,
  shift4RoutingFor,
} from "@/providers/shift4/commerce-engine/cloud"

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8")
const codeOnly = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1")

const PAYMENT_ID = "3f1c9a2e-8b7d-4e5f-9a1b-2c3d4e5f6a7b"

/** Evaluated Test 7 uses 999998.01 — 99,999,801 minor units. */
const TEST_7_AMOUNT_MINOR = 99_999_801

const referral = (overrides: Partial<Shift4ReferralAttemptEvidence> = {}): Shift4ReferralAttemptEvidence => ({
  attemptId: "attempt-referral-1",
  merchantId: "merchant-a",
  merchantProviderConnectionId: "connection-1",
  pineTreePaymentId: PAYMENT_ID,
  attemptRole: "referral_authorization",
  invoice: "0510093358",
  amountMinor: TEST_7_AMOUNT_MINOR,
  taxAmountMinor: 0,
  currency: "USD",
  responseCode: SHIFT4_REFERRAL_RESPONSE_CODE,
  cardTokenValue: "8048471746471119",
  ...overrides,
})

const purchaseCardSources = {
  paymentId: PAYMENT_ID,
  merchantBusinessPostalCode: "60654",
  lineItemNames: ["Espresso"],
}

const PAX_READER = { device_type: "PAX A35", serial_number: "1170301234" }

describe("Shift4 manual authorization contract", () => {
  it("targets POST /transactions/manualauthorization", () => {
    const routing = shift4RoutingFor("manual_authorization")
    expect(routing?.endpoint).toBe("/transactions/manualauthorization")
    expect(routing?.method).toBe("POST")
  })

  it("recognizes Commerce Engine For Cloud as a documented variant", () => {
    expect(shift4RoutingFor("manual_authorization")?.documentedIntegrationMethods).toContain(
      "Commerce Engine For Cloud"
    )
  })

  it("builds the exact Cloud body with the device object and the code", () => {
    const built = buildShift4CloudTransactionRequest({
      operation: "manual_authorization",
      dateTime: "2026-08-04T09:18:23.283-05:00",
      totalMinor: TEST_7_AMOUNT_MINOR,
      taxMinor: 0,
      clerkNumericId: 1576,
      invoice: "0510093358",
      device: { manufacturer: "PAX", serialNumber: "1170301234" },
      purchaseCard: {
        customerReference: "PT-10241",
        destinationPostalCode: "60654",
        productDescriptors: ["Espresso"],
      },
      authorizationCode: "123456",
    })

    expect(built.endpoint).toBe("/transactions/manualauthorization")
    expect(built.body.device).toEqual({
      cloud: true,
      manufacturer: "PAX",
      serialNumber: "1170301234",
    })
    expect(built.body.transaction.authorizationCode).toBe("123456")
    expect(built.body.transaction.purchaseCard).toBeDefined()
    expect(built.body.amount.total).toBe(999998.01)
    // Merchant-local dateTime with an offset, never a UTC instant.
    expect(built.body.dateTime).toMatch(/[+-]\d{2}:\d{2}$/)
  })

  it("puts no terminalId anywhere in the Cloud body", () => {
    const built = buildShift4CloudTransactionRequest({
      operation: "manual_authorization",
      dateTime: "2026-08-04T09:18:23.283-05:00",
      totalMinor: 100,
      taxMinor: 0,
      clerkNumericId: 1,
      invoice: "0510093358",
      device: { manufacturer: "PAX", serialNumber: "1170301234" },
      purchaseCard: {
        customerReference: "PT-1",
        destinationPostalCode: "60654",
        productDescriptors: ["Retail Purchase"],
      },
      authorizationCode: "ABC123",
    })
    expect(JSON.stringify(built.body)).not.toContain("terminalId")
  })

  it("rejects an authorization code on operations that do not carry one", () => {
    expect(() =>
      buildShift4CloudTransactionRequest({
        operation: "sale",
        dateTime: "2026-08-04T09:18:23.283-05:00",
        totalMinor: 100,
        taxMinor: 0,
        clerkNumericId: 1,
        invoice: "0510093358",
        device: { manufacturer: "PAX", serialNumber: "1170301234" },
        purchaseCard: {
          customerReference: "PT-1",
          destinationPostalCode: "60654",
          productDescriptors: ["Retail Purchase"],
        },
        authorizationCode: "123456",
      })
    ).toThrow(/only valid for manual authorization/i)
  })

  it("requires purchaseCard on the Cloud manual-authorization body", () => {
    expect(() =>
      buildShift4CloudTransactionRequest({
        operation: "manual_authorization",
        dateTime: "2026-08-04T09:18:23.283-05:00",
        totalMinor: 100,
        taxMinor: 0,
        clerkNumericId: 1,
        invoice: "0510093358",
        device: { manufacturer: "PAX", serialNumber: "1170301234" },
        authorizationCode: "123456",
      })
    ).toThrow(/purchaseCard/)
  })

  it("uses the documented GTV token shape when the token variant is selected", () => {
    // Line endings are normalized: this repo checks out CRLF.
    const code = source("providers/shift4/rest/transactions/request.ts").replace(/\r\n/g, "\n")
    expect(code).toContain("card: {\n      token: { value: tokenValue },")
  })
})

describe("Shift4 authorization code validation", () => {
  it("accepts exactly six alphanumeric characters and uppercases them", () => {
    expect(normalizeShift4AuthorizationCode("123456")).toBe("123456")
    expect(normalizeShift4AuthorizationCode("abc123")).toBe("ABC123")
    expect(normalizeShift4AuthorizationCode("  ABC123  ")).toBe("ABC123")
  })

  it("rejects anything that is not six alphanumeric characters", () => {
    for (const invalid of ["12345", "1234567", "ABC 12", "ABC-12", "ABC!23", "", "      "]) {
      expect(() => normalizeShift4AuthorizationCode(invalid)).toThrow(
        Shift4ManualAuthorizationError
      )
    }
  })

  it("never echoes the rejected value back", () => {
    const message = (() => {
      try {
        normalizeShift4AuthorizationCode("SECRET-CODE")
        return ""
      } catch (error) {
        return (error as Error).message
      }
    })()
    expect(message).not.toContain("SECRET-CODE")
  })

  it("is not written to a general log anywhere on the path", () => {
    for (const path of [
      "engine/shift4/manualAuthorization.ts",
      "app/api/pos/shift4-manual-authorization/route.ts",
      "providers/shift4/rest/transactions/manualAuthorization.ts",
    ]) {
      const code = codeOnly(source(path))
      expect(code).not.toMatch(/console\.(log|info|warn|error)[^\n]*authorizationCode/)
      expect(code).not.toMatch(/logShift4Event[^\n]*authorizationCode/)
    }
  })
})

describe("Shift4 referral lineage", () => {
  it("accepts only an attempt that actually received a referral", () => {
    expect(
      assertShift4ReferralLineage({ merchantId: "merchant-a", evidence: referral() }).invoice
    ).toBe("0510093358")

    expect(() =>
      assertShift4ReferralLineage({
        merchantId: "merchant-a",
        evidence: referral({ responseCode: "A", attemptRole: "authorization" }),
      })
    ).toThrow(/did not receive a referral/i)
  })

  it("rejects another merchant's attempt with a generic message", () => {
    const foreign = (() => {
      try {
        assertShift4ReferralLineage({ merchantId: "merchant-b", evidence: referral() })
        return ""
      } catch (error) {
        return (error as Error).message
      }
    })()
    const missing = (() => {
      try {
        assertShift4ReferralLineage({ merchantId: "merchant-a", evidence: null })
        return ""
      } catch (error) {
        return (error as Error).message
      }
    })()

    // Identical, so nothing can be learned about another tenant.
    expect(foreign).toBe(missing)
    expect(foreign).toBe("No referral is available for this payment.")
  })

  it("rejects an invoice that does not match the original referral", () => {
    expect(() =>
      assertShift4ReferralLineage({
        merchantId: "merchant-a",
        evidence: referral(),
        expectedInvoice: "9999999999",
      })
    ).toThrow(/invoice does not match/i)
  })

  it("rejects an amount that does not match the original referral", () => {
    expect(() =>
      assertShift4ReferralLineage({
        merchantId: "merchant-a",
        evidence: referral(),
        expectedAmountMinor: 100,
      })
    ).toThrow(/amount does not match/i)
  })

  it("preserves the original invoice, amount and connection in the plan", () => {
    const plan = buildShift4ManualAuthorizationPlan({
      merchantId: "merchant-a",
      evidence: referral(),
      reader: PAX_READER,
      purchaseCardSources,
    })

    expect(plan.invoice).toBe("0510093358")
    expect(plan.amountMinor).toBe(TEST_7_AMOUNT_MINOR)
    expect(plan.merchantProviderConnectionId).toBe("connection-1")
    expect(plan.referralAttemptId).toBe("attempt-referral-1")
    expect(plan.pineTreePaymentId).toBe(PAYMENT_ID)
  })

  it("names every field a browser must never send", () => {
    for (const field of [
      "merchantId",
      "invoice",
      "amount",
      "token",
      "accessToken",
      "serialNumber",
      "manufacturer",
      "terminalId",
      "responseCode",
      "merchantProviderConnectionId",
      "purchaseCard",
    ]) {
      expect(SHIFT4_MANUAL_AUTHORIZATION_FORBIDDEN_FIELDS).toContain(field)
    }
  })
})

describe("Shift4 manual authorization variant selection", () => {
  it("selects the GTV token variant when the referral retained a token", () => {
    const selected = selectShift4ManualAuthorizationVariant({
      evidence: referral(),
      reader: PAX_READER,
    })
    expect(selected.variant).toBe("gtv_token")
    expect(selected.reason).toMatch(/no second card read/i)
  })

  it("selects the Commerce Engine Cloud variant when no token was retained", () => {
    const selected = selectShift4ManualAuthorizationVariant({
      evidence: referral({ cardTokenValue: null }),
      reader: PAX_READER,
    })
    expect(selected.variant).toBe("commerce_engine_cloud")
  })

  it("refuses when neither a token nor an addressable reader exists", () => {
    expect(() =>
      selectShift4ManualAuthorizationVariant({
        evidence: referral({ cardTokenValue: null }),
        reader: null,
      })
    ).toThrow(/cannot be built/i)
  })

  it("is server-side and deterministic — the browser never chooses", () => {
    const code = codeOnly(source("components/pos/Shift4ManualAuthorizationPanel.tsx"))
    for (const forbidden of ["gtv_token", "commerce_engine_cloud", "integrationMethod", "variant"]) {
      expect(code).not.toContain(forbidden)
    }
  })

  it("records the selected variant as safe attempt metadata", () => {
    const plan = buildShift4ManualAuthorizationPlan({
      merchantId: "merchant-a",
      evidence: referral(),
      reader: PAX_READER,
      purchaseCardSources,
    })
    expect(plan.variant).toBe("gtv_token")
    expect(plan.selectedVariantReason).toBeTruthy()
    // No token, serial, or credential travels with the plan.
    const serialized = JSON.stringify(plan)
    expect(serialized).not.toContain("8048471746471119")
    expect(plan.device).toBeNull()
  })

  it("attaches the device only for the Cloud variant", () => {
    const plan = buildShift4ManualAuthorizationPlan({
      merchantId: "merchant-a",
      evidence: referral({ cardTokenValue: null }),
      reader: PAX_READER,
      purchaseCardSources,
    })
    expect(plan.variant).toBe("commerce_engine_cloud")
    expect(plan.device).toEqual({ manufacturer: "PAX", serialNumber: "1170301234" })
  })

  it("reuses the same purchaseCard evidence as the original attempt", () => {
    const first = buildShift4ManualAuthorizationPlan({
      merchantId: "merchant-a",
      evidence: referral(),
      reader: PAX_READER,
      purchaseCardSources,
    })
    const second = buildShift4ManualAuthorizationPlan({
      merchantId: "merchant-a",
      evidence: referral(),
      reader: PAX_READER,
      purchaseCardSources,
    })
    // Derived from the payment, so it is identical on the authorization and on
    // the manual authorization that follows the referral.
    expect(first.purchaseCard).toEqual(second.purchaseCard)
  })
})

describe("Certification Evaluated Test 7", () => {
  it("uses the same invoice as the original authorization", () => {
    const plan = buildShift4ManualAuthorizationPlan({
      merchantId: "merchant-a",
      evidence: referral(),
      reader: PAX_READER,
      purchaseCardSources,
    })
    expect(plan.invoice).toBe(referral().invoice)
  })

  it("carries the official code and amount without hardcoding them in production logic", () => {
    const built = buildShift4CloudTransactionRequest({
      operation: "manual_authorization",
      dateTime: "2026-08-04T09:18:23.283-05:00",
      totalMinor: TEST_7_AMOUNT_MINOR,
      taxMinor: 0,
      clerkNumericId: 1576,
      invoice: "0510093358",
      device: { manufacturer: "PAX", serialNumber: "1170301234" },
      purchaseCard: {
        customerReference: "PT-10241",
        destinationPostalCode: "60654",
        productDescriptors: ["Retail Purchase"],
      },
      authorizationCode: "123456",
    })
    expect(built.body.amount.total).toBe(999998.01)
    expect(built.body.transaction.authorizationCode).toBe("123456")

    // The certification amounts are fixture inputs, never production constants.
    for (const path of [
      "engine/shift4/manualAuthorization.ts",
      "engine/shift4/purchaseCardData.ts",
      "engine/shift4/retailPreparation.ts",
      "providers/shift4/commerce-engine/cloud/transactionRequest.ts",
    ]) {
      const code = codeOnly(source(path))
      expect(code).not.toContain("999998")
      expect(code).not.toContain("123456")
    }
  })

  it("keeps live dispatch blocked on the clerk route", () => {
    const text = source("app/api/pos/shift4-manual-authorization/route.ts")
    expect(text).toContain("dispatchPermitted: false")
    expect(text).toContain("providerCallPerformed: false")
    expect(codeOnly(text)).not.toMatch(/shift4RestRequest|@\/providers\/shift4\/rest/)
  })
})

describe("Shift4 manual authorization route boundary", () => {
  const ROUTE = "app/api/pos/shift4-manual-authorization/route.ts"

  it("derives merchant identity from the signed terminal session", () => {
    expect(source(ROUTE)).toContain("requireTerminalSession(request)")
  })

  it("accepts only paymentId and authorizationCode", () => {
    const text = source(ROUTE)
    expect(text).toContain('ALLOWED_BODY_KEYS = new Set(["paymentId", "authorizationCode"])')

    const code = codeOnly(text)
    const bodyReads = [...code.matchAll(/parsed\.\s*([A-Za-z_$][\w$]*)/g)].map((match) => match[1])
    expect([...new Set(bodyReads)].sort()).toEqual(["authorizationCode", "paymentId"])
  })

  it("returns no credential, token, invoice, or amount to the browser", () => {
    const code = codeOnly(source(ROUTE))
    for (const forbidden of ["accessToken", "clientGuid", "cardToken", "serialNumber", "invoice:"]) {
      expect(code).not.toContain(forbidden)
    }
  })

  it("does not echo the accepted authorization code back", () => {
    const code = codeOnly(source(ROUTE))
    expect(code).toContain("authorizationCodeAccepted")
    expect(code).not.toMatch(/authorizationCode\s*,\s*$/m)
  })

  it("shows the clerk a loss and chargeback warning", () => {
    const panel = source("components/pos/Shift4ManualAuthorizationPanel.tsx")
    expect(panel).toMatch(/chargeback/i)
    expect(panel).toMatch(/six-character/i)
    expect(panel).toContain("Submit Manual Authorization")
    expect(panel).toContain("Cancel")
  })

  it("never runs itself after a referral", () => {
    const panel = codeOnly(source("components/pos/Shift4ManualAuthorizationPanel.tsx"))
    // Submission is only ever reachable from the button's click handler.
    expect(panel).not.toMatch(/useEffect\([^)]*submit/)
  })
})
