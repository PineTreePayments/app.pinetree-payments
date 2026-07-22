/**
 * Stable response envelope and error codes for PineTree's generic wallet
 * API surface (app/api/wallets/{capabilities,balances,activity,operations,
 * withdrawals,payouts,swaps,preferences}/*). Every route in that surface
 * returns one of these two shapes - never a raw provider payload, never a
 * provider-specific error code (no SPEED_*), never a bare error string.
 */

export type WalletApiSuccess<T> = { ok: true; data: T }

export type WalletApiErrorCode =
  | "UNAUTHORIZED"
  | "WALLET_PROVIDER_NOT_CONFIGURED"
  | "WALLET_PROVIDER_NOT_READY"
  | "WALLET_PROVIDER_UNAVAILABLE"
  | "WALLET_CAPABILITY_UNAVAILABLE"
  | "WALLET_OPERATION_NOT_FOUND"
  | "WALLET_VALIDATION_ERROR"
  | "WALLET_PROVIDER_AUTHENTICATION_ERROR"
  | "WALLET_PROVIDER_PERMISSION_ERROR"
  | "WALLET_PROVIDER_RATE_LIMITED"
  | "WALLET_PROVIDER_TIMEOUT"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_KEY_CONFLICT"
  | "INSUFFICIENT_BALANCE"
  | "INTERNAL_ERROR"
  // Withdrawal-specific additions (engine/withdrawals/*) - kept in this same
  // taxonomy rather than a parallel one, so every wallet-surface route still
  // returns exactly one error shape.
  | "INVALID_DESTINATION"
  | "INVALID_AMOUNT"
  | "MINIMUM_AMOUNT"
  | "MAXIMUM_AMOUNT"
  | "NETWORK_FEE_TOO_HIGH"
  | "DESTINATION_NOT_CONFIGURED"
  | "DUPLICATE_WITHDRAWAL"
  | "WITHDRAWAL_ALREADY_PROCESSING"
  | "UNSUPPORTED_NETWORK"
  | "UNSUPPORTED_ASSET"
  | "UNSUPPORTED_RAIL"
  | "UNKNOWN_ERROR"
  // Browser-signer-specific additions - these describe the merchant's own
  // wallet/session/authorization state during Dynamic browser signing
  // (Base/Solana), a concern the original provider-facing codes above never
  // covered (they only describe the external provider's state).
  | "WALLET_NOT_CONNECTED"
  | "SIGNER_NOT_AVAILABLE"
  | "AUTHORIZATION_REJECTED"
  | "STATUS_UNKNOWN"
  | "WITHDRAWAL_FAILED"

export type WalletApiError = {
  ok: false
  error: {
    code: WalletApiErrorCode
    message: string
    retryable: boolean
  }
  correlationId?: string
}

export type WalletApiResponse<T> = WalletApiSuccess<T> | WalletApiError

export function walletOk<T>(data: T): WalletApiSuccess<T> {
  return { ok: true, data }
}

export function walletError(
  code: WalletApiErrorCode,
  message: string,
  retryable = false
): WalletApiError {
  return { ok: false, error: { code, message, retryable } }
}

const CODE_HTTP_STATUS: Record<WalletApiErrorCode, number> = {
  UNAUTHORIZED: 401,
  WALLET_PROVIDER_NOT_CONFIGURED: 409,
  WALLET_PROVIDER_NOT_READY: 409,
  WALLET_PROVIDER_UNAVAILABLE: 503,
  WALLET_CAPABILITY_UNAVAILABLE: 409,
  WALLET_OPERATION_NOT_FOUND: 404,
  WALLET_VALIDATION_ERROR: 400,
  WALLET_PROVIDER_AUTHENTICATION_ERROR: 503,
  WALLET_PROVIDER_PERMISSION_ERROR: 409,
  WALLET_PROVIDER_RATE_LIMITED: 429,
  WALLET_PROVIDER_TIMEOUT: 504,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  IDEMPOTENCY_KEY_CONFLICT: 409,
  INSUFFICIENT_BALANCE: 409,
  INTERNAL_ERROR: 500,
  INVALID_DESTINATION: 400,
  INVALID_AMOUNT: 400,
  MINIMUM_AMOUNT: 400,
  MAXIMUM_AMOUNT: 422,
  NETWORK_FEE_TOO_HIGH: 422,
  DESTINATION_NOT_CONFIGURED: 409,
  DUPLICATE_WITHDRAWAL: 409,
  WITHDRAWAL_ALREADY_PROCESSING: 409,
  UNSUPPORTED_NETWORK: 400,
  UNSUPPORTED_ASSET: 400,
  UNSUPPORTED_RAIL: 400,
  UNKNOWN_ERROR: 500,
  WALLET_NOT_CONNECTED: 409,
  SIGNER_NOT_AVAILABLE: 409,
  AUTHORIZATION_REJECTED: 409,
  STATUS_UNKNOWN: 202,
  WITHDRAWAL_FAILED: 500,
}

export function walletErrorHttpStatus(code: WalletApiErrorCode): number {
  return CODE_HTTP_STATUS[code] ?? 500
}

/**
 * Thrown by the generic wallet engine (engine/wallet/walletOperations.ts,
 * walletPreferences.ts, walletProviderResolution.ts) and caught at the
 * route boundary (lib/api/walletApiRoute.ts). Always carries a PineTree
 * error code - a provider adapter must translate its own errors into one of
 * these before they cross the adapter boundary; a raw provider error must
 * never reach a route or the browser.
 */
export class WalletApiRouteError extends Error {
  readonly code: WalletApiErrorCode
  readonly retryable: boolean

  constructor(code: WalletApiErrorCode, message: string, retryable = false) {
    super(message)
    this.name = "WalletApiRouteError"
    this.code = code
    this.retryable = retryable
  }
}
