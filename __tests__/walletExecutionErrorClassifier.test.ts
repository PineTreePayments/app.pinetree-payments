import { describe, expect, it } from "vitest"
import {
  classifyWalletExecutionError,
  friendlyWalletExecutionMessage,
  sanitizeCustomerPaymentErrorMessage,
} from "@/lib/payments/walletExecutionErrorClassifier"

/**
 * Coverage for the live-demo incident class: a customer wallet payment fails
 * for a knowable reason (insufficient balance, insufficient gas, expired
 * blockhash, wrong network) but the screen showed either a raw RPC string or
 * a bare timeout. The classifier must map conclusive wallet/RPC evidence to
 * a specific cause, return null for anything ambiguous, and the sanitizer
 * must keep raw technical dumps off customer screens.
 */

const baseEth = { rail: "base" as const, asset: "ETH" }
const baseUsdc = { rail: "base" as const, asset: "USDC" }
const solanaSol = { rail: "solana" as const, asset: "SOL" }
const solanaUsdc = { rail: "solana" as const, asset: "USDC" }

describe("classifyWalletExecutionError - Base", () => {
  it("insufficient funds for gas * price + value, paying ETH -> insufficient_native_total", () => {
    expect(
      classifyWalletExecutionError(new Error("insufficient funds for gas * price + value"), baseEth)
    ).toBe("insufficient_native_total")
  })

  it("insufficient funds for intrinsic transaction cost, paying USDC -> insufficient_native_gas", () => {
    expect(
      classifyWalletExecutionError(new Error("err: insufficient funds for intrinsic transaction cost"), baseUsdc)
    ).toBe("insufficient_native_gas")
  })

  it("ERC20 transfer amount exceeds balance -> insufficient_payment_asset", () => {
    expect(
      classifyWalletExecutionError(new Error("execution reverted: ERC20: transfer amount exceeds balance"), baseUsdc)
    ).toBe("insufficient_payment_asset")
  })

  it("nested WalletConnect JSON-RPC envelope is inspected", () => {
    expect(
      classifyWalletExecutionError(
        { code: -32000, error: { message: "insufficient funds for gas" } },
        baseEth
      )
    ).toBe("insufficient_native_total")
  })

  it("wrong chain -> wrong_network", () => {
    expect(classifyWalletExecutionError(new Error("Unsupported chain id"), baseEth)).toBe("wrong_network")
  })

  it("generic wallet failure -> null (no guessing)", () => {
    expect(classifyWalletExecutionError(new Error("Failed to sign message"), baseEth)).toBe(null)
  })

  it("user-style rejection text is not classified as an execution failure", () => {
    expect(classifyWalletExecutionError(new Error("User rejected the request."), baseEth)).toBe(null)
  })
})

describe("classifyWalletExecutionError - Solana", () => {
  it("insufficient lamports, paying SOL -> insufficient_native_total", () => {
    expect(
      classifyWalletExecutionError(
        new Error("Transfer: insufficient lamports 5000, need 2039280"),
        solanaSol
      )
    ).toBe("insufficient_native_total")
  })

  it("insufficient lamports, paying USDC -> insufficient_native_gas", () => {
    expect(
      classifyWalletExecutionError(new Error("insufficient lamports for fee"), solanaUsdc)
    ).toBe("insufficient_native_gas")
  })

  it("SPL custom program error 0x1, paying USDC -> insufficient_payment_asset", () => {
    expect(
      classifyWalletExecutionError(
        new Error("Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1"),
        solanaUsdc
      )
    ).toBe("insufficient_payment_asset")
  })

  it("expired blockhash -> expired_blockhash", () => {
    expect(classifyWalletExecutionError(new Error("Blockhash not found"), solanaSol)).toBe("expired_blockhash")
    expect(
      classifyWalletExecutionError(new Error("TransactionExpiredBlockheightExceededError: block height exceeded"), solanaSol)
    ).toBe("expired_blockhash")
  })
})

describe("friendlyWalletExecutionMessage", () => {
  it("returns specific, safe copy per kind", () => {
    expect(friendlyWalletExecutionMessage("insufficient_payment_asset", baseUsdc)).toContain("enough USDC")
    expect(friendlyWalletExecutionMessage("insufficient_native_gas", baseUsdc)).toContain("network fee")
    expect(friendlyWalletExecutionMessage("insufficient_native_total", solanaSol)).toContain("SOL")
    expect(friendlyWalletExecutionMessage("wrong_network", baseEth)).toContain("Base")
    expect(friendlyWalletExecutionMessage("wrong_network", solanaSol)).toContain("Solana")
  })

  it("returns null for unclassified failures so callers keep their fallback", () => {
    expect(friendlyWalletExecutionMessage(null, baseEth)).toBe(null)
  })
})

describe("sanitizeCustomerPaymentErrorMessage", () => {
  it("keeps short human-readable wallet messages", () => {
    expect(sanitizeCustomerPaymentErrorMessage("Transaction approval was not completed. Retry payment approval to try again."))
      .toBe("Transaction approval was not completed. Retry payment approval to try again.")
  })

  it("collapses raw RPC/program dumps", () => {
    const raw = "Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1"
    expect(sanitizeCustomerPaymentErrorMessage(raw)).toBe("Payment could not be completed. Tap Try Again to retry.")
  })

  it("collapses [object Object] and empty messages", () => {
    expect(sanitizeCustomerPaymentErrorMessage("[object Object]")).toBe("Payment could not be completed. Tap Try Again to retry.")
    expect(sanitizeCustomerPaymentErrorMessage("")).toBe("Payment could not be completed. Tap Try Again to retry.")
  })

  it("collapses over-long messages", () => {
    expect(sanitizeCustomerPaymentErrorMessage("x".repeat(200))).toBe("Payment could not be completed. Tap Try Again to retry.")
  })
})
