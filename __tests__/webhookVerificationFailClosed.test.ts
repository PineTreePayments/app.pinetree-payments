import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regression tests for the forged-webhook-confirmation vulnerability.
 *
 * Before this fix an unauthenticated caller could POST to the generic provider
 * webhook route, choose an adapter with the `x-provider` header, and confirm an
 * arbitrary payment:
 *
 *   POST /api/webhooks/provider
 *   x-provider: solana
 *   {"reference":"<paymentId>","confirmed":true,"feeCaptureValidated":true}
 *
 * These tests assert behavior — that nothing reaches the canonical status
 * updater or the ledger — rather than searching source text for "return false".
 */

vi.mock("@/database", () => ({
  getPaymentById: vi.fn(),
  getPaymentByProviderReference: vi.fn(),
  upsertLedgerEntry: vi.fn(),
}))

vi.mock("@/database/transactions", () => ({
  getTransactionByPaymentId: vi.fn().mockResolvedValue(null),
  getTransactionByProviderReference: vi.fn().mockResolvedValue(null),
  updateTransactionProviderReference: vi.fn(),
}))

vi.mock("@/database/paymentEvents", () => ({
  getPaymentEventByProviderEvent: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/engine/updatePaymentStatus", () => ({
  updatePaymentStatus: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/engine/transactionProgress", () => ({
  syncTransactionProgressForPayment: vi.fn(),
}))

vi.mock("@/providers/registry", () => ({
  getProvider: vi.fn(),
  registerProvider: vi.fn(),
  setProviderHealth: vi.fn(),
}))

import { getPaymentById, upsertLedgerEntry } from "@/database"
import { getPaymentEventByProviderEvent } from "@/database/paymentEvents"
import { processWebhook } from "@/engine/eventProcessor"
import { updatePaymentStatus } from "@/engine/updatePaymentStatus"
import { getProvider } from "@/providers/registry"
import { solanaAdapter } from "@/providers/solana"
import { basePayAdapter } from "@/providers/basePay"
import { coinbaseAdapter } from "@/providers/coinbase"
import { BaseProviderAdapter } from "@/providers/BaseAdapter"

const mockGetPayment = vi.mocked(getPaymentById)
const mockGetProvider = vi.mocked(getProvider)
const mockUpdateStatus = vi.mocked(updatePaymentStatus)
const mockUpsertLedger = vi.mocked(upsertLedgerEntry)
const mockGetEventByProviderEvent = vi.mocked(getPaymentEventByProviderEvent)

/** A real, non-terminal Solana payment — the victim of the original attack. */
const pendingSolanaPayment = {
  id: "11111111-2222-3333-4444-555555555555",
  merchant_id: "merchant-1",
  merchant_amount: 9.85,
  pinetree_fee: 0.15,
  gross_amount: 10,
  currency: "USD",
  provider: "solana",
  provider_reference: "solana-ref-1",
  network: "solana",
  status: "PENDING",
  payment_url: "https://example.test/pay",
  metadata: {
    split: {
      feeCaptureMethod: "atomic_split",
      merchantWallet: "merchant-wallet",
      pinetreeWallet: "pinetree-wallet",
    },
  },
}

/** The exact forged payload from the audit finding. */
const forgedPayload = {
  reference: pendingSolanaPayment.id,
  confirmed: true,
  feeCaptureValidated: true,
}

function expectNoFinancialEffect() {
  expect(mockUpdateStatus).not.toHaveBeenCalled()
  expect(mockUpsertLedger).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetEventByProviderEvent.mockResolvedValue(null)
  mockGetPayment.mockResolvedValue(pendingSolanaPayment as never)
})

// ─── Adapter-level fail-closed contracts ─────────────────────────────────────

describe("adapter webhook verification fails closed", () => {
  it("rejects an unsigned generic webhook for Solana", () => {
    // Solana confirmation comes from chain evidence via /api/webhooks/solana.
    expect(() => solanaAdapter.verifyWebhook!(forgedPayload, "", JSON.stringify(forgedPayload)))
      .toThrow(/no adapter webhook contract/i)
  })

  it("rejects an unsigned generic webhook for Base", () => {
    expect(() => basePayAdapter.verifyWebhook!({ paymentId: "p" }, "", "{}"))
      .toThrow(/no adapter webhook contract/i)
  })

  it("fails closed by default in BaseProviderAdapter", () => {
    class UnverifiedAdapter extends BaseProviderAdapter {
      readonly providerId = "unverified-test-provider"
      readonly providerName = "Unverified Test Provider"
      readonly supportedNetworks = ["solana"]
      async createPayment() {
        return { providerPaymentId: "x" } as never
      }
    }
    const adapter = new UnverifiedAdapter()
    // Must not silently accept: a subclass that forgets to override is refused.
    expect(() => adapter.verifyWebhook({ any: "payload" }, "sig", "{}")).toThrow(
      /verification is not implemented/i
    )
  })

  it("rejects a Coinbase webhook when no shared secret is configured", () => {
    vi.stubEnv("COINBASE_WEBHOOK_SHARED_SECRET", "")
    const charge = {
      type: "charge:confirmed",
      data: { metadata: { paymentId: pendingSolanaPayment.id } },
    }
    expect(coinbaseAdapter.verifyWebhook!(charge, "forged", JSON.stringify(charge))).toBe(false)
    vi.unstubAllEnvs()
  })

  it("still rejects a Coinbase webhook with a bad signature when a secret IS configured", () => {
    vi.stubEnv("COINBASE_WEBHOOK_SHARED_SECRET", "test-secret")
    const charge = { type: "charge:confirmed", data: { metadata: { paymentId: "p" } } }
    expect(coinbaseAdapter.verifyWebhook!(charge, "not-the-right-hmac", JSON.stringify(charge)))
      .toBe(false)
    vi.unstubAllEnvs()
  })
})

// ─── Engine-level fail-closed contract ───────────────────────────────────────

describe("processWebhook refuses unverified events", () => {
  it("rejects the forged Solana confirmation and produces no financial effect", async () => {
    mockGetProvider.mockReturnValue(solanaAdapter as never)

    await expect(
      processWebhook({
        provider: "solana",
        payload: forgedPayload,
        headers: {},
        rawBody: JSON.stringify(forgedPayload),
      })
    ).rejects.toThrow(/verification failed/i)

    expectNoFinancialEffect()
    // Rejection happens before the payment is even looked up.
    expect(mockGetPayment).not.toHaveBeenCalled()
  })

  it("rejects when the adapter has no verifyWebhook at all", async () => {
    mockGetProvider.mockReturnValue({
      providerId: "no-webhook-support",
      translateEvent: () => ({ paymentId: pendingSolanaPayment.id, event: "payment.confirmed" }),
    } as never)

    await expect(
      processWebhook({ provider: "mystery", payload: forgedPayload, headers: {}, rawBody: "{}" })
    ).rejects.toThrow(/unsupported/i)

    expectNoFinancialEffect()
  })

  it("rejects when verification returns a non-boolean truthy value", async () => {
    // Guards against `verified = "yes"` style regressions — the engine compares
    // strictly against true.
    mockGetProvider.mockReturnValue({
      providerId: "sloppy",
      verifyWebhook: () => "yes" as never,
      translateEvent: () => ({ paymentId: pendingSolanaPayment.id, event: "payment.confirmed" }),
    } as never)

    await expect(
      processWebhook({ provider: "solana", payload: forgedPayload, headers: {}, rawBody: "{}" })
    ).rejects.toThrow(/verification failed/i)

    expectNoFinancialEffect()
  })

  it("cannot move a payment from PENDING or PROCESSING to CONFIRMED without verification", async () => {
    mockGetProvider.mockReturnValue(solanaAdapter as never)

    for (const status of ["PENDING", "PROCESSING"]) {
      mockGetPayment.mockResolvedValue({ ...pendingSolanaPayment, status } as never)
      await expect(
        processWebhook({
          provider: "solana",
          payload: forgedPayload,
          headers: {},
          rawBody: JSON.stringify(forgedPayload),
        })
      ).rejects.toThrow()
    }

    expectNoFinancialEffect()
  })
})

// ─── Payload trust ───────────────────────────────────────────────────────────

describe("internal trust flags are never honoured from a provider payload", () => {
  it("strips feeCaptureValidated from a verified provider payload", async () => {
    // A verified adapter is used here so the request reaches the transition.
    // Even then, feeCaptureValidated must not survive from the payload — it is
    // set only by on-chain watchers that verified both split legs themselves.
    mockGetProvider.mockReturnValue({
      providerId: "verified-test-provider",
      verifyWebhook: () => true,
      translateEvent: () => ({
        paymentId: pendingSolanaPayment.id,
        event: "payment.confirmed",
      }),
    } as never)

    await processWebhook({
      provider: "solana",
      payload: { ...forgedPayload, nested: { feeCaptureValidated: true } },
      headers: {},
      rawBody: JSON.stringify(forgedPayload),
    })

    expect(mockUpdateStatus).toHaveBeenCalled()
    const rawPayload = mockUpdateStatus.mock.calls.at(-1)?.[2]?.rawPayload as
      | Record<string, unknown>
      | undefined
    expect(rawPayload).toBeDefined()

    // The attacker's `true` must not survive. The engine recomputes the flag
    // from the payment's own fee-capture method, so for atomic_split it lands on
    // false — which is what makes the CONFIRMED fee-capture gate in
    // engine/updatePaymentStatus.ts reject the attempt.
    expect(rawPayload?.feeCaptureValidated).not.toBe(true)
    expect(rawPayload?.feeCaptureValidated).toBe(false)

    // Nested copies are stripped outright rather than recomputed.
    expect(rawPayload?.nested).not.toHaveProperty("feeCaptureValidated")

    // Untouched fields of a legitimate payload still pass through.
    expect(rawPayload?.confirmed).toBe(true)
  })
})

// ─── Provider / payment rail correlation ─────────────────────────────────────

describe("provider and payment rail must correlate", () => {
  it("refuses a verified Solana event against a payment on another rail", async () => {
    mockGetProvider.mockReturnValue({
      providerId: "verified-test-provider",
      verifyWebhook: () => true,
      translateEvent: () => ({
        paymentId: pendingSolanaPayment.id,
        event: "payment.confirmed",
      }),
    } as never)
    mockGetPayment.mockResolvedValue({
      ...pendingSolanaPayment,
      provider: "shift4",
      network: "shift4",
    } as never)

    await expect(
      processWebhook({ provider: "solana", payload: forgedPayload, headers: {}, rawBody: "{}" })
    ).rejects.toThrow(/does not own payment network/i)

    expectNoFinancialEffect()
  })

  it("allows a verified event on the provider's own rail", async () => {
    mockGetProvider.mockReturnValue({
      providerId: "verified-test-provider",
      verifyWebhook: () => true,
      translateEvent: () => ({
        paymentId: pendingSolanaPayment.id,
        event: "payment.confirmed",
      }),
    } as never)

    await processWebhook({
      provider: "solana",
      payload: { reference: pendingSolanaPayment.id, confirmed: true },
      headers: {},
      rawBody: "{}",
    })

    expect(mockUpdateStatus).toHaveBeenCalled()
  })

  it("maps the speed provider alias onto the bitcoin_lightning rail", async () => {
    mockGetProvider.mockReturnValue({
      providerId: "verified-test-provider",
      verifyWebhook: () => true,
      translateEvent: () => ({
        paymentId: pendingSolanaPayment.id,
        event: "payment.confirmed",
      }),
    } as never)
    mockGetPayment.mockResolvedValue({
      ...pendingSolanaPayment,
      provider: "speed",
      network: "bitcoin_lightning",
      metadata: {
        split: { feeCaptureMethod: "invoice_split", merchantWallet: "m", pinetreeWallet: "p" },
      },
    } as never)

    await processWebhook({
      provider: "speed",
      payload: { reference: pendingSolanaPayment.id },
      headers: {},
      rawBody: "{}",
    })

    expect(mockUpdateStatus).toHaveBeenCalled()
  })
})

// ─── Idempotency and terminal protection remain intact ───────────────────────

describe("existing guards still hold for verified events", () => {
  const verifiedAdapter = {
    providerId: "verified-test-provider",
    verifyWebhook: () => true,
    translateEvent: () => ({
      paymentId: pendingSolanaPayment.id,
      event: "payment.confirmed" as const,
    }),
  }

  it("skips a duplicate provider event without re-transitioning", async () => {
    mockGetProvider.mockReturnValue(verifiedAdapter as never)
    mockGetEventByProviderEvent.mockResolvedValue({ id: "existing-event" } as never)

    await processWebhook({
      provider: "solana",
      payload: { reference: pendingSolanaPayment.id, id: "evt_dupe", confirmed: true },
      headers: {},
      rawBody: "{}",
    })

    expectNoFinancialEffect()
  })

  it("skips an event for a payment already in a terminal state", async () => {
    mockGetProvider.mockReturnValue(verifiedAdapter as never)
    mockGetPayment.mockResolvedValue({ ...pendingSolanaPayment, status: "CONFIRMED" } as never)

    await processWebhook({
      provider: "solana",
      payload: { reference: pendingSolanaPayment.id, confirmed: true },
      headers: {},
      rawBody: "{}",
    })

    expectNoFinancialEffect()
  })
})
