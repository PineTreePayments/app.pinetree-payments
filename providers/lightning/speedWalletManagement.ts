/**
 * Speed Custom Connect wallet-management provider boundary.
 *
 * This is the ONLY place allowed to eventually translate Speed's raw
 * connected-account balance/transaction/withdrawal/payout/swap
 * request/response shapes - engine code (engine/wallet/*) must only ever
 * depend on the stable types exported here, never on Speed's payload shape
 * directly. Mirrors the existing, already-shipped pattern in
 * providers/lightning/speedInstantSend.ts.
 *
 * Every exported function below:
 *   1. Checks the relevant SpeedWalletCapabilities flag
 *      (providers/lightning/speedWalletCapabilities.ts) and throws
 *      SpeedWalletCapabilityUnavailableError if it is not available.
 *   2. Even when the capability flag IS set, still calls
 *      requireContractConfirmed() unconditionally before issuing any HTTP
 *      request - because the exact connected-account scoping mechanism
 *      (header? query param? separate credential?) for /balances,
 *      /balance-transactions, /withdraw-requests, /send, and
 *      /balances/swap is not documented by Speed for ANY of them (see the
 *      research note in speedWalletCapabilities.ts). No request is ever
 *      built or sent by this module today - issuing one would mean
 *      guessing a provider contract, which this integration must not do.
 *
 * Implementing the real HTTP calls is a follow-up change once Speed
 * confirms the connected-account scoping contract for each endpoint - this
 * file intentionally does not guess it. Only the response *shapes* below are
 * taken directly from Speed's official API reference (apidocs.tryspeed.com),
 * so the eventual real implementation has an accurate target to normalize
 * into PineTree's types against.
 */

import {
  getSpeedWalletCapabilities,
  type SpeedWalletCapabilityKey,
  type SpeedWalletCapabilityReason,
} from "./speedWalletCapabilities"

export class SpeedWalletCapabilityUnavailableError extends Error {
  readonly capability: SpeedWalletCapabilityKey
  readonly reason: SpeedWalletCapabilityReason

  constructor(capability: SpeedWalletCapabilityKey, reason: SpeedWalletCapabilityReason) {
    super(`Speed wallet capability "${capability}" is not available (${reason}).`)
    this.name = "SpeedWalletCapabilityUnavailableError"
    this.capability = capability
    this.reason = reason
  }
}

export type SpeedWalletErrorCategory =
  | "authentication"
  | "permission"
  | "validation"
  | "rate_limit"
  | "unsupported_capability"
  | "provider_unavailable"
  | "unknown"

/**
 * PineTree's own stable internal error shape for a real (post-contract)
 * Speed wallet-management failure - the future implementation must translate
 * Speed's raw error response into this shape rather than letting engine code
 * depend on Speed's payload directly.
 */
export class SpeedWalletProviderError extends Error {
  readonly category: SpeedWalletErrorCategory
  readonly httpStatus: number | null
  readonly retryable: boolean
  readonly providerCode: string | null

  constructor(
    message: string,
    options: {
      category: SpeedWalletErrorCategory
      httpStatus?: number | null
      retryable: boolean
      providerCode?: string | null
    }
  ) {
    super(message)
    this.name = "SpeedWalletProviderError"
    this.category = options.category
    this.httpStatus = options.httpStatus ?? null
    this.retryable = options.retryable
    this.providerCode = options.providerCode ?? null
  }
}

function requireCapability(key: SpeedWalletCapabilityKey): void {
  const { details } = getSpeedWalletCapabilities()
  const detail = details[key]
  if (!detail.available) {
    throw new SpeedWalletCapabilityUnavailableError(key, detail.reason)
  }
}

/**
 * Single, obvious chokepoint reached by every operation below once its
 * capability flag passes. A future change wiring the real, Speed-confirmed
 * contract only has to touch this file - callers never change.
 */
function requireContractConfirmed(operation: string): never {
  throw new Error(
    `Speed has not documented the connected-account scoping mechanism for ${operation}. ` +
      "Implement the real request/response translation in providers/lightning/speedWalletManagement.ts only once Speed confirms it - do not guess it."
  )
}

export type ConnectedAccountContext = {
  merchantId: string
  speedAccountId: string
}

// ---------------------------------------------------------------------------
// Balances - GET /balances (apidocs.tryspeed.com/reference/balance-retrieve)
// ---------------------------------------------------------------------------

export type SpeedBalanceEntry = {
  amount: number
  target_currency: string
}

export type SpeedBalanceObject = {
  object: "balance"
  available: SpeedBalanceEntry[]
}

export async function getConnectedAccountBalances(
  context: ConnectedAccountContext
): Promise<SpeedBalanceObject> {
  requireCapability("balances")
  void context
  requireContractConfirmed("GET /balances (connected-account balance retrieval)")
}

// ---------------------------------------------------------------------------
// Transactions - GET /balance-transactions (transaction-list)
// ---------------------------------------------------------------------------

export type SpeedBalanceTransactionObject = {
  id: string
  object: "balance_transaction"
  amount: number
  fee: number
  net: number
  target_currency: string
  type: string
  transaction_type: "credit" | "debit"
  source: string | null
  created: number
}

export type SpeedBalanceTransactionList = {
  object: "list"
  has_more: boolean
  data: SpeedBalanceTransactionObject[]
}

export type ListConnectedTransactionsInput = ConnectedAccountContext & {
  cursor?: string | null
  limit?: number
}

export async function listConnectedAccountTransactions(
  input: ListConnectedTransactionsInput
): Promise<SpeedBalanceTransactionList> {
  requireCapability("transactions")
  void input
  requireContractConfirmed("GET /balance-transactions (connected-account transaction list)")
}

// ---------------------------------------------------------------------------
// Withdrawals / Payouts - POST /send (create-a-instant-send)
// ---------------------------------------------------------------------------

export type SpeedInstantSendObject = {
  id: string
  status: string
  amount: number
  currency: string
  target_amount: number
  target_currency: string
  fees: number
  withdraw_method: string
  withdraw_type: string
  explorer_link?: string
  created: number
  modified: number
}

export type CreateConnectedWithdrawalInput = ConnectedAccountContext & {
  amount: number
  currency: "SATS" | "USDT" | "USDC"
  withdrawMethod: "lightning" | "onchain" | "ethereum" | "solana" | "tron"
  withdrawRequest: string
  note?: string
  idempotencyKey: string
}

export async function createConnectedAccountWithdrawal(
  input: CreateConnectedWithdrawalInput
): Promise<SpeedInstantSendObject> {
  requireCapability("withdrawals")
  void input
  requireContractConfirmed("POST /send (connected-account withdrawal)")
}

export type CreateConnectedPayoutInput = CreateConnectedWithdrawalInput

export async function createConnectedAccountPayout(
  input: CreateConnectedPayoutInput
): Promise<SpeedInstantSendObject> {
  requireCapability("payouts")
  void input
  requireContractConfirmed("POST /send (connected-account payout)")
}

export type GetPayoutOrWithdrawalStatusInput = ConnectedAccountContext & {
  providerSendId: string
}

export async function getConnectedAccountSendStatus(
  input: GetPayoutOrWithdrawalStatusInput
): Promise<SpeedInstantSendObject> {
  requireCapability("payoutStatus")
  void input
  requireContractConfirmed("GET /send/{id} (connected-account withdrawal/payout status)")
}

// ---------------------------------------------------------------------------
// Swaps - POST /balances/swap/quote, POST /balances/swap (create-a-swap)
// ---------------------------------------------------------------------------

export type SpeedSwapQuoteObject = {
  id: string
  object: "swap_quote"
  currency: string
  amount: number
  exchange_rate_swap_out: number
  target_currency_swap_out: string
  target_amount_swap_out: number
  exchange_rate_swap_in: number
  target_currency_swap_in: string
  target_amount_swap_in: number
  swap_quote_id: string
  swap_quote_expires_at: number
  created: number
  modified: number
}

export type CreateSwapQuoteInput = ConnectedAccountContext & {
  currency: string
  amount: string
  targetCurrencySwapOut: string
  targetCurrencySwapIn: string
}

export async function createConnectedAccountSwapQuote(
  input: CreateSwapQuoteInput
): Promise<SpeedSwapQuoteObject> {
  requireCapability("manualSwap")
  void input
  requireContractConfirmed("POST /balances/swap/quote (connected-account swap quote)")
}

export type SpeedSwapObject = {
  id: string
  object: string
  currency: string
  amount: number
  exchange_rate_swap_out: number
  target_currency_swap_out: string
  target_amount_swap_out: number
  exchange_rate_swap_in: number
  target_currency_swap_in: string
  target_amount_swap_in: number
  speed_fee?: { percentage: number; amount: number }
  status: string
  created: number
  modified: number
}

export type CreateSwapInput = ConnectedAccountContext & {
  currency: string
  amount: string
  targetCurrencySwapOut: string
  targetCurrencySwapIn: string
  idempotencyKey: string
}

export async function createConnectedAccountSwap(input: CreateSwapInput): Promise<SpeedSwapObject> {
  requireCapability("manualSwap")
  void input
  requireContractConfirmed("POST /balances/swap (connected-account swap execution)")
}

export type GetSwapStatusInput = ConnectedAccountContext & {
  providerSwapId: string
}

export async function getConnectedAccountSwapStatus(input: GetSwapStatusInput): Promise<SpeedSwapObject> {
  requireCapability("manualSwap")
  void input
  requireContractConfirmed("GET /balances/swap/{id} (connected-account swap status)")
}
