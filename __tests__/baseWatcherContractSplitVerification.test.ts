import { beforeEach, describe, expect, it, vi } from "vitest"
import { AbiCoder, id as ethersId, ZeroAddress } from "ethers"

/**
 * Base contract_split (ETH + USDC) on-chain verification coverage.
 *
 * watchPaymentOnce is the single verification path shared by routine
 * polling, the customer-triggered /detect fast path, and self-healing
 * reconciliation (reconcile: true). These tests exercise it directly against
 * simulated `eth_getTransactionReceipt` / `eth_getLogs` RPC responses so the
 * USDC Transfer/PaymentSplit decode logic, destination/amount/uniqueness
 * checks, and revert handling are proven without needing a live Base RPC.
 */

vi.mock("@/engine/eventProcessor", () => ({
  processPaymentEvent: vi.fn()
}))

import { watchPaymentOnce } from "@/engine/paymentWatcher"
import { processPaymentEvent } from "@/engine/eventProcessor"

const mockProcessPaymentEvent = vi.mocked(processPaymentEvent)

const PAYMENT_SPLIT_TOPIC = ethersId(
  "PaymentSplit(address,address,uint256,uint256,string,address,address)"
)
const SPLIT_CONTRACT = "0x96484a59b0Aa16E4F95F0899B592F76a6A192c29"
const MERCHANT_WALLET = "0x50c619680b56382489429e8d382D520cfca95599"
const PINETREE_WALLET = "0xDfB2EB3FccB76B8C7f7e352d5421654add5a7903"
const PAYER = "0xB5429a1035E7C5B7fD8f8B7e1A2C3d4E5f677A5"
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const WRONG_TOKEN = "0x" + "0".repeat(38) + "ad" // 20-byte address, all-lowercase (no EIP-55 checksum ambiguity)
const PAYMENT_ID = "b8a386d5-7843-43a3-b904-5e326eb5f5e0"

function topicFromAddress(address: string): string {
  return "0x" + "0".repeat(24) + address.slice(2).toLowerCase()
}

function encodePaymentSplitLog(input: {
  merchantAmount: bigint
  feeAmount: bigint
  paymentRef: string
  token: string
}): string {
  return AbiCoder.defaultAbiCoder().encode(
    ["uint256", "uint256", "string", "address"],
    [input.merchantAmount, input.feeAmount, input.paymentRef, input.token]
  )
}

function jsonRpcResponder(handlers: Record<string, (body: { params?: unknown[] }) => unknown>) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { method: string; params?: unknown[] }
    const handler = handlers[body.method]
    const result = handler ? handler(body) : null
    return {
      json: async () => ({ jsonrpc: "2.0", id: 1, result })
    } as Response
  })
}

const baseWatchInput = {
  merchantWallet: MERCHANT_WALLET,
  pinetreeWallet: PINETREE_WALLET,
  merchantAmount: 0.27,
  pinetreeFee: 0.15,
  splitContract: SPLIT_CONTRACT,
  feeCaptureMethod: "contract_split",
  network: "base",
  paymentId: PAYMENT_ID
}

describe("watchPaymentOnce — Base contract_split verification (no stored txHash, fallback log scan)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("confirms exactly once when a matching PaymentSplit log for this paymentId is found", async () => {
    const log = {
      address: SPLIT_CONTRACT.toLowerCase(),
      topics: [PAYMENT_SPLIT_TOPIC, "0x", "0x", topicFromAddress(PAYER)],
      data: encodePaymentSplitLog({
        merchantAmount: BigInt("143733996284210"),
        feeAmount: BigInt("79852220157894"),
        paymentRef: PAYMENT_ID,
        token: ZeroAddress // native ETH leg
      }),
      transactionHash: "0xrealtxhash"
    }

    global.fetch = jsonRpcResponder({
      eth_blockNumber: () => "0x100",
      eth_getLogs: () => [log]
    }) as unknown as typeof fetch

    const detected = await watchPaymentOnce({
      ...baseWatchInput,
      asset: "ETH",
      expectedAmountNative: 0.000223586216442104,
      expectedMerchantAtomic: "143733996284210",
      expectedFeeAtomic: "79852220157894"
    })

    expect(detected).toBe(true)
    expect(mockProcessPaymentEvent).toHaveBeenCalledTimes(1)
    expect(mockProcessPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "payment.confirmed",
        paymentId: PAYMENT_ID,
        txHash: "0xrealtxhash",
        feeCaptureValidated: true
      })
    )
  })

  it("does not confirm when the log's paymentRef belongs to a different payment (uniqueness)", async () => {
    const log = {
      address: SPLIT_CONTRACT.toLowerCase(),
      topics: [PAYMENT_SPLIT_TOPIC, "0x", "0x", topicFromAddress(PAYER)],
      data: encodePaymentSplitLog({
        merchantAmount: BigInt("143733996284210"),
        feeAmount: BigInt("79852220157894"),
        paymentRef: "some-other-payment-id",
        token: ZeroAddress
      }),
      transactionHash: "0xothertx"
    }

    global.fetch = jsonRpcResponder({
      eth_blockNumber: () => "0x100",
      eth_getLogs: () => [log]
    }) as unknown as typeof fetch

    const detected = await watchPaymentOnce({ ...baseWatchInput, asset: "ETH" })

    expect(detected).toBe(false)
    expect(mockProcessPaymentEvent).not.toHaveBeenCalled()
  })

  it("does not confirm a wrong destination / wrong token contract for a USDC payment", async () => {
    const log = {
      address: SPLIT_CONTRACT.toLowerCase(),
      topics: [PAYMENT_SPLIT_TOPIC, "0x", "0x", topicFromAddress(PAYER)],
      data: encodePaymentSplitLog({
        merchantAmount: BigInt(250000),
        feeAmount: BigInt(150000),
        paymentRef: PAYMENT_ID,
        token: WRONG_TOKEN // not the configured Base USDC contract
      }),
      transactionHash: "0xwrongtoken"
    }

    global.fetch = jsonRpcResponder({
      eth_blockNumber: () => "0x100",
      eth_getLogs: () => [log]
    }) as unknown as typeof fetch

    const detected = await watchPaymentOnce({ ...baseWatchInput, asset: "USDC" })

    expect(detected).toBe(false)
    expect(mockProcessPaymentEvent).not.toHaveBeenCalled()
  })

  it("does not confirm when the matched amount is below the configured tolerance threshold", async () => {
    const log = {
      address: SPLIT_CONTRACT.toLowerCase(),
      topics: [PAYMENT_SPLIT_TOPIC, "0x", "0x", topicFromAddress(PAYER)],
      data: encodePaymentSplitLog({
        merchantAmount: BigInt(1), // far below expected
        feeAmount: BigInt(1),
        paymentRef: PAYMENT_ID,
        token: USDC_ADDRESS
      }),
      transactionHash: "0xunderpaid"
    }

    global.fetch = jsonRpcResponder({
      eth_blockNumber: () => "0x100",
      eth_getLogs: () => [log]
    }) as unknown as typeof fetch

    const detected = await watchPaymentOnce({
      ...baseWatchInput,
      asset: "USDC",
      expectedMerchantAtomic: "250000",
      expectedFeeAtomic: "150000"
    })

    expect(detected).toBe(false)
    expect(mockProcessPaymentEvent).not.toHaveBeenCalled()
  })

  it("does not confirm from an approval-only log (no PaymentSplit topic present)", async () => {
    // Simulates a USDC `Approve` event — same contract address, different topic.
    const approvalLog = {
      address: SPLIT_CONTRACT.toLowerCase(),
      topics: [ethersId("Approval(address,address,uint256)"), "0x", "0x"],
      data: "0x",
      transactionHash: "0xapproveonly"
    }

    global.fetch = jsonRpcResponder({
      eth_blockNumber: () => "0x100",
      eth_getLogs: () => [approvalLog]
    }) as unknown as typeof fetch

    const detected = await watchPaymentOnce({ ...baseWatchInput, asset: "USDC" })

    expect(detected).toBe(false)
    expect(mockProcessPaymentEvent).not.toHaveBeenCalled()
  })

  it("repeated execution against the same logs stays idempotent — still exactly one confirm event per call", async () => {
    const log = {
      address: SPLIT_CONTRACT.toLowerCase(),
      topics: [PAYMENT_SPLIT_TOPIC, "0x", "0x", topicFromAddress(PAYER)],
      data: encodePaymentSplitLog({
        merchantAmount: BigInt("143733996284210"),
        feeAmount: BigInt("79852220157894"),
        paymentRef: PAYMENT_ID,
        token: ZeroAddress
      }),
      transactionHash: "0xrealtxhash"
    }

    global.fetch = jsonRpcResponder({
      eth_blockNumber: () => "0x100",
      eth_getLogs: () => [log]
    }) as unknown as typeof fetch

    await watchPaymentOnce({ ...baseWatchInput, asset: "ETH" })
    await watchPaymentOnce({ ...baseWatchInput, asset: "ETH" })

    // Two independent watcher runs each emit one event to the engine — the
    // engine's own idempotency (payment already CONFIRMED / terminal-state
    // guard) is what prevents a second ledger write, covered separately in
    // baseSelfHealReconciliation.test.ts and paymentTransitionIdempotency.test.ts.
    expect(mockProcessPaymentEvent).toHaveBeenCalledTimes(2)
    expect(mockProcessPaymentEvent.mock.calls[0][0]).toMatchObject({ txHash: "0xrealtxhash" })
    expect(mockProcessPaymentEvent.mock.calls[1][0]).toMatchObject({ txHash: "0xrealtxhash" })
  })
})

describe("watchPaymentOnce — reverted Base transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("emits payment.failed (not confirmed) for a reverted receipt found via stored txHash", async () => {
    global.fetch = jsonRpcResponder({
      eth_blockNumber: () => "0x100",
      eth_getTransactionReceipt: () => ({ status: "0x0", logs: [] })
    }) as unknown as typeof fetch

    const detected = await watchPaymentOnce({
      ...baseWatchInput,
      asset: "ETH",
      txHash: "0xrevertedtx"
    })

    expect(detected).toBe(true)
    expect(mockProcessPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "payment.failed", txHash: "0xrevertedtx" })
    )
  })
})

describe("watchPaymentOnce — self-healing reconciliation propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("forwards reconcile:true through to processPaymentEvent on a match", async () => {
    const log = {
      address: SPLIT_CONTRACT.toLowerCase(),
      topics: [PAYMENT_SPLIT_TOPIC, "0x", "0x", topicFromAddress(PAYER)],
      data: encodePaymentSplitLog({
        merchantAmount: BigInt("143733996284210"),
        feeAmount: BigInt("79852220157894"),
        paymentRef: PAYMENT_ID,
        token: ZeroAddress
      }),
      transactionHash: "0xrealtxhash"
    }

    global.fetch = jsonRpcResponder({
      eth_blockNumber: () => "0x100",
      eth_getLogs: () => [log]
    }) as unknown as typeof fetch

    await watchPaymentOnce({ ...baseWatchInput, asset: "ETH", reconcile: true })

    expect(mockProcessPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ reconcile: true })
    )
  })

  it("an explicit lookbackOverride is honoured instead of the env-configured default", async () => {
    const getLogsSpy = vi.fn(() => [])
    global.fetch = jsonRpcResponder({
      eth_blockNumber: () => "0x100",
      eth_getLogs: getLogsSpy
    }) as unknown as typeof fetch

    await watchPaymentOnce({ ...baseWatchInput, asset: "ETH", lookbackOverride: 5 })

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([, reqInit]) => JSON.parse(String((reqInit as RequestInit).body)).method === "eth_getLogs"
    ) as [string, RequestInit]
    const params = JSON.parse(String(init.body)).params as Array<{ fromBlock: string }>
    // currentBlock 0x100 (256) - lookbackOverride 5 = 251 = 0xfb
    expect(params[0].fromBlock).toBe("0x" + (256 - 5).toString(16))
  })
})
