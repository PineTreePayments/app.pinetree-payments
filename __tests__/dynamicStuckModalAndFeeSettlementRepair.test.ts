import fs from "fs"
import path from "path"
import { beforeEach, describe, expect, it, vi } from "vitest"

function readNormalized(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8").replace(/\r\n/g, "\n")
}

const page = readNormalized("app/dashboard/wallet-setup/page.tsx")
const paymentMaintenanceDb = readNormalized("database/paymentMaintenance.ts")
const paymentMaintenanceEngine = readNormalized("engine/paymentMaintenance.ts")

function sliceBetween(src: string, start: string, end: string) {
  const startIndex = src.indexOf(start)
  return src.slice(startIndex, src.indexOf(end, startIndex))
}

describe("Dynamic in-modal stuck withdrawal repair (EVM/PSBT signing timeout)", () => {
  it("EVM sendTransaction and Bitcoin-PSBT signPsbt are now both bounded by a timeout, matching Solana's existing bound", () => {
    const sendFn = sliceBetween(page, "async function sendDynamicPreparedWithdrawal(", "function base64ToBytes(")
    expect(page).toContain("const DYNAMIC_EVM_SIGN_TIMEOUT_MS = 45_000")
    expect(sendFn).toContain("withTimeout(\n        client.sendTransaction({")
    expect(sendFn).toContain("withTimeout(\n        signPsbtPromise,")
    expect(sendFn).toContain('DYNAMIC_EVM_SIGN_TIMEOUT_MS,\n        DYNAMIC_EVM_SIGN_TIMEOUT_MESSAGE')
  })

  it("a signing-level timeout on any payload kind is classified DYNAMIC_SIGNING_TIMEOUT, never a hard failure", () => {
    const sendFn = sliceBetween(page, "async function sendDynamicPreparedWithdrawal(", "function base64ToBytes(")
    const evmCatch = sendFn.slice(sendFn.indexOf("client.sendTransaction({"), sendFn.indexOf("emitDynamicPostPrepareStage(context, \"dynamic_authorization_confirmed\""))
    expect(evmCatch).toContain('throw makeDynamicPostPrepareError(DYNAMIC_EVM_SIGN_TIMEOUT_MESSAGE, "DYNAMIC_SIGNING_TIMEOUT")')
    const psbtSection = sendFn.slice(sendFn.indexOf("bitcoin_psbt"), sendFn.indexOf("Solana transaction. Resolve"))
    expect(psbtSection).toContain('throw makeDynamicPostPrepareError(DYNAMIC_EVM_SIGN_TIMEOUT_MESSAGE, "DYNAMIC_SIGNING_TIMEOUT")')
  })

  it("handleSubmitWithdrawal treats DYNAMIC_SIGNING_TIMEOUT the same as a post-sign submission timeout - status unknown, no retry-invite, no duplicate-submission dialog", () => {
    const handleSubmit = sliceBetween(page, "async function handleSubmitWithdrawal(context", "\n  // Early returns")
    expect(handleSubmit).toContain('const isAmbiguousSigningTimeout = errorCode === "DYNAMIC_SIGNING_TIMEOUT"')
    expect(handleSubmit).toContain("const isAmbiguousOutcome = isPostSignSubmissionTimeout || isAmbiguousSigningTimeout")
    expect(handleSubmit).toContain("isAmbiguousOutcome\n        ? withdrawalStatusUnknownMessage")
    expect(handleSubmit).toContain("if (!isAmbiguousOutcome && withdrawalReview?.review.approvalMethod")
  })

  it("withTimeout is exported from dynamicSignerLookup and reused by page.tsx rather than re-implemented", () => {
    const lookup = readNormalized("lib/wallets/dynamicSignerLookup.ts")
    expect(lookup).toContain("export async function withTimeout<T>(")
    expect(page).toContain("withTimeout,\n  type DynamicSignerRail,")
  })
})

describe("Withdrawal result card copy (this session's exact required wording)", () => {
  function resultCardSrc() {
    return sliceBetween(page, "function WithdrawalResultCard(", "function WithdrawalFormShell(")
  }

  it("uses 'Withdrawal failed' as the failed-state title and 'Your withdrawal has been completed.' for confirmed", () => {
    const src = resultCardSrc()
    expect(src).toContain("Withdrawal failed")
    expect(src).not.toContain("Withdrawal couldn't be completed")
    expect(src).toContain("Your withdrawal has been completed.")
  })

  it("shows Submitted/Confirmed timestamps when available on the request record", () => {
    const src = resultCardSrc()
    expect(src).toContain(">Submitted<")
    expect(src).toContain(">Confirmed<")
    expect(src).toContain("formatActivityTimestamp(submitResult.request.submitted_at")
    expect(src).toContain("formatActivityTimestamp(submitResult.request.confirmed_at")
  })

  it("the request type carries submitted_at/confirmed_at so timestamps can be threaded through from the DB record", () => {
    expect(page).toContain("submitted_at?: string | null")
    expect(page).toContain("confirmed_at?: string | null")
  })
})

describe("Bitcoin platform-fee settlement reconciliation gap fix", () => {
  it("adds a candidate query for CONFIRMED payments whose fee settlement never resolved past transfer_created/missing", () => {
    expect(paymentMaintenanceDb).toContain("export async function getConfirmedLightningFeeSettlementCandidates(")
    const fn = sliceBetween(
      paymentMaintenanceDb,
      "export async function getConfirmedLightningFeeSettlementCandidates(",
      "export async function"
    )
    expect(fn || paymentMaintenanceDb).toContain('.eq("status", "CONFIRMED")')
    expect(paymentMaintenanceDb).toContain(
      '.in("metadata->split->lightningProviderMetadata->>feeSettlementStatus", ["transfer_created", "missing"])'
    )
  })

  it("wires the new candidate query into the payment maintenance tick without touching the payment's own status", () => {
    expect(paymentMaintenanceEngine).toContain("getConfirmedLightningFeeSettlementCandidates")
    expect(paymentMaintenanceEngine).toContain("reconcileConfirmedLightningFeeSettlement")
    expect(paymentMaintenanceEngine).toContain("feeSettlementCandidates: feeSettlementCandidates.length")
    expect(paymentMaintenanceEngine).toContain("feeSettlementReconciled")
    expect(paymentMaintenanceEngine).toContain("feeSettlementErrors")
  })

  it("the confirmed-payment fee recheck never calls processPaymentEvent/advancePaymentToTargetStatus (status is already terminal)", () => {
    const engineSrc = readNormalized("engine/lightningSpeedReconciliation.ts")
    const fn = sliceBetween(
      engineSrc,
      "export async function reconcileConfirmedLightningFeeSettlement(",
      "export async function reconcileConfirmedLightningFeeSettlement("
    )
    const fnBody = engineSrc.slice(engineSrc.indexOf("export async function reconcileConfirmedLightningFeeSettlement("))
    expect(fnBody).toContain("recordSpeedApplicationFeeSettlement(paymentId, speedPayment.transfers)")
    expect(fnBody).not.toContain("processPaymentEvent(")
    expect(fnBody).not.toContain("advancePaymentToTargetStatus(")
    void fn
  })
})

describe("reconcileConfirmedLightningFeeSettlement (behavioral)", () => {
  const mocks = vi.hoisted(() => ({
    getPaymentById: vi.fn(),
    updatePaymentMetadata: vi.fn(),
    retrieveMerchantSpeedPayment: vi.fn(),
    recordSpeedApplicationFeeSettlement: vi.fn(),
  }))

  vi.mock("@/database", () => ({ getPaymentById: mocks.getPaymentById }))
  vi.mock("@/database/payments", () => ({
    getPaymentById: mocks.getPaymentById,
    updatePaymentMetadata: mocks.updatePaymentMetadata,
  }))
  vi.mock("@/providers/lightning/speedAdapter", () => ({
    retrieveMerchantSpeedPayment: mocks.retrieveMerchantSpeedPayment,
  }))
  vi.mock("@/engine/speedFeeSettlement", () => ({
    recordSpeedApplicationFeeSettlement: mocks.recordSpeedApplicationFeeSettlement,
  }))
  vi.mock("@/engine/eventProcessor", () => ({
    advancePaymentToTargetStatus: vi.fn(),
    processPaymentEvent: vi.fn(),
  }))
  vi.mock("@/providers/lightning/speedClient", async () => {
    const actual = await vi.importActual<typeof import("@/providers/lightning/speedClient")>(
      "@/providers/lightning/speedClient"
    )
    return { isSpeedPaymentPaid: actual.isSpeedPaymentPaid, SpeedApiError: actual.SpeedApiError }
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("re-checks Speed and records settlement for a CONFIRMED payment without advancing its status", async () => {
    const { reconcileConfirmedLightningFeeSettlement } = await import("@/engine/lightningSpeedReconciliation")
    mocks.getPaymentById.mockResolvedValue({
      id: "pay-1",
      metadata: { split: { lightningProviderMetadata: { feeSettlementStatus: "settled" } } },
    })
    mocks.retrieveMerchantSpeedPayment.mockResolvedValue({ transfers: [{ created_type: "APPLICATION_FEE", transfer_id: "tr_1" }] })

    const result = await reconcileConfirmedLightningFeeSettlement({
      id: "pay-1",
      provider_reference: "speed_pay_1",
      merchant_id: "merchant-1",
    } as never)

    expect(result.checked).toBe(true)
    expect(mocks.recordSpeedApplicationFeeSettlement).toHaveBeenCalledWith("pay-1", [
      { created_type: "APPLICATION_FEE", transfer_id: "tr_1" },
    ])
  })

  it("is a no-op when the payment has no provider reference", async () => {
    const { reconcileConfirmedLightningFeeSettlement } = await import("@/engine/lightningSpeedReconciliation")
    const result = await reconcileConfirmedLightningFeeSettlement({
      id: "pay-2",
      provider_reference: null,
      merchant_id: "merchant-1",
    } as never)

    expect(result.checked).toBe(false)
    expect(mocks.retrieveMerchantSpeedPayment).not.toHaveBeenCalled()
  })

  it("skips a payment already flagged with a permanently stale Speed reference", async () => {
    const { reconcileConfirmedLightningFeeSettlement } = await import("@/engine/lightningSpeedReconciliation")
    mocks.getPaymentById.mockResolvedValue({ id: "pay-3", metadata: { speedRetrieveStale: true } })

    const result = await reconcileConfirmedLightningFeeSettlement({
      id: "pay-3",
      provider_reference: "speed_pay_3",
      merchant_id: "merchant-1",
    } as never)

    expect(result.checked).toBe(false)
    expect(mocks.retrieveMerchantSpeedPayment).not.toHaveBeenCalled()
  })
})
