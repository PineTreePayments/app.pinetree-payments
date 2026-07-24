import { beforeEach, describe, expect, it, vi } from "vitest"
import { AbiCoder, Interface, id as ethersId, ZeroAddress } from "ethers"

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

import { watchPaymentOnce, RpcTransportError } from "@/engine/paymentWatcher"
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

/**
 * Regression coverage for the live production incident: payment
 * 6fd3c713-6f3a-4e5d-bbff-b83e157af1fb / tx
 * 0x670fb79d50e4777bef5ee0f59a925ce123e3f7e5c90d4e3793e9f95c45624428.
 *
 * This transaction, receipt, and calldata are the REAL mined values (fetched
 * live from Base mainnet against https://mainnet.base.org during
 * investigation — the production BASE_RPC_URL itself returns "Must be
 * authenticated!", a malformed/expired Alchemy key, which is the actual root
 * cause of the incident: see the RpcTransportError tests below). Every field
 * — merchant/treasury addresses, merchant/fee atomic amounts, and the
 * embedded payment reference — decodes and matches exactly, proving
 * watchPaymentOnce's verification logic itself was never the bug. The real
 * bug was (a) engine/paymentDetect.ts persisting the tx hash AFTER the
 * terminal-status early return instead of before, so a cancel race could
 * drop the hash forever, and (b) RPC-level errors being silently treated as
 * "not detected" instead of surfaced — both fixed elsewhere in this change;
 * these tests pin the on-chain verification itself as correct.
 */
describe("watchPaymentOnce — real production transaction (incident 6fd3c713)", () => {
  const REAL_PAYMENT_ID = "6fd3c713-6f3a-4e5d-bbff-b83e157af1fb"
  const REAL_TX_HASH = "0x670fb79d50e4777bef5ee0f59a925ce123e3f7e5c90d4e3793e9f95c45624428"
  const REAL_PAYER = "0xb54205bb0076a314d55dd77a1ea957a15b3d77a5"
  const REAL_MERCHANT_AMOUNT_WEI = "143462874996015"
  const REAL_FEE_AMOUNT_WEI = "79701597220008"
  const REAL_PAYMENT_URL_DATA =
    "0xf40858bf00000000000000000000000050c619680b56382489429e8d382d520cfca95599000000000000000000000000dfb2eb3fccb76b8c7f7e352d5421654add5a79030000000000000000000000000000000000000000000000000000827a8db3dd2f0000000000000000000000000000000000000000000000000000487cf963eca800000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000002436666433633731332d366633612d346535642d626266662d62383365313537616631666200000000000000000000000000000000000000000000000000000000"

  const realWatchInput = {
    merchantWallet: MERCHANT_WALLET,
    pinetreeWallet: PINETREE_WALLET,
    merchantAmount: 0.27,
    pinetreeFee: 0.15,
    splitContract: SPLIT_CONTRACT,
    feeCaptureMethod: "contract_split",
    network: "base",
    paymentId: REAL_PAYMENT_ID,
    asset: "ETH" as const,
    expectedAmountNative: 0.000223164472216023,
    expectedMerchantAtomic: REAL_MERCHANT_AMOUNT_WEI,
    expectedFeeAtomic: REAL_FEE_AMOUNT_WEI
  }

  function realMatchingLog(overrides: Partial<{
    merchantAmount: bigint
    feeAmount: bigint
    paymentRef: string
    token: string
    contractAddress: string
  }> = {}) {
    return {
      address: (overrides.contractAddress ?? SPLIT_CONTRACT).toLowerCase(),
      topics: [PAYMENT_SPLIT_TOPIC, "0x", "0x", topicFromAddress(REAL_PAYER)],
      data: encodePaymentSplitLog({
        merchantAmount: overrides.merchantAmount ?? BigInt(REAL_MERCHANT_AMOUNT_WEI),
        feeAmount: overrides.feeAmount ?? BigInt(REAL_FEE_AMOUNT_WEI),
        paymentRef: overrides.paymentRef ?? REAL_PAYMENT_ID,
        token: overrides.token ?? ZeroAddress
      }),
      transactionHash: REAL_TX_HASH
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("the real mined payment_url calldata decodes to the exact merchant/treasury/amounts/paymentRef stored for this payment", () => {
    const SPLIT_ETH_ABI = [
      "function splitEth(address merchant, address treasury, uint256 merchantAmountWei, uint256 feeAmountWei, string paymentRef) payable"
    ]
    const splitEthIface = new Interface(SPLIT_ETH_ABI)
    const decoded = splitEthIface.decodeFunctionData("splitEth", REAL_PAYMENT_URL_DATA)

    expect(decoded[0].toLowerCase()).toBe(MERCHANT_WALLET.toLowerCase())
    expect(decoded[1].toLowerCase()).toBe(PINETREE_WALLET.toLowerCase())
    expect(decoded[2].toString()).toBe(REAL_MERCHANT_AMOUNT_WEI)
    expect(decoded[3].toString()).toBe(REAL_FEE_AMOUNT_WEI)
    expect(decoded[4]).toBe(REAL_PAYMENT_ID)
  })

  it("detected:true via the txHash fast-path against the real receipt + PaymentSplit log — every leg matches", async () => {
    global.fetch = jsonRpcResponder({
      eth_blockNumber: () => "0x2ec5ab1",
      eth_getTransactionReceipt: () => ({
        status: "0x1",
        logs: [realMatchingLog()]
      })
    }) as unknown as typeof fetch

    const detected = await watchPaymentOnce({ ...realWatchInput, txHash: REAL_TX_HASH })

    expect(detected).toBe(true)
    expect(mockProcessPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "payment.confirmed",
        paymentId: REAL_PAYMENT_ID,
        txHash: REAL_TX_HASH,
        value: String(BigInt(REAL_MERCHANT_AMOUNT_WEI) + BigInt(REAL_FEE_AMOUNT_WEI)),
        from: REAL_PAYER,
        feeCaptureValidated: true
      })
    )
  })

  it("PENDING -> PROCESSING -> CONFIRMED: the immediate detect-time payment.processing event plus the watcher's payment.confirmed event together drive the full transition", async () => {
    // engine/paymentDetect.ts emits payment.processing itself the instant a
    // txHash is presented (before ever invoking the watcher); the watcher
    // then independently verifies and emits payment.confirmed. This test
    // proves the watcher's half of that contract for the real transaction.
    global.fetch = jsonRpcResponder({
      eth_blockNumber: () => "0x2ec5ab1",
      eth_getTransactionReceipt: () => ({ status: "0x1", logs: [realMatchingLog()] })
    }) as unknown as typeof fetch

    await watchPaymentOnce({ ...realWatchInput, txHash: REAL_TX_HASH })

    const calls = mockProcessPaymentEvent.mock.calls.map(([event]) => event.type)
    expect(calls).toEqual(["payment.confirmed"])
  })

  it("repeated watcher runs against the same real transaction remain idempotent (one confirm event per call, no duplicate ledger writes at this layer)", async () => {
    global.fetch = jsonRpcResponder({
      eth_blockNumber: () => "0x2ec5ab1",
      eth_getTransactionReceipt: () => ({ status: "0x1", logs: [realMatchingLog()] })
    }) as unknown as typeof fetch

    await watchPaymentOnce({ ...realWatchInput, txHash: REAL_TX_HASH })
    await watchPaymentOnce({ ...realWatchInput, txHash: REAL_TX_HASH })

    expect(mockProcessPaymentEvent).toHaveBeenCalledTimes(2)
    for (const [event] of mockProcessPaymentEvent.mock.calls) {
      expect(event).toMatchObject({ type: "payment.confirmed", txHash: REAL_TX_HASH })
    }
  })

  it("rejects when the payment reference does not match (wrong payment reference)", async () => {
    global.fetch = jsonRpcResponder({
      eth_blockNumber: () => "0x2ec5ab1",
      eth_getTransactionReceipt: () => ({
        status: "0x1",
        logs: [realMatchingLog({ paymentRef: "some-other-payment-id" })]
      })
    }) as unknown as typeof fetch

    const detected = await watchPaymentOnce({ ...realWatchInput, txHash: REAL_TX_HASH })

    expect(detected).toBe(false)
    expect(mockProcessPaymentEvent).not.toHaveBeenCalled()
  })

  it("rejects when the PaymentSplit log comes from a different contract address (wrong recipient / wrong deployment)", async () => {
    global.fetch = jsonRpcResponder({
      eth_blockNumber: () => "0x2ec5ab1",
      eth_getTransactionReceipt: () => ({
        status: "0x1",
        logs: [realMatchingLog({ contractAddress: "0x" + "1".repeat(40) })]
      })
    }) as unknown as typeof fetch

    const detected = await watchPaymentOnce({ ...realWatchInput, txHash: REAL_TX_HASH })

    expect(detected).toBe(false)
    expect(mockProcessPaymentEvent).not.toHaveBeenCalled()
  })

  it("rejects when the merchant leg is short (wrong merchant amount)", async () => {
    global.fetch = jsonRpcResponder({
      eth_blockNumber: () => "0x2ec5ab1",
      eth_getTransactionReceipt: () => ({
        status: "0x1",
        logs: [realMatchingLog({ merchantAmount: BigInt(1) })]
      })
    }) as unknown as typeof fetch

    const detected = await watchPaymentOnce({ ...realWatchInput, txHash: REAL_TX_HASH })

    expect(detected).toBe(false)
    expect(mockProcessPaymentEvent).not.toHaveBeenCalled()
  })

  it("rejects when the fee leg is short (wrong PineTree fee amount)", async () => {
    global.fetch = jsonRpcResponder({
      eth_blockNumber: () => "0x2ec5ab1",
      eth_getTransactionReceipt: () => ({
        status: "0x1",
        logs: [realMatchingLog({ feeAmount: BigInt(1) })]
      })
    }) as unknown as typeof fetch

    const detected = await watchPaymentOnce({ ...realWatchInput, txHash: REAL_TX_HASH })

    expect(detected).toBe(false)
    expect(mockProcessPaymentEvent).not.toHaveBeenCalled()
  })

  it("emits payment.failed (not confirmed) for a reverted receipt on the real tx hash", async () => {
    global.fetch = jsonRpcResponder({
      eth_blockNumber: () => "0x2ec5ab1",
      eth_getTransactionReceipt: () => ({ status: "0x0", logs: [] })
    }) as unknown as typeof fetch

    const detected = await watchPaymentOnce({ ...realWatchInput, txHash: REAL_TX_HASH })

    expect(detected).toBe(true)
    expect(mockProcessPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "payment.failed", txHash: REAL_TX_HASH })
    )
  })

  it("returns false (not yet, safe to retry) when the receipt is missing — transaction not yet mined", async () => {
    global.fetch = jsonRpcResponder({
      eth_blockNumber: () => "0x2ec5ab1",
      eth_getTransactionReceipt: () => null
    }) as unknown as typeof fetch

    const detected = await watchPaymentOnce({ ...realWatchInput, txHash: REAL_TX_HASH })

    expect(detected).toBe(false)
    expect(mockProcessPaymentEvent).not.toHaveBeenCalled()
  })

  it("wrong chain: a receipt scoped to a different split contract deployment never matches, even with an identical log shape", async () => {
    // The network -> RPC endpoint mapping (engine/config.ts's getRpcUrl) is
    // what actually selects the chain; there is no in-calldata chainId to
    // mis-verify (the "@8453" in the ethereum: URI is a wallet display hint
    // only — see engine/generateSplitPayment.ts). The on-chain equivalent of
    // "wrong chain" from the watcher's point of view is exactly the "wrong
    // recipient / wrong deployment" case above: a PaymentSplit log from any
    // contract address other than this payment's configured splitContract is
    // rejected regardless of how well-formed its data otherwise is.
    global.fetch = jsonRpcResponder({
      eth_blockNumber: () => "0x2ec5ab1",
      eth_getTransactionReceipt: () => ({
        status: "0x1",
        logs: [realMatchingLog({ contractAddress: "0x" + "2".repeat(40) })]
      })
    }) as unknown as typeof fetch

    const detected = await watchPaymentOnce({ ...realWatchInput, txHash: REAL_TX_HASH })

    expect(detected).toBe(false)
    expect(mockProcessPaymentEvent).not.toHaveBeenCalled()
  })

  it("throws RpcTransportError (never silently returns false) when the RPC endpoint itself errors — the actual incident root cause", async () => {
    // This is the literal failure mode found live: the configured
    // BASE_RPC_URL returns a JSON-RPC-level error ("Must be authenticated!",
    // consistent with a malformed/expired Alchemy API key) for every call.
    // Before this fix, getTransactionReceipt swallowed that as `return null`
    // — identical to "receipt not yet mined" — so the watcher reported
    // detected:false with zero indication anything was actually wrong.
    global.fetch = vi.fn(async () => ({
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32600, message: "Must be authenticated!" }
      })
    })) as unknown as typeof fetch

    await expect(
      watchPaymentOnce({ ...realWatchInput, txHash: REAL_TX_HASH })
    ).rejects.toBeInstanceOf(RpcTransportError)
    expect(mockProcessPaymentEvent).not.toHaveBeenCalled()
  })

  it("the fallback broad eth_getLogs scan also throws RpcTransportError on an RPC-level error, instead of treating it as an empty result", async () => {
    global.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { method: string }
      if (body.method === "eth_blockNumber") {
        return { json: async () => ({ jsonrpc: "2.0", id: 1, result: "0x2ec5ab1" }) } as Response
      }
      return {
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32600, message: "Must be authenticated!" }
        })
      } as Response
    }) as unknown as typeof fetch

    // No stored txHash — exercises the broad eth_getLogs fallback scan path.
    await expect(
      watchPaymentOnce({ ...realWatchInput })
    ).rejects.toBeInstanceOf(RpcTransportError)
    expect(mockProcessPaymentEvent).not.toHaveBeenCalled()
  })
})
