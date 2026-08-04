/**
 * Commerce Engine For Cloud — the documented contract, transcribed.
 *
 * SOURCE: Shift4 Payment API OpenAPI 3.1 spec, version 1.7.58, published at
 * `https://docs.shift4.com/_bundle/apis/payments-platform-rest/openapi.yaml`,
 * plus the guide at `https://docs.shift4.com/guides/device-functionality/
 * commerce-engine`. Every constant below is transcribed from that spec. Nothing
 * here is inferred, and no field name appears that the spec does not publish.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 * PineTree previously carried `DocumentBlockedShift4CommerceEngineClient`,
 * which threw `documentation_required` on the stated basis that no official
 * endpoint, authentication, or payload schema was available. That is no longer
 * true: the spec publishes a distinct `Commerce Engine For Cloud` request
 * variant for each supported operation. This module replaces the assumption
 * with the contract.
 *
 * ── The one fact that changes the shape of everything ────────────────────────
 * Commerce Engine For Cloud addresses a payment device by MANUFACTURER +
 * SERIAL NUMBER, not by terminal ID:
 *
 *     "device": { "cloud": true, "manufacturer": "PAX", "serialNumber": "…" }
 *
 * The On-Premise variant of `/devices/getstatus` carries NO `device` object at
 * all (it is addressed by the local network URL), so copying the On-Premise
 * body into a Cloud request would omit every routing field. The two are not
 * interchangeable, and this module keeps them apart deliberately.
 *
 * A Shift4 terminal ID remains PineTree's stored provider identifier and the
 * Shift4-side merchant/terminal binding, but it is NOT how a Cloud request
 * reaches the device.
 *
 * SECURITY: pure and server-only. No credential, no I/O, no environment read.
 */

/** The exact `device.manufacturer` enum. Transcribed, not extended. */
export const SHIFT4_CLOUD_DEVICE_MANUFACTURERS = [
  "Ingenico",
  "Innowi",
  "PAX",
  "Verifone",
  "Castles",
  "Miura",
] as const

export type Shift4CloudDeviceManufacturer = (typeof SHIFT4_CLOUD_DEVICE_MANUFACTURERS)[number]

/** Documented maximum length of `device.serialNumber`. */
export const SHIFT4_CLOUD_SERIAL_NUMBER_MAX_LENGTH = 64

/**
 * The `device` object every Commerce Engine For Cloud request requires.
 * `cloud` is documented as: "Value must be sent as `true` in order to route the
 * request to the payment device at the merchant location."
 */
export type Shift4CloudDevice = Readonly<{
  cloud: true
  manufacturer: Shift4CloudDeviceManufacturer
  serialNumber: string
}>

/**
 * Devices Shift4 documents for Commerce Engine, from the guide's supported list.
 *
 * `certificationScope` is PineTree's own status, NOT Shift4's. Shift4 documents
 * platform support for all of these; PineTree's approved integration plan names
 * PAX only. Conflating the two would claim a certification PineTree does not
 * hold, so the two facts are stored as separate fields and never merged.
 */
export type Shift4CommerceEngineDeviceEntry = Readonly<{
  model: string
  manufacturer: Shift4CloudDeviceManufacturer
  /** True for every model in Shift4's published Commerce Engine device list. */
  documentedByShift4: true
  /**
   * `pinetree_pax_plan` — named in PineTree's approved integration plan.
   * `confirmation_pending` — documented by Shift4, not yet confirmed as inside
   * PineTree's certification scope. Never rendered as "unsupported".
   */
  certificationScope: "pinetree_pax_plan" | "confirmation_pending"
}>

/** Shift4's published Commerce Engine device list. */
export const SHIFT4_COMMERCE_ENGINE_DEVICES: readonly Shift4CommerceEngineDeviceEntry[] = Object.freeze([
  { model: "A800", manufacturer: "PAX", documentedByShift4: true, certificationScope: "pinetree_pax_plan" },
  { model: "A6630", manufacturer: "PAX", documentedByShift4: true, certificationScope: "pinetree_pax_plan" },
  { model: "A35", manufacturer: "PAX", documentedByShift4: true, certificationScope: "pinetree_pax_plan" },
  { model: "A3700", manufacturer: "PAX", documentedByShift4: true, certificationScope: "pinetree_pax_plan" },
  { model: "IM30", manufacturer: "PAX", documentedByShift4: true, certificationScope: "pinetree_pax_plan" },
  { model: "V660p", manufacturer: "Verifone", documentedByShift4: true, certificationScope: "confirmation_pending" },
  { model: "P630-A", manufacturer: "Verifone", documentedByShift4: true, certificationScope: "confirmation_pending" },
  { model: "UX700", manufacturer: "Verifone", documentedByShift4: true, certificationScope: "confirmation_pending" },
] as const)

/**
 * How PineTree classifies a locally configured device model.
 *
 * `unrecognized_model` is deliberately NOT an error state. Shift4 may assign a
 * model outside today's published list, and a POS that hard-fails on an unknown
 * string would be brittle in exactly the situation this integration is being
 * prepared for. It is accepted and flagged for operator review.
 */
export type Shift4DeviceClassification =
  | "documented_shift4_device"
  | "certification_scope_pending"
  | "unrecognized_model"

export type Shift4DeviceClassificationResult = Readonly<{
  classification: Shift4DeviceClassification
  /** Null when the model string does not resolve to a documented manufacturer. */
  manufacturer: Shift4CloudDeviceManufacturer | null
  /** The matched catalog model, when one matched. */
  model: string | null
  /** Operator-facing sentence. Never claims a certification PineTree lacks. */
  note: string
}>

function normalizeModelText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

/**
 * Classify a stored `device_type` string against Shift4's published list.
 *
 * Matching is deliberately tolerant of formatting ("PAX A920", "pax-a920"),
 * because the stored value is typed by an operator, while the RESULT is
 * conservative: an unmatched model never becomes a documented one.
 */
export function classifyShift4Device(deviceType: string | null | undefined): Shift4DeviceClassificationResult {
  const raw = String(deviceType ?? "").trim()
  if (!raw) {
    return Object.freeze({
      classification: "unrecognized_model" as const,
      manufacturer: null,
      model: null,
      note: "No device model is recorded. Confirm the model with Shift4 before verification.",
    })
  }

  const normalized = normalizeModelText(raw)
  const entry = SHIFT4_COMMERCE_ENGINE_DEVICES.find((candidate) => {
    const model = normalizeModelText(candidate.model)
    const manufacturer = normalizeModelText(candidate.manufacturer)
    // Match "A920" alone or "PAX A920"; require the model token either way so
    // a bare manufacturer name cannot resolve to an arbitrary model.
    return normalized === model || normalized === `${manufacturer}${model}`
  })

  if (!entry) {
    // A manufacturer may still be recoverable even when the model is not
    // published, which is what lets a Cloud request be built at all.
    const manufacturer = SHIFT4_CLOUD_DEVICE_MANUFACTURERS.find((candidate) =>
      normalized.startsWith(normalizeModelText(candidate))
    ) ?? null

    return Object.freeze({
      classification: "unrecognized_model" as const,
      manufacturer,
      model: null,
      note: manufacturer
        ? `${manufacturer} is a documented Commerce Engine manufacturer, but this model is not in Shift4's published device list. Confirm the model with Shift4.`
        : "This model is not in Shift4's published Commerce Engine device list. Confirm the model with Shift4.",
    })
  }

  if (entry.certificationScope === "confirmation_pending") {
    return Object.freeze({
      classification: "certification_scope_pending" as const,
      manufacturer: entry.manufacturer,
      model: entry.model,
      note: "Documented Commerce Engine device; PineTree certification scope confirmation pending",
    })
  }

  return Object.freeze({
    classification: "documented_shift4_device" as const,
    manufacturer: entry.manufacturer,
    model: entry.model,
    note: "Documented and included in PineTree's current PAX certification plan",
  })
}

/**
 * Which Shift4 integration method PineTree uses for each operation.
 *
 * ── Correction ───────────────────────────────────────────────────────────────
 * An earlier revision read each path's `servers` block as the authoritative
 * statement of supported integration methods. That was wrong. The authoritative
 * statement is the operation DESCRIPTION, which publishes an explicit
 * "**Integration Methods:**" list. `/transactions/manualauthorization` lists all
 * four — Host Direct, Locally Installed UTG, Commerce Engine For On Premise and
 * Commerce Engine For Cloud — while its `servers` block happens to omit the
 * Cloud URLs. That omission is harmless and not a restriction: for every
 * transaction path the Commerce Engine For Cloud URLs are byte-identical to the
 * Host Direct URLs, so the entry is redundant where it does appear.
 *
 * Each entry below therefore records the description's integration-method list,
 * cross-checked against which request-body variants the spec publishes — because
 * "reachable over Cloud" and "has a device body" are different questions.
 * Capture is reachable over Cloud yet publishes only token bodies, so it stays
 * token-based and gains no invented device object.
 */
export type Shift4IntegrationRoute =
  /** Card is read at the device: Commerce Engine For Cloud. */
  | "commerce_engine_cloud"
  /** Subsequent token- or invoice-addressed operation: Host Direct. */
  | "host_direct"
  /** Documented for both; the transaction stage decides which PineTree sends. */
  | "either_by_stage"
  /** Not reachable from a cloud POS at all. */
  | "not_supported_for_cloud"

export type Shift4OperationRouting = Readonly<{
  operation: string
  endpoint: string
  method: "GET" | "POST" | "DELETE"
  route: Shift4IntegrationRoute
  /** The description's published "Integration Methods" list, verbatim. */
  documentedIntegrationMethods: readonly string[]
  /** Whether the spec publishes a `Commerce Engine For Cloud` body variant. */
  cloudRequestSchemaPublished: boolean
  /** Whether the selected PineTree body is token-addressed rather than device-addressed. */
  tokenAddressed: boolean
  /** Whether the selected schema requires `transaction.purchaseCard`. */
  requiresPurchaseCard: boolean
  rationale: string
}>

/** The four documented integration methods, as the descriptions spell them. */
const ALL_FOUR = Object.freeze([
  "Host Direct",
  "Locally Installed UTG",
  "Commerce Engine For On Premise",
  "Commerce Engine For Cloud",
])

export const SHIFT4_OPERATION_ROUTING: readonly Shift4OperationRouting[] = Object.freeze([
  {
    operation: "authorization",
    endpoint: "/transactions/authorization",
    method: "POST",
    route: "commerce_engine_cloud",
    documentedIntegrationMethods: ALL_FOUR,
    cloudRequestSchemaPublished: true,
    tokenAddressed: false,
    requiresPurchaseCard: true,
    rationale: "Initial card entry happens at the device, so the request routes to the device.",
  },
  {
    operation: "sale",
    endpoint: "/transactions/sale",
    method: "POST",
    route: "commerce_engine_cloud",
    documentedIntegrationMethods: ALL_FOUR,
    cloudRequestSchemaPublished: true,
    tokenAddressed: false,
    requiresPurchaseCard: true,
    rationale: "Initial card entry happens at the device, so the request routes to the device.",
  },
  {
    operation: "refund",
    endpoint: "/transactions/refund",
    method: "POST",
    route: "commerce_engine_cloud",
    documentedIntegrationMethods: ALL_FOUR,
    cloudRequestSchemaPublished: true,
    tokenAddressed: false,
    // The refund Cloud variant requires `card.present`, not purchaseCard.
    requiresPurchaseCard: false,
    rationale: "Card-present refund requires a card interaction at the device.",
  },
  {
    operation: "capture",
    endpoint: "/transactions/capture",
    method: "POST",
    route: "host_direct",
    documentedIntegrationMethods: ALL_FOUR,
    cloudRequestSchemaPublished: false,
    tokenAddressed: true,
    requiresPurchaseCard: false,
    rationale:
      "Reachable over Cloud, but the published request body offers ONLY token variants — there is no device variant. Capture acts on an existing authorization and needs no card interaction, so PineTree sends the documented GTV-token body Host Direct and adds no device object.",
  },
  {
    operation: "void",
    endpoint: "/transactions/invoice",
    method: "DELETE",
    route: "either_by_stage",
    documentedIntegrationMethods: ALL_FOUR,
    cloudRequestSchemaPublished: false,
    tokenAddressed: false,
    requiresPurchaseCard: false,
    rationale:
      "Void takes no request body and is addressed by the Invoice header, so no device variant exists or is needed. PineTree sends it Host Direct against the original invoice.",
  },
  {
    operation: "invoice_information",
    endpoint: "/transactions/invoice",
    method: "GET",
    route: "either_by_stage",
    documentedIntegrationMethods: ALL_FOUR,
    cloudRequestSchemaPublished: false,
    tokenAddressed: false,
    requiresPurchaseCard: false,
    rationale:
      "A read-only lookup with no request body, addressed by the Invoice header. PineTree sends it Host Direct during timeout recovery.",
  },
  {
    operation: "manual_authorization",
    endpoint: "/transactions/manualauthorization",
    method: "POST",
    route: "either_by_stage",
    documentedIntegrationMethods: ALL_FOUR,
    cloudRequestSchemaPublished: true,
    // Either variant may be selected; the GTV variant is token-addressed.
    tokenAddressed: false,
    requiresPurchaseCard: true,
    rationale:
      "The operation description publishes all four integration methods, including Commerce Engine For Cloud, and a comengcloud body variant exists. PineTree selects deterministically: the GTV-token variant when the referral evidence carries a usable token (no second card read), otherwise the Commerce Engine For Cloud variant against the merchant-owned reader.",
  },
  {
    operation: "device_status",
    endpoint: "/devices/getstatus",
    method: "POST",
    route: "commerce_engine_cloud",
    documentedIntegrationMethods: Object.freeze([
      "Commerce Engine For On Premise",
      "Commerce Engine For Cloud",
    ]),
    cloudRequestSchemaPublished: true,
    tokenAddressed: false,
    requiresPurchaseCard: false,
    rationale:
      "Published for Commerce Engine On Premise and Commerce Engine For Cloud only. There is no Host Direct integration method for this path.",
  },
  {
    operation: "device_information",
    endpoint: "/devices/info",
    method: "GET",
    route: "not_supported_for_cloud",
    documentedIntegrationMethods: Object.freeze([
      "Commerce Engine For On Premise",
      "Locally Installed UTG",
    ]),
    cloudRequestSchemaPublished: false,
    tokenAddressed: false,
    requiresPurchaseCard: false,
    rationale:
      "The description publishes only Commerce Engine For On Premise and Locally Installed UTG — Commerce Engine For Cloud is absent, and the servers block lists only the local UTG URL. It is not a cloud terminal-listing or auto-discovery endpoint and must not be used as one.",
  },
] as const)

export function shift4RoutingFor(operation: string): Shift4OperationRouting | null {
  return SHIFT4_OPERATION_ROUTING.find((entry) => entry.operation === operation) ?? null
}

/**
 * Documented `transaction.purchaseCard` limits, transcribed.
 *
 * An earlier revision treated this object as an unresolved question for Shift4.
 * It is not: the spec documents each field's meaning and limit, and PineTree
 * derives all three from its own stored merchant and payment data in
 * `engine/shift4/purchaseCardData.ts`. It is required by the sale, authorization
 * and manual-authorization schemas, and is NOT part of capture, refund, void or
 * invoice information.
 */
export const SHIFT4_PURCHASE_CARD_LIMITS = {
  customerReference: 25,
  destinationPostalCode: 9,
  productDescriptor: 40,
  productDescriptorCount: 4,
} as const

/** Operations whose selected PineTree schema requires `transaction.purchaseCard`. */
export function shift4RequiresPurchaseCard(operation: string): boolean {
  return shift4RoutingFor(operation)?.requiresPurchaseCard === true
}
