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
const dynamicOwnershipSrc = read("lib/wallets/dynamicWalletOwnership.ts")
const dynamicIdentityRepairSrc = read("lib/wallets/dynamicIdentityRepair.ts")

describe("Regression: restore Bitcoin Lightning payment creation (application_fee removed)", () => {
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

  it("1. Bitcoin Lightning payment creation succeeds without application_fee", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "speed_pay_1", status: "unpaid", payment_request: "lnbc1test",
    }), { status: 200 })))

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

    expect(result.speedPaymentId).toBe("speed_pay_1")

    const fetchMock = vi.mocked(fetch)
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init?.body || "{}"))
    expect(body).not.toHaveProperty("application_fee")
  })

  it("2. a missing/unverified BTC price does not block invoice creation (fee conversion is best-effort, never fatal)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "speed_pay_2", status: "unpaid", payment_request: "lnbc1test2",
    }), { status: 200 })))

    const { createSpeedLightningPayment } = await import("@/providers/lightning/speedClient")
    // No pineTreeFeeSats/btcPriceUsdAtFeeQuote supplied at all - must not throw.
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

    expect(result.speedPaymentId).toBe("speed_pay_2")
    expect(result.platformFeeSats).toBeNull()
  })

  it("3. PineTree's expected $0.15 fee remains recorded internally (metadata), even though it is not sent to Speed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "speed_pay_3", status: "unpaid", payment_request: "lnbc1test3",
    }), { status: 200 })))

    const { createSpeedLightningPayment } = await import("@/providers/lightning/speedClient")
    const result = await createSpeedLightningPayment({
      amount: 10.15,
      currency: "USD",
      merchantAmount: 10,
      pineTreeFeeAmount: 0.15,
      merchantSpeedAccountId: "acct_merchant_1",
      pineTreePaymentId: "pay-fee-test-3",
      merchantId: "merchant-1",
      settlementMode: "speed_connect_split",
    })

    expect(result.metadata).toMatchObject({
      platform_fee_usd: 0.15,
      pineTreeFeeAmount: 0.15,
    })
  })

  it("4. fee settlement is never marked collected/credited without provider evidence - 'credited' does not exist as a status value", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "speed_pay_4", status: "unpaid", payment_request: "lnbc1test4",
    }), { status: 200 })))

    const { createSpeedLightningPayment } = await import("@/providers/lightning/speedClient")
    const result = await createSpeedLightningPayment({
      amount: 10.15,
      currency: "USD",
      merchantAmount: 10,
      pineTreeFeeAmount: 0.15,
      merchantSpeedAccountId: "acct_merchant_1",
      pineTreePaymentId: "pay-fee-test-4",
      merchantId: "merchant-1",
      settlementMode: "speed_connect_split",
    })

    expect(result.feeSettlementStatus).toBe("not_collected")
    expect(result.feeSettlementStatus).not.toBe("credited")
    expect(speedClientSrc).toContain(
      'export type SpeedFeeSettlementStatus = "not_collected" | "retained_pending_sweep" | "not_applicable"'
    )
    expect(speedClientSrc).not.toMatch(/SpeedFeeSettlementStatus\s*=[^\n]*"credited"/)
  })

  it("5. Speed POST /payments does not receive the previously-attempted sats-denominated fee, even if a caller still supplies pineTreeFeeSats", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "speed_pay_5", status: "unpaid", payment_request: "lnbc1test5",
    }), { status: 200 })))

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
    expect(body).not.toHaveProperty("application_fee")
    // The sats value is still recorded internally (metadata) for future
    // reconciliation once Speed's contract is confirmed - just never sent.
    expect(body.metadata).toMatchObject({ platform_fee_sats: 225 })
  })

  it("6. a Speed POST /payments 400 is logged with full safe diagnostics (status, provider code/message, request id, request shape)", async () => {
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
      applicationFeePresent: false,
      invoiceCurrency: "USD",
      targetCurrency: "SATS",
      merchantSpeedAccountSuffix: "acct_merchant_1".slice(-6),
    })
    expect(details.providerMessage).toBe("amount is too small")

    errorSpy.mockRestore()
  })

  it("6b. never logs the full merchant Speed account id or API key in the failure diagnostic", async () => {
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
})

describe("USD-to-sats conversion (retained for internal bookkeeping only)", () => {
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

  it("a well-formed record round-trips its values for later reconciliation", () => {
    const wellFormed = extractBitcoinFeeSettlementInfo({
      split: {
        lightningProviderMetadata: {
          pineTreeFeeAmount: 0.15,
          platformFeeSats: 225,
          feeConversionRateUsd: 66_666.6667,
          feeSettlementStatus: "not_collected",
          speedPaymentId: "speed_pay_1",
        }
      }
    })
    expect(wellFormed).toMatchObject({ feeUsd: 0.15, feeSats: 225, feeSettlementStatus: "not_collected", providerReferencePresent: true })
  })

  it("request-time and confirmation-time diagnostics both surface a reconciliationState field", () => {
    expect(speedAdapterSrc).toContain("reconciliationState: speedPayment.feeSettlementStatus")
    expect(reconciliationSrc).toContain("reconciliationState: feeInfo.feeSettlementStatus")
  })
})

describe("Fee-request idempotency", () => {
  it("application_fee (if ever reintroduced) would only be requested once, at invoice creation - webhook/reconciliation never call createSpeedLightningPayment", () => {
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

describe("7. Dynamic Base/Solana identity fixes remain unchanged by this urgent Bitcoin-only fix", () => {
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

describe("8/9. Speed Bitcoin withdrawals and connected-account routing remain unchanged", () => {
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

describe("10. a permanent payment.retrieve 404 is not retried indefinitely", () => {
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
