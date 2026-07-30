/**
 * Shift4 Payment Platform REST API - server-only provider module.
 *
 * PineTree boundary:
 *   Interface/UI -> PineTree API -> PineTree Engine -> THIS ADAPTER -> Shift4
 *
 * The UI never imports from here. The Engine consumes only
 * `Shift4NormalizedOperationResult`; Shift4 wire types stay inside this module.
 *
 * This module does not touch the database - per PineTree architecture, providers
 * communicate with external APIs and nothing else. Credential persistence lives
 * in engine/shift4Connection.ts and database/merchantProviders.ts.
 */

/**
 * Public surface of the Shift4 REST provider module.
 *
 * Deliberately narrower than the sum of the files: `assertOpaqueCredential`,
 * `resolveShift4Environment`, `getShift4ClientGuid`, and
 * `buildAccessTokenExchangeRequest` are internal implementation details and are
 * not re-exported, so no caller outside this directory can reach a credential
 * primitive or bypass `getShift4RestConfig`.
 */

export {
  SHIFT4_REST_TEST_BASE_URL,
  SHIFT4_REST_PRODUCTION_BASE_URL,
  SHIFT4_FIELD_LIMITS,
  Shift4ConfigError,
  getShift4RestConfig,
  shift4BaseUrlForEnvironment,
  describeShift4RestConfiguration,
  type Shift4RestEnvironment,
  type Shift4RestConfig,
  type Shift4InterfaceIdentity,
  type Shift4IntegrationMethod,
} from "./config"

export { formatShift4DateTime } from "./dateTime"

export {
  SHIFT4_COMMUNICATION_ERROR_CODES,
  SHIFT4_INVOICE_NOT_FOUND_TEXT,
  Shift4RestError,
  Shift4RestApiError,
  Shift4RestTransportError,
  Shift4RestInvalidResponseError,
  isShift4CommunicationErrorCode,
  isShift4UnknownOutcomeError,
  looksLikeInvoiceNotFound,
  describeShift4Error,
  type Shift4ErrorDiagnostics,
} from "./errors"

export {
  SHIFT4_REDACTED,
  redactShift4Headers,
  redactShift4Payload,
  shift4SafeBodySummary,
  containsShift4Secret,
} from "./redact"

export {
  SHIFT4_OPERATION_ENDPOINTS,
  SHIFT4_TRANSACTION_CREATING_OPERATIONS,
  isShift4TransactionCreatingOperation,
  type Shift4Operation,
  type Shift4TransactionResponseCode,
  type Shift4AvsResult,
  type Shift4SecurityCodeResult,
  type Shift4CardEntryMode,
  type Shift4CardOnFileType,
} from "./types"

export {
  normalizeShift4Response,
  isShift4Envelope,
  shift4ResultForLog,
  type Shift4NormalizedOperationResult,
  type Shift4Outcome,
  type Shift4EntryChannel,
} from "./normalizeResponse"

export {
  SHIFT4_DEVICE_ENTRY_TIMEOUT_MS,
  SHIFT4_STANDARD_ENTRY_TIMEOUT_MS,
  SHIFT4_LOOKUP_TIMEOUT_MS,
  SHIFT4_RECOVERY_DELAY_MS,
  buildShift4Headers,
  shift4RestRequest,
  shift4LookupWithSingleRetry,
  shift4RecoveryDelayMs,
  shift4TimeoutForOperation,
  type Shift4RequestContext,
  type Shift4EntryContext,
  type Shift4RestRequestResult,
} from "./client"

export {
  SHIFT4_INVOICE_LENGTH,
  createInvoiceReference,
  assertValidShift4Invoice,
  invoiceMatchesReference,
  type Shift4InvoiceReference,
  type Shift4InvoicePurpose,
} from "./invoices/invoiceReference"

export { getInvoice, type Shift4InvoiceLookup } from "./invoices/getInvoice"
export { voidInvoice, type Shift4VoidReason } from "./invoices/voidInvoice"

export {
  exchangeAccessToken,
  shift4AccessTokenFingerprint,
  type Shift4AccessTokenExchangeOutcome,
} from "./credentials/exchangeAccessToken"

export {
  encryptShift4AccessToken,
  decryptShift4AccessToken,
  isShift4EncryptedSecret,
  Shift4CredentialCryptoError,
  type Shift4EncryptedSecret,
} from "./credentials/secretEnvelope"

export {
  authorize,
  capture,
  sale,
  refund,
  type Shift4TransactionCallInput,
} from "./transactions"

export {
  buildTokenTransactionRequest,
  type Shift4TransactionRequestInput,
  type Shift4TokenCardInput,
} from "./transactions/request"
