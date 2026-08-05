/**
 * Bridge (by Stripe) - error taxonomy.
 *
 * The client distinguishes four outcomes so PineTree Engine never has to guess:
 *
 *   1. transport failure / timeout -> BridgeTransportError
 *   2. structured provider error   -> BridgeApiError
 *   3. invalid response            -> BridgeInvalidResponseError
 *   4. success                     -> a typed result, never an error
 *
 * A timeout is an UNKNOWN outcome, not a failure: Bridge may already have
 * created the customer or KYC link. Retrying with the SAME idempotency key is
 * the only safe resolution - never a fresh key, which would create a duplicate
 * Bridge customer.
 *
 * SECURITY: no error in this module may carry the API key, a raw request body,
 * a hosted onboarding URL, or unredacted KYB material. Diagnostics are attached
 * only after passing through redact.ts.
 */

/** Non-secret diagnostics attached to a Bridge error. Already redacted. */
export type BridgeErrorDiagnostics = {
  operation?: string
  correlationId?: string | null
  merchantId?: string | null
  merchantProviderConnectionId?: string | null
  idempotencyKeyPresent?: boolean
  httpStatus?: number | null
  elapsedMs?: number | null
  /** Bridge's own request identifier when the response carries one. */
  providerRequestId?: string | null
  /** Redacted response summary. Never a raw provider payload. */
  responseSummary?: string | null
}

export class BridgeError extends Error {
  readonly diagnostics: BridgeErrorDiagnostics

  constructor(message: string, diagnostics: BridgeErrorDiagnostics = {}) {
    super(message)
    this.name = "BridgeError"
    this.diagnostics = diagnostics
  }
}

/**
 * The request never produced a usable HTTP response: DNS/TLS/socket failure,
 * or the timeout elapsed.
 *
 * `outcomeUncertain` is true whenever the request may already have reached
 * Bridge. Such a request must NOT be resent with a new idempotency key.
 */
export class BridgeTransportError extends BridgeError {
  readonly timedOut: boolean
  readonly outcomeUncertain: boolean
  readonly retryable = true

  constructor(
    message: string,
    options: { timedOut: boolean; outcomeUncertain: boolean; diagnostics?: BridgeErrorDiagnostics }
  ) {
    super(message, options.diagnostics)
    this.name = "BridgeTransportError"
    this.timedOut = options.timedOut
    this.outcomeUncertain = options.outcomeUncertain
  }
}

/**
 * Bridge answered with a non-2xx status and (usually) a structured error body.
 *
 * `code` is Bridge's own error code where present. `retryable` marks 429 and
 * 5xx, which are safe to retry with the SAME idempotency key.
 */
export class BridgeApiError extends BridgeError {
  readonly httpStatus: number
  readonly code: string | null
  readonly retryable: boolean
  /** True when Bridge rejected the API key or the key lacks access. */
  readonly authenticationFailure: boolean

  constructor(
    message: string,
    options: {
      httpStatus: number
      code?: string | null
      diagnostics?: BridgeErrorDiagnostics
    }
  ) {
    super(message, options.diagnostics)
    this.name = "BridgeApiError"
    this.httpStatus = options.httpStatus
    this.code = options.code ?? null
    this.retryable = options.httpStatus === 429 || options.httpStatus >= 500
    this.authenticationFailure = options.httpStatus === 401 || options.httpStatus === 403
  }
}

/**
 * A 2xx response whose body is not usable JSON or does not carry the fields
 * the operation requires. Treated as an unknown outcome - never as success.
 */
export class BridgeInvalidResponseError extends BridgeError {
  readonly outcomeUncertain = true
  readonly retryable = true

  constructor(message: string, diagnostics: BridgeErrorDiagnostics = {}) {
    super(message, diagnostics)
    this.name = "BridgeInvalidResponseError"
  }
}

/**
 * True when the error leaves the provider-side outcome genuinely unknown, so
 * the caller must retry with the same idempotency key or re-read state rather
 * than recording a failure. A timeout is never proof that nothing happened.
 */
export function isBridgeUnknownOutcomeError(error: unknown): boolean {
  if (error instanceof BridgeTransportError) return error.outcomeUncertain
  if (error instanceof BridgeInvalidResponseError) return true
  return false
}

/**
 * True when retrying the identical request (same idempotency key) is
 * appropriate. A 4xx other than 429 is a verified provider rejection and is
 * never retried.
 */
export function isBridgeRetryableError(error: unknown): boolean {
  if (error instanceof BridgeTransportError) return true
  if (error instanceof BridgeInvalidResponseError) return true
  if (error instanceof BridgeApiError) return error.retryable
  return false
}

/** Log-safe description of any Bridge error. Contains no secrets. */
export function describeBridgeError(error: unknown): Record<string, unknown> {
  if (error instanceof BridgeApiError) {
    return {
      kind: "api_error",
      httpStatus: error.httpStatus,
      code: error.code,
      retryable: error.retryable,
      authenticationFailure: error.authenticationFailure,
      unknownOutcome: false,
      ...error.diagnostics,
    }
  }
  if (error instanceof BridgeTransportError) {
    return {
      kind: "transport_error",
      timedOut: error.timedOut,
      outcomeUncertain: error.outcomeUncertain,
      unknownOutcome: isBridgeUnknownOutcomeError(error),
      ...error.diagnostics,
    }
  }
  if (error instanceof BridgeInvalidResponseError) {
    return { kind: "invalid_response", unknownOutcome: true, ...error.diagnostics }
  }
  if (error instanceof BridgeError) {
    return { kind: "bridge_error", unknownOutcome: false, ...error.diagnostics }
  }
  // Unknown throwables contribute a classification only - never a message that
  // could embed an upstream payload.
  return { kind: "unclassified_error", unknownOutcome: false }
}
