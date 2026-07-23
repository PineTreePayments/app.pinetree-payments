import fs from "fs"
import path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { convertUsdFeeToSats } from "@/lib/bitcoin/feeConversion"
import { extractBitcoinFeeSettlementInfo, type BitcoinFeeSettlementInfo } from "@/lib/bitcoin/feeSettlementInfo"
import { PINETREE_FEE } from "@/engine/config"

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8")
}

const speedClientSrc = read("providers/lightning/speedClient.ts")
const speedAdapterSrc = read("providers/lightning/speedAdapter.ts")
const speedWalletManagementSrc = read("providers/lightning/speedWalletManagement.ts")
const reconciliationSrc = read("engine/lightningSpeedReconciliation.ts")
const speedFeeSettlementSrc = read("engine/speedFeeSettlement.ts")
const dynamicOwnershipSrc = read("lib/wallets/dynamicWalletOwnership.ts")
const dynamicIdentityRepairSrc = read("lib/wallets/dynamicIdentityRepair.ts")

describe("Speed Bitcoin Lightning payment creation follows the documented application_fee contract", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    process.env = {
      ...originalEnv,
      SPEED_API_KEY: "sk_test_present",
      SPEED_WEBHOOK_SECRET: "wsec_present",
      SPEED_API_BASE_URL: "https://api.tryspeed.test",
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env = originalEnv
  })

  function mockSpeedPaymentResponse(overrides: Record<string, unknown> = {}) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "pi_test123",
      object: "payment",
      status: "unpaid",
      currency: "USD",
      amount: 10.15,
      target_currency: "SATS",
      target_amount: 16200,
      payment_method_options: {
        lightning: { id: "lni_test", payment_request: "lntb162u1p4reuw2pp5test" },
      },
      transfers: [
        {
          destination_account: "acct_platform_1",
          fixed_amount: 0.15,
          created_type: "APPLICATION_FEE",
          description: "Application fee transfer",
        },
      ],
      ttl: 300,
      ...overrides,
    }), { status: 200 })))
  }

  it("1/2/3/4. sends a $10.15 gross payment with application_fee exactly 0.15 (fixed USD, not sats, no percentage)", async () => {
    mockSpeedPaymentResponse()
    const { createSpeedLightningPayment } = await import("@/providers/lightning/speedClient")

    const result = await createSpeedLightningPayment({
      amount: 10.15,
      currency: "USD",
      merchantAmount: 10,
      pineTreeFeeAmount: 0.15,
      merchantSpeedAccountId: "acct_merchant_1",
      pineTreePaymentId: "pay-fee-test",
      merchantId: "merchant-1",
      settlementMode: "speed_connect_split",
    })

    const fetchMock = vi.mocked(fetch)
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init?.body || "{}"))

    expect(body.amount).toBe(10.15)
    expect(body.currency).toBe("USD")
    expect(body.application_fee).toBe(0.15)
    expect(body).not.toHaveProperty("application_fee_percentage")
    expect(result.speedPaymentId).toBe("pi_test123")
  })

  it("5. speed-account header carries the merchant connected account id, and the platform API key remains the auth credential", async () => {
    mockSpeedPaymentResponse()
    const { createSpeedLightningPayment } = await import("@/providers/lightning/speedClient")

    await createSpeedLightningPayment({
      amount: 10.15,
      currency: "USD",
      merchantAmount: 10,
      pineTreeFeeAmount: 0.15,
      merchantSpeedAccountId: "acct_merchant_1",
      pineTreePaymentId: "pay-fee-test-headers",
      merchantId: "merchant-1",
      settlementMode: "speed_connect_split",
    })

    const fetchMock = vi.mocked(fetch)
    const [, init] = fetchMock.mock.calls[0]
    const headers = new Headers(init?.headers)

    expect(headers.get("speed-account")).toBe("acct_merchant_1")
    expect(headers.get("authorization")).toBe(`Basic ${Buffer.from("sk_test_present:").toString("base64")}`)
  })

  it("6. a missing/unverified BTC price does not block invoice creation (sats conversion is best-effort, never fatal)", async () => {
    mockSpeedPaymentResponse({ id: "pi_test2" })
    const { createSpeedLightningPayment } = await import("@/providers/lightning/speedClient")

    const result = await createSpeedLightningPayment({
      amount: 10.15,
      currency: "USD",
      merchantAmount: 10,
      pineTreeFeeAmount: 0.15,
      merchantSpeedAccountId: "acct_merchant_1",
      pineTreePaymentId: "pay-no-price",
      merchantId: "merchant-1",
      settlementMode: "speed_connect_split",
    })

    expect(result.speedPaymentId).toBe("pi_test2")
    expect(result.platformFeeSats).toBeNull()
    expect(result.applicationFeeRequested).toBe(0.15)
  })

  it("does not send the previously-attempted sats-denominated fee, even when a caller still supplies pineTreeFeeSats", async () => {
    mockSpeedPaymentResponse({ id: "pi_test3" })
    const { createSpeedLightningPayment } = await import("@/providers/lightning/speedClient")

    await createSpeedLightningPayment({
      amount: 10.15,
      currency: "USD",
      merchantAmount: 10,
      pineTreeFeeAmount: 0.15,
      pineTreeFeeSats: 225, // the exact kind of value that triggered Speed's 400 in production
      btcPriceUsdAtFeeQuote: 66_666.6667,
      merchantSpeedAccountId: "acct_merchant_1",
      pineTreePaymentId: "pay-fee-test-5",
      merchantId: "merchant-1",
      settlementMode: "speed_connect_split",
    })

    const fetchMock = vi.mocked(fetch)
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init?.body || "{}"))
    expect(body.application_fee).toBe(0.15)
    expect(typeof body.application_fee).toBe("number")
    // The sats value is still recorded internally (metadata) for display -
    // just never sent as application_fee.
    expect(body.metadata).toMatchObject({ platform_fee_sats: 225 })
  })

  it("no fee is requested (and no application_fee sent) when PineTree's fee is zero", async () => {
    mockSpeedPaymentResponse({ id: "pi_test4" })
    const { createSpeedLightningPayment } = await import("@/providers/lightning/speedClient")

    const result = await createSpeedLightningPayment({
      amount: 10,
      currency: "USD",
      merchantAmount: 10,
      pineTreeFeeAmount: 0,
      merchantSpeedAccountId: "acct_merchant_1",
      pineTreePaymentId: "pay-zero-fee",
      merchantId: "merchant-1",
      settlementMode: "speed_connect_split",
    })

    const fetchMock = vi.mocked(fetch)
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init?.body || "{}"))
    expect(body).not.toHaveProperty("application_fee")
    expect(result.feeSettlementStatus).toBe("not_applicable")
  })

  it("a Speed POST /payments 400 is logged with the full documented-contract diagnostic fields", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "invalid_request",
      errors: [{ field: "amount", message: "amount is too small" }],
    }), {
      status: 400,
      headers: { "webhook-id": "req_diagnostic_1" },
    })))
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const { createSpeedLightningPayment } = await import("@/providers/lightning/speedClient")
    await expect(createSpeedLightningPayment({
      amount: 10.15,
      currency: "USD",
      merchantAmount: 10,
      pineTreeFeeAmount: 0.15,
      merchantSpeedAccountId: "acct_merchant_1",
      pineTreePaymentId: "pay-fee-test-6",
      merchantId: "merchant-1",
      settlementMode: "speed_connect_split",
    })).rejects.toThrow()

    const call = errorSpy.mock.calls.find(([label]) => label === "[speed] bitcoin_payment_create_failed")
    expect(call).toBeTruthy()
    const [, details] = call!
    expect(details).toMatchObject({
      canonicalTransactionId: "pay-fee-test-6",
      httpStatus: 400,
      operation: "payment.create",
      settlementMode: "speed_connect_split",
      applicationFeePresent: true,
      applicationFeeValue: 0.15,
      applicationFeePercentagePresent: false,
      speedAccountHeaderPresent: true,
      apiEnvironment: "test",
      invoiceCurrency: "USD",
      targetCurrency: "SATS",
      merchantSpeedAccountSuffix: "acct_merchant_1".slice(-6),
    })
    expect(details.providerMessage).toBe("amount is too small")

    errorSpy.mockRestore()
  })

  it("never logs the full merchant Speed account id or API key in the failure diagnostic", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "invalid_request" }), { status: 400 })))
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const { createSpeedLightningPayment } = await import("@/providers/lightning/speedClient")
    await createSpeedLightningPayment({
      amount: 10.15, currency: "USD", merchantAmount: 10, pineTreeFeeAmount: 0.15,
      merchantSpeedAccountId: "acct_merchant_full_identifier_1", pineTreePaymentId: "pay-fee-test-6b",
      merchantId: "merchant-1", settlementMode: "speed_connect_split",
    }).catch(() => undefined)

    const call = errorSpy.mock.calls.find(([label]) => label === "[speed] bitcoin_payment_create_failed")
    const serialized = JSON.stringify(call)
    expect(serialized).not.toContain("acct_merchant_full_identifier_1")
    expect(serialized).not.toContain("sk_test_present")

    errorSpy.mockRestore()
  })

  it("7/9/10. accepts the documented response shape: nested payment_method_options.lightning.payment_request, status 'unpaid', and a valid pi_ id", async () => {
    mockSpeedPaymentResponse({ id: "pi_shape_test" })
    const { createSpeedLightningPayment } = await import("@/providers/lightning/speedClient")

    const result = await createSpeedLightningPayment({
      amount: 10.15, currency: "USD", merchantAmount: 10, pineTreeFeeAmount: 0.15,
      merchantSpeedAccountId: "acct_merchant_1", pineTreePaymentId: "pay-shape-test",
      merchantId: "merchant-1", settlementMode: "speed_connect_split",
    })

    expect(result.speedPaymentId).toBe("pi_shape_test")
    expect(result.paymentRequest).toBe("lntb162u1p4reuw2pp5test")
    expect(result.status).toBe("unpaid")
  })

  it("10. optional null/missing response fields do not cause parser rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "pi_minimal",
      status: "unpaid",
      payment_method_options: { lightning: { payment_request: "lntb1minimal" } },
      // No transfers, no hosted_url/checkout_url/url, no expires_at/created/modified.
    }), { status: 200 })))
    const { createSpeedLightningPayment } = await import("@/providers/lightning/speedClient")

    const result = await createSpeedLightningPayment({
      amount: 10.15, currency: "USD", merchantAmount: 10, pineTreeFeeAmount: 0.15,
      merchantSpeedAccountId: "acct_merchant_1", pineTreePaymentId: "pay-minimal-test",
      merchantId: "merchant-1", settlementMode: "speed_connect_split",
    })

    expect(result.speedPaymentId).toBe("pi_minimal")
    expect(result.paymentRequest).toBe("lntb1minimal")
    expect(result.transfers).toEqual([])
    expect(result.feeSettlementStatus).toBe("missing")
  })

  it("11. parses an APPLICATION_FEE transfer from the create-payment response into 'transfer_created'", async () => {
    mockSpeedPaymentResponse({ id: "pi_transfer_test" })
    const { createSpeedLightningPayment } = await import("@/providers/lightning/speedClient")

    const result = await createSpeedLightningPayment({
      amount: 10.15, currency: "USD", merchantAmount: 10, pineTreeFeeAmount: 0.15,
      merchantSpeedAccountId: "acct_merchant_1", pineTreePaymentId: "pay-transfer-test",
      merchantId: "merchant-1", settlementMode: "speed_connect_split",
    })

    expect(result.feeSettlementStatus).toBe("transfer_created")
    expect(result.applicationFeeTransferDestinationAccount).toBe("acct_platform_1")
    expect(result.applicationFeeTransferFixedAmount).toBe(0.15)
    expect(result.transfers.length).toBe(1)
  })
})

describe("USD-to-sats conversion (retained for internal bookkeeping/display only)", () => {
  it("never converts a nonzero $0.15 fee to zero sats, across a realistic BTC price range", () => {
    for (const btcPriceUsd of [10_000, 30_000, 60_000, 100_000, 250_000, 500_000]) {
      const sats = convertUsdFeeToSats(0.15, btcPriceUsd)
      expect(sats).toBeGreaterThanOrEqual(1)
      expect(Number.isInteger(sats)).toBe(true)
    }
  })

  it("is deterministic and rounds up (ceil), never down", () => {
    const a = convertUsdFeeToSats(0.15, 66_666.6667)
    const b = convertUsdFeeToSats(0.15, 66_666.6667)
    expect(a).toBe(b)
    expect(a).toBe(225)

    const nonWholeSats = 0.15 / 61_234 * 100_000_000
    expect(Number.isInteger(nonWholeSats)).toBe(false)
    expect(convertUsdFeeToSats(0.15, 61_234)).toBe(Math.ceil(nonWholeSats))
  })

  it("PINETREE_FEE is $0.15, not the earlier $0.10 value", () => {
    expect(PINETREE_FEE).toBe(0.15)
  })
})

describe("Fee bookkeeping stays reconcilable even when incomplete", () => {
  it("extraction never throws on missing or malformed metadata", () => {
    const cases: unknown[] = [null, undefined, {}, { split: null }, { split: {} }, { split: { lightningProviderMetadata: null } }, "not-an-object", 42]
    for (const input of cases) {
      let result: BitcoinFeeSettlementInfo | undefined
      expect(() => { result = extractBitcoinFeeSettlementInfo(input) }).not.toThrow()
      expect(result).toMatchObject({ feeUsd: null, feeSats: null, feeSettlementStatus: null, providerReferencePresent: false })
    }
  })

  it("a well-formed record round-trips its values for later reconciliation, including transfer settlement evidence", () => {
    const wellFormed = extractBitcoinFeeSettlementInfo({
      split: {
        lightningProviderMetadata: {
          pineTreeFeeAmount: 0.15,
          platformFeeSats: 225,
          feeConversionRateUsd: 66_666.6667,
          feeSettlementStatus: "settled",
          speedPaymentId: "pi_test123",
          applicationFeeTransferId: "pitrm_test123",
          applicationFeeTransferDestinationAccount: "acct_platform_1",
        }
      }
    })
    expect(wellFormed).toMatchObject({
      feeUsd: 0.15,
      feeSats: 225,
      feeSettlementStatus: "settled",
      providerReferencePresent: true,
      applicationFeeTransferId: "pitrm_test123",
      applicationFeeTransferDestinationAccount: "acct_platform_1",
    })
  })

  it("request-time and confirmation-time diagnostics both surface a reconciliationState field", () => {
    expect(speedAdapterSrc).toContain("reconciliationState: speedPayment.feeSettlementStatus")
    expect(reconciliationSrc).toContain("reconciliationState: feeInfo.feeSettlementStatus")
  })
})

describe("12/13/14. Speed fee settlement is recorded from provider evidence exactly once, never falsely", () => {
  const settlementMocks = vi.hoisted(() => ({
    getPaymentById: vi.fn(),
    updatePaymentMetadata: vi.fn(),
  }))

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.doMock("@/database/payments", () => ({
      getPaymentById: settlementMocks.getPaymentById,
      updatePaymentMetadata: settlementMocks.updatePaymentMetadata,
    }))
    settlementMocks.updatePaymentMetadata.mockResolvedValue({ id: "pay-1" })
  })

  it("12. a webhook transfer ID marks the fee settled exactly once", async () => {
    settlementMocks.getPaymentById.mockResolvedValue({
      id: "pay-1",
      metadata: { split: { lightningProviderMetadata: { feeSettlementStatus: "transfer_created" } } },
    })
    const { recordSpeedApplicationFeeSettlement } = await import("@/engine/speedFeeSettlement")

    await recordSpeedApplicationFeeSettlement("pay-1", [
      { created_type: "APPLICATION_FEE", transfer_id: "pitrm_1", destination_account: "acct_platform_1" },
    ])

    expect(settlementMocks.updatePaymentMetadata).toHaveBeenCalledTimes(1)
    const [, update] = settlementMocks.updatePaymentMetadata.mock.calls[0]
    expect(update.split.lightningProviderMetadata).toMatchObject({
      feeSettlementStatus: "settled",
      applicationFeeTransferId: "pitrm_1",
      applicationFeeTransferDestinationAccount: "acct_platform_1",
    })
  })

  it("13. duplicate webhooks cannot duplicate the fee - a second call against an already-settled record is a no-op", async () => {
    settlementMocks.getPaymentById.mockResolvedValue({
      id: "pay-1",
      metadata: { split: { lightningProviderMetadata: { feeSettlementStatus: "settled", applicationFeeTransferId: "pitrm_1" } } },
    })
    const { recordSpeedApplicationFeeSettlement } = await import("@/engine/speedFeeSettlement")

    await recordSpeedApplicationFeeSettlement("pay-1", [
      { created_type: "APPLICATION_FEE", transfer_id: "pitrm_1", destination_account: "acct_platform_1" },
    ])

    expect(settlementMocks.updatePaymentMetadata).not.toHaveBeenCalled()
  })

  it("14. a missing fee transfer does not falsely mark the fee settled", async () => {
    settlementMocks.getPaymentById.mockResolvedValue({
      id: "pay-1",
      metadata: { split: { lightningProviderMetadata: { feeSettlementStatus: "transfer_created" } } },
    })
    const { recordSpeedApplicationFeeSettlement } = await import("@/engine/speedFeeSettlement")

    await recordSpeedApplicationFeeSettlement("pay-1", [])

    expect(settlementMocks.updatePaymentMetadata).toHaveBeenCalledTimes(1)
    const [, update] = settlementMocks.updatePaymentMetadata.mock.calls[0]
    expect(update.split.lightningProviderMetadata.feeSettlementStatus).toBe("missing")
    expect(update.split.lightningProviderMetadata.applicationFeeTransferId).toBeUndefined()
  })

  it("never acts on a payment that never expected a connect-split fee (not_applicable / retained_pending_sweep)", async () => {
    for (const status of ["not_applicable", "retained_pending_sweep"]) {
      settlementMocks.updatePaymentMetadata.mockClear()
      settlementMocks.getPaymentById.mockResolvedValue({
        id: "pay-1",
        metadata: { split: { lightningProviderMetadata: { feeSettlementStatus: status } } },
      })
      const { recordSpeedApplicationFeeSettlement } = await import("@/engine/speedFeeSettlement")
      await recordSpeedApplicationFeeSettlement("pay-1", [
        { created_type: "APPLICATION_FEE", transfer_id: "pitrm_1", destination_account: "acct_platform_1" },
      ])
      expect(settlementMocks.updatePaymentMetadata).not.toHaveBeenCalled()
    }
  })

  it("both call sites (webhook path and reconciliation polling path) invoke the shared settlement recorder", () => {
    const eventProcessorSrc = read("engine/eventProcessor.ts")
    expect(eventProcessorSrc).toContain("recordSpeedApplicationFeeSettlement")
    expect(reconciliationSrc).toContain("recordSpeedApplicationFeeSettlement")
    expect(speedFeeSettlementSrc).toContain("PRE_SETTLEMENT_STATUSES")
  })
})

describe("Fee-request idempotency", () => {
  it("application_fee is only ever requested once, at invoice creation - webhook/reconciliation never call createSpeedLightningPayment", () => {
    const translateEventSrc = speedAdapterSrc.slice(
      speedAdapterSrc.indexOf("translateEvent(payload)"),
      speedAdapterSrc.indexOf("async healthCheck()")
    )
    expect(translateEventSrc).not.toContain("createSpeedLightningPayment")
    expect(translateEventSrc).not.toContain("createLightningInvoice")
    expect(reconciliationSrc).not.toContain("createSpeedLightningPayment")
    expect(reconciliationSrc).not.toContain("createLightningInvoice")
    expect(reconciliationSrc).toContain("TERMINAL_STATUSES.has(currentStatus)")
  })
})

describe("Dynamic Base/Solana identity fixes remain unchanged by this Speed-only fix", () => {
  it("DYNAMIC_WALLETS_HYDRATING (hydration-timing fix) is still present, not reverted", () => {
    expect(dynamicOwnershipSrc).toContain("DYNAMIC_WALLETS_HYDRATING")
    expect(dynamicOwnershipSrc).toContain('failureReason = "DYNAMIC_WALLETS_HYDRATING"')
  })

  it("the Dynamic identity write/repair contract (merchant_id never accepted as dynamic_user_id) is still present", () => {
    expect(dynamicIdentityRepairSrc).toContain("export function decideDynamicUserIdWrite")
    expect(dynamicIdentityRepairSrc).toContain('incoming === merchantId')
    expect(dynamicIdentityRepairSrc).toContain('reason: "incoming_equals_merchant_id"')
  })

  it("the bounded wallet-hydration retry loop in ensureDynamicWalletRuntimeReady is still present", () => {
    const page = read("app/dashboard/wallet-setup/page.tsx")
    expect(page).toContain("MAX_WALLET_HYDRATION_ATTEMPTS")
    expect(page).toContain("for (let attempt = 1; attempt <= MAX_WALLET_HYDRATION_ATTEMPTS; attempt++)")
  })
})

describe("15/16. Speed Bitcoin withdrawals and connected-account routing remain unchanged", () => {
  it("Speed withdrawal request construction has no application_fee/sats-fee concept and is untouched", () => {
    const fnSrc = speedClientSrc.slice(
      speedClientSrc.indexOf("export async function createSpeedWithdrawRequest("),
      speedClientSrc.indexOf("export async function retrieveSpeedPayment(")
    )
    expect(fnSrc).not.toContain("application_fee")
    expect(fnSrc).not.toContain("pineTreeFeeSats")
    expect(fnSrc).toContain('withdraw_method: "onchain"')
  })

  it("connected-account withdrawal management (balances, Instant Send) does not reference the fee-sats contract", () => {
    expect(speedWalletManagementSrc).not.toContain("pineTreeFeeSats")
    expect(speedWalletManagementSrc).not.toContain("application_fee")
  })

  it("the speed-account header routing (merchant connected-account context) is unchanged", () => {
    const fnSrc = speedClientSrc.slice(
      speedClientSrc.indexOf("export async function createSpeedLightningPayment("),
      speedClientSrc.indexOf("export async function createSpeedWithdrawRequest(")
    )
    expect(fnSrc).toContain("connectedAccountId: merchantSpeedAccountId")
    expect(speedClientSrc).toContain('...(providerAccountId ? { "speed-account": providerAccountId } : {})')
  })
})

describe("a permanent payment.retrieve 404 is not retried indefinitely", () => {
  const mocks = vi.hoisted(() => ({
    getPaymentById: vi.fn(),
    updatePaymentMetadata: vi.fn(),
    advancePaymentToTargetStatus: vi.fn(),
    processPaymentEvent: vi.fn(),
    retrieveMerchantSpeedPayment: vi.fn(),
  }))

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.getPaymentById.mockResolvedValue({ id: "pay-404", status: "PROCESSING", metadata: {} })
    mocks.updatePaymentMetadata.mockResolvedValue({ id: "pay-404" })
  })

  it("logs the 404 as stale and flags the payment so it is skipped on the next reconciliation pass, without repeatedly polling Speed", async () => {
    vi.doMock("@/database", () => ({ getPaymentById: mocks.getPaymentById }))
    vi.doMock("@/database/payments", () => ({ updatePaymentMetadata: mocks.updatePaymentMetadata }))
    vi.doMock("@/engine/eventProcessor", () => ({
      advancePaymentToTargetStatus: mocks.advancePaymentToTargetStatus,
      processPaymentEvent: mocks.processPaymentEvent,
    }))
    vi.doMock("@/providers/lightning/speedAdapter", () => ({
      retrieveMerchantSpeedPayment: mocks.retrieveMerchantSpeedPayment,
    }))
    const { SpeedApiError, isSpeedPaymentPaid } = await vi.importActual<typeof import("@/providers/lightning/speedClient")>(
      "@/providers/lightning/speedClient"
    )
    vi.doMock("@/providers/lightning/speedClient", () => ({ SpeedApiError, isSpeedPaymentPaid }))

    mocks.retrieveMerchantSpeedPayment.mockRejectedValue(
      new SpeedApiError("Speed API returned 404", 404, "not_found", [{ field: null, message: "Invalid payment id. Your request cannot be completed." }], null, "req_404")
    )

    const { reconcileSpeedLightningPayment } = await import("@/engine/lightningSpeedReconciliation")

    // First call: hits the 404, flags the payment as stale.
    const firstResult = await reconcileSpeedLightningPayment({
      id: "pay-404", status: "PROCESSING", provider_reference: "speed_pay_stale", merchant_id: "merchant-1",
    } as never)
    expect(firstResult.checked).toBe(true)
    expect(firstResult.detected).toBe(false)
    expect(mocks.updatePaymentMetadata).toHaveBeenCalledWith("pay-404", expect.objectContaining({ speedRetrieveStale: true }))
    expect(mocks.retrieveMerchantSpeedPayment).toHaveBeenCalledTimes(1)

    // Second call: payment now has the stale flag persisted - must skip Speed entirely.
    mocks.getPaymentById.mockResolvedValue({ id: "pay-404", status: "PROCESSING", metadata: { speedRetrieveStale: true, speedRetrieveStaleAt: "2026-07-23T00:00:00.000Z" } })
    const secondResult = await reconcileSpeedLightningPayment({
      id: "pay-404", status: "PROCESSING", provider_reference: "speed_pay_stale", merchant_id: "merchant-1",
    } as never)
    expect(secondResult.checked).toBe(false)
    // Still only ever called once total across both reconciliation attempts.
    expect(mocks.retrieveMerchantSpeedPayment).toHaveBeenCalledTimes(1)

    // The canonical payment record itself was never mutated in status - only
    // the stale-reference flag was recorded, preserving it for support review.
    expect(mocks.advancePaymentToTargetStatus).not.toHaveBeenCalled()
    expect(mocks.processPaymentEvent).not.toHaveBeenCalled()
  })
})
