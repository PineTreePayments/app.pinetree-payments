import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regression coverage for the live incident: payment
 * 6fd3c713-6f3a-4e5d-bbff-b83e157af1fb / tx
 * 0x670fb79d50e4777bef5ee0f59a925ce123e3f7e5c90d4e3793e9f95c45624428.
 *
 * The wallet successfully broadcast a real, valid transaction and the
 * browser called POST /api/payments/[paymentId]/detect with its hash — but a
 * merchant cancel raced ahead of it and flipped the payment to INCOMPLETE a
 * moment earlier. engine/paymentDetect.ts's runPaymentDetectForPayment used
 * to check the terminal-status guard FIRST and return early before ever
 * persisting the hash, so evidence of a real, already-broadcast transaction
 * was silently dropped forever — nothing in transactions.provider_transaction_id,
 * no payment.processing event, no way for self-heal reconciliation to ever
 * find it again.
 *
 * The fix reorders this: the hash is persisted (idempotently, guarded by
 * !transaction.provider_transaction_id) BEFORE the terminal-status check, so
 * even a payment that has already raced to INCOMPLETE/CONFIRMED/FAILED keeps
 * a durable record of the wallet-returned hash.
 */

const mocks = vi.hoisted(() => ({
  getPaymentById: vi.fn(),
  getTransactionByPaymentId: vi.fn(),
  updateTransactionProviderReference: vi.fn(),
  processPaymentEvent: vi.fn(),
  ensurePaymentFresh: vi.fn(),
}))

vi.mock("@/database", () => ({ getPaymentById: mocks.getPaymentById }))
vi.mock("@/database/transactions", () => ({
  getTransactionByPaymentId: mocks.getTransactionByPaymentId,
  updateTransactionProviderReference: mocks.updateTransactionProviderReference,
}))
vi.mock("@/engine/eventProcessor", () => ({ processPaymentEvent: mocks.processPaymentEvent }))
vi.mock("@/engine/paymentMaintenance", () => ({ ensurePaymentFresh: mocks.ensurePaymentFresh }))

const REAL_PAYMENT_ID = "6fd3c713-6f3a-4e5d-bbff-b83e157af1fb"
const REAL_TX_HASH = "0x670fb79d50e4777bef5ee0f59a925ce123e3f7e5c90d4e3793e9f95c45624428"

function basePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: REAL_PAYMENT_ID,
    status: "PENDING",
    network: "base",
    metadata: { split: { feeCaptureMethod: "contract_split", asset: "ETH" } },
    ...overrides,
  } as never
}

function baseUsdcPayment(overrides: Record<string, unknown> = {}) {
  return basePayment({
    metadata: {
      paymentIntentId: "intent-1",
      split: {
        feeCaptureMethod: "contract_split",
        asset: "USDC",
        splitContract: "0x96484a59b0Aa16E4F95F0899B592F76a6A192c29",
        merchantWallet: "0x50c619680b56382489429e8d382D520cfca95599",
        pinetreeWallet: "0xDfB2EB3FccB76B8C7f7e352d5421654add5a7903",
        expectedAmountNative: 0.26,
        merchantNativeAmountAtomic: "110000",
        feeNativeAmountAtomic: "150000"
      }
    },
    ...overrides,
  })
}

describe("runPaymentDetectForPayment — tx hash persistence ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ensurePaymentFresh.mockResolvedValue({ detected: false })
    global.fetch = vi.fn(async () => ({
      json: async () => ({ result: null })
    })) as unknown as typeof fetch
  })

  it("persists the tx hash for a normal in-flight (PENDING) payment before running the watcher", async () => {
    mocks.getPaymentById.mockResolvedValue(basePayment())
    mocks.getTransactionByPaymentId.mockResolvedValue({ id: "txn-1", provider_transaction_id: null })

    const { runPaymentDetectForPayment } = await import("@/engine/paymentDetect")
    await runPaymentDetectForPayment(REAL_PAYMENT_ID, { txHash: REAL_TX_HASH })

    expect(mocks.updateTransactionProviderReference).toHaveBeenCalledWith("txn-1", REAL_TX_HASH)
  })

  it("REGRESSION: still persists the tx hash even when a cancel race already flipped the payment to INCOMPLETE", async () => {
    // This is the exact race from the incident: by the time /detect's
    // request reaches the server, POST /api/payment-intents/.../cancel has
    // already committed INCOMPLETE for this payment.
    mocks.getPaymentById.mockResolvedValue(basePayment({ status: "INCOMPLETE" }))
    mocks.getTransactionByPaymentId.mockResolvedValue({ id: "txn-1", provider_transaction_id: null })

    const { runPaymentDetectForPayment } = await import("@/engine/paymentDetect")
    const result = await runPaymentDetectForPayment(REAL_PAYMENT_ID, { txHash: REAL_TX_HASH })

    // The hash must be durably recorded even though this call reports
    // "skipped" — self-heal reconciliation can use it later. It must NOT be
    // silently lost, which is what happened in production.
    expect(mocks.updateTransactionProviderReference).toHaveBeenCalledWith("txn-1", REAL_TX_HASH)
    expect(result.body).toMatchObject({ detected: false, skipped: true, status: "INCOMPLETE" })
    // A terminal payment must never be advanced through the ordinary
    // detect path — that would bypass the guarded reconciliation bypass.
    expect(mocks.ensurePaymentFresh).not.toHaveBeenCalled()
  })

  it("does not overwrite an already-stored tx hash (idempotent — one-time write)", async () => {
    mocks.getPaymentById.mockResolvedValue(basePayment({ status: "INCOMPLETE" }))
    mocks.getTransactionByPaymentId.mockResolvedValue({
      id: "txn-1",
      provider_transaction_id: "0xalreadystored",
    })

    const { runPaymentDetectForPayment } = await import("@/engine/paymentDetect")
    await runPaymentDetectForPayment(REAL_PAYMENT_ID, { txHash: REAL_TX_HASH })

    expect(mocks.updateTransactionProviderReference).not.toHaveBeenCalled()
  })

  it("rejects a malformed (non-EVM-shaped) tx hash for a Base payment before attempting persistence", async () => {
    mocks.getPaymentById.mockResolvedValue(basePayment())

    const { runPaymentDetectForPayment } = await import("@/engine/paymentDetect")
    const result = await runPaymentDetectForPayment(REAL_PAYMENT_ID, { txHash: "not-a-hash" })

    expect(result.httpStatus).toBe(400)
    expect(mocks.updateTransactionProviderReference).not.toHaveBeenCalled()
  })

  it("still runs the watcher normally for a live PENDING/PROCESSING payment after persisting the hash", async () => {
    mocks.getPaymentById.mockResolvedValue(basePayment({ status: "PROCESSING" }))
    mocks.getTransactionByPaymentId.mockResolvedValue({ id: "txn-1", provider_transaction_id: null })
    mocks.ensurePaymentFresh.mockResolvedValue({ detected: true })

    const { runPaymentDetectForPayment } = await import("@/engine/paymentDetect")
    const result = await runPaymentDetectForPayment(REAL_PAYMENT_ID, { txHash: REAL_TX_HASH })

    expect(mocks.updateTransactionProviderReference).toHaveBeenCalledWith("txn-1", REAL_TX_HASH)
    expect(mocks.ensurePaymentFresh).toHaveBeenCalledWith(
      REAL_PAYMENT_ID,
      expect.objectContaining({ txHash: REAL_TX_HASH, forceWatcher: true })
    )
    expect(result.body.detected).toBe(true)
  })

  it("REGRESSION: a Base USDC allowance approval hash is not stored as the canonical payment transaction", async () => {
    const approvalHash = "0x" + "b".repeat(64)
    mocks.getPaymentById.mockResolvedValue(baseUsdcPayment({ status: "PROCESSING" }))
    mocks.getTransactionByPaymentId.mockResolvedValue({ id: "txn-1", provider_transaction_id: null })
    global.fetch = vi.fn(async () => ({
      json: async () => ({
        result: {
          to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          from: "0xb54205bb0076a314d55dd77a1ea957a15b3d77a5",
          input: "0x095ea7b3" + "0".repeat(64)
        }
      })
    })) as unknown as typeof fetch

    const { runPaymentDetectForPayment } = await import("@/engine/paymentDetect")
    const result = await runPaymentDetectForPayment(REAL_PAYMENT_ID, { txHash: approvalHash })

    expect(result.body).toMatchObject({
      detected: true,
      status: "PROCESSING",
      kind: "wrong_transaction_type",
      reason: "allowance_approval_hash"
    })
    expect(mocks.updateTransactionProviderReference).not.toHaveBeenCalled()
    expect(mocks.processPaymentEvent).not.toHaveBeenCalled()
    expect(mocks.ensurePaymentFresh).not.toHaveBeenCalled()
  })
})
