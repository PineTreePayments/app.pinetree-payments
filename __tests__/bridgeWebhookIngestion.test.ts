/**
 * Bridge (by Stripe) - webhook signature verification, event translation, and
 * Engine ingestion (dedup, ordering, tenant resolution).
 *
 * Signatures are produced with a throwaway RSA key generated in-process. All
 * Bridge identifiers and payloads are fully fabricated.
 */

import { createSign, generateKeyPairSync } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  BRIDGE_WEBHOOK_TOLERANCE_MS,
  isBridgeTimestampFresh,
  parseBridgeSignatureHeader,
  verifyBridgeWebhookSignature,
} from "@/providers/bridge/verifyWebhook"
import {
  extractBridgeEventObject,
  translateBridgeEvent,
} from "@/providers/bridge/translateEvent"

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
})

const OTHER_KEY = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
})

const FAKE_CUSTOMER_ID = "cust_66666666-6666-4666-8666-666666666666"
const FAKE_KYC_LINK_ID = "kyc_77777777-7777-4777-8777-777777777777"
const NOW_MS = 1_785_000_000_000

/** Sign a body exactly the way Bridge documents: RSA-SHA256 over `${t}.${body}`. */
function signBridgeBody(rawBody: string, timestampMs: number, key = privateKey): string {
  const signer = createSign("RSA-SHA256")
  signer.update(`${timestampMs}.${rawBody}`)
  signer.end()
  return `t=${timestampMs},v0=${signer.sign(key, "base64")}`
}

/**
 * The Engine receives the raw header map (exactly what the route passes from
 * `req.headers`) and resolves Bridge's signature header itself.
 */
function asHeaders(signature: string): Record<string, string> {
  return { "content-type": "application/json", "x-webhook-signature": signature }
}

function customerEvent(overrides: Record<string, unknown> = {}) {
  return {
    api_version: "v0",
    event_id: "evt_88888888-8888-4888-8888-888888888888",
    event_category: "customer",
    event_type: "customer.updated.status_transitioned",
    event_object_id: FAKE_CUSTOMER_ID,
    event_object_status: "active",
    event_object: { id: FAKE_CUSTOMER_ID, status: "active" },
    event_created_at: new Date(NOW_MS).toISOString(),
    ...overrides,
  }
}

describe("Bridge webhook signature header parsing", () => {
  it("parses the documented t=/v0= format", () => {
    const parts = parseBridgeSignatureHeader("t=1785000000000,v0=QUJD")
    expect(parts).toEqual({ timestampMs: 1785000000000, signatureBase64: "QUJD" })
  })

  it("tolerates whitespace and an unknown extra segment", () => {
    const parts = parseBridgeSignatureHeader("t=1785000000000, v0=QUJD, v1=ignored")
    expect(parts?.timestampMs).toBe(1785000000000)
    expect(parts?.signatureBase64).toBe("QUJD")
  })

  it("returns null rather than a partially trusted value for a malformed header", () => {
    expect(parseBridgeSignatureHeader("")).toBeNull()
    expect(parseBridgeSignatureHeader("v0=QUJD")).toBeNull()
    expect(parseBridgeSignatureHeader("t=notanumber,v0=QUJD")).toBeNull()
    expect(parseBridgeSignatureHeader("t=1785000000000,v0=")).toBeNull()
    expect(parseBridgeSignatureHeader("t=1785000000000,v0=not base64!")).toBeNull()
  })

  it("bounds the replay window in both directions", () => {
    expect(isBridgeTimestampFresh(NOW_MS, NOW_MS)).toBe(true)
    expect(isBridgeTimestampFresh(NOW_MS - BRIDGE_WEBHOOK_TOLERANCE_MS + 1, NOW_MS)).toBe(true)
    expect(isBridgeTimestampFresh(NOW_MS - BRIDGE_WEBHOOK_TOLERANCE_MS - 1, NOW_MS)).toBe(false)
    // A far-future timestamp must not buy an unlimited replay lifetime.
    expect(isBridgeTimestampFresh(NOW_MS + BRIDGE_WEBHOOK_TOLERANCE_MS + 1, NOW_MS)).toBe(false)
  })
})

describe("Bridge webhook signature verification", () => {
  const rawBody = JSON.stringify(customerEvent())

  it("accepts a correctly signed, fresh delivery", () => {
    const result = verifyBridgeWebhookSignature({
      rawBody,
      signatureHeader: signBridgeBody(rawBody, NOW_MS),
      publicKeyPem: publicKey,
      nowMs: NOW_MS,
    })
    expect(result).toEqual({ valid: true, timestampMs: NOW_MS })
  })

  it("rejects a signature made with a different key", () => {
    const result = verifyBridgeWebhookSignature({
      rawBody,
      signatureHeader: signBridgeBody(rawBody, NOW_MS, OTHER_KEY.privateKey),
      publicKeyPem: publicKey,
      nowMs: NOW_MS,
    })
    expect(result).toEqual({ valid: false, reason: "signature_mismatch" })
  })

  it("rejects a body modified after signing", () => {
    const signatureHeader = signBridgeBody(rawBody, NOW_MS)
    const tampered = JSON.stringify(customerEvent({ event_object_status: "rejected" }))

    const result = verifyBridgeWebhookSignature({
      rawBody: tampered,
      signatureHeader,
      publicKeyPem: publicKey,
      nowMs: NOW_MS,
    })
    expect(result).toEqual({ valid: false, reason: "signature_mismatch" })
  })

  it("rejects a genuinely signed but expired delivery", () => {
    const staleMs = NOW_MS - BRIDGE_WEBHOOK_TOLERANCE_MS - 1000
    const result = verifyBridgeWebhookSignature({
      rawBody,
      signatureHeader: signBridgeBody(rawBody, staleMs),
      publicKeyPem: publicKey,
      nowMs: NOW_MS,
    })
    expect(result).toEqual({ valid: false, reason: "timestamp_outside_tolerance" })
  })

  it("rejects a replayed timestamp reused with a mismatched signature", () => {
    // Signature computed over an older timestamp, header claims a fresh one.
    const realSignature = signBridgeBody(rawBody, NOW_MS - 60_000).split("v0=")[1]
    const result = verifyBridgeWebhookSignature({
      rawBody,
      signatureHeader: `t=${NOW_MS},v0=${realSignature}`,
      publicKeyPem: publicKey,
      nowMs: NOW_MS,
    })
    expect(result).toEqual({ valid: false, reason: "signature_mismatch" })
  })

  it("fails closed on a missing or malformed header", () => {
    expect(
      verifyBridgeWebhookSignature({ rawBody, signatureHeader: null, publicKeyPem: publicKey })
    ).toEqual({ valid: false, reason: "missing_signature_header" })

    expect(
      verifyBridgeWebhookSignature({ rawBody, signatureHeader: "garbage", publicKeyPem: publicKey })
    ).toEqual({ valid: false, reason: "malformed_signature_header" })
  })

  it("fails closed on a malformed public key rather than accepting", () => {
    const result = verifyBridgeWebhookSignature({
      rawBody,
      signatureHeader: signBridgeBody(rawBody, NOW_MS),
      publicKeyPem: "-----BEGIN PUBLIC KEY-----\nnot-a-real-key\n-----END PUBLIC KEY-----",
      nowMs: NOW_MS,
    })
    expect(result.valid).toBe(false)
  })
})

describe("Bridge event translation", () => {
  it("translates a customer status transition", () => {
    const event = translateBridgeEvent(customerEvent())

    expect(event).toMatchObject({
      eventId: "evt_88888888-8888-4888-8888-888888888888",
      category: "customer",
      type: "customer.updated.status_transitioned",
      statusTransition: true,
      customerId: FAKE_CUSTOMER_ID,
      objectStatus: "active",
    })
    expect(event?.occurredAtMs).toBe(NOW_MS)
  })

  it("translates a kyc_link event and recovers the customer id from the object", () => {
    const event = translateBridgeEvent({
      event_id: "evt_99999999-9999-4999-8999-999999999999",
      event_category: "kyc_link",
      event_type: "kyc_link.updated.status_transitioned",
      event_object_id: FAKE_KYC_LINK_ID,
      event_object: { id: FAKE_KYC_LINK_ID, customer_id: FAKE_CUSTOMER_ID, kyc_status: "approved" },
      event_created_at: new Date(NOW_MS).toISOString(),
    })

    expect(event?.category).toBe("kyc_link")
    expect(event?.kycLinkId).toBe(FAKE_KYC_LINK_ID)
    expect(event?.customerId).toBe(FAKE_CUSTOMER_ID)
    expect(event?.objectStatus).toBe("approved")
  })

  it("returns null for an unsupported category instead of guessing", () => {
    expect(translateBridgeEvent(customerEvent({ event_category: "transfer" }))).toBeNull()
    expect(translateBridgeEvent(customerEvent({ event_category: "virtual_account" }))).toBeNull()
  })

  it("returns null when the event carries no event id", () => {
    expect(translateBridgeEvent(customerEvent({ event_id: "" }))).toBeNull()
    expect(translateBridgeEvent(null)).toBeNull()
    expect(translateBridgeEvent("not an object")).toBeNull()
  })

  it("marks a non-transition update as such", () => {
    const event = translateBridgeEvent(customerEvent({ event_type: "customer.created" }))
    expect(event?.statusTransition).toBe(false)
  })

  it("exposes the raw event object only as a signal", () => {
    expect(extractBridgeEventObject(customerEvent())).toMatchObject({ id: FAKE_CUSTOMER_ID })
    expect(extractBridgeEventObject({ event_id: "evt_x" })).toBeNull()
  })
})

// ─── Engine ingestion ────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  claimBridgeWebhookEvent: vi.fn(),
  markBridgeWebhookEventProcessed: vi.fn(),
  findMerchantByBridgeIdentifiers: vi.fn(),
  getMerchantBridgeConnection: vi.fn(),
  upsertMerchantBridgeConnection: vi.fn(),
  insertMerchantAuditEvent: vi.fn(),
  syncAccount: vi.fn(),
  connectMerchant: vi.fn(),
  getMerchantBusinessProfile: vi.fn(),
}))

vi.mock("@/database/merchantBridgeConnections", async () => {
  const actual = await vi.importActual<typeof import("@/database/merchantBridgeConnections")>(
    "@/database/merchantBridgeConnections"
  )
  return {
    ...actual,
    claimBridgeWebhookEvent: mocks.claimBridgeWebhookEvent,
    markBridgeWebhookEventProcessed: mocks.markBridgeWebhookEventProcessed,
    findMerchantByBridgeIdentifiers: mocks.findMerchantByBridgeIdentifiers,
    getMerchantBridgeConnection: mocks.getMerchantBridgeConnection,
    upsertMerchantBridgeConnection: mocks.upsertMerchantBridgeConnection,
  }
})

vi.mock("@/database/merchantAuditEvents", () => ({
  insertMerchantAuditEvent: mocks.insertMerchantAuditEvent,
}))

vi.mock("@/engine/businessProfile", () => ({
  getMerchantBusinessProfile: mocks.getMerchantBusinessProfile,
}))

vi.mock("@/providers/bridge/adapter", () => ({
  bridgeAdapter: {
    syncAccount: mocks.syncAccount,
    connectMerchant: mocks.connectMerchant,
  },
}))

import { ingestBridgeWebhookEventEngine } from "@/engine/bridgeConnect"

const APPROVED_CONNECTION = {
  customerId: FAKE_CUSTOMER_ID,
  kycLinkId: FAKE_KYC_LINK_ID,
  customerType: "business" as const,
  rawCustomerStatus: "active",
  rawKycStatus: "approved",
  rawTosStatus: "approved",
  kycStatus: "approved" as const,
  tosStatus: "approved" as const,
  customerStatus: "active" as const,
  endorsements: [
    {
      name: "base",
      status: "approved" as const,
      approved: true,
      missingRequirements: [],
      pendingRequirements: [],
      issues: [],
    },
  ],
  baseEndorsementApproved: true,
  requirementsDue: [],
  futureRequirementsDue: [],
  providerCreatedAt: "2026-08-01T00:00:00.000Z",
  providerUpdatedAt: "2026-08-02T00:00:00.000Z",
}

function ownerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row_fake_1",
    merchantId: "merchant_alpha",
    status: "connected",
    enabled: false,
    credentials: {
      bridge_customer_id: FAKE_CUSTOMER_ID,
      bridge_kyc_link_id: FAKE_KYC_LINK_ID,
      onboarding_requested_at: "2026-08-01T00:00:00.000Z",
    },
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

describe("Bridge webhook Engine ingestion", () => {
  const rawBody = JSON.stringify(customerEvent())

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})

    process.env.BRIDGE_ENVIRONMENT = "sandbox"
    process.env.BRIDGE_API_KEY = "sk_test_bridgefake0000000000000000"
    process.env.BRIDGE_KYC_REDIRECT_URL = "https://app.pinetree.test/dashboard/providers"
    process.env.BRIDGE_WEBHOOK_PUBLIC_KEY = publicKey

    mocks.findMerchantByBridgeIdentifiers.mockResolvedValue(ownerRow())
    mocks.claimBridgeWebhookEvent.mockResolvedValue({
      claimed: true,
      record: { id: "inbox_fake_1" },
    })
    mocks.markBridgeWebhookEventProcessed.mockResolvedValue(undefined)
    mocks.upsertMerchantBridgeConnection.mockResolvedValue(undefined)
    mocks.insertMerchantAuditEvent.mockResolvedValue(undefined)
    mocks.syncAccount.mockResolvedValue({
      connection: APPROVED_CONNECTION,
      correlationId: "corr_fake",
    })
  })

  it("rejects an invalid signature before parsing or touching any state", async () => {
    const result = await ingestBridgeWebhookEventEngine({
      rawBody,
      headers: asHeaders(signBridgeBody(rawBody, NOW_MS, OTHER_KEY.privateKey)),
      nowMs: NOW_MS,
    })

    expect(result).toMatchObject({ ok: false, status: 400, reason: "signature_mismatch" })
    expect(mocks.claimBridgeWebhookEvent).not.toHaveBeenCalled()
    expect(mocks.findMerchantByBridgeIdentifiers).not.toHaveBeenCalled()
    expect(mocks.upsertMerchantBridgeConnection).not.toHaveBeenCalled()
  })

  it("rejects an expired timestamp and changes nothing", async () => {
    const staleMs = NOW_MS - BRIDGE_WEBHOOK_TOLERANCE_MS - 1000
    const result = await ingestBridgeWebhookEventEngine({
      rawBody,
      headers: asHeaders(signBridgeBody(rawBody, staleMs)),
      nowMs: NOW_MS,
    })

    expect(result).toMatchObject({ ok: false, status: 400, reason: "timestamp_outside_tolerance" })
    expect(mocks.upsertMerchantBridgeConnection).not.toHaveBeenCalled()
  })

  it("applies a verified event exactly once and audits it once", async () => {
    const result = await ingestBridgeWebhookEventEngine({
      rawBody,
      headers: asHeaders(signBridgeBody(rawBody, NOW_MS)),
      nowMs: NOW_MS,
    })

    expect(result).toMatchObject({ ok: true, applied: true })
    expect(mocks.upsertMerchantBridgeConnection).toHaveBeenCalledTimes(1)
    expect(mocks.insertMerchantAuditEvent).toHaveBeenCalledTimes(1)
    expect(mocks.insertMerchantAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: "merchant_alpha",
        eventType: "provider.bridge_webhook_applied",
      })
    )
  })

  it("re-reads Bridge state instead of trusting the event payload", async () => {
    await ingestBridgeWebhookEventEngine({
      rawBody,
      headers: asHeaders(signBridgeBody(rawBody, NOW_MS)),
      nowMs: NOW_MS,
    })

    // Approval evidence comes from a Bridge lookup, never from the delivered
    // event object.
    expect(mocks.syncAccount).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: FAKE_CUSTOMER_ID, kycLinkId: FAKE_KYC_LINK_ID })
    )
  })

  it("acknowledges a duplicate delivery without duplicating state or audit records", async () => {
    mocks.claimBridgeWebhookEvent.mockResolvedValue({
      claimed: false,
      record: { id: "inbox_fake_1" },
    })

    const result = await ingestBridgeWebhookEventEngine({
      rawBody,
      headers: asHeaders(signBridgeBody(rawBody, NOW_MS)),
      nowMs: NOW_MS,
    })

    expect(result).toMatchObject({ ok: true, applied: false, reason: "duplicate" })
    expect(mocks.upsertMerchantBridgeConnection).not.toHaveBeenCalled()
    expect(mocks.insertMerchantAuditEvent).not.toHaveBeenCalled()
    expect(mocks.syncAccount).not.toHaveBeenCalled()
  })

  it("retains an out-of-order event without letting it regress newer state", async () => {
    mocks.findMerchantByBridgeIdentifiers.mockResolvedValue(
      ownerRow({
        credentials: {
          bridge_customer_id: FAKE_CUSTOMER_ID,
          bridge_kyc_link_id: FAKE_KYC_LINK_ID,
          // A newer event was already applied.
          last_applied_event_at: new Date(NOW_MS + 60_000).toISOString(),
          last_applied_event_id: "evt_newer",
        },
      })
    )

    const staleEventBody = JSON.stringify(
      customerEvent({
        event_id: "evt_older",
        event_object_status: "under_review",
        event_created_at: new Date(NOW_MS - 60_000).toISOString(),
      })
    )

    const result = await ingestBridgeWebhookEventEngine({
      rawBody: staleEventBody,
      headers: asHeaders(signBridgeBody(staleEventBody, NOW_MS)),
      nowMs: NOW_MS,
    })

    expect(result).toMatchObject({ ok: true, applied: false })
    // Stored as evidence, but never applied.
    expect(mocks.claimBridgeWebhookEvent).toHaveBeenCalledTimes(1)
    expect(mocks.upsertMerchantBridgeConnection).not.toHaveBeenCalled()
    expect(mocks.markBridgeWebhookEventProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ skippedReason: "out_of_order" })
    )
  })

  it("applies a newer event even when it moves an approved merchant backwards", async () => {
    mocks.findMerchantByBridgeIdentifiers.mockResolvedValue(
      ownerRow({
        enabled: true,
        credentials: {
          bridge_customer_id: FAKE_CUSTOMER_ID,
          bridge_kyc_link_id: FAKE_KYC_LINK_ID,
          enablement_decision_at: "2026-08-02T00:00:00.000Z",
          last_applied_event_at: new Date(NOW_MS - 60_000).toISOString(),
        },
      })
    )
    mocks.syncAccount.mockResolvedValue({
      connection: { ...APPROVED_CONNECTION, customerStatus: "paused", kycStatus: "paused" },
      correlationId: "corr_fake",
    })

    const result = await ingestBridgeWebhookEventEngine({
      rawBody,
      headers: asHeaders(signBridgeBody(rawBody, NOW_MS)),
      nowMs: NOW_MS,
    })

    expect(result).toMatchObject({ ok: true, applied: true })

    // A paused customer must land as action_required with the row disabled.
    const [saved] = mocks.upsertMerchantBridgeConnection.mock.calls[0] as [
      { status: string; enabled: boolean }
    ]
    expect(saved.status).toBe("action_required")
    expect(saved.enabled).toBe(false)
  })

  it("stores a verified event whose merchant is unknown instead of dropping it", async () => {
    mocks.findMerchantByBridgeIdentifiers.mockResolvedValue(null)

    const result = await ingestBridgeWebhookEventEngine({
      rawBody,
      headers: asHeaders(signBridgeBody(rawBody, NOW_MS)),
      nowMs: NOW_MS,
    })

    expect(result).toMatchObject({ ok: true, applied: false, reason: "unresolved_merchant" })
    expect(mocks.claimBridgeWebhookEvent).toHaveBeenCalledTimes(1)
    expect(mocks.markBridgeWebhookEventProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ skippedReason: "unresolved_merchant" })
    )
    expect(mocks.upsertMerchantBridgeConnection).not.toHaveBeenCalled()
  })

  it("resolves the tenant only from stored Bridge identifiers, never from the payload", async () => {
    const spoofed = JSON.stringify(
      customerEvent({
        // A hostile payload asserting a different merchant must be ignored.
        merchant_id: "merchant_victim",
        event_object: { id: FAKE_CUSTOMER_ID, status: "active", merchant_id: "merchant_victim" },
      })
    )

    await ingestBridgeWebhookEventEngine({
      rawBody: spoofed,
      headers: asHeaders(signBridgeBody(spoofed, NOW_MS)),
      nowMs: NOW_MS,
    })

    expect(mocks.findMerchantByBridgeIdentifiers).toHaveBeenCalledWith({
      customerId: FAKE_CUSTOMER_ID,
      kycLinkId: null,
    })
    const [saved] = mocks.upsertMerchantBridgeConnection.mock.calls[0] as [{ merchantId: string }]
    expect(saved.merchantId).toBe("merchant_alpha")
  })

  it("acknowledges a verified but unsupported category without state change", async () => {
    const transferBody = JSON.stringify(customerEvent({ event_category: "transfer" }))

    const result = await ingestBridgeWebhookEventEngine({
      rawBody: transferBody,
      headers: asHeaders(signBridgeBody(transferBody, NOW_MS)),
      nowMs: NOW_MS,
    })

    expect(result).toMatchObject({ ok: true, applied: false, reason: "unsupported_category" })
    expect(mocks.claimBridgeWebhookEvent).not.toHaveBeenCalled()
    expect(mocks.upsertMerchantBridgeConnection).not.toHaveBeenCalled()
  })

  it("returns 400 for a signed but malformed JSON body", async () => {
    const malformed = "{not json"
    const result = await ingestBridgeWebhookEventEngine({
      rawBody: malformed,
      headers: asHeaders(signBridgeBody(malformed, NOW_MS)),
      nowMs: NOW_MS,
    })

    expect(result).toMatchObject({ ok: false, status: 400, reason: "malformed_json" })
  })

  it("returns 500 so Bridge retries when PineTree cannot durably store the event", async () => {
    mocks.claimBridgeWebhookEvent.mockRejectedValue(new Error("database unavailable"))

    const result = await ingestBridgeWebhookEventEngine({
      rawBody,
      headers: asHeaders(signBridgeBody(rawBody, NOW_MS)),
      nowMs: NOW_MS,
    })

    expect(result).toMatchObject({ ok: false, status: 500, reason: "claim_failed" })
  })
})
