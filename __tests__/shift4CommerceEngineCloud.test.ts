/**
 * Commerce Engine For Cloud — the documented contract.
 *
 * These assertions are transcribed from Shift4 Payment API OpenAPI 3.1 v1.7.58
 * (`https://docs.shift4.com/_bundle/apis/payments-platform-rest/openapi.yaml`).
 * They exist so a future edit cannot quietly drift from the published schema,
 * copy an On-Premise-only shape into a Cloud request, or invent a field.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  buildShift4CloudDeviceStatusRequest,
  buildShift4CloudTransactionRequest,
  classifyShift4Device,
  readShift4CloudDeviceStatusFlags,
  SHIFT4_CLOUD_DEVICE_MANUFACTURERS,
  SHIFT4_COMMERCE_ENGINE_DEVICES,
  SHIFT4_OPERATION_ROUTING,
  Shift4CloudRequestError,
  shift4CloudAmountFromMinor,
  shift4RoutingFor,
} from "@/providers/shift4/commerce-engine/cloud"
import {
  SHIFT4_REST_PRODUCTION_BASE_URL,
  SHIFT4_REST_TEST_BASE_URL,
} from "@/providers/shift4/rest/config"
import { SHIFT4_OPERATION_ENDPOINTS } from "@/providers/shift4/rest/types"

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8")

const VALID_DATE_TIME = "2026-08-04T09:18:23.283-05:00"
const DEVICE = { manufacturer: "PAX", serialNumber: "1170301234" }

/** Level 2 data shaped like the factory's real output, not Shift4's examples. */
const PURCHASE_CARD = {
  customerReference: "PT-10241",
  destinationPostalCode: "606543201",
  productDescriptors: ["Espresso", "Croissant"],
} as const

describe("Commerce Engine For Cloud contract", () => {
  describe("hosted URLs and headers are reused, not reinvented", () => {
    it("uses the documented Shift4 hosted URLs", () => {
      // Host Direct and Commerce Engine For Cloud share these hosts; the spec's
      // servers block lists the same two URLs for both.
      expect(SHIFT4_REST_TEST_BASE_URL).toBe("https://api.shift4test.com/api/rest/v1")
      expect(SHIFT4_REST_PRODUCTION_BASE_URL).toBe("https://api.shift4api.net/api/rest/v1")
    })

    it("builds no second HTTP stack in the cloud directory", () => {
      for (const file of ["contract.ts", "deviceStatus.ts", "transactionRequest.ts", "index.ts"]) {
        const text = source(`providers/shift4/commerce-engine/cloud/${file}`)
        expect(text).not.toMatch(/\bfetch\s*\(/)
        expect(text).not.toMatch(/XMLHttpRequest|axios|node-fetch|https?:\/\/api\.shift4/)
      }
    })

    it("routes device status through the shared client's operation table", () => {
      // Reusing the table is what gives the operation the documented headers,
      // base URL selection, timeouts, redaction and error normalization.
      expect(SHIFT4_OPERATION_ENDPOINTS.device_status).toEqual({
        method: "POST",
        path: "/devices/getstatus",
      })
    })

    it("keeps the four documented headers in one place", () => {
      const client = source("providers/shift4/rest/client.ts")
      for (const header of ["InterfaceVersion", "InterfaceName", "CompanyName", "AccessToken"]) {
        expect(client).toContain(header)
      }
    })
  })

  describe("POST /devices/getstatus request body", () => {
    it("builds exactly the documented Cloud fields and nothing else", () => {
      const body = buildShift4CloudDeviceStatusRequest({ dateTime: VALID_DATE_TIME, ...DEVICE })

      expect(Object.keys(body).sort()).toEqual(["dateTime", "device"])
      expect(Object.keys(body.device).sort()).toEqual(["cloud", "manufacturer", "serialNumber"])
      expect(body.device.cloud).toBe(true)
      expect(body.device.manufacturer).toBe("PAX")
      expect(body.device.serialNumber).toBe("1170301234")
    })

    it("does not copy the On-Premise shape, which carries no device object", () => {
      // `devices_getstatus_comengdevice` requires only dateTime. A Cloud request
      // built from that shape would have no way to reach the device at all.
      const body = buildShift4CloudDeviceStatusRequest({ dateTime: VALID_DATE_TIME, ...DEVICE })
      expect(body.device).toBeDefined()
      expect(source("providers/shift4/commerce-engine/cloud/deviceStatus.ts")).toContain(
        "devices_getstatus_comengcloud"
      )
    })

    it("accepts only the documented manufacturer enum", () => {
      expect([...SHIFT4_CLOUD_DEVICE_MANUFACTURERS]).toEqual([
        "Ingenico",
        "Innowi",
        "PAX",
        "Verifone",
        "Castles",
        "Miura",
      ])

      expect(() =>
        buildShift4CloudDeviceStatusRequest({
          dateTime: VALID_DATE_TIME,
          manufacturer: "Acme",
          serialNumber: "1",
        })
      ).toThrow(Shift4CloudRequestError)
    })

    it("requires a serial number within the documented 64-character maximum", () => {
      expect(() =>
        buildShift4CloudDeviceStatusRequest({ dateTime: VALID_DATE_TIME, manufacturer: "PAX", serialNumber: "" })
      ).toThrow(/serialNumber/)

      expect(() =>
        buildShift4CloudDeviceStatusRequest({
          dateTime: VALID_DATE_TIME,
          manufacturer: "PAX",
          serialNumber: "x".repeat(65),
        })
      ).toThrow(/64/)
    })

    it("requires merchant-local dateTime with a timezone offset and rejects UTC Z", () => {
      const body = buildShift4CloudDeviceStatusRequest({ dateTime: VALID_DATE_TIME, ...DEVICE })
      expect(body.dateTime).toMatch(/[+-]\d{2}:\d{2}$/)

      // `Z` is a UTC instant, not merchant-local time. Near midnight it would
      // report the wrong local date.
      expect(() =>
        buildShift4CloudDeviceStatusRequest({ dateTime: "2026-08-04T14:18:23.283Z", ...DEVICE })
      ).toThrow(/timezone offset/)
      expect(() =>
        buildShift4CloudDeviceStatusRequest({ dateTime: "2026-08-04", ...DEVICE })
      ).toThrow(Shift4CloudRequestError)
    })
  })

  describe("POST /devices/getstatus response", () => {
    it("reads the three documented flags from result[0]", () => {
      const flags = readShift4CloudDeviceStatusFlags({
        result: [{ cloudRegistered: "Y", cloudConnected: "Y", offlineMode: "N" }],
      })
      expect(flags).toEqual({ cloudRegistered: "Y", cloudConnected: "Y", offlineMode: "N" })
    })

    it("yields null for anything undocumented rather than guessing", () => {
      expect(readShift4CloudDeviceStatusFlags({ result: [{ cloudRegistered: "MAYBE" }] })).toEqual({
        cloudRegistered: null,
        cloudConnected: null,
        offlineMode: null,
      })
      for (const body of [null, {}, { result: [] }, { result: "Y" }, { result: [null] }]) {
        expect(readShift4CloudDeviceStatusFlags(body)).toEqual({
          cloudRegistered: null,
          cloudConnected: null,
          offlineMode: null,
        })
      }
    })

    it("accepts the documented offlineMode 'U'", () => {
      const flags = readShift4CloudDeviceStatusFlags({
        result: [{ cloudRegistered: "Y", cloudConnected: "Y", offlineMode: "U" }],
      })
      expect(flags.offlineMode).toBe("U")
    })
  })

  describe("transaction request builders", () => {
    const base = {
      dateTime: VALID_DATE_TIME,
      totalMinor: 16_000,
      taxMinor: 1_500,
      clerkNumericId: 1576,
      invoice: "0510093358",
      device: DEVICE,
      purchaseCard: PURCHASE_CARD,
    }

    it("builds the documented sale body with the device object", () => {
      const built = buildShift4CloudTransactionRequest({ ...base, operation: "sale" })

      expect(built.endpoint).toBe("/transactions/sale")
      expect(Object.keys(built.body).sort()).toEqual([
        "amount",
        "clerk",
        "dateTime",
        "device",
        "transaction",
      ])
      expect(built.body.amount).toEqual({ total: 160, tax: 15 })
      expect(built.body.clerk).toEqual({ numericId: 1576 })
      expect(built.body.transaction.invoice).toBe("0510093358")
      expect(built.body.device).toEqual({ cloud: true, manufacturer: "PAX", serialNumber: "1170301234" })
    })

    it("adds card.present for refund only, as the spec requires", () => {
      const refund = buildShift4CloudTransactionRequest({ ...base, operation: "refund" })
      expect(refund.body.card).toEqual({ present: "Y" })
      expect(refund.endpoint).toBe("/transactions/refund")

      const authorization = buildShift4CloudTransactionRequest({ ...base, operation: "authorization" })
      expect(authorization.body.card).toBeUndefined()
      expect(authorization.endpoint).toBe("/transactions/authorization")
    })

    it("converts minor units to the documented decimal amounts", () => {
      expect(shift4CloudAmountFromMinor(16_000)).toBe(160)
      expect(shift4CloudAmountFromMinor(1)).toBe(0.01)
      expect(shift4CloudAmountFromMinor(0)).toBe(0)
    })

    it("enforces the documented 10-character invoice maximum", () => {
      expect(() =>
        buildShift4CloudTransactionRequest({ ...base, operation: "sale", invoice: "12345678901" })
      ).toThrow(/10/)
    })

    it("requires transaction.purchaseCard for sale and authorization", () => {
      // The schema marks it required, and PineTree derives all three fields from
      // real merchant/payment data rather than treating it as unresolved.
      expect(() =>
        buildShift4CloudTransactionRequest({ ...base, operation: "sale", purchaseCard: undefined })
      ).toThrow(/purchaseCard/)

      const built = buildShift4CloudTransactionRequest({
        ...base,
        operation: "sale",
        purchaseCard: PURCHASE_CARD,
      })
      expect(built.body.transaction.purchaseCard).toEqual({
        customerReference: "PT-10241",
        destinationPostalCode: "606543201",
        productDescriptors: ["Espresso", "Croissant"],
      })
    })

    it("does not attach purchaseCard to refund, whose Cloud variant omits it", () => {
      const refund = buildShift4CloudTransactionRequest({
        ...base,
        operation: "refund",
        purchaseCard: PURCHASE_CARD,
      })
      expect(refund.body.transaction.purchaseCard).toBeUndefined()
      expect(JSON.stringify(refund.body)).not.toContain("customerReference")
    })

    it("carries no cardholder data field of any kind", () => {
      const built = buildShift4CloudTransactionRequest({ ...base, operation: "sale" })
      const serialized = JSON.stringify(built.body).toLowerCase()
      for (const forbidden of [
        "pan",
        "cardnumber",
        "expirationdate",
        "track",
        "cvv",
        "csc",
        "pinblock",
        "ksn",
        "p2pe",
        "emv",
      ]) {
        expect(serialized).not.toContain(forbidden)
      }

      // And the module cannot express one either.
      const text = source("providers/shift4/commerce-engine/cloud/transactionRequest.ts")
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1")
      for (const forbidden of ["pan:", "cardNumber", "securityCode", "pinBlock", "trackData"]) {
        expect(code).not.toContain(forbidden)
      }
    })
  })

  describe("operation to integration-method matrix", () => {
    it("routes device-entry operations through Commerce Engine For Cloud", () => {
      for (const operation of ["authorization", "sale", "refund"]) {
        expect(shift4RoutingFor(operation)?.route).toBe("commerce_engine_cloud")
        expect(shift4RoutingFor(operation)?.cloudRequestSchemaPublished).toBe(true)
      }
    })

    it("keeps capture token-addressed, because only token body variants exist", () => {
      // Capture IS reachable over Cloud, but the published request body offers
      // only token variants — so no device object may be invented for it.
      const capture = shift4RoutingFor("capture")
      expect(capture?.route).toBe("host_direct")
      expect(capture?.cloudRequestSchemaPublished).toBe(false)
      expect(capture?.tokenAddressed).toBe(true)
      expect(capture?.requiresPurchaseCard).toBe(false)
      expect(capture?.documentedIntegrationMethods).toContain("Commerce Engine For Cloud")
    })

    it("treats void and invoice information as stage-dependent header operations", () => {
      expect(shift4RoutingFor("void")?.route).toBe("either_by_stage")
      expect(shift4RoutingFor("invoice_information")?.route).toBe("either_by_stage")
    })

    it("recognizes Commerce Engine For Cloud as a documented manual-authorization method", () => {
      // The operation description publishes all four integration methods. An
      // earlier revision read the servers block instead and wrongly called this
      // Cloud-unsupported.
      const manual = shift4RoutingFor("manual_authorization")
      expect(manual?.documentedIntegrationMethods).toEqual([
        "Host Direct",
        "Locally Installed UTG",
        "Commerce Engine For On Premise",
        "Commerce Engine For Cloud",
      ])
      expect(manual?.route).toBe("either_by_stage")
      expect(manual?.cloudRequestSchemaPublished).toBe(true)
      expect(manual?.requiresPurchaseCard).toBe(true)
      expect(manual?.endpoint).toBe("/transactions/manualauthorization")
    })

    it("carries no unresolved-question language in the matrix", () => {
      for (const entry of SHIFT4_OPERATION_ROUTING) {
        expect(entry.rationale).not.toMatch(/AMBIGUITY|pending Shift4 confirmation|open question/i)
      }
    })

    it("does not treat GET /devices/info as a Cloud endpoint", () => {
      // Its published integration methods are On Premise and locally installed
      // UTG — Commerce Engine For Cloud is absent.
      const info = shift4RoutingFor("device_information")
      expect(info?.route).toBe("not_supported_for_cloud")
      expect(info?.documentedIntegrationMethods).not.toContain("Commerce Engine For Cloud")
      expect(info?.cloudRequestSchemaPublished).toBe(false)
    })

    it("never calls /devices/info anywhere in the integration", () => {
      expect(SHIFT4_OPERATION_ENDPOINTS).not.toHaveProperty("device_information")
      for (const path of [
        "engine/shift4/deviceStatus.ts",
        "engine/shift4/retailPreparation.ts",
        "providers/shift4/commerce-engine/cloud/deviceStatus.ts",
      ]) {
        const code = source(path)
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
        expect(code).not.toContain("/devices/info")
      }
    })
  })

  describe("device model classification", () => {
    it("lists exactly Shift4's published Commerce Engine devices", () => {
      expect(SHIFT4_COMMERCE_ENGINE_DEVICES.map((device) => device.model)).toEqual([
        "A800",
        "A6630",
        "A35",
        "A3700",
        "IM30",
        "V660p",
        "P630-A",
        "UX700",
      ])
    })

    it("classifies official PAX models as documented and in PineTree's plan", () => {
      for (const model of ["A800", "A6630", "A35", "A3700", "IM30"]) {
        const result = classifyShift4Device(model)
        expect(result.classification).toBe("documented_shift4_device")
        expect(result.manufacturer).toBe("PAX")
        expect(result.note).toContain("PAX certification plan")
      }
      expect(classifyShift4Device("PAX A35").manufacturer).toBe("PAX")
      expect(classifyShift4Device("pax-a35").classification).toBe("documented_shift4_device")
    })

    it("classifies official Verifone models as documented but scope-pending", () => {
      for (const model of ["V660p", "P630-A", "UX700"]) {
        const result = classifyShift4Device(model)
        expect(result.classification).toBe("certification_scope_pending")
        expect(result.manufacturer).toBe("Verifone")
        expect(result.note).toBe(
          "Documented Commerce Engine device; PineTree certification scope confirmation pending"
        )
      }
    })

    it("never labels a documented Verifone model unsupported or PineTree-certified", () => {
      for (const model of ["V660p", "P630-A", "UX700"]) {
        const note = classifyShift4Device(model).note
        expect(note).not.toMatch(/unsupported/i)
        expect(note).not.toMatch(/\bcertified\b/i)
      }
    })

    it("accepts an unknown model safely and flags it for review", () => {
      const result = classifyShift4Device("PAX A920")
      expect(result.classification).toBe("unrecognized_model")
      // The manufacturer still resolves, so a Cloud request remains buildable.
      expect(result.manufacturer).toBe("PAX")
      expect(result.note).toMatch(/Confirm the model with Shift4/)

      const unknown = classifyShift4Device("Something Else")
      expect(unknown.classification).toBe("unrecognized_model")
      expect(unknown.manufacturer).toBeNull()
    })

    it("does not resolve a bare manufacturer name to an arbitrary model", () => {
      expect(classifyShift4Device("PAX").model).toBeNull()
      expect(classifyShift4Device("").classification).toBe("unrecognized_model")
    })
  })
})
