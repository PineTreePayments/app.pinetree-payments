import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regression coverage for the production incident: Alchemy's Base
 * ADDRESS_ACTIVITY webhook delivered the exact txHash for a successful,
 * on-chain contract_split transaction (payment c62cdfd3-892c-44ab-b552-
 * c191bede9f88, tx 0x2cc06db2230c53216dd0c3a29d15f53db7453c5d10f05fd20b72d0
 * 5e22c33d2a), but engine/alchemyWebhookProcessor.ts correctly refused to
 * confirm by address-only matching (contract_split requires an on-chain
 * paymentRef match) and then *discarded* the txHash entirely instead of
 * handing it to the existing authoritative verification pipeline. Status
 * polling then invoked the watcher with no stored hash, causing
 * eth_getLogs/eth_blockNumber 429s and leaving the payment stuck.
 *
 * The fix does not change the security rule (contract_split still cannot be
 * confirmed by address alone) — it changes what happens to the txHash once
 * that rule correctly declines to confirm directly: it's persisted and
 * routed through runPaymentDetectForPayment (the exact same engine function
 * the customer-facing POST /detect route uses), which does the real
 * eth_getTransactionReceipt + PaymentSplit decode + paymentRef + amount
 * verification before ever touching payment status.
 */

const mocks = vi.hoisted(() => ({
  getActivePaymentsByNetwork: vi.fn(),
  processPaymentEvent: vi.fn(),
  runPaymentDetectForPayment: vi.fn(),
}))

vi.mock("@/database/payments", () => ({
  getActivePaymentsByNetwork: mocks.getActivePaymentsByNetwork,
}))
vi.mock("@/engine/eventProcessor", () => ({
  processPaymentEvent: mocks.processPaymentEvent,
}))
vi.mock("@/engine/paymentDetect", () => ({
  runPaymentDetectForPayment: mocks.runPaymentDetectForPayment,
}))

import { processAlchemyWebhook } from "@/engine/alchemyWebhookProcessor"

const MERCHANT_WALLET = "0x50c619680b56382489429e8d382D520cfca95599"
const PINETREE_WALLET = "0xDfB2EB3FccB76B8C7f7e352d5421654add5a7903"
const REAL_TX_HASH = "0x2cc06db2230c53216dd0c3a29d15f53db7453c5d10f05fd20b72d05e22c33d2a"
const PAYMENT_ID = "c62cdfd3-892c-44ab-b552-c191bede9f88"

function contractSplitPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYMENT_ID,
    status: "PENDING",
    network: "base",
    metadata: {
      split: {
        merchantWallet: MERCHANT_WALLET,
        pinetreeWallet: PINETREE_WALLET,
        feeCaptureMethod: "contract_split",
        splitContract: "0x96484a59b0Aa16E4F95F0899B592F76a6A192c29",
      },
    },
    ...overrides,
  } as never
}

function directPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: "direct-payment-1",
    status: "PENDING",
    network: "base",
    metadata: {
      split: {
        merchantWallet: MERCHANT_WALLET,
        pinetreeWallet: PINETREE_WALLET,
        feeCaptureMethod: "direct",
      },
    },
    ...overrides,
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("processAlchemyWebhook — contract_split never confirms by address alone", () => {
  it("never calls processPaymentEvent directly for a contract_split candidate", async () => {
    mocks.getActivePaymentsByNetwork.mockResolvedValue([contractSplitPayment()])
    mocks.runPaymentDetectForPayment.mockResolvedValue({
      httpStatus: 200,
      body: { detected: true, status: "CONFIRMED" },
    })

    await processAlchemyWebhook({
      network: "base",
      activities: [{ toAddress: MERCHANT_WALLET, hash: REAL_TX_HASH, value: "223586216442104" }],
    })

    expect(mocks.processPaymentEvent).not.toHaveBeenCalled()
  })

  it("routes the webhook txHash through the existing authoritative detect pipeline instead", async () => {
    mocks.getActivePaymentsByNetwork.mockResolvedValue([contractSplitPayment()])
    mocks.runPaymentDetectForPayment.mockResolvedValue({
      httpStatus: 200,
      body: { detected: true, status: "CONFIRMED" },
    })

    await processAlchemyWebhook({
      network: "base",
      activities: [{ toAddress: MERCHANT_WALLET, hash: REAL_TX_HASH }],
    })

    expect(mocks.runPaymentDetectForPayment).toHaveBeenCalledTimes(1)
    expect(mocks.runPaymentDetectForPayment).toHaveBeenCalledWith(PAYMENT_ID, { txHash: REAL_TX_HASH })
  })

  it("matches on the treasury (pinetreeWallet) address too, not just the merchant wallet", async () => {
    mocks.getActivePaymentsByNetwork.mockResolvedValue([contractSplitPayment()])
    mocks.runPaymentDetectForPayment.mockResolvedValue({
      httpStatus: 200,
      body: { detected: true, status: "CONFIRMED" },
    })

    await processAlchemyWebhook({
      network: "base",
      activities: [{ toAddress: PINETREE_WALLET, hash: REAL_TX_HASH }],
    })

    expect(mocks.runPaymentDetectForPayment).toHaveBeenCalledWith(PAYMENT_ID, { txHash: REAL_TX_HASH })
  })

  it("does nothing when the activity carries no usable transaction hash", async () => {
    mocks.getActivePaymentsByNetwork.mockResolvedValue([contractSplitPayment()])

    await processAlchemyWebhook({
      network: "base",
      activities: [{ toAddress: MERCHANT_WALLET, hash: null }],
    })

    expect(mocks.runPaymentDetectForPayment).not.toHaveBeenCalled()
    expect(mocks.processPaymentEvent).not.toHaveBeenCalled()
  })

  it("does nothing when the activity's hash is not a well-formed EVM transaction hash", async () => {
    mocks.getActivePaymentsByNetwork.mockResolvedValue([contractSplitPayment()])

    await processAlchemyWebhook({
      network: "base",
      activities: [{ toAddress: MERCHANT_WALLET, hash: "not-a-real-hash" }],
    })

    expect(mocks.runPaymentDetectForPayment).not.toHaveBeenCalled()
  })

  it("a second, duplicate webhook delivery for an already-confirmed payment is a no-op (idempotent) — the payment is no longer in the active candidate set", async () => {
    // getActivePaymentsByNetwork only returns CREATED/PENDING/PROCESSING
    // payments; once CONFIRMED, a duplicate webhook simply finds no
    // candidate at all.
    mocks.getActivePaymentsByNetwork.mockResolvedValue([])

    await processAlchemyWebhook({
      network: "base",
      activities: [{ toAddress: MERCHANT_WALLET, hash: REAL_TX_HASH }],
    })

    expect(mocks.runPaymentDetectForPayment).not.toHaveBeenCalled()
  })
})

describe("processAlchemyWebhook — direct (non-contract_split) payments are unaffected", () => {
  it("still confirms a direct payment by address match, unchanged from before", async () => {
    mocks.getActivePaymentsByNetwork.mockResolvedValue([directPayment()])

    await processAlchemyWebhook({
      network: "base",
      activities: [{ toAddress: MERCHANT_WALLET, hash: "0xdirecttxhash", value: "100000000000000000", fromAddress: "0xpayer" }],
    })

    expect(mocks.processPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "payment.confirmed", paymentId: "direct-payment-1" })
    )
    expect(mocks.runPaymentDetectForPayment).not.toHaveBeenCalled()
  })
})

describe("processAlchemyWebhook — candidate matching safety", () => {
  it("refuses to guess and does not persist/verify when the wallet address maps to more than one active contract_split payment", async () => {
    mocks.getActivePaymentsByNetwork.mockResolvedValue([
      contractSplitPayment({ id: "payment-a" }),
      contractSplitPayment({ id: "payment-b" }),
    ])

    await processAlchemyWebhook({
      network: "base",
      activities: [{ toAddress: MERCHANT_WALLET, hash: REAL_TX_HASH }],
    })

    expect(mocks.runPaymentDetectForPayment).not.toHaveBeenCalled()
    expect(mocks.processPaymentEvent).not.toHaveBeenCalled()
  })

  it("proceeds normally once only one candidate remains for that address", async () => {
    mocks.getActivePaymentsByNetwork.mockResolvedValue([contractSplitPayment()])
    mocks.runPaymentDetectForPayment.mockResolvedValue({
      httpStatus: 200,
      body: { detected: true, status: "CONFIRMED" },
    })

    await processAlchemyWebhook({
      network: "base",
      activities: [{ toAddress: MERCHANT_WALLET, hash: REAL_TX_HASH }],
    })

    expect(mocks.runPaymentDetectForPayment).toHaveBeenCalledWith(PAYMENT_ID, { txHash: REAL_TX_HASH })
  })

  it("a different, unrelated wallet address with no active candidates is ignored", async () => {
    mocks.getActivePaymentsByNetwork.mockResolvedValue([contractSplitPayment()])

    await processAlchemyWebhook({
      network: "base",
      activities: [{ toAddress: "0x" + "9".repeat(40), hash: REAL_TX_HASH }],
    })

    expect(mocks.runPaymentDetectForPayment).not.toHaveBeenCalled()
  })
})
