/**
 * Shift4 Payment Platform REST API - error taxonomy.
 *
 * The client distinguishes five outcomes so PineTree Engine never has to guess:
 *
 *   1. transport failure   -> Shift4RestTransportError (outcomeUncertain=false)
 *   2. timeout             -> Shift4RestTransportError (timedOut=true, outcomeUncertain=true)
 *   3. structured provider error / decline -> Shift4RestApiError
 *   4. invalid response    -> Shift4RestInvalidResponseError
 *   5. success             -> a normalized result, never an error
 *
 * A timeout or a documented communication error code is an UNKNOWN outcome, not
 * a failure: the transaction may have been approved by the issuer before the
 * failure occurred. Resolution requires an Invoice Information lookup.
 * See docs: guides/response-handling/timeouts-and-communications-failures.
 *
 * SECURITY: no error in this module may carry a credential, a raw request body,
 * or an unredacted provider payload. Diagnostics are attached only after being
 * passed through redact.ts.
 */

/**
 * Communication error codes listed verbatim in Shift4's "Timeouts And
 * Communication Failures" guide. Receiving one of these means the transaction
 * outcome is unknown and the invoice must be checked.
 */
export const SHIFT4_COMMUNICATION_ERROR_CODES: readonly number[] = [
  1001, 2011, 4003, 9012, 9018, 9020, 9023, 9033,
  9489, 9901, 9902, 9951, 9957, 9960, 9961, 9962, 9964, 9978,
] as const

const COMMUNICATION_ERROR_CODE_SET = new Set<number>(SHIFT4_COMMUNICATION_ERROR_CODES)

export function isShift4CommunicationErrorCode(code: unknown): boolean {
  const numeric = typeof code === "number" ? code : Number.parseInt(String(code ?? ""), 10)
  return Number.isFinite(numeric) && COMMUNICATION_ERROR_CODE_SET.has(numeric)
}

/** Non-secret diagnostics attached to a Shift4 error. Already redacted. */
export type Shift4ErrorDiagnostics = {
  operation?: string
  invoice?: string | null
  correlationId?: string | null
  merchantId?: string | null
  merchantProviderConnectionId?: string | null
  pineTreePaymentId?: string | null
  pineTreePaymentAttemptId?: string | null
  httpStatus?: number | null
  elapsedMs?: number | null
  serverName?: string | null
  /** Redacted response summary. Never a raw provider payload. */
  responseSummary?: string | null
}

export class Shift4RestError extends Error {
  readonly diagnostics: Shift4ErrorDiagnostics

  constructor(message: string, diagnostics: Shift4ErrorDiagnostics = {}) {
    super(message)
    this.name = "Shift4RestError"
    this.diagnostics = diagnostics
  }
}

/**
 * The request never produced a usable HTTP response: DNS/TLS/socket failure, or
 * the Global Timer elapsed.
 *
 * `outcomeUncertain` is true whenever the request may already have reached
 * Shift4 (any timeout after dispatch). Such a request must NOT be blindly
 * resent; the invoice must be looked up first.
 */
export class Shift4RestTransportError extends Shift4RestError {
  readonly timedOut: boolean
  readonly outcomeUncertain: boolean

  constructor(
    message: string,
    options: { timedOut: boolean; outcomeUncertain: boolean; diagnostics?: Shift4ErrorDiagnostics }
  ) {
    super(message, options.diagnostics)
    this.name = "Shift4RestTransportError"
    this.timedOut = options.timedOut
    this.outcomeUncertain = options.outcomeUncertain
  }
}

/**
 * Shift4 returned a structured `error` object (documented fields: code,
 * severity, shortText, longText, primaryCode, secondaryCode).
 *
 * `communicationFailure` marks the documented communication error codes, whose
 * transaction outcome is unknown rather than failed.
 */
export class Shift4RestApiError extends Shift4RestError {
  readonly code: number | null
  readonly severity: string | null
  readonly shortText: string | null
  readonly longText: string | null
  readonly primaryCode: number | null
  readonly secondaryCode: number | null
  readonly communicationFailure: boolean
  readonly invoiceNotFound: boolean

  constructor(
    message: string,
    options: {
      code?: number | null
      severity?: string | null
      shortText?: string | null
      longText?: string | null
      primaryCode?: number | null
      secondaryCode?: number | null
      invoiceNotFound?: boolean
      diagnostics?: Shift4ErrorDiagnostics
    }
  ) {
    super(message, options.diagnostics)
    this.name = "Shift4RestApiError"
    this.code = options.code ?? null
    this.severity = options.severity ?? null
    this.shortText = options.shortText ?? null
    this.longText = options.longText ?? null
    this.primaryCode = options.primaryCode ?? null
    this.secondaryCode = options.secondaryCode ?? null
    this.communicationFailure = isShift4CommunicationErrorCode(this.code)
    this.invoiceNotFound = Boolean(options.invoiceNotFound)
  }
}

/**
 * A 2xx response whose body does not match the documented envelope
 * (`{ result: [ ... ] }`). Treated as an unknown outcome for transaction
 * operations - never as success and never as a decline.
 */
export class Shift4RestInvalidResponseError extends Shift4RestError {
  constructor(message: string, diagnostics: Shift4ErrorDiagnostics = {}) {
    super(message, diagnostics)
    this.name = "Shift4RestInvalidResponseError"
  }
}

/**
 * True when the error leaves the transaction outcome genuinely unknown, so the
 * caller must resolve it through an Invoice Information lookup instead of
 * recording a failure.
 */
export function isShift4UnknownOutcomeError(error: unknown): boolean {
  if (error instanceof Shift4RestTransportError) return error.outcomeUncertain
  if (error instanceof Shift4RestApiError) return error.communicationFailure
  if (error instanceof Shift4RestInvalidResponseError) return true
  return false
}

/**
 * Text Shift4 returns for an invoice that is absent, voided, or already
 * batched and settled. Documented on GET /transactions/invoice.
 */
export const SHIFT4_INVOICE_NOT_FOUND_TEXT = "Invoice Not Found"

export function looksLikeInvoiceNotFound(...texts: (string | null | undefined)[]): boolean {
  return texts.some((text) =>
    String(text || "").trim().toLowerCase().includes(SHIFT4_INVOICE_NOT_FOUND_TEXT.toLowerCase())
  )
}

/** Log-safe description of any Shift4 error. Contains no secrets. */
export function describeShift4Error(error: unknown): Record<string, unknown> {
  if (error instanceof Shift4RestApiError) {
    return {
      kind: "api_error",
      code: error.code,
      severity: error.severity,
      shortText: error.shortText,
      primaryCode: error.primaryCode,
      secondaryCode: error.secondaryCode,
      communicationFailure: error.communicationFailure,
      invoiceNotFound: error.invoiceNotFound,
      unknownOutcome: isShift4UnknownOutcomeError(error),
      ...error.diagnostics,
    }
  }
  if (error instanceof Shift4RestTransportError) {
    return {
      kind: "transport_error",
      timedOut: error.timedOut,
      outcomeUncertain: error.outcomeUncertain,
      unknownOutcome: isShift4UnknownOutcomeError(error),
      ...error.diagnostics,
    }
  }
  if (error instanceof Shift4RestInvalidResponseError) {
    return {
      kind: "invalid_response",
      unknownOutcome: true,
      ...error.diagnostics,
    }
  }
  if (error instanceof Shift4RestError) {
    return { kind: "shift4_error", unknownOutcome: false, ...error.diagnostics }
  }
  // Unknown throwables contribute a classification only - never a message that
  // could embed an upstream payload.
  return { kind: "unclassified_error", unknownOutcome: false }
}
