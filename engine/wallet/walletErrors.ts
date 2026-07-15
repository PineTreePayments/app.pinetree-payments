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

export type WalletApiError = {
  ok: false
  error: {
    code: WalletApiErrorCode
    message: string
    retryable: boolean
  }
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
  WALLET_CAPABILITY_UNAVAILABLE: 422,
  WALLET_OPERATION_NOT_FOUND: 404,
  WALLET_VALIDATION_ERROR: 400,
  WALLET_PROVIDER_AUTHENTICATION_ERROR: 502,
  WALLET_PROVIDER_PERMISSION_ERROR: 502,
  WALLET_PROVIDER_RATE_LIMITED: 429,
  WALLET_PROVIDER_TIMEOUT: 504,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  IDEMPOTENCY_KEY_CONFLICT: 409,
  INSUFFICIENT_BALANCE: 422,
  INTERNAL_ERROR: 500,
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
