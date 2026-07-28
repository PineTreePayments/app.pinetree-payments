/**
 * Shared classifier for customer-wallet payment execution failures on the
 * self-custodial rails (Base ETH/USDC, Solana SOL/USDC).
 *
 * Root cause this replaces: none of the customer payment surfaces
 * (components/payment/BaseWalletPayment.tsx, SolanaWalletPayment.tsx,
 * components/pos/POSLayout.tsx -> BasePosCheckoutMirror.tsx) distinguished
 * insufficient payment-asset balance from insufficient native gas from a
 * generic failure - a wallet rejecting with "insufficient funds for gas *
 * price + value" surfaced either as a raw RPC string or as a bare timeout,
 * which is exactly the live-demo incident ("payment timed out" with no
 * truthful cause).
 *
 * This module is presentation-side normalization only. It never decides
 * canonical payment state - PROCESSING/CONFIRMED/FAILED remain owned by the
 * PineTree Engine on provider/chain evidence. It only chooses which safe,
 * actionable message the customer/merchant sees for a failure the wallet or
 * RPC already reported.
 */

export type WalletExecutionErrorKind =
  | "insufficient_payment_asset"
  | "insufficient_native_gas"
  | "insufficient_native_total"
  | "expired_blockhash"
  | "wrong_network"

export type WalletExecutionErrorContext = {
  rail: "base" | "solana"
  /** The asset the customer is paying with ("ETH" | "USDC" | "SOL"). */
  asset: string
}

function collectMessages(error: unknown, depth = 0): string[] {
  const messages: string[] = []
  if (depth > 3) return messages
  if (typeof error === "string") {
    messages.push(error)
  } else if (error instanceof Error) {
    messages.push(error.message)
    if (error.cause !== undefined) messages.push(...collectMessages(error.cause, depth + 1))
  } else if (typeof error === "object" && error !== null) {
    const obj = error as Record<string, unknown>
    for (const key of ["message", "shortMessage", "details"]) {
      if (typeof obj[key] === "string") messages.push(obj[key] as string)
    }
    for (const key of ["error", "data", "cause"]) {
      if (obj[key] !== undefined && obj[key] !== null) {
        messages.push(...collectMessages(obj[key], depth + 1))
      }
    }
  }
  return messages.filter(Boolean)
}

// EVM: not enough native ETH to cover value and/or gas. Wallets/RPCs phrase
// this a few ways; all of them mean the native balance cannot fund the
// transaction as constructed.
const EVM_INSUFFICIENT_NATIVE_PATTERNS = [
  /insufficient funds for gas/i,
  /insufficient funds for intrinsic transaction cost/i,
  /insufficient eth\b/i,
  /gas required exceeds allowance/i,
  /insufficient balance for transfer/i,
]
// ERC-20 token balance too low (reverts/simulations phrase it as the token
// transfer exceeding balance).
const EVM_INSUFFICIENT_TOKEN_PATTERNS = [
  /transfer amount exceeds balance/i,
  /erc20.*insufficient/i,
  /insufficient (usdc|token) balance/i,
]
// Solana: not enough SOL (lamports) for the transfer and/or fees/rent.
const SOLANA_INSUFFICIENT_NATIVE_PATTERNS = [
  /insufficient lamports/i,
  /found no record of a prior credit/i,
  /insufficient funds for (fee|rent)/i,
]
// SPL token program error 0x1 = insufficient token funds.
const SOLANA_INSUFFICIENT_TOKEN_PATTERNS = [
  /custom program error:\s*0x1\b/i,
  /insufficient funds(?!.*(fee|rent|lamports|gas))/i,
]
const SOLANA_EXPIRED_BLOCKHASH_PATTERNS = [
  /blockhash not found/i,
  /block height exceeded/i,
  /blockhash.*expired/i,
  /transaction.*expired/i,
]
const WRONG_NETWORK_PATTERNS = [
  /wrong (network|chain)/i,
  /chain mismatch/i,
  /unsupported chain/i,
  /unrecognized chain/i,
  /does not match the (network|chain)/i,
]

function matchesAny(patterns: RegExp[], messages: string[]): boolean {
  return messages.some((message) => patterns.some((pattern) => pattern.test(message)))
}

/**
 * Classify a payment execution failure from the wallet/RPC. Returns null when
 * the evidence is not conclusive - callers must then keep their existing
 * generic handling rather than guessing a cause.
 */
export function classifyWalletExecutionError(
  error: unknown,
  context: WalletExecutionErrorContext
): WalletExecutionErrorKind | null {
  const messages = collectMessages(error)
  if (messages.length === 0) return null

  if (matchesAny(WRONG_NETWORK_PATTERNS, messages)) return "wrong_network"

  if (context.rail === "base") {
    if (matchesAny(EVM_INSUFFICIENT_TOKEN_PATTERNS, messages)) return "insufficient_payment_asset"
    if (matchesAny(EVM_INSUFFICIENT_NATIVE_PATTERNS, messages)) {
      // Paying in native ETH: the shortfall covers payment + fee together.
      // Paying in USDC: the native shortfall can only be the gas fee.
      return context.asset === "ETH" ? "insufficient_native_total" : "insufficient_native_gas"
    }
    return null
  }

  if (matchesAny(SOLANA_EXPIRED_BLOCKHASH_PATTERNS, messages)) return "expired_blockhash"
  if (matchesAny(SOLANA_INSUFFICIENT_NATIVE_PATTERNS, messages)) {
    return context.asset === "SOL" ? "insufficient_native_total" : "insufficient_native_gas"
  }
  if (context.asset !== "SOL" && matchesAny(SOLANA_INSUFFICIENT_TOKEN_PATTERNS, messages)) {
    return "insufficient_payment_asset"
  }
  return null
}

/**
 * Safe, actionable customer-facing copy for a classified execution failure.
 * Returns null for unclassified failures so callers keep their own fallback.
 */
export function friendlyWalletExecutionMessage(
  kind: WalletExecutionErrorKind | null,
  context: WalletExecutionErrorContext
): string | null {
  const nativeAsset = context.rail === "base" ? "ETH" : "SOL"
  switch (kind) {
    case "insufficient_payment_asset":
      return `Your wallet doesn't have enough ${context.asset} for this payment. Add ${context.asset} or choose another payment method.`
    case "insufficient_native_gas":
      return `Your wallet doesn't have enough ${nativeAsset} to cover the network fee for this payment. Add a small amount of ${nativeAsset} and try again.`
    case "insufficient_native_total":
      return `Your wallet doesn't have enough ${nativeAsset} to cover this payment plus the network fee. Add ${nativeAsset} or choose another payment method.`
    case "expired_blockhash":
      return "The payment request expired in your wallet before it was approved. Tap Try Again to create a fresh request."
    case "wrong_network":
      return context.rail === "base"
        ? "Your wallet is connected to the wrong network. Switch to Base and try again."
        : "Your wallet is connected to the wrong network. Switch to Solana mainnet and try again."
    default:
      return null
  }
}

// Raw RPC/SDK strings that must never be shown verbatim to a customer.
const RAW_TECHNICAL_PATTERN =
  /error processing instruction|simulation failed|custom program error|0x[a-f0-9]{8,}|json[- ]?rpc|\[object object\]|internal error|stack|revert(ed)? with reason|call exception/i

/**
 * Last-resort sanitizer for an unclassified failure message: keeps short,
 * human-looking messages (wallet phrasing is often already fine) but collapses
 * raw RPC/program dumps to a safe generic retry message. The raw message must
 * still go to correlation logs at the call site - this only guards the screen.
 */
export function sanitizeCustomerPaymentErrorMessage(
  message: string,
  fallback = "Payment could not be completed. Tap Try Again to retry."
): string {
  const trimmed = String(message || "").trim()
  if (!trimmed) return fallback
  if (trimmed.length > 160) return fallback
  if (RAW_TECHNICAL_PATTERN.test(trimmed)) return fallback
  return trimmed
}
