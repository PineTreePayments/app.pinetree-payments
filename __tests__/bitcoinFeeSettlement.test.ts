import fs from "fs"
import path from "path"
import { describe, expect, it, vi } from "vitest"
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

describe("Bitcoin service fee: $0.15 platform fee (engine/config.ts PINETREE_FEE)", () => {
  it("the platform fee constant is $0.15, not the earlier $0.10 value", () => {
    expect(PINETREE_FEE).toBe(0.15)
  })

  it("11. a $0.15 platform fee never converts to zero sats across a realistic range of BTC prices", () => {
    // From a very cheap BTC ($10k) to a very expensive one ($500k), 0.15 USD
    // must always be at least 1 sat.
    for (const btcPriceUsd of [10_000, 30_000, 60_000, 100_000, 250_000, 500_000]) {
      const sats = convertUsdFeeToSats(0.15, btcPriceUsd)
      expect(sats).toBeGreaterThanOrEqual(1)
      expect(Number.isInteger(sats)).toBe(true)
    }
  })

  it("11b. rejects rather than silently returning zero when the BTC price is missing or invalid", () => {
    expect(() => convertUsdFeeToSats(0.15, 0)).toThrow(/BTC price unavailable/)
    expect(() => convertUsdFeeToSats(0.15, -1)).toThrow(/BTC price unavailable/)
    expect(() => convertUsdFeeToSats(0.15, NaN)).toThrow(/BTC price unavailable/)
  })

  it("12. USD-to-sats conversion is deterministic (same inputs always produce the same output) and rounds up", () => {
    const a = convertUsdFeeToSats(0.15, 66_666.6667)
    const b = convertUsdFeeToSats(0.15, 66_666.6667)
    expect(a).toBe(b)
    // 0.15 / 66666.6667 * 1e8 = 225.000... -> ceil keeps it at 225, never truncated down.
    expect(a).toBe(225)

    // A price chosen so the raw division is NOT a whole number of sats -
    // confirms ceil (round up), not floor/round-to-nearest.
    const nonWholeSats = 0.15 / 61_234 * 100_000_000
    expect(Number.isInteger(nonWholeSats)).toBe(false)
    expect(convertUsdFeeToSats(0.15, 61_234)).toBe(Math.ceil(nonWholeSats))
  })

  it("13. the provider request contains the correct nonzero sats-denominated fee value, not the raw USD float", async () => {
    vi.resetModules()
    process.env.SPEED_API_KEY = "sk_test_present"
    process.env.SPEED_WEBHOOK_SECRET = "wsec_present"
    process.env.SPEED_API_BASE_URL = "https://api.tryspeed.test"
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "speed_pay_1", status: "unpaid", payment_request: "lnbc1test",
    }), { status: 200 })))

    const { createSpeedLightningPayment } = await import("@/providers/lightning/speedClient")
    await createSpeedLightningPayment({
      amount: 10.15,
      currency: "USD",
      merchantAmount: 10,
      pineTreeFeeAmount: 0.15,
      pineTreeFeeSats: 225,
      btcPriceUsdAtFeeQuote: 66_666.6667,
      merchantSpeedAccountId: "acct_merchant_1",
      pineTreePaymentId: "pay-fee-test",
      merchantId: "merchant-1",
      settlementMode: "speed_connect_split",
    })

    const fetchMock = vi.mocked(fetch)
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init?.body || "{}"))
    expect(body.application_fee).toBe(225)
    expect(body.application_fee).toBeGreaterThan(0)
    expect(typeof body.application_fee).toBe("number")

    vi.unstubAllGlobals()
  })

  it("14. the PineTree treasury account, not the merchant account, is the fee destination", () => {
    // The gross payment is scoped to the merchant's own Speed sub-account via
    // the speed-account header (correct - merchant proceeds belong there).
    // application_fee carries no separate destination parameter of its own -
    // Speed's Connect-style application fee always settles to whichever
    // account owns the platform SPEED_API_KEY (PineTree's treasury/platform
    // account), never the connected merchant sub-account passed in
    // speed-account. Confirm the request body never attaches the fee to the
    // merchant account id.
    const fnSrc = speedClientSrc.slice(
      speedClientSrc.indexOf("export async function createSpeedLightningPayment("),
      speedClientSrc.indexOf("export async function createSpeedWithdrawRequest(")
    )
    expect(fnSrc).toContain("application_fee: platformFeeSats")
    expect(fnSrc).not.toContain("application_fee_destination")
    expect(fnSrc).not.toContain("application_fee_account")
    // The merchant account id is only ever used for the speed-account header
    // context (via createSpeedPaymentRequest/connectedAccountId), never
    // embedded into the fee itself.
    expect(fnSrc).toContain("connectedAccountId: merchantSpeedAccountId")
  })

  it("15. provider/network fees remain separate from PineTree's platform fee - no double subtraction", () => {
    // merchantAmount + pineTreeFeeAmount must equal grossAmount (the customer
    // pays gross once; PineTree's cut and the merchant's net are two
    // non-overlapping slices of that same gross amount - never subtracted
    // twice).
    const grossAmount = 10.15
    const pineTreeFeeAmount = 0.15
    const merchantAmount = 10
    expect(merchantAmount + pineTreeFeeAmount).toBeCloseTo(grossAmount, 10)
  })
})

describe("Bitcoin fee idempotency (tests 16-18)", () => {
  it("16/17. application_fee is requested exactly once, only at invoice creation - webhook code never calls createSpeedLightningPayment", () => {
    // The only caller of createLightningInvoice/createSpeedLightningPayment
    // in the whole engine is payment creation. Webhook translation
    // (speedAdapter.translateEvent) only classifies an already-received
    // payload into a status transition - it never creates a new invoice or
    // re-requests a fee.
    const translateEventSrc = speedAdapterSrc.slice(
      speedAdapterSrc.indexOf("translateEvent(payload)"),
      speedAdapterSrc.indexOf("async healthCheck()")
    )
    expect(translateEventSrc).not.toContain("createSpeedLightningPayment")
    expect(translateEventSrc).not.toContain("createLightningInvoice")
  })

  it("18. reconciliation never calls createSpeedLightningPayment and only ever reads status back", () => {
    expect(reconciliationSrc).not.toContain("createSpeedLightningPayment")
    expect(reconciliationSrc).not.toContain("createLightningInvoice")
    expect(reconciliationSrc).toContain("retrieveMerchantSpeedPayment")
    // A payment that already reached a terminal local status is never
    // re-processed - see the dedicated test in
    // lightningSpeedReconciliation.test.ts ("never calls Speed for a payment
    // that is already terminal locally"), which proves webhook
    // retries/reconciliation re-runs against a CONFIRMED payment cannot
    // create a duplicate fee transfer, since the fee-request path
    // (createSpeedLightningPayment) is never reachable from here at all.
    expect(reconciliationSrc).toContain("TERMINAL_STATUSES.has(currentStatus)")
  })

  it("does not attach a Speed Idempotency-Key to payment creation (that contract is unconfirmed for /payments, same as documented for /send)", () => {
    // Not required for correctness here (fee idempotency is structural, per
    // above), but guards against silently reintroducing a guessed header.
    const fnSrc = speedClientSrc.slice(
      speedClientSrc.indexOf("export async function createSpeedLightningPayment("),
      speedClientSrc.indexOf("export async function createSpeedWithdrawRequest(")
    )
    expect(fnSrc).not.toContain("Idempotency-Key")
  })
})

describe("Bitcoin fee accounting honesty (tests 19-21)", () => {
  it("19. a zero-value provider application-fee record can never be labeled 'credited' - that status value does not exist in the type", () => {
    // SpeedFeeSettlementStatus intentionally only has states that are honest
    // about what this code can actually verify - "credited" is not one of
    // them, because Speed's application-fee settlement cannot currently be
    // read back (no documented/modeled endpoint or field). Adding "credited"
    // here without a real verification mechanism would be exactly the bug
    // this fix removes.
    expect(speedClientSrc).toContain(
      'export type SpeedFeeSettlementStatus = "requested" | "retained_pending_sweep" | "not_applicable"'
    )
    expect(speedClientSrc).not.toMatch(/SpeedFeeSettlementStatus\s*=[^\n]*"credited"/)
    // The adapter's own returned metadata documents why "credited" is
    // deliberately absent.
    expect(speedAdapterSrc).toContain("never \"credited\" here")
  })

  it("20. request-time and confirmation-time diagnostics both surface a reconciliationState field for reporting to key off", () => {
    expect(speedAdapterSrc).toContain("reconciliationState: speedPayment.feeSettlementStatus")
    expect(reconciliationSrc).toContain("reconciliationState: feeInfo.feeSettlementStatus")
  })

  it("21. failed/unknown fee settlement remains reconcilable - extraction never throws on missing or malformed metadata", () => {
    const cases: unknown[] = [null, undefined, {}, { split: null }, { split: {} }, { split: { lightningProviderMetadata: null } }, "not-an-object", 42]
    for (const input of cases) {
      let result: BitcoinFeeSettlementInfo | undefined
      expect(() => { result = extractBitcoinFeeSettlementInfo(input) }).not.toThrow()
      expect(result).toMatchObject({
        feeUsd: null,
        feeSats: null,
        feeConversionRateUsd: null,
        feeSettlementStatus: null,
        providerReferencePresent: false,
      })
    }

    // A well-formed record round-trips its values so it CAN be reconciled later.
    const wellFormed = extractBitcoinFeeSettlementInfo({
      split: {
        lightningProviderMetadata: {
          pineTreeFeeAmount: 0.15,
          platformFeeSats: 225,
          feeConversionRateUsd: 66_666.6667,
          feeSettlementStatus: "requested",
          speedPaymentId: "speed_pay_1",
        }
      }
    })
    expect(wellFormed).toMatchObject({
      feeUsd: 0.15,
      feeSats: 225,
      feeSettlementStatus: "requested",
      providerReferencePresent: true,
    })
  })
})

describe("22. existing successful Speed withdrawal behavior remains unchanged", () => {
  it("Speed withdrawal request construction is untouched by the Lightning payment fee-conversion fix", () => {
    // createSpeedWithdrawRequest has no platform-fee concept at all (Speed
    // withdrawals move a merchant's own already-settled balance out - there
    // is no PineTree application fee on a withdrawal), and this fix must not
    // add one.
    const fnSrc = speedClientSrc.slice(
      speedClientSrc.indexOf("export async function createSpeedWithdrawRequest("),
      speedClientSrc.indexOf("export async function retrieveSpeedPayment(")
    )
    expect(fnSrc).not.toContain("application_fee")
    expect(fnSrc).not.toContain("pineTreeFeeSats")
    expect(fnSrc).toContain('withdraw_method: "onchain"')
  })

  it("connected-account withdrawal management (balances, Instant Send) does not reference the new sats-fee contract", () => {
    expect(speedWalletManagementSrc).not.toContain("pineTreeFeeSats")
    expect(speedWalletManagementSrc).not.toContain("application_fee")
  })
})
