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
import { minorUnitsToShift4Amount } from "../money"
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
  /** Integer minor units. Serialized once at this provider boundary. */
  amountMinor: number
  /** Integer minor units. Required by Shift4; zero is explicit. */
  taxAmountMinor: number
  tipAmountMinor?: number
  surchargeAmountMinor?: number
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

  const currency = String(input.currencyCode || "USD").toUpperCase()
  const amount: Shift4Amount = {
    total: minorUnitsToShift4Amount(input.amountMinor, currency),
    tax: minorUnitsToShift4Amount(input.taxAmountMinor, currency, { allowZero: true }),
  }
  if (input.tipAmountMinor !== undefined) {
    amount.tip = minorUnitsToShift4Amount(input.tipAmountMinor, currency, { allowZero: true })
  }
  if (input.surchargeAmountMinor !== undefined) {
    amount.surcharge = minorUnitsToShift4Amount(input.surchargeAmountMinor, currency, {
      allowZero: true,
    })
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
    request.currencyCode = currency
  }
  if (input.apiOptions && input.apiOptions.length > 0) {
    request.apiOptions = input.apiOptions
  }

  return request
}
