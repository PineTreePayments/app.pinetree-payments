import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regression coverage for the "STOP RPC FLOODING" requirement.
 *
 * Once the Base webhook (engine/alchemyWebhookProcessor.ts) has routed a
 * txHash through runPaymentDetectForPayment and it has been persisted as
 * transactions.provider_transaction_id, every subsequent watcher check for
 * that payment — including routine status polling that calls
 * runPaymentWatcher(paymentId) with no explicit txHash — must use the stored
 * hash's eth_getTransactionReceipt fast-path. It must never fall back to the
 * broad eth_getLogs scan (or eth_blockNumber-driven log scanning) while a
 * valid stored hash exists; that fallback is what produced the 429s in the
 * production incident.
 *
 * This exercises engine/checkPaymentOnce.ts's runPaymentWatcher with the
 * real (unmocked) engine/paymentWatcher.ts against a fake JSON-RPC fetch, so
 * a regression that reintroduces the eth_getLogs fallback for a payment with
 * a stored hash fails this test immediately.
 */

const mocks = vi.hoisted(() => ({
  getPaymentById: vi.fn(),
  getTransactionByPaymentId: vi.fn(),
  markPaymentIncompleteIfAbandoned: vi.fn(),
  processPaymentEvent: vi.fn(),
}))

vi.mock("@/database", () => ({ getPaymentById: mocks.getPaymentById }))
vi.mock("@/database/transactions", () => ({
  getTransactionByPaymentId: mocks.getTransactionByPaymentId,
}))
vi.mock("@/engine/paymentStateActions", () => ({
  markPaymentIncompleteIfAbandoned: mocks.markPaymentIncompleteIfAbandoned,
}))
vi.mock("@/database/merchantProviders", () => ({ SPEED_PROVIDER_NAME: "lightning_speed" }))
// watchPaymentOnce hands a match off to the real eventProcessor, which needs
// a much larger @/database surface (updatePaymentStatus, etc.) than this
// suite otherwise mocks. Only fetch/RPC behavior is under test here, not
// event-processor persistence (already covered elsewhere) — mock it out.
vi.mock("@/engine/eventProcessor", () => ({ processPaymentEvent: mocks.processPaymentEvent }))

import { AbiCoder, id as ethersId, ZeroAddress } from "ethers"

const PAYMENT_SPLIT_TOPIC = ethersId(
  "PaymentSplit(address,address,uint256,uint256,string,address,address)"
)
const SPLIT_CONTRACT = "0x96484a59b0Aa16E4F95F0899B592F76a6A192c29"
const MERCHANT_WALLET = "0x50c619680b56382489429e8d382D520cfca95599"
const PINETREE_WALLET = "0xDfB2EB3FccB76B8C7f7e352d5421654add5a7903"
const PAYMENT_ID = "c62cdfd3-892c-44ab-b552-c191bede9f88"
const TX_HASH = "0x2cc06db2230c53216dd0c3a29d15f53db7453c5d10f05fd20b72d05e22c33d2a"

function payment() {
  return {
    id: PAYMENT_ID,
    status: "PENDING",
    provider: "base",
    network: "base",
    merchant_amount: 0.27,
    pinetree_fee: 0.15,
    metadata: {
      split: {
        merchantWallet: MERCHANT_WALLET,
        pinetreeWallet: PINETREE_WALLET,
        feeCaptureMethod: "contract_split",
        splitContract: SPLIT_CONTRACT,
        asset: "ETH",
        merchantNativeAmountAtomic: "143733996284210",
        feeNativeAmountAtomic: "79852220157894",
      },
    },
  } as never
}

function topicFromAddress(address: string): string {
  return "0x" + "0".repeat(24) + address.slice(2).toLowerCase()
}

function jsonRpcResponder(handlers: Record<string, (body: { params?: unknown[] }) => unknown>) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { method: string; params?: unknown[] }
    const handler = handlers[body.method]
    if (!handler) {
      throw new Error(`Unexpected RPC method called: ${body.method}`)
    }
    return { json: async () => ({ jsonrpc: "2.0", id: 1, result: handler(body) }) } as Response
  })
}

describe("runPaymentWatcher — no eth_getLogs once a hash is persisted (webhook-supplied evidence)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("uses eth_getTransactionReceipt(txHash), never eth_getLogs, when the caller passes the webhook's txHash directly", async () => {
    mocks.getPaymentById.mockResolvedValue(payment())

    const matchingLog = {
      address: SPLIT_CONTRACT.toLowerCase(),
      topics: [PAYMENT_SPLIT_TOPIC, "0x", "0x", topicFromAddress("0xB5429a1035E7C5B7fD8f8B7e1A2C3d4E5f677A5")],
      data: AbiCoder.defaultAbiCoder().encode(
        ["uint256", "uint256", "string", "address"],
        [BigInt("143733996284210"), BigInt("79852220157894"), PAYMENT_ID, ZeroAddress]
      ),
      transactionHash: TX_HASH,
    }

    const getLogsSpy = vi.fn()
    global.fetch = jsonRpcResponder({
      eth_getTransactionReceipt: () => ({ status: "0x1", logs: [matchingLog] }),
      eth_getLogs: getLogsSpy,
      eth_blockNumber: () => "0x100",
    }) as unknown as typeof fetch

    const { runPaymentWatcher } = await import("@/engine/checkPaymentOnce")
    const detected = await runPaymentWatcher(PAYMENT_ID, { txHash: TX_HASH, maxAttempts: 1 })

    expect(detected).toBe(true)
    expect(getLogsSpy).not.toHaveBeenCalled()
  })

  it("uses eth_getTransactionReceipt(txHash), never eth_getLogs, when no txHash is passed but one is already stored (routine status-poll path after the webhook persisted it)", async () => {
    mocks.getPaymentById.mockResolvedValue(payment())
    mocks.getTransactionByPaymentId.mockResolvedValue({
      id: "txn-1",
      provider_transaction_id: TX_HASH,
    })

    const matchingLog = {
      address: SPLIT_CONTRACT.toLowerCase(),
      topics: [PAYMENT_SPLIT_TOPIC, "0x", "0x", topicFromAddress("0xB5429a1035E7C5B7fD8f8B7e1A2C3d4E5f677A5")],
      data: AbiCoder.defaultAbiCoder().encode(
        ["uint256", "uint256", "string", "address"],
        [BigInt("143733996284210"), BigInt("79852220157894"), PAYMENT_ID, ZeroAddress]
      ),
      transactionHash: TX_HASH,
    }

    const getLogsSpy = vi.fn()
    global.fetch = jsonRpcResponder({
      eth_getTransactionReceipt: () => ({ status: "0x1", logs: [matchingLog] }),
      eth_getLogs: getLogsSpy,
      eth_blockNumber: () => "0x100",
    }) as unknown as typeof fetch

    // No options at all — exactly how the periodic status-poll -> ensurePaymentFresh
    // -> runPaymentWatcher(paymentId) call chain invokes this.
    const detected = await (await import("@/engine/checkPaymentOnce")).runPaymentWatcher(PAYMENT_ID)

    expect(detected).toBe(true)
    expect(mocks.getTransactionByPaymentId).toHaveBeenCalledWith(PAYMENT_ID)
    expect(getLogsSpy).not.toHaveBeenCalled()
  })

  it("still never calls eth_getLogs while a stored hash exists, even if the receipt is not yet mined (a single bounded check, not an unbounded retry loop)", async () => {
    mocks.getPaymentById.mockResolvedValue(payment())
    mocks.getTransactionByPaymentId.mockResolvedValue({
      id: "txn-1",
      provider_transaction_id: TX_HASH,
    })

    const getLogsSpy = vi.fn()
    global.fetch = jsonRpcResponder({
      eth_getTransactionReceipt: () => null, // not yet mined
      eth_getLogs: getLogsSpy,
      eth_blockNumber: () => "0x100",
    }) as unknown as typeof fetch

    // maxAttempts: 1 keeps this a single bounded check — without it, a
    // real (unmocked) 5-attempt/3s-sleep retry loop would run for a
    // genuinely undetected payment, which isn't what this test is about.
    const detected = await (await import("@/engine/checkPaymentOnce")).runPaymentWatcher(PAYMENT_ID, {
      maxAttempts: 1,
    })

    expect(detected).toBe(false)
    expect(getLogsSpy).not.toHaveBeenCalled()
  })
})
