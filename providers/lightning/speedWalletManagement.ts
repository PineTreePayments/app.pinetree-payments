/**
 * Speed Custom Connect wallet-management provider boundary.
 *
 * This is the ONLY place allowed to translate Speed's raw
 * connected-account balance/transaction/withdrawal/payout/swap
 * request/response shapes - engine code (engine/wallet/*) must only ever
 * depend on the stable types exported here, never on Speed's payload shape
 * directly. Mirrors the existing, already-shipped pattern in
 * providers/lightning/speedInstantSend.ts.
 *
 * PineTree uses its server-side platform credentials for every request and
 * the shared Speed client adds `speed-account: <connected_account_id>` from
 * server-resolved merchant context. Raw provider payloads never cross this
 * boundary.
 */

import {
  getSpeedWalletCapabilities,
  type SpeedWalletCapabilityKey,
  type SpeedWalletCapabilityReason,
} from "./speedWalletCapabilities"
import { SpeedApiError, SpeedTransportError, speedRequest, speedRequestWithStatus } from "./speedClient"

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
 * PineTree's own stable internal error shape for a Speed wallet-management
 * failure. This boundary translates
 * Speed's raw error response into this shape rather than letting engine code
 * depend on Speed's payload directly.
 */
export class SpeedWalletProviderError extends Error {
  readonly category: SpeedWalletErrorCategory
  readonly httpStatus: number | null
  readonly retryable: boolean
  readonly providerCode: string | null
  readonly requestId: string | null
  readonly outcomeUncertain: boolean

  constructor(
    message: string,
    options: {
      category: SpeedWalletErrorCategory
      httpStatus?: number | null
      retryable: boolean
      providerCode?: string | null
      requestId?: string | null
      outcomeUncertain?: boolean
    }
  ) {
    super(message)
    this.name = "SpeedWalletProviderError"
    this.category = options.category
    this.httpStatus = options.httpStatus ?? null
    this.retryable = options.retryable
    this.providerCode = options.providerCode ?? null
    this.requestId = options.requestId ?? null
    this.outcomeUncertain = Boolean(options.outcomeUncertain)
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
function providerError(error: unknown): never {
  if (error instanceof SpeedWalletCapabilityUnavailableError || error instanceof SpeedWalletProviderError) throw error
  if (error instanceof SpeedTransportError) {
    throw new SpeedWalletProviderError(error.message, {
      category: "provider_unavailable",
      retryable: true,
      providerCode: error.timedOut ? "timeout" : "transport_error",
      outcomeUncertain: error.outcomeUncertain,
    })
  }
  if (error instanceof SpeedApiError) {
    const category: SpeedWalletErrorCategory = error.status === 401
      ? "authentication"
      : error.status === 403
        ? "permission"
        : error.status === 429
          ? "rate_limit"
          : error.status >= 500
            ? "provider_unavailable"
            : "validation"
    throw new SpeedWalletProviderError("Speed could not complete the wallet request.", {
      category,
      httpStatus: error.status,
      retryable: error.retryable,
      providerCode: error.providerCode,
      requestId: error.requestId,
    })
  }
  throw new SpeedWalletProviderError("Speed returned an invalid wallet response.", {
    category: "provider_unavailable",
    retryable: true,
    providerCode: "malformed_response",
  })
}

function speedProviderFailureDiagnostic(error: unknown): {
  httpStatus: number | null
  speedRequestId: string | null
  normalizedErrorCode: string
  category: SpeedWalletErrorCategory
  retryable: boolean
} {
  if (error instanceof SpeedApiError) {
    const category: SpeedWalletErrorCategory = error.status === 401
      ? "authentication"
      : error.status === 403
        ? "permission"
        : error.status === 429
          ? "rate_limit"
          : error.status >= 500
            ? "provider_unavailable"
            : "validation"
    return {
      httpStatus: error.status,
      speedRequestId: error.requestId,
      normalizedErrorCode: error.providerCode || `speed_http_${error.status}`,
      category,
      retryable: error.retryable,
    }
  }
  if (error instanceof SpeedTransportError) {
    return {
      httpStatus: null,
      speedRequestId: null,
      normalizedErrorCode: error.timedOut ? "timeout" : "transport_error",
      category: "provider_unavailable",
      retryable: true,
    }
  }
  if (error instanceof SpeedWalletProviderError) {
    return {
      httpStatus: error.httpStatus,
      speedRequestId: error.requestId,
      normalizedErrorCode: error.providerCode || error.category,
      category: error.category,
      retryable: error.retryable,
    }
  }
  return {
    httpStatus: null,
    speedRequestId: null,
    normalizedErrorCode: "malformed_response",
    category: "provider_unavailable",
    retryable: true,
  }
}

function accountSuffix(accountId: string): string {
  return String(accountId || "").trim().slice(-6)
}

function merchantContext(context: ConnectedAccountContext, operation: string) {
  const connectedAccountId = String(context.speedAccountId || "").trim()
  if (!connectedAccountId) {
    throw new SpeedWalletProviderError("Speed connected account is missing.", {
      category: "permission",
      retryable: false,
      providerCode: "connected_account_missing",
    })
  }
  return { merchantId: context.merchantId, connectedAccountId, operation }
}

function assertNonNegativeAmount(value: unknown, field: string): string | number {
  if (typeof value !== "number" && typeof value !== "string") throw new Error(`Invalid ${field}`)
  const text = String(value).trim()
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error(`Invalid ${field}`)
  return value
}

export type ConnectedAccountContext = {
  merchantId: string
  speedAccountId: string
}

// ---------------------------------------------------------------------------
// Balances - GET /balances (apidocs.tryspeed.com/reference/balance-retrieve)
// ---------------------------------------------------------------------------

export type SpeedBalanceEntry = {
  amount: number | string
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
  try {
    const response = await speedRequest<SpeedBalanceObject>("/balances", {
      method: "GET",
      merchantContext: merchantContext(context, "balance.retrieve"),
    })
    if (response?.object !== "balance" || !Array.isArray(response.available) || response.available.length === 0) {
      throw new Error("Malformed balance")
    }
    for (const entry of response.available) {
      assertNonNegativeAmount(entry?.amount, "balance amount")
      if (!String(entry?.target_currency || "").trim()) throw new Error("Missing balance currency")
    }
    return response
  } catch (error) {
    providerError(error)
  }
}

// ---------------------------------------------------------------------------
// Transactions - GET /balance-transactions (transaction-list)
// ---------------------------------------------------------------------------

export type SpeedBalanceTransactionObject = {
  id: string
  object: "balance_transaction"
  amount: number | string
  fee: number | string
  net: number | string
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
  try {
    const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 100)
    const params = new URLSearchParams({ limit: String(limit) })
    if (input.cursor?.trim()) params.set("ending_before", input.cursor.trim())
    const response = await speedRequest<SpeedBalanceTransactionList>(`/balance-transactions?${params}`, {
      method: "GET",
      merchantContext: merchantContext(input, "transaction.list"),
    })
    if (response?.object !== "list" || typeof response.has_more !== "boolean" || !Array.isArray(response.data)) {
      throw new Error("Malformed transaction list")
    }
    for (const transaction of response.data) {
      if (!String(transaction?.id || "").trim() || !String(transaction?.target_currency || "").trim()) {
        throw new Error("Malformed transaction")
      }
      assertNonNegativeAmount(transaction.amount, "transaction amount")
      assertNonNegativeAmount(transaction.fee, "transaction fee")
      assertNonNegativeAmount(transaction.net, "transaction net")
      if (!Number.isFinite(Number(transaction.created)) || Number(transaction.created) <= 0) {
        throw new Error("Malformed transaction timestamp")
      }
    }
    return response
  } catch (error) {
    providerError(error)
  }
}

// ---------------------------------------------------------------------------
// Withdrawals / Payouts - POST /send (create-a-instant-send)
// ---------------------------------------------------------------------------

export type SpeedInstantSendObject = {
  id: string
  object?: "instant_send"
  status: string
  withdraw_id?: string | null
  amount: number | string
  currency: string
  target_amount: number | string
  target_currency: string
  fees: number | string
  speed_fee?: { percentage?: number | string; amount?: number | string }
  withdraw_method: string
  withdraw_type: string
  withdraw_request?: string
  failure_reason?: string | null
  explorer_link?: string | null
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
  correlationId?: string | null
  diagnostics?: {
    setSubstage?: (substage: string) => void
    setProviderAccountId?: (providerAccountId: string | null | undefined) => void
  }
}

export async function createConnectedAccountWithdrawal(
  input: CreateConnectedWithdrawalInput
): Promise<SpeedInstantSendObject> {
  requireCapability("withdrawals")
  try {
    const body = {
      amount: input.amount,
      currency: input.currency,
      target_currency: input.currency,
      withdraw_method: input.withdrawMethod,
      withdraw_request: input.withdrawRequest,
      ...(input.note?.trim() ? { note: input.note.trim().slice(0, 200) } : {}),
    }
    console.info("[pinetree-withdrawals] SPEED_SEND_REQUESTED", {
      correlationId: input.correlationId || null,
      merchantId: input.merchantId,
      providerAccountSuffix: accountSuffix(input.speedAccountId),
      destinationMethod: input.withdrawMethod === "onchain" ? "onchain" : "lightning",
      amountSats: input.amount,
      currency: input.currency,
      routeStage: "send_requested",
    })
    input.diagnostics?.setSubstage?.("send_request")
    const response = await speedRequestWithStatus<SpeedInstantSendObject>("/send", {
      method: "POST",
      body: JSON.stringify(body),
      merchantContext: merchantContext(input, "instant_send.create"),
    })
    console.info("[pinetree-withdrawals] SPEED_SEND_HTTP_RESPONSE", {
      correlationId: input.correlationId || null,
      merchantId: input.merchantId,
      providerAccountSuffix: accountSuffix(input.speedAccountId),
      endpointPath: "/send",
      destinationMethod: input.withdrawMethod === "onchain" ? "onchain" : "lightning",
      amountSats: input.amount,
      httpStatus: response.status,
      speedRequestId: response.requestId,
      routeStage: "send_http_response",
    })
    input.diagnostics?.setSubstage?.("provider_response_parse")
    const validated = validateInstantSend(response.data)
    console.info("[pinetree-withdrawals] SPEED_SEND_SUCCEEDED", {
      correlationId: input.correlationId || null,
      merchantId: input.merchantId,
      providerAccountSuffix: accountSuffix(input.speedAccountId),
      endpointPath: "/send",
      destinationMethod: input.withdrawMethod === "onchain" ? "onchain" : "lightning",
      amountSats: input.amount,
      status: validated.status,
      providerReferencePresent: Boolean(validated.id),
      speedRequestId: response.requestId,
      routeStage: "send_succeeded",
    })
    return validated
  } catch (error) {
    const diagnostic = speedProviderFailureDiagnostic(error)
    const sendStage = error instanceof SpeedTransportError && error.timedOut
      ? "SPEED_SEND_TIMEOUT"
      : error instanceof SpeedApiError
        ? "SPEED_SEND_PROVIDER_REJECTED"
        : diagnostic.normalizedErrorCode === "malformed_response"
          ? "SPEED_SEND_PARSE_FAILED"
          : "SPEED_SEND_FAILED"
    if (sendStage === "SPEED_SEND_TIMEOUT") input.diagnostics?.setSubstage?.("send_timeout")
    else if (sendStage === "SPEED_SEND_PROVIDER_REJECTED") input.diagnostics?.setSubstage?.("provider_rejected")
    else if (sendStage === "SPEED_SEND_PARSE_FAILED") input.diagnostics?.setSubstage?.("provider_response_parse")
    console.warn(`[pinetree-withdrawals] ${sendStage}`, {
      correlationId: input.correlationId || null,
      merchantId: input.merchantId,
      providerAccountSuffix: accountSuffix(input.speedAccountId),
      endpointPath: "/send",
      destinationMethod: input.withdrawMethod === "onchain" ? "onchain" : "lightning",
      amountSats: input.amount,
      httpStatus: diagnostic.httpStatus,
      speedRequestId: diagnostic.speedRequestId,
      normalizedErrorCode: diagnostic.normalizedErrorCode,
      providerErrorCategory: diagnostic.category,
      retryable: diagnostic.retryable,
      routeStage: sendStage.toLowerCase().replace(/^speed_/, ""),
    })
    console.warn("[pinetree-withdrawals] SPEED_SEND_FAILED", {
      correlationId: input.correlationId || null,
      merchantId: input.merchantId,
      providerAccountSuffix: accountSuffix(input.speedAccountId),
      destinationMethod: input.withdrawMethod === "onchain" ? "onchain" : "lightning",
      amountSats: input.amount,
      httpStatus: diagnostic.httpStatus,
      speedRequestId: diagnostic.speedRequestId,
      normalizedErrorCode: diagnostic.normalizedErrorCode,
      providerErrorCategory: diagnostic.category,
      retryable: diagnostic.retryable,
      routeStage: "send_failed",
    })
    providerError(error)
  }
}

export type CreateConnectedPayoutInput = CreateConnectedWithdrawalInput

export async function createConnectedAccountPayout(
  input: CreateConnectedPayoutInput
): Promise<SpeedInstantSendObject> {
  requireCapability("payouts")
  void input
  throw new SpeedWalletCapabilityUnavailableError("payouts", "provider_not_supported")
}

export type GetPayoutOrWithdrawalStatusInput = ConnectedAccountContext & {
  providerSendId: string
}

export async function getConnectedAccountSendStatus(
  input: GetPayoutOrWithdrawalStatusInput
): Promise<SpeedInstantSendObject> {
  requireCapability("payoutStatus")
  try {
    const id = String(input.providerSendId || "").trim()
    if (!id) throw new SpeedWalletProviderError("Missing Instant Send reference.", {
      category: "validation",
      retryable: false,
      providerCode: "send_id_missing",
    })
    const response = await speedRequest<SpeedInstantSendObject>(`/send/${encodeURIComponent(id)}`, {
      method: "GET",
      merchantContext: merchantContext(input, "instant_send.retrieve"),
    })
    return validateInstantSend(response)
  } catch (error) {
    providerError(error)
  }
}

function validateInstantSend(response: SpeedInstantSendObject): SpeedInstantSendObject {
  if (!response || !String(response.id || "").trim() || !String(response.status || "").trim()) {
    throw new Error("Malformed Instant Send response")
  }
  assertNonNegativeAmount(response.amount, "Instant Send amount")
  assertNonNegativeAmount(response.fees, "Instant Send fee")
  if (!String(response.currency || "").trim()) throw new Error("Missing Instant Send currency")
  return response
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
  throw new SpeedWalletCapabilityUnavailableError("manualSwap", "provider_not_supported")
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
  throw new SpeedWalletCapabilityUnavailableError("manualSwap", "provider_not_supported")
}

export type GetSwapStatusInput = ConnectedAccountContext & {
  providerSwapId: string
}

export async function getConnectedAccountSwapStatus(input: GetSwapStatusInput): Promise<SpeedSwapObject> {
  requireCapability("manualSwap")
  void input
  throw new SpeedWalletCapabilityUnavailableError("manualSwap", "provider_not_supported")
}
