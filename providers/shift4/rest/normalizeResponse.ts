/**
 * Shift4 Payment Platform REST API - normalized result model.
 *
 * This module is the boundary between raw Shift4 responses and PineTree. The
 * Engine consumes `Shift4NormalizedOperationResult` and nothing else; Shift4
 * wire types never travel further inward.
 *
 * LIFECYCLE RULE: this module classifies provider EVIDENCE. It does not decide
 * PineTree payment state. There is no mapping here to CONFIRMED, FAILED, or any
 * other canonical status - the Engine owns those transitions. In particular:
 *   - an HTTP 200 does not prove approval;
 *   - a blank `transaction.responseCode` is UNKNOWN, not failure;
 *   - a timeout or documented communication error is UNKNOWN, not failure.
 */

import { createHash } from "node:crypto"

import {
  looksLikeInvoiceNotFound,
  type Shift4ErrorDiagnostics,
} from "./errors"
import { redactShift4Payload } from "./redact"
import type {
  Shift4AvsResult,
  Shift4CardEntryMode,
  Shift4Envelope,
  Shift4ErrorObject,
  Shift4Operation,
  Shift4SaleFlag,
  Shift4SecurityCodeResult,
  Shift4TransactionResponseCode,
  Shift4TransactionResult,
} from "./types"

/**
 * Provider-evidence classification. Deliberately NOT a PineTree payment status.
 *
 *   approved          responseCode A or C
 *   partial_approval  responseCode P - only amount.total was approved
 *   declined          responseCode D
 *   referral          responseCode R - voice authorization required
 *   verification_failed  responseCode f - AVS/CSC failure
 *   authentication_required  responseCode S or I - SCA needed
 *   soft_declined     responseCode J - exemption rejected
 *   provider_error    responseCode e or X, or a structured non-communication error
 *   unknown           blank/absent responseCode, timeout, documented
 *                     communication error code, or an invalid response body.
 *                     Requires an Invoice Information lookup to resolve.
 *   not_found         Shift4 reports the invoice as absent/voided/settled
 */
export type Shift4Outcome =
  | "approved"
  | "partial_approval"
  | "declined"
  | "referral"
  | "verification_failed"
  | "authentication_required"
  | "soft_declined"
  | "provider_error"
  | "unknown"
  | "not_found"

/** Card-entry channel classification derived from `card.entryMode`/`card.present`. */
export type Shift4EntryChannel =
  | "keyed"
  | "swiped"
  | "emv_contact"
  | "contactless"
  | "ecommerce"
  | "qr"
  | "unknown"

export type Shift4NormalizedOperationResult = {
  operation: Shift4Operation

  /** PineTree correlation. Present on every result. */
  correlationId: string
  invoice: string | null
  merchantProviderConnectionId: string | null
  pineTreePaymentId: string | null
  pineTreePaymentAttemptId: string | null

  /** Evidence classification. Never a PineTree payment status. */
  outcome: Shift4Outcome
  /** True when the outcome must be resolved by an invoice lookup, not recorded. */
  requiresInvoiceResolution: boolean

  /** Raw Shift4 host response code, preserved verbatim (may be an empty string). */
  responseCode: Shift4TransactionResponseCode | "" | null
  /** `error.primaryCode` / `error.secondaryCode`. */
  primaryCode: number | null
  secondaryCode: number | null
  /** `error.code`, `error.severity`, `error.shortText`, `error.longText`. */
  errorCode: number | null
  errorSeverity: string | null
  responseText: string | null
  responseDetailText: string | null

  /** Shift4 transaction identifiers. */
  authorizationCode: string | null
  retrievalReference: string | null
  saleFlag: Shift4SaleFlag | null
  cardOnFileTransactionId: string | null

  /**
   * Token reference returned by Shift4 (Global Token Vault token).
   * Required for capture and refund. Treated as sensitive: excluded from the
   * log-safe projection and redacted by redact.ts.
   */
  cardTokenValue: string | null

  /** Verification evidence. Non-sensitive and required for certification. */
  avsResult: Shift4AvsResult | null
  cscResult: Shift4SecurityCodeResult | null

  /** Card / channel classification. */
  entryMode: Shift4CardEntryMode | null
  entryChannel: Shift4EntryChannel
  cardType: string | null
  cardPresent: boolean | null

  /** Amounts Shift4 confirmed. Authoritative for partial approvals. */
  approvedAmount: number | null
  currencyCode: string | null

  /** Timestamps. */
  providerDateTime: string | null
  requestStartedAt: string
  requestCompletedAt: string
  elapsedMs: number

  /** Transport metadata. */
  httpStatus: number | null
  serverName: string | null
  timedOut: boolean

  /**
   * Secure reference to the raw response: a SHA-256 digest of the REDACTED
   * payload. The raw body itself is never stored here, so persisting or logging
   * this result cannot leak a provider payload. `redactedResponse` is the
   * redacted tree, provided for deliberate evidence capture by the Engine.
   */
  rawResponseRef: string | null
  redactedResponse: unknown
}

export type NormalizeShift4ResponseInput = {
  operation: Shift4Operation
  correlationId: string
  invoice?: string | null
  merchantProviderConnectionId?: string | null
  pineTreePaymentId?: string | null
  pineTreePaymentAttemptId?: string | null
  httpStatus: number | null
  requestStartedAt: Date
  requestCompletedAt: Date
  timedOut?: boolean
  /** Parsed response body, or null when there was no usable body. */
  body: unknown
  /** Forced classification for transport failures, where no body exists. */
  forcedOutcome?: Shift4Outcome
}

/**
 * Response codes that leave the transaction outcome unknown. A blank or absent
 * code is documented as "Status is unknown".
 */
function classifyResponseCode(code: string | null | undefined): Shift4Outcome | null {
  if (code === null || code === undefined) return null
  const value = String(code)
  if (value.trim() === "") return "unknown"
  switch (value) {
    case "A":
    case "C":
      return "approved"
    case "P":
      return "partial_approval"
    case "D":
      return "declined"
    case "R":
      return "referral"
    case "f":
      return "verification_failed"
    case "S":
    case "I":
      return "authentication_required"
    case "J":
      return "soft_declined"
    case "e":
    case "X":
      return "provider_error"
    default:
      // An undocumented code must never be optimistically approved.
      return "unknown"
  }
}

function classifyEntryChannel(
  entryMode: Shift4CardEntryMode | null,
  present: boolean | null
): Shift4EntryChannel {
  switch (entryMode) {
    case "1":
    case "M":
      return "keyed"
    case "2":
      return "swiped"
    case "C":
      return "emv_contact"
    case "R":
      return "contactless"
    case "E":
      return "ecommerce"
    case "Q":
      return "qr"
    default:
      if (present === false) return "ecommerce"
      return "unknown"
  }
}

function firstResult<T>(body: unknown): T | null {
  if (!body || typeof body !== "object") return null
  const envelope = body as Shift4Envelope<T>
  if (!Array.isArray(envelope.result) || envelope.result.length === 0) return null
  const entry = envelope.result[0]
  return entry && typeof entry === "object" ? entry : null
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function readText(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : ""
  return text === "" ? null : text
}

/**
 * True when the response body matches the documented `{ result: [...] }`
 * envelope. Anything else is an invalid response.
 */
export function isShift4Envelope(body: unknown): boolean {
  return Boolean(
    body &&
    typeof body === "object" &&
    Array.isArray((body as Shift4Envelope<unknown>).result)
  )
}

export function normalizeShift4Response(
  input: NormalizeShift4ResponseInput
): Shift4NormalizedOperationResult {
  const result = firstResult<Shift4TransactionResult>(input.body)
  const error: Shift4ErrorObject | null = (result?.error as Shift4ErrorObject | undefined) ?? null
  const transaction = result?.transaction ?? null
  const card = result?.card ?? null

  const responseCodeRaw = transaction?.responseCode
  const responseCode =
    responseCodeRaw === undefined || responseCodeRaw === null
      ? null
      : (responseCodeRaw as Shift4TransactionResponseCode | "")

  const shortText = readText(error?.shortText)
  const longText = readText(error?.longText)
  const invoiceNotFound = looksLikeInvoiceNotFound(shortText, longText)

  let outcome: Shift4Outcome
  if (input.forcedOutcome) {
    outcome = input.forcedOutcome
  } else if (invoiceNotFound) {
    outcome = "not_found"
  } else {
    const fromCode = classifyResponseCode(responseCode)
    if (fromCode) {
      outcome = fromCode
    } else if (error) {
      // A structured error with no response code. Communication error codes are
      // unknown outcomes; every other error is a provider error.
      outcome = "provider_error"
    } else if (!isShift4Envelope(input.body)) {
      outcome = "unknown"
    } else {
      // Documented envelope, no responseCode and no error. Operations such as
      // Void report success through the HTTP status and the absence of `error`.
      outcome = input.httpStatus !== null && input.httpStatus >= 200 && input.httpStatus < 300
        ? "approved"
        : "unknown"
    }
  }

  const entryMode = (card?.entryMode as Shift4CardEntryMode | undefined) ?? null
  const cardPresent =
    card?.present === "Y" ? true : card?.present === "N" ? false : null

  const redactedResponse = input.body === undefined || input.body === null
    ? null
    : redactShift4Payload(input.body)

  const rawResponseRef = redactedResponse === null
    ? null
    : createHash("sha256").update(JSON.stringify(redactedResponse)).digest("hex")

  return {
    operation: input.operation,
    correlationId: input.correlationId,
    invoice: readText(transaction?.invoice) ?? readText(input.invoice) ?? null,
    merchantProviderConnectionId: input.merchantProviderConnectionId ?? null,
    pineTreePaymentId: input.pineTreePaymentId ?? null,
    pineTreePaymentAttemptId: input.pineTreePaymentAttemptId ?? null,

    outcome,
    requiresInvoiceResolution: outcome === "unknown",

    responseCode,
    primaryCode: readNumber(error?.primaryCode),
    secondaryCode: readNumber(error?.secondaryCode),
    errorCode: readNumber(error?.code),
    errorSeverity: readText(error?.severity),
    responseText: shortText ?? readText(transaction?.hostResponse?.reasonDescription),
    responseDetailText: longText,

    authorizationCode: readText(transaction?.authorizationCode),
    retrievalReference: readText(transaction?.retrievalReference),
    saleFlag: (transaction?.saleFlag as Shift4SaleFlag | undefined) ?? null,
    cardOnFileTransactionId: readText(transaction?.cardOnFile?.transactionId),

    cardTokenValue: readText(card?.token?.value),

    avsResult: (transaction?.avs?.result as Shift4AvsResult | undefined) ?? null,
    cscResult: (card?.securityCode?.result as Shift4SecurityCodeResult | undefined) ?? null,

    entryMode,
    entryChannel: classifyEntryChannel(entryMode, cardPresent),
    cardType: readText(card?.type),
    cardPresent,

    approvedAmount: readNumber(result?.amount?.total),
    currencyCode: null,

    providerDateTime: readText(result?.dateTime),
    requestStartedAt: input.requestStartedAt.toISOString(),
    requestCompletedAt: input.requestCompletedAt.toISOString(),
    elapsedMs: Math.max(0, input.requestCompletedAt.getTime() - input.requestStartedAt.getTime()),

    httpStatus: input.httpStatus,
    serverName: readText(result?.server?.name),
    timedOut: Boolean(input.timedOut),

    rawResponseRef,
    redactedResponse,
  }
}

/**
 * Log-safe projection of a normalized result.
 *
 * Retains only the safe operational evidence the integration standard permits:
 * PineTree identifiers, operation, invoice, correlation ID, Shift4 response
 * codes, timing, and the normalized outcome. The card token, redacted payload,
 * and raw digest are excluded.
 */
export function shift4ResultForLog(
  result: Shift4NormalizedOperationResult
): Record<string, unknown> {
  return {
    operation: result.operation,
    correlationId: result.correlationId,
    invoice: result.invoice,
    merchantProviderConnectionId: result.merchantProviderConnectionId,
    pineTreePaymentId: result.pineTreePaymentId,
    pineTreePaymentAttemptId: result.pineTreePaymentAttemptId,
    outcome: result.outcome,
    requiresInvoiceResolution: result.requiresInvoiceResolution,
    responseCode: result.responseCode,
    primaryCode: result.primaryCode,
    secondaryCode: result.secondaryCode,
    errorCode: result.errorCode,
    errorSeverity: result.errorSeverity,
    avsResult: result.avsResult,
    cscResult: result.cscResult,
    entryChannel: result.entryChannel,
    cardType: result.cardType,
    approvedAmount: result.approvedAmount,
    authorizationCode: result.authorizationCode ? "[present]" : null,
    httpStatus: result.httpStatus,
    timedOut: result.timedOut,
    elapsedMs: result.elapsedMs,
    serverName: result.serverName,
    rawResponseRef: result.rawResponseRef,
  }
}

/** Diagnostics shape shared with the error taxonomy. */
export function shift4ResultDiagnostics(
  result: Shift4NormalizedOperationResult
): Shift4ErrorDiagnostics {
  return {
    operation: result.operation,
    invoice: result.invoice,
    correlationId: result.correlationId,
    merchantProviderConnectionId: result.merchantProviderConnectionId,
    pineTreePaymentId: result.pineTreePaymentId,
    pineTreePaymentAttemptId: result.pineTreePaymentAttemptId,
    httpStatus: result.httpStatus,
    elapsedMs: result.elapsedMs,
    serverName: result.serverName,
  }
}
