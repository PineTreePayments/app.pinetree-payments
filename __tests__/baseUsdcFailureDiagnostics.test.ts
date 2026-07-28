import { afterEach, describe, expect, it, vi } from "vitest"
import {
  classifyBaseUsdcRevertReason,
  decodeEvmRevertReason,
  extractBaseRevertReason,
} from "@/engine/baseRevertReason"
import { classifyBaseUsdcBalancePreflight } from "@/engine/baseV7StrategyResolver"
import { evaluateBaseV7ReceiptEvidence } from "@/engine/baseV7Evidence"

/**
 * Regression coverage for production payment a29773b7-6da0-47ed-b3e5-
 * cb09a47fc392: tx 0xe90d1f44... called the split contract's USDC payment
 * (selector 0x7fb6346b, correct 110000/150000 split), reverted with
 * "ERC20: transfer amount exceeds balance" (payer USDC balance was 0, the
 * 0.26 allowance had already been approved, gas ETH was ample). The receipt
 * had status 0x0 and zero logs. The payment was correctly FAILED - but no
 * cause was extracted, and the two-step flow prompted the wallet twice for a
 * payment that could never succeed.
 */

// Exact revert payload returned by replaying the production transaction.
const PRODUCTION_REVERT_DATA =
  "0x08c379a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000026" +
  "45524332303a207472616e7366657220616d6f756e7420657863656564732062616c616e63650000000000000000000000000000000000000000000000000000"

const SPLIT_CONTRACT = "0x96484a59b0aa16e4f95f0899b592f76a6a192c29"
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("decodeEvmRevertReason", () => {
  it("decodes the exact production revert payload", () => {
    expect(decodeEvmRevertReason(PRODUCTION_REVERT_DATA)).toBe("ERC20: transfer amount exceeds balance")
  })

  it("returns null for opaque or empty payloads", () => {
    expect(decodeEvmRevertReason("0x")).toBe(null)
    expect(decodeEvmRevertReason("")).toBe(null)
    expect(decodeEvmRevertReason("0xdeadbeef")).toBe(null)
  })
})

describe("classifyBaseUsdcRevertReason", () => {
  it("maps the production revert to insufficient_usdc_balance with safe copy", () => {
    const classified = classifyBaseUsdcRevertReason("ERC20: transfer amount exceeds balance")
    expect(classified.code).toBe("insufficient_usdc_balance")
    expect(classified.message).toContain("USDC")
    expect(classified.message).not.toContain("ERC20")
  })

  it("maps allowance shortfalls to insufficient_allowance", () => {
    expect(classifyBaseUsdcRevertReason("ERC20: insufficient allowance").code).toBe("insufficient_allowance")
    expect(classifyBaseUsdcRevertReason("transfer amount exceeds allowance").code).toBe("insufficient_allowance")
  })

  it("falls back to a generic but truthful payment_reverted", () => {
    const classified = classifyBaseUsdcRevertReason("some custom contract failure")
    expect(classified.code).toBe("payment_reverted")
    expect(classified.message).toContain("rejected by the network")
    expect(classifyBaseUsdcRevertReason(null).code).toBe("payment_reverted")
  })
})

describe("extractBaseRevertReason", () => {
  const transaction = { from: "0xb54205bb0076a314d55dd77a1ea957a15b3d77a5", to: SPLIT_CONTRACT, input: "0x7fb6346b" }

  it("classifies from the node's error.data payload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      json: async () => ({ error: { message: "execution reverted", data: PRODUCTION_REVERT_DATA } }),
    }) as Response))
    const result = await extractBaseRevertReason({ rpcUrl: "http://rpc", transaction, blockNumber: "0x2eee784" })
    expect(result.code).toBe("insufficient_usdc_balance")
    expect(result.raw).toBe("ERC20: transfer amount exceeds balance")
  })

  it("classifies from an 'execution reverted: <reason>' message when data is absent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      json: async () => ({ error: { message: "execution reverted: ERC20: transfer amount exceeds balance" } }),
    }) as Response))
    const result = await extractBaseRevertReason({ rpcUrl: "http://rpc", transaction })
    expect(result.code).toBe("insufficient_usdc_balance")
  })

  it("never throws - RPC failure yields the generic classification", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down") }))
    const result = await extractBaseRevertReason({ rpcUrl: "http://rpc", transaction })
    expect(result.code).toBe("payment_reverted")
  })
})

describe("classifyBaseUsdcBalancePreflight", () => {
  it("blocks the exact incident shape: zero balance, 260000 required", () => {
    expect(classifyBaseUsdcBalancePreflight({ balance: BigInt(0), required: BigInt(260000) }).sufficient).toBe(false)
  })

  it("passes when the balance covers merchant amount plus Platform Fee", () => {
    expect(classifyBaseUsdcBalancePreflight({ balance: BigInt(260000), required: BigInt(260000) }).sufficient).toBe(true)
  })

  it("never blocks on a failed balance read - only on proof of insufficiency", () => {
    expect(classifyBaseUsdcBalancePreflight({ balance: null, required: BigInt(260000) }).sufficient).toBe(true)
  })

  it("passes trivially when nothing is required", () => {
    expect(classifyBaseUsdcBalancePreflight({ balance: BigInt(0), required: BigInt(0) }).sufficient).toBe(true)
  })
})

describe("incident receipt evidence (status 0x0, zero logs, split-contract call)", () => {
  it("classifies the exact production failure as failed_transaction, never confirmed", () => {
    const decision = evaluateBaseV7ReceiptEvidence({
      txHash: "0xe90d1f447cde33ccae868eef63809f6eb7214f00f64deda00be48dcd4a89b0ab",
      receipt: { status: "0x0", logs: [] },
      transaction: {
        to: SPLIT_CONTRACT,
        from: "0xb54205bb0076a314d55dd77a1ea957a15b3d77a5",
        input: "0x7fb6346b00000000000000000000000050c619680b56382489429e8d382d520cfca95599",
      },
      expectedSplitContract: SPLIT_CONTRACT,
      expectedUsdcToken: USDC,
      expectedMerchantWallet: "0x50c619680b56382489429e8d382d520cfca95599",
      expectedPineTreeWallet: "0xdfb2eb3fccb76b8c7f7e352d5421654add5a7903",
      expectedPaymentRef: "a29773b7-6da0-47ed-b3e5-cb09a47fc392",
      expectedMerchantAmountAtomic: "110000",
      expectedFeeAmountAtomic: "150000",
    })
    expect(decision.kind).toBe("failed_transaction")
    expect(decision.status).toBe("FAILED")
  })

  it("an approval transaction is classified wrong_transaction_type - never FAILED, never the payment hash", () => {
    const decision = evaluateBaseV7ReceiptEvidence({
      txHash: "0x" + "aa".repeat(32),
      receipt: { status: "0x1", logs: [] },
      transaction: { to: USDC, from: "0xb54205bb0076a314d55dd77a1ea957a15b3d77a5", input: "0x095ea7b3" },
      expectedSplitContract: SPLIT_CONTRACT,
      expectedUsdcToken: USDC,
      expectedMerchantWallet: "0x50c619680b56382489429e8d382d520cfca95599",
      expectedPineTreeWallet: "0xdfb2eb3fccb76b8c7f7e352d5421654add5a7903",
      expectedPaymentRef: "a29773b7-6da0-47ed-b3e5-cb09a47fc392",
      expectedMerchantAmountAtomic: "110000",
      expectedFeeAmountAtomic: "150000",
    })
    expect(decision.kind).toBe("wrong_transaction_type")
    expect(decision.status).toBe("PROCESSING")
  })
})
