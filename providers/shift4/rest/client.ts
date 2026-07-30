/**
 * Shift4 Payment Platform REST API - the single shared server-only client.
 *
 * Every Shift4 REST call in PineTree goes through `shift4RestRequest`. It owns
 * URL selection, required headers, timeouts, response parsing, error
 * classification, and redaction. No route, component, engine module, or wrapper
 * may call fetch against Shift4 directly.
 *
 * ── Correlation ──────────────────────────────────────────────────────────────
 * Shift4 does not document a request-correlation header, and this integration
 * must never invent field names, so no custom header is sent. PineTree
 * correlation works in two documented ways instead:
 *   1. the INVOICE is the Shift4-side correlation key, deterministically
 *      derived from one PineTree payment attempt (see invoices/invoiceReference);
 *   2. a PineTree `correlationId` is attached to every log line and to the
 *      normalized result, joining PineTree records to the Shift4 invoice.
 * Whether Shift4 wants an additional correlation header is an open question for
 * Shift4 and is recorded as such rather than guessed at.
 *
 * ── Retry policy ─────────────────────────────────────────────────────────────
 * Transaction-creating operations (authorization, capture, sale, refund, void)
 * are NEVER retried automatically. Shift4 permits resending only after an
 * Invoice Information lookup returns "Invoice Not Found", and then only with the
 * same invoice number. That decision belongs to the Engine, not to this client.
 * Invoice Information is a read-only lookup; the guide explicitly allows one
 * retry, which is the only automatic retry implemented here.
 *
 * SECURITY: the AccessToken never appears in a log, an error, or a return value.
 */

import { randomUUID } from "node:crypto"

import {
  assertOpaqueCredential,
  getShift4RestConfig,
  SHIFT4_FIELD_LIMITS,
  type Shift4RestConfig,
} from "./config"
import {
  isShift4CommunicationErrorCode,
  looksLikeInvoiceNotFound,
  Shift4RestApiError,
  Shift4RestInvalidResponseError,
  Shift4RestTransportError,
  type Shift4ErrorDiagnostics,
} from "./errors"
import {
  isShift4Envelope,
  normalizeShift4Response,
  shift4ResultForLog,
  type Shift4NormalizedOperationResult,
} from "./normalizeResponse"
import { shift4SafeBodySummary } from "./redact"
import {
  isShift4TransactionCreatingOperation,
  SHIFT4_OPERATION_ENDPOINTS,
  type Shift4Envelope,
  type Shift4ErrorObject,
  type Shift4Operation,
  type Shift4TransactionResult,
} from "./types"

/**
 * Global Timer defaults, from "Timeouts And Communication Failures":
 *   - 120s when the card is entered on a UTG or Commerce Engine controlled PIN pad
 *   - 65s for all other card entry methods
 * The guide requires these be configurable, hence the env overrides.
 *
 * The lookup timeout is NOT specified by Shift4. 30s is a PineTree-chosen value
 * for a read-only call and is flagged as such rather than presented as official.
 */
export const SHIFT4_DEVICE_ENTRY_TIMEOUT_MS = 120_000
export const SHIFT4_STANDARD_ENTRY_TIMEOUT_MS = 65_000
export const SHIFT4_LOOKUP_TIMEOUT_MS = 30_000

/**
 * Documented delay before checking the invoice after a communication failure:
 * 1-3 seconds in production, 3-5 seconds in test.
 */
export const SHIFT4_RECOVERY_DELAY_MS = {
  production: { minMs: 1_000, maxMs: 3_000 },
  test: { minMs: 3_000, maxMs: 5_000 },
} as const

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = String(process.env[name] || "").trim()
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/** How the cardholder data reached PineTree, which selects the Global Timer. */
export type Shift4EntryContext = "device_pin_pad" | "standard"

export function shift4TimeoutForOperation(
  operation: Shift4Operation,
  entryContext: Shift4EntryContext = "standard"
): number {
  if (operation === "invoice_information") {
    return readPositiveIntEnv("SHIFT4_LOOKUP_TIMEOUT_MS", SHIFT4_LOOKUP_TIMEOUT_MS)
  }
  if (entryContext === "device_pin_pad") {
    return readPositiveIntEnv("SHIFT4_DEVICE_GLOBAL_TIMER_MS", SHIFT4_DEVICE_ENTRY_TIMEOUT_MS)
  }
  return readPositiveIntEnv("SHIFT4_GLOBAL_TIMER_MS", SHIFT4_STANDARD_ENTRY_TIMEOUT_MS)
}

/** PineTree context threaded through every request for correlation and logging. */
export type Shift4RequestContext = {
  correlationId?: string
  invoice?: string | null
  merchantId?: string | null
  merchantProviderConnectionId?: string | null
  pineTreePaymentId?: string | null
  pineTreePaymentAttemptId?: string | null
  entryContext?: Shift4EntryContext
}

export type Shift4RestRequestOptions = {
  operation: Shift4Operation
  /**
   * The merchant's Shift4 access token, already decrypted by the Engine.
   * Omitted only for `access_token_exchange`, which is unauthenticated.
   */
  accessToken?: string
  body?: unknown
  /** Extra documented header parameters (for example ApiOptions, ReversalReason). */
  headerParameters?: Record<string, string | number | undefined>
  context?: Shift4RequestContext
  config?: Shift4RestConfig
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export type Shift4RestRequestResult = {
  result: Shift4NormalizedOperationResult
  /** Present only when Shift4 returned a structured error object. */
  error: Shift4ErrorObject | null
}

/**
 * Build the headers Shift4 requires. Names are exactly as documented:
 * InterfaceVersion, InterfaceName, CompanyName, AccessToken. The Invoice header
 * is required by GET and DELETE /transactions/invoice.
 */
export function buildShift4Headers(input: {
  operation: Shift4Operation
  config: Shift4RestConfig
  accessToken?: string
  invoice?: string | null
  headerParameters?: Record<string, string | number | undefined>
  hasBody: boolean
}): Record<string, string> {
  const headers: Record<string, string> = {
    InterfaceVersion: input.config.identity.interfaceVersion,
    InterfaceName: input.config.identity.interfaceName,
    CompanyName: input.config.identity.companyName,
  }

  if (input.hasBody) {
    headers["Content-Type"] = "application/json"
  }

  if (input.operation !== "access_token_exchange") {
    const accessToken = String(input.accessToken || "").trim()
    if (!accessToken) {
      throw new Shift4RestApiError("Shift4 access token is not available for this merchant.", {
        diagnostics: { operation: input.operation },
      })
    }
    assertOpaqueCredential(accessToken, SHIFT4_FIELD_LIMITS.accessToken, "Shift4 access token")
    headers.AccessToken = accessToken
  }

  if (input.operation === "invoice_information" || input.operation === "void") {
    const invoice = String(input.invoice || "").trim()
    if (!invoice) {
      throw new Shift4RestApiError(
        `Shift4 ${input.operation} requires an invoice number in the Invoice header.`,
        { diagnostics: { operation: input.operation } }
      )
    }
    if (invoice.length > SHIFT4_FIELD_LIMITS.invoice) {
      throw new Shift4RestApiError(
        `Shift4 invoice exceeds the documented maximum of ${SHIFT4_FIELD_LIMITS.invoice} characters.`,
        { diagnostics: { operation: input.operation, invoice } }
      )
    }
    headers.Invoice = invoice
  }

  for (const [name, value] of Object.entries(input.headerParameters || {})) {
    if (value === undefined || value === null || String(value).trim() === "") continue
    headers[name] = String(value)
  }

  return headers
}

function parseShift4Body(text: string): { parsed: unknown; jsonParsed: boolean } {
  if (!text.trim()) return { parsed: null, jsonParsed: false }
  try {
    return { parsed: JSON.parse(text) as unknown, jsonParsed: true }
  } catch {
    return { parsed: null, jsonParsed: false }
  }
}

function firstErrorObject(body: unknown): Shift4ErrorObject | null {
  if (!body || typeof body !== "object") return null
  const envelope = body as Shift4Envelope<Shift4TransactionResult>
  if (!Array.isArray(envelope.result) || envelope.result.length === 0) return null
  const error = envelope.result[0]?.error
  return error && typeof error === "object" ? error : null
}

/**
 * Execute one Shift4 REST request.
 *
 * Throws:
 *   Shift4RestTransportError        - no usable response (timeout / network)
 *   Shift4RestInvalidResponseError  - 2xx body outside the documented envelope
 *   Shift4RestApiError              - configuration or hard provider error
 *
 * Returns a normalized result for every response that Shift4 answered with a
 * documented envelope - including declines, which are provider evidence rather
 * than exceptions.
 */
export async function shift4RestRequest(
  options: Shift4RestRequestOptions
): Promise<Shift4RestRequestResult> {
  const config = options.config ?? getShift4RestConfig()
  const endpoint = SHIFT4_OPERATION_ENDPOINTS[options.operation]
  const context = options.context ?? {}
  const correlationId = context.correlationId || randomUUID()
  const invoice = context.invoice ?? null
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? shift4TimeoutForOperation(options.operation, context.entryContext)

  // GET and DELETE /transactions/invoice explicitly do not support a request
  // body; sending an empty one may itself cause an error.
  const hasBody = options.body !== undefined && endpoint.method === "POST"

  const headers = buildShift4Headers({
    operation: options.operation,
    config,
    accessToken: options.accessToken,
    invoice,
    headerParameters: options.headerParameters,
    hasBody,
  })

  const diagnostics: Shift4ErrorDiagnostics = {
    operation: options.operation,
    invoice,
    correlationId,
    merchantId: context.merchantId ?? null,
    merchantProviderConnectionId: context.merchantProviderConnectionId ?? null,
    pineTreePaymentId: context.pineTreePaymentId ?? null,
    pineTreePaymentAttemptId: context.pineTreePaymentAttemptId ?? null,
  }

  const url = `${config.baseUrl}${endpoint.path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const requestStartedAt = new Date()

  let response: Response
  try {
    response = await fetchImpl(url, {
      method: endpoint.method,
      headers,
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    })
  } catch {
    const requestCompletedAt = new Date()
    const timedOut = controller.signal.aborted
    // A timeout after dispatch leaves the outcome UNKNOWN: the issuer may have
    // approved before the failure. It is never a proven failure.
    console.warn("[shift4-rest] transport_failure", {
      ...diagnostics,
      timedOut,
      elapsedMs: requestCompletedAt.getTime() - requestStartedAt.getTime(),
      outcomeClassification: timedOut ? "unknown_requires_invoice_lookup" : "transport_failure",
      transactionCreating: isShift4TransactionCreatingOperation(options.operation),
    })
    throw new Shift4RestTransportError(
      timedOut
        ? "Shift4 request exceeded the configured Global Timer."
        : "Shift4 REST API is temporarily unreachable.",
      {
        timedOut,
        // Only a dispatched-then-timed-out request has an uncertain outcome.
        // A pre-dispatch connection failure did not reach Shift4, but for a
        // transaction-creating operation PineTree still cannot prove that, so
        // uncertainty is retained for those.
        outcomeUncertain: timedOut || isShift4TransactionCreatingOperation(options.operation),
        diagnostics: {
          ...diagnostics,
          elapsedMs: requestCompletedAt.getTime() - requestStartedAt.getTime(),
        },
      }
    )
  } finally {
    clearTimeout(timer)
  }

  const rawText = await response.text().catch(() => "")
  const requestCompletedAt = new Date()
  const { parsed, jsonParsed } = parseShift4Body(rawText)

  // A 2xx response that is not the documented envelope is an invalid response,
  // not a success. For a transaction-creating operation this is an unknown
  // outcome that the Engine must resolve by invoice lookup.
  if (!jsonParsed || !isShift4Envelope(parsed)) {
    const summary = shift4SafeBodySummary(rawText)
    console.warn("[shift4-rest] invalid_response", {
      ...diagnostics,
      httpStatus: response.status,
      jsonParsed,
      elapsedMs: requestCompletedAt.getTime() - requestStartedAt.getTime(),
      outcomeClassification: "unknown_requires_invoice_lookup",
      responseSummary: summary,
    })
    throw new Shift4RestInvalidResponseError(
      "Shift4 returned a response outside the documented result envelope.",
      {
        ...diagnostics,
        httpStatus: response.status,
        elapsedMs: requestCompletedAt.getTime() - requestStartedAt.getTime(),
        responseSummary: summary,
      }
    )
  }

  const error = firstErrorObject(parsed)
  const normalized = normalizeShift4Response({
    operation: options.operation,
    correlationId,
    invoice,
    merchantProviderConnectionId: context.merchantProviderConnectionId ?? null,
    pineTreePaymentId: context.pineTreePaymentId ?? null,
    pineTreePaymentAttemptId: context.pineTreePaymentAttemptId ?? null,
    httpStatus: response.status,
    requestStartedAt,
    requestCompletedAt,
    body: parsed,
  })

  // Communication error codes leave the outcome unknown even though a
  // well-formed body was returned.
  if (error && isShift4CommunicationErrorCode(error.code)) {
    console.warn("[shift4-rest] communication_failure", {
      ...shift4ResultForLog(normalized),
      errorCode: error.code ?? null,
      outcomeClassification: "unknown_requires_invoice_lookup",
    })
    throw new Shift4RestApiError("Shift4 reported a communication failure.", {
      code: error.code ?? null,
      severity: error.severity ?? null,
      shortText: error.shortText ?? null,
      longText: error.longText ?? null,
      primaryCode: error.primaryCode ?? null,
      secondaryCode: error.secondaryCode ?? null,
      invoiceNotFound: looksLikeInvoiceNotFound(error.shortText, error.longText),
      diagnostics: {
        ...diagnostics,
        httpStatus: response.status,
        elapsedMs: normalized.elapsedMs,
        serverName: normalized.serverName,
      },
    })
  }

  console.info("[shift4-rest] operation_result", shift4ResultForLog(normalized))

  return { result: normalized, error }
}

/**
 * Invoice Information is the one safely repeatable operation. Shift4's guide
 * permits a single retry of a failed lookup before logging the transaction for
 * an auditor's review.
 */
export async function shift4LookupWithSingleRetry(
  options: Omit<Shift4RestRequestOptions, "operation">
): Promise<Shift4RestRequestResult> {
  try {
    return await shift4RestRequest({ ...options, operation: "invoice_information" })
  } catch (firstError) {
    const notFound = firstError instanceof Shift4RestApiError && firstError.invoiceNotFound
    if (notFound) {
      // "Invoice Not Found" is a definitive answer, not a failed lookup.
      throw firstError
    }
    console.warn("[shift4-rest] invoice_lookup_retry", {
      operation: "invoice_information",
      correlationId: options.context?.correlationId ?? null,
      invoice: options.context?.invoice ?? null,
      pineTreePaymentId: options.context?.pineTreePaymentId ?? null,
    })
    return await shift4RestRequest({ ...options, operation: "invoice_information" })
  }
}

/**
 * The documented wait before checking an invoice after a communication failure.
 * Exposed so the Engine's Phase 2 recovery sequence uses the official values
 * rather than an ad hoc delay.
 */
export function shift4RecoveryDelayMs(environment: "test" | "production"): number {
  const window = SHIFT4_RECOVERY_DELAY_MS[environment]
  return window.minMs + Math.floor(Math.random() * (window.maxMs - window.minMs + 1))
}
