import { AbiCoder } from "ethers"
import { describe, expect, it } from "vitest"
import {
  BASE_USDC_APPROVAL_TOPIC,
  BASE_USDC_TRANSFER_TOPIC,
  BASE_V7_PAYMENT_SPLIT_TOPIC,
  classifyBaseV7TransactionRole,
  evaluateBaseV7ReceiptEvidence
} from "@/engine/baseV7Evidence"

const TX_HASH = "0x" + "a".repeat(64)
const SPLIT_CONTRACT = "0x96484a59b0Aa16E4F95F0899B592F76a6A192c29"
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const MERCHANT = "0x50c619680b56382489429e8d382D520cfca95599"
const TREASURY = "0xDfB2EB3FccB76B8C7f7e352d5421654add5a7903"
const PAYER = "0xb54205bb0076a314d55dd77a1ea957a15b3d77a5"
const PAYMENT_ID = "4b81f9a8-1d4e-4ff1-9709-66c9bef50065"

function topicAddress(address: string): string {
  return "0x" + "0".repeat(24) + address.toLowerCase().replace(/^0x/, "")
}

function uintData(value: string): string {
  return "0x" + BigInt(value).toString(16).padStart(64, "0")
}

function baseInput(overrides: Partial<Parameters<typeof evaluateBaseV7ReceiptEvidence>[0]> = {}) {
  return {
    txHash: TX_HASH,
    receipt: { status: "0x1", logs: [] },
    transaction: {
      to: SPLIT_CONTRACT,
      from: PAYER,
      input: "0x7fb6346b" + "0".repeat(64)
    },
    expectedSplitContract: SPLIT_CONTRACT,
    expectedUsdcToken: USDC,
    expectedMerchantWallet: MERCHANT,
    expectedPineTreeWallet: TREASURY,
    expectedPaymentRef: PAYMENT_ID,
    expectedMerchantAmountAtomic: "110000",
    expectedFeeAmountAtomic: "150000",
    ...overrides
  }
}

function paymentSplitLog(paymentRef = PAYMENT_ID) {
  return {
    address: SPLIT_CONTRACT.toLowerCase(),
    topics: [
      BASE_V7_PAYMENT_SPLIT_TOPIC,
      topicAddress(MERCHANT),
      topicAddress(TREASURY),
      topicAddress(PAYER)
    ],
    data: AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256", "string", "address"],
      [BigInt("110000"), BigInt("150000"), paymentRef, USDC]
    ),
    transactionHash: TX_HASH
  }
}

function transferLog(to: string, amount: string) {
  return {
    address: USDC.toLowerCase(),
    topics: [BASE_USDC_TRANSFER_TOPIC, topicAddress(SPLIT_CONTRACT), topicAddress(to)],
    data: uintData(amount),
    transactionHash: TX_HASH
  }
}

describe("Base V7 evidence hierarchy", () => {
  it("classifies an allowance approval transaction by token destination and approve selector", () => {
    const role = classifyBaseV7TransactionRole({
      transactionTo: USDC,
      transactionInput: "0x095ea7b3" + "0".repeat(64),
      expectedSplitContract: SPLIT_CONTRACT,
      expectedUsdcToken: USDC
    })

    expect(role).toBe("allowance_approval")
  })

  it("keeps an allowance approval hash retryable and never marks it FAILED", () => {
    const result = evaluateBaseV7ReceiptEvidence(baseInput({
      transaction: { to: USDC, from: PAYER, input: "0x095ea7b3" + "0".repeat(64) },
      receipt: {
        status: "0x1",
        logs: [{
          address: USDC.toLowerCase(),
          topics: [BASE_USDC_APPROVAL_TOPIC, topicAddress(PAYER), topicAddress(SPLIT_CONTRACT)],
          data: uintData("260000"),
          transactionHash: TX_HASH
        }]
      }
    }))

    expect(result).toMatchObject({
      kind: "wrong_transaction_type",
      status: "PROCESSING",
      reason: "allowance_approval_hash"
    })
  })

  it("marks a reverted final split-contract transaction as a failed transaction", () => {
    const result = evaluateBaseV7ReceiptEvidence(baseInput({
      receipt: { status: "0x0", logs: [] }
    }))

    expect(result).toMatchObject({
      kind: "failed_transaction",
      status: "FAILED",
      reason: "receipt_reverted"
    })
  })

  it("confirms a successful final transaction with matching PaymentSplit evidence", () => {
    const result = evaluateBaseV7ReceiptEvidence(baseInput({
      receipt: { status: "0x1", logs: [paymentSplitLog()] }
    }))

    expect(result).toMatchObject({
      kind: "confirmed_payment",
      status: "CONFIRMED"
    })
  })

  it("uses exact merchant and PineTree USDC transfers as positive evidence when the custom event is missing", () => {
    const result = evaluateBaseV7ReceiptEvidence(baseInput({
      receipt: {
        status: "0x1",
        logs: [transferLog(MERCHANT, "110000"), transferLog(TREASURY, "150000")]
      }
    }))

    expect(result).toMatchObject({
      kind: "confirmed_payment",
      status: "CONFIRMED"
    })
  })

  it("leaves parser uncertainty PROCESSING instead of FAILED", () => {
    const result = evaluateBaseV7ReceiptEvidence(baseInput({
      receipt: {
        status: "0x1",
        logs: [{
          address: SPLIT_CONTRACT.toLowerCase(),
          topics: [BASE_V7_PAYMENT_SPLIT_TOPIC, topicAddress(MERCHANT), topicAddress(TREASURY), topicAddress(PAYER)],
          data: "0xdeadbeef",
          transactionHash: TX_HASH
        }]
      }
    }))

    expect(result).toMatchObject({
      kind: "inconclusive",
      status: "PROCESSING"
    })
  })
})
