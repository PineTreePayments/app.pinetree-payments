/**
 * Shared request construction for the tokenized Shift4 transaction operations.
 *
 * PineTree sends exactly one card shape: the Global Token Vault / i4Go token
 * (`card.token.value`). The spec also defines variants carrying `card.number`,
 * track data, PIN blocks, and encrypted device blobs. PineTree must never
 * populate those - raw cardholder data goes from the customer browser directly
 * into Shift4's i4Go iframe and never through PineTree - so the input type here
 * offers no way to express them.
 *
 * `dateTime`, `amount.total`, `amount.tax`, `clerk.numericId`, and
 * `transaction.invoice` are all REQUIRED by the official schema. `amount.tax`
 * has no default in the spec, so the caller must supply it explicitly; a sale
 * with no tax sends 0 deliberately rather than by omission.
 */

import { assertValidShift4Invoice } from "../invoices/invoiceReference"
import { formatShift4DateTime } from "../dateTime"
import { Shift4RestApiError } from "../errors"
import type {
  Shift4Amount,
  Shift4CardOnFile,
  Shift4CustomerBlock,
  Shift4Operation,
  Shift4SecurityCodeIndicator,
  Shift4TokenTransactionRequest,
} from "../types"

/**
 * Card-not-present verification data PineTree may forward.
 *
 * `securityCode.value` is the CSC the CUSTOMER typed into the i4Go iframe.
 * PineTree never receives it, so this field exists only for completeness of the
 * type and must be left undefined by every PineTree call path. The indicator is
 * safe: it merely states whether a code was collected.
 */
export type Shift4TokenCardInput = {
  tokenValue: string
  /** MMYY, as an integer, per the official `card.expirationDate` field. */
  expirationDate?: number
  present?: boolean
  securityCodeIndicator?: Shift4SecurityCodeIndicator
}

export type Shift4TransactionRequestInput = {
  invoice: string
  /** Major currency units. Mapped to `amount.total`. */
  total: number
  /** Major currency units. Mapped to `amount.tax`. Required by Shift4. */
  tax: number
  tip?: number
  surcharge?: number
  /** Mapped to `clerk.numericId`. Required by Shift4. */
  clerkNumericId: number
  card: Shift4TokenCardInput
  customer?: Shift4CustomerBlock
  cardOnFile?: Shift4CardOnFile
  /** ISO 4217 alphabetic code, mapped to `currencyCode`. */
  currencyCode?: string
  /** Mapped to `transaction.notes`. Never used for secrets or card data. */
  notes?: string
  apiOptions?: string[]
  requestedAt?: Date
  merchantTimeZone?: string
}

function assertNonNegativeAmount(value: number, label: string, operation: Shift4Operation): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Shift4RestApiError(`Shift4 ${operation} requires a numeric ${label}.`, {
      diagnostics: { operation },
    })
  }
  if (value < 0) {
    throw new Shift4RestApiError(`Shift4 ${operation} requires ${label} to be zero or greater.`, {
      diagnostics: { operation },
    })
  }
  // Shift4's amount fields carry at most two decimal places for USD; rounding
  // here prevents a floating-point artifact from being sent as the amount.
  return Math.round(value * 100) / 100
}

export function buildTokenTransactionRequest(
  operation: Shift4Operation,
  input: Shift4TransactionRequestInput
): Shift4TokenTransactionRequest {
  const invoice = assertValidShift4Invoice(input.invoice)

  const tokenValue = String(input.card?.tokenValue || "").trim()
  if (!tokenValue) {
    throw new Shift4RestApiError(
      `Shift4 ${operation} requires a tokenized card value. PineTree never sends raw card data.`,
      { diagnostics: { operation, invoice } }
    )
  }

  if (!Number.isInteger(input.clerkNumericId)) {
    throw new Shift4RestApiError(`Shift4 ${operation} requires an integer clerk.numericId.`, {
      diagnostics: { operation, invoice },
    })
  }

  const amount: Shift4Amount = {
    total: assertNonNegativeAmount(input.total, "amount.total", operation),
    tax: assertNonNegativeAmount(input.tax, "amount.tax", operation),
  }
  if (input.tip !== undefined) {
    amount.tip = assertNonNegativeAmount(input.tip, "amount.tip", operation)
  }
  if (input.surcharge !== undefined) {
    amount.surcharge = assertNonNegativeAmount(input.surcharge, "amount.surcharge", operation)
  }

  const request: Shift4TokenTransactionRequest = {
    dateTime: formatShift4DateTime(input.requestedAt ?? new Date(), input.merchantTimeZone),
    amount,
    clerk: { numericId: input.clerkNumericId },
    transaction: { invoice },
    card: {
      token: { value: tokenValue },
    },
  }

  if (input.card.expirationDate !== undefined) {
    request.card.expirationDate = input.card.expirationDate
  }
  if (input.card.present !== undefined) {
    request.card.present = input.card.present ? "Y" : "N"
  }
  if (input.notes) {
    request.transaction.notes = input.notes
  }
  if (input.cardOnFile) {
    request.transaction.cardOnFile = input.cardOnFile
  }
  if (input.customer) {
    request.customer = input.customer
  }
  if (input.currencyCode) {
    request.currencyCode = String(input.currencyCode).toUpperCase()
  }
  if (input.apiOptions && input.apiOptions.length > 0) {
    request.apiOptions = input.apiOptions
  }

  return request
}
