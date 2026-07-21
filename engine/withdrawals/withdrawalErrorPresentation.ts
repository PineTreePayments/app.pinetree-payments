/**
 * Single source of merchant-facing withdrawal error copy, shared by both
 * independent withdrawal engines (Base/Solana in walletWithdrawals.ts,
 * Bitcoin/Speed in walletOperations.ts + speedWalletAdapter.ts) and by the
 * client (app/dashboard/wallet-setup/page.tsx). Replaces the two previously
 * inconsistent, regex-based sanitizers that used to live only in the client.
 *
 * A caller that already has a WalletApiErrorCode (thrown as a
 * WalletApiRouteError, or attached via Object.assign(error, { code })) should
 * pass it straight through. A caller with only a legacy plain-Error message
 * (older throw sites in walletWithdrawals.ts, raw RPC/signing errors) should
 * run it through classifyLegacyWithdrawalErrorMessage first.
 */

import type { WalletApiErrorCode } from "@/engine/wallet/walletErrors"

export const WITHDRAWAL_ERROR_MESSAGES: Record<WalletApiErrorCode, string> = {
  UNAUTHORIZED: "Your session has expired. Refresh the page and try again.",
  WALLET_PROVIDER_NOT_CONFIGURED: "This withdrawal method is not connected yet.",
  WALLET_PROVIDER_NOT_READY: "Your wallet provider is not ready yet. Finish setup and try again.",
  WALLET_PROVIDER_UNAVAILABLE: "Your wallet provider is temporarily unavailable. Please try again shortly.",
  WALLET_CAPABILITY_UNAVAILABLE: "This withdrawal type is not currently supported by your connected provider.",
  WALLET_OPERATION_NOT_FOUND: "We couldn't find this withdrawal. Refresh and try again.",
  WALLET_VALIDATION_ERROR: "Check the withdrawal details and try again.",
  WALLET_PROVIDER_AUTHENTICATION_ERROR: "We couldn't authenticate with your wallet provider. Please try again.",
  WALLET_PROVIDER_PERMISSION_ERROR: "Your wallet provider declined this request.",
  WALLET_PROVIDER_RATE_LIMITED: "Too many requests right now. Please wait a moment and try again.",
  WALLET_PROVIDER_TIMEOUT: "The request timed out. We'll confirm the result once we hear back from the provider.",
  IDEMPOTENCY_KEY_REQUIRED: "We couldn't submit this withdrawal. Please try again.",
  IDEMPOTENCY_KEY_CONFLICT: "This withdrawal was already submitted.",
  INSUFFICIENT_BALANCE: "The available balance is insufficient for this withdrawal.",
  INTERNAL_ERROR: "Something went wrong on our end. Please try again.",
  INVALID_DESTINATION: "Enter a valid destination address for the selected asset and network.",
  INVALID_AMOUNT: "Enter a valid withdrawal amount.",
  MINIMUM_AMOUNT: "This amount is below the minimum allowed for this withdrawal type.",
  MAXIMUM_AMOUNT: "This amount exceeds the maximum allowed for this withdrawal type.",
  NETWORK_FEE_TOO_HIGH: "Network fees are unusually high right now. Try a smaller amount or try again later.",
  DESTINATION_NOT_CONFIGURED: "Set up a payout destination before withdrawing.",
  DUPLICATE_WITHDRAWAL: "This withdrawal was already submitted.",
  WITHDRAWAL_ALREADY_PROCESSING: "This withdrawal is already being processed.",
  UNSUPPORTED_NETWORK: "This network isn't supported for withdrawals yet.",
  UNSUPPORTED_ASSET: "This asset isn't supported for withdrawals on this network.",
  UNKNOWN_ERROR: "The withdrawal could not be completed. Review the details and try again.",
}

/**
 * Internal-looking messages (schema/column errors, stack fragments) must
 * never reach the merchant - collapse them to the generic fallback instead.
 */
const INTERNAL_LEAK_PATTERN =
  /schema cache|column|wallet_withdrawal_requests|merchant_wallet_operations|amount_decimal|failed to create wallet withdrawal request|private key|secret|api key/i

/**
 * Best-effort classifier for legacy plain-Error withdrawal messages that
 * don't yet carry a WalletApiErrorCode. Pattern order matters - more specific
 * checks run first so e.g. "minimum amount" isn't swallowed by the generic
 * amount check.
 */
export function classifyLegacyWithdrawalErrorMessage(rawMessage: string): WalletApiErrorCode {
  const raw = String(rawMessage || "")
  if (!raw.trim()) return "UNKNOWN_ERROR"
  if (/insufficient|exceeds available balance|exceeds balance/i.test(raw)) return "INSUFFICIENT_BALANCE"
  if (/minimum/i.test(raw)) return "MINIMUM_AMOUNT"
  if (/maximum|too large/i.test(raw)) return "MAXIMUM_AMOUNT"
  if (/network fee|fee too high/i.test(raw)) return "NETWORK_FEE_TOO_HIGH"
  if (/destination.*(required|invalid|not match|unsupported)|invalid.*(address|destination)|enter a valid bitcoin address|lightning address|lightning invoice/i.test(raw))
    return "INVALID_DESTINATION"
  if (/amount.*(greater than 0|valid|decimal places)|enter a valid withdrawal amount/i.test(raw)) return "INVALID_AMOUNT"
  if (/already processing|pending review|still pending|not ready for wallet approval/i.test(raw))
    return "WITHDRAWAL_ALREADY_PROCESSING"
  if (/duplicate/i.test(raw)) return "DUPLICATE_WITHDRAWAL"
  if (/unsupported.*(rail|network)|withdrawal rail/i.test(raw)) return "UNSUPPORTED_NETWORK"
  if (/unsupported.*asset|rail\/asset combination/i.test(raw)) return "UNSUPPORTED_ASSET"
  if (/not configured|no .*profile|destination not configured/i.test(raw)) return "DESTINATION_NOT_CONFIGURED"
  if (/not ready|not connected|profile not found|source address is not available|signer is not available/i.test(raw))
    return "WALLET_PROVIDER_NOT_READY"
  if (/timeout|timed out/i.test(raw)) return "WALLET_PROVIDER_TIMEOUT"
  if (/rate limit/i.test(raw)) return "WALLET_PROVIDER_RATE_LIMITED"
  if (/unauthorized|authentication/i.test(raw)) return "WALLET_PROVIDER_AUTHENTICATION_ERROR"
  return "UNKNOWN_ERROR"
}

/**
 * Resolves the final merchant-safe { code, message } pair. Prefers an
 * explicit code (set at the throw site) over message classification -
 * classification is a fallback for call sites not yet instrumented with an
 * explicit code.
 */
export function presentWithdrawalError(input: {
  code?: WalletApiErrorCode | null
  rawMessage?: string | null
}): { code: WalletApiErrorCode; message: string } {
  const rawMessage = String(input.rawMessage || "").trim()
  const code = input.code || classifyLegacyWithdrawalErrorMessage(rawMessage)
  if (INTERNAL_LEAK_PATTERN.test(rawMessage)) {
    return { code, message: WITHDRAWAL_ERROR_MESSAGES[code] }
  }
  // For validation-shaped codes the original message is usually already
  // merchant-safe and more specific than the generic fallback copy (e.g.
  // "This Lightning invoice is for the wrong Bitcoin network.") - prefer it.
  const specificCodes: WalletApiErrorCode[] = [
    "INVALID_DESTINATION",
    "INVALID_AMOUNT",
    "WALLET_VALIDATION_ERROR",
    "WALLET_CAPABILITY_UNAVAILABLE",
  ]
  if (rawMessage && specificCodes.includes(code)) {
    return { code, message: rawMessage }
  }
  return { code, message: WITHDRAWAL_ERROR_MESSAGES[code] || rawMessage || WITHDRAWAL_ERROR_MESSAGES.UNKNOWN_ERROR }
}
