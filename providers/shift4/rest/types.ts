/**
 * Shift4 Payment Platform REST API - wire types.
 *
 * Every field here is transcribed from the official OpenAPI description
 * (Shift4 Payment API v1.7.57, https://docs.shift4.com/apis/payments-platform-rest/openapi).
 * No property name is invented. Optional properties reflect the spec's
 * `required` lists; readOnly response fields are typed as optional because
 * Shift4 omits them when they do not apply.
 *
 * These types are provider-internal. They must never appear in a PineTree UI
 * component, a PineTree API response body, or a canonical Engine type - the
 * boundary is `Shift4NormalizedOperationResult` in normalizeResponse.ts.
 */

/* ────────────────────────────────────────────────────────────────────────────
   Shared response envelope

   Every documented operation returns `{ result: [ ... ] }` - a single-element
   array in practice. 400 and 504 responses use the same envelope with an
   `error` object instead of transaction data.
   ──────────────────────────────────────────────────────────────────────────── */

export type Shift4Envelope<T> = {
  result?: T[]
}

/** Documented severity levels for `error.severity`. */
export type Shift4ErrorSeverity = "Info" | "Error" | "Alert"

export type Shift4ErrorObject = {
  /** Error code. Note: documented as only supported for European merchant processing. */
  code?: number
  severity?: Shift4ErrorSeverity
  shortText?: string
  longText?: string
  primaryCode?: number
  secondaryCode?: number
}

export type Shift4Server = {
  name?: string
}

export type Shift4ErrorResult = {
  error?: Shift4ErrorObject
  lighthouse?: { data?: string }
  server?: Shift4Server
}

/* ────────────────────────────────────────────────────────────────────────────
   Credentials - POST /credentials/accesstoken
   ──────────────────────────────────────────────────────────────────────────── */

export type Shift4AccessTokenExchangeRequest = {
  /** ISO 8601 with timezone offset, sent as the merchant's LOCAL date/time. */
  dateTime: string
  credential: {
    /** writeOnly. Single-use in production. Never stored, never logged. */
    authToken: string
    /** writeOnly. The certified interface identifier. */
    clientGuid: string
  }
}

export type Shift4AccessTokenExchangeResult = {
  dateTime?: string
  credential?: {
    /** readOnly. The merchant-scoped credential for all subsequent requests. */
    accessToken?: string
  }
  server?: Shift4Server
  error?: Shift4ErrorObject
}

/* ────────────────────────────────────────────────────────────────────────────
   Transaction response codes
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * `transaction.responseCode` - the Shift4 host response.
 *
 *   A  Approved
 *   C  Approved without additional authorization (within the ceiling amount)
 *   D  Declined
 *   e  Error condition
 *   f  AVS or CSC failure (only when the POSHANDLEAVSFAIL ApiOption was sent)
 *   P  Partial approval - check amount.total for the approved amount
 *   R  Voice referral required
 *   X  Error - card expired
 *   S  SCA online PIN required
 *   I  SCA interface switch required
 *   J  Soft decline after an exemption request
 *
 * A BLANK or absent responseCode means the approval status is UNKNOWN. It must
 * never be treated as an approval or as a failure.
 */
export type Shift4TransactionResponseCode =
  | "A" | "C" | "D" | "e" | "f" | "P" | "R" | "X" | "S" | "I" | "J"

/** `transaction.saleFlag`: A = authorization, C = capture, S = sale. */
export type Shift4SaleFlag = "A" | "C" | "S"

/** `transaction.authSource`. */
export type Shift4AuthSource = "E" | "O" | "A" | "F"

/**
 * `card.entryMode`. Documented values:
 * 1 = manual/keyed, 2 = swiped, C = chip/contact EMV, E = ecommerce,
 * M = manual, Q = QR, R = contactless/RFID.
 */
export type Shift4CardEntryMode = "1" | "2" | "C" | "E" | "M" | "Q" | "R"

/** `card.type`. */
export type Shift4CardType =
  | "AX" | "AP" | "BC" | "CI" | "DB" | "GC" | "JC"
  | "MC" | "NS" | "PL" | "SC" | "VS" | "WP" | "YC"

/** `transaction.avs.result`. */
export type Shift4AvsResult =
  | "A" | "E" | "G" | "N" | "R" | "S" | "U" | "W" | "X" | "Y" | "Z"
  | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8"

/** `card.securityCode.result` (CSC/CVV verification outcome). */
export type Shift4SecurityCodeResult =
  | "M" | "N" | "P" | "S" | "U" | "Y" | "1" | "2" | "3"

/** `card.securityCode.indicator` (writeOnly request field). */
export type Shift4SecurityCodeIndicator = "0" | "1" | "2" | "9"

/* ────────────────────────────────────────────────────────────────────────────
   Transaction request/response objects
   ──────────────────────────────────────────────────────────────────────────── */

export type Shift4Amount = {
  total: number
  tax: number
  taxIndicator?: "Y" | "N"
  cashback?: number
  surcharge?: number
  tip?: number
  tipBasis?: number
}

export type Shift4Clerk = {
  numericId: number
}

/**
 * Card-on-file indicator values, per the Card On File transactions guide.
 * S01/S02 = stored credential setup; U01-U09 = subsequent stored-credential use.
 */
export type Shift4CardOnFileType =
  | "S01" | "S02" | "U01" | "U02" | "U03" | "U04" | "U05" | "U06" | "U07" | "U08" | "U09"

export type Shift4CardOnFile = {
  type?: Shift4CardOnFileType
  recurringExpiry?: string
  recurringFrequency?: string
  /** Store this from the original approval and send it on subsequent COF requests. */
  transactionId?: string
  transactionLinkId?: string
}

/**
 * Level 2 purchasing-card data.
 *
 * Documented limits, transcribed from the OpenAPI:
 *   customerReference      max 25
 *   destinationPostalCode  max 9
 *   productDescriptors     1-4 entries, each max 40
 *
 * Required by the sale, authorization and manual-authorization schemas (both the
 * Commerce Engine For Cloud and GTV-token variants). NOT part of the capture,
 * refund, void, or invoice-information schemas.
 */
export type Shift4PurchaseCard = {
  customerReference: string
  destinationPostalCode: string
  productDescriptors: string[]
}

export type Shift4TransactionRequestBlock = {
  /** Max 10 characters. The correlation key for every subsequent operation. */
  invoice: string
  notes?: string
  businessDate?: string
  cardOnFile?: Shift4CardOnFile
  /** Six-character voice approval code; manual-authorization requests only. */
  authorizationCode?: string
  /** Required by the sale/authorization/manual-authorization schemas. */
  purchaseCard?: Shift4PurchaseCard
}

/**
 * The tokenized card block (Global Token Vault / i4Go token).
 *
 * This is the ONLY card shape PineTree sends. The spec also defines variants
 * carrying `card.number`, track data, and encrypted device blobs; PineTree must
 * never populate those, because raw cardholder data must go directly from the
 * customer browser into Shift4's i4Go iframe and never through PineTree.
 */
export type Shift4TokenCard = {
  token: { value: string }
  expirationDate?: number
  present?: "Y" | "N"
  /**
   * Only the INDICATOR is expressible. The spec also defines
   * `securityCode.value`, but PineTree never possesses a CSC: the customer types
   * it directly into Shift4's i4Go iframe, which returns a token. Omitting the
   * field from this type makes it structurally impossible for PineTree code to
   * place cardholder verification data in a request.
   */
  securityCode?: {
    indicator: Shift4SecurityCodeIndicator
  }
}

export type Shift4CustomerBlock = {
  addressLine1?: string
  firstName?: string
  lastName?: string
  postalCode?: string
  emailAddress?: string
  ipAddress?: string
}

/** Request body for authorization, capture, sale, and refund using a GTV token. */
export type Shift4TokenTransactionRequest = {
  dateTime: string
  amount: Shift4Amount
  clerk: Shift4Clerk
  transaction: Shift4TransactionRequestBlock
  card: Shift4TokenCard
  customer?: Shift4CustomerBlock
  currencyCode?: string
  apiOptions?: string[]
}

/**
 * Voice-authorization contact details.
 *
 * Certification retail test 7 states that `voiceCenter.accountNumber` and
 * `voiceCenter.phoneNumber` are returned so a clerk can telephone for approval
 * after a referral. Typed as OPTIONAL and parsed defensively: the block is not
 * present on an ordinary approval, and PineTree has no documentation fixing
 * which response shapes carry it. Both are non-secret contact details — the
 * account number here is a MERCHANT account reference, never a card number.
 */
export type Shift4VoiceCenterBlock = {
  accountNumber?: string
  phoneNumber?: string
}

export type Shift4TransactionResponseBlock = {
  authorizationCode?: string
  authSource?: Shift4AuthSource
  invoice?: string
  responseCode?: Shift4TransactionResponseCode | ""
  retrievalReference?: string
  saleFlag?: Shift4SaleFlag
  avs?: { result?: Shift4AvsResult }
  cardOnFile?: Shift4CardOnFile
  hostResponse?: {
    reasonCode?: string
    reasonDescription?: string
    reattemptPermission?: string
  }
  deferredAuth?: "D"
}

export type Shift4CardResponseBlock = {
  entryMode?: Shift4CardEntryMode
  type?: Shift4CardType
  present?: "Y" | "N"
  levelResult?: string
  /** Shift4 returns a masked value here. PineTree never logs or persists it. */
  number?: string
  expirationDate?: number
  token?: { value?: string }
  securityCode?: { result?: Shift4SecurityCodeResult; valid?: string }
  balance?: { amount?: number }
  debitType?: string
}

/** Successful transaction result body. Shared by authorization/capture/sale/refund. */
export type Shift4TransactionResult = {
  dateTime?: string
  amount?: Partial<Shift4Amount>
  card?: Shift4CardResponseBlock
  customer?: { firstName?: string; lastName?: string }
  clerk?: Shift4Clerk
  device?: { terminalId?: string }
  merchant?: {
    mid?: number
    name?: string
    cardTypes?: string[]
    voiceCenter?: Shift4VoiceCenterBlock
  }
  transaction?: Shift4TransactionResponseBlock
  server?: Shift4Server
  universalToken?: { value?: string }
  receipt?: { key?: string; printName?: string; printValue?: string }[]
  error?: Shift4ErrorObject
  lighthouse?: { data?: string }
}

/** GET /transactions/invoice returns the same result shape. */
export type Shift4InvoiceInformationResult = Shift4TransactionResult

/** DELETE /transactions/invoice (Void) returns the same result shape. */
export type Shift4VoidResult = Shift4TransactionResult

/* ────────────────────────────────────────────────────────────────────────────
   PineTree operation identifiers
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * The approved Shift4 REST operations for this integration. Each maps to
 * exactly one documented endpoint.
 */
export type Shift4Operation =
  | "access_token_exchange"
  | "authorization"
  | "manual_authorization"
  | "capture"
  | "sale"
  | "refund"
  | "invoice_information"
  | "merchant_information"
  | "void"
  /**
   * Commerce Engine For Cloud device status. Published for Commerce Engine On
   * Premise and Commerce Engine For Cloud only — there is no Host Direct server
   * for this path. Read-only: it moves no money and creates no transaction.
   */
  | "device_status"

export const SHIFT4_OPERATION_ENDPOINTS: Record<
  Shift4Operation,
  { method: "GET" | "POST" | "DELETE"; path: string }
> = {
  access_token_exchange: { method: "POST", path: "/credentials/accesstoken" },
  authorization: { method: "POST", path: "/transactions/authorization" },
  manual_authorization: { method: "POST", path: "/transactions/manualauthorization" },
  capture: { method: "POST", path: "/transactions/capture" },
  sale: { method: "POST", path: "/transactions/sale" },
  refund: { method: "POST", path: "/transactions/refund" },
  invoice_information: { method: "GET", path: "/transactions/invoice" },
  merchant_information: { method: "GET", path: "/merchants/merchant" },
  void: { method: "DELETE", path: "/transactions/invoice" },
  device_status: { method: "POST", path: "/devices/getstatus" },
} as const

/**
 * Operations that create or modify money movement. These must never be retried
 * automatically. Shift4 permits resending only after an Invoice Information
 * lookup returns "Invoice Not Found", and then only with the same invoice.
 */
export const SHIFT4_TRANSACTION_CREATING_OPERATIONS: readonly Shift4Operation[] = [
  "authorization", "manual_authorization", "capture", "sale", "refund", "void",
] as const

/**
 * Read-only operations. None creates or modifies a transaction.
 *
 * "Safely repeatable" describes the operation, not PineTree's policy: the only
 * automatic retry in this integration is the documented single Invoice
 * Information retry. `device_status` is explicitly never retried automatically
 * — one operator action sends exactly one request.
 */
export const SHIFT4_IDEMPOTENT_LOOKUP_OPERATIONS: readonly Shift4Operation[] = [
  "invoice_information", "merchant_information", "device_status",
] as const

export function isShift4TransactionCreatingOperation(operation: Shift4Operation): boolean {
  return SHIFT4_TRANSACTION_CREATING_OPERATIONS.includes(operation)
}
