/**
 * Commerce Engine For Cloud transaction request builders.
 *
 * SOURCE: `transactions_sale_comengcloud`, `transactions_authorization_comeng-
 * cloud` and `transactions_refund_comengcloud` in the Shift4 Payment API
 * OpenAPI 3.1 spec v1.7.58.
 *
 * Documented `required` sets, transcribed exactly:
 *
 *   sale / authorization : [dateTime, amount, clerk, transaction, device]
 *   refund               : [dateTime, amount, clerk, transaction, card, device]
 *   amount               : [total, tax]
 *   clerk                : [numericId]
 *   transaction          : [invoice, purchaseCard]   (sale/authorization)
 *   transaction          : [invoice]                 (refund)
 *   card                 : [present]                 (refund)
 *   device               : [cloud, manufacturer, serialNumber]
 *
 * ── No cardholder data, by construction ──────────────────────────────────────
 * There is no PAN, expiry, CSC, track, PIN, PIN block, KSN, or P2PE field in
 * any type in this file, and none in the documented Cloud variant either. The
 * card is read AT THE DEVICE; that is the entire point of Commerce Engine. A
 * PineTree type that could hold cardholder data would be a PCI liability with
 * no purpose, so none exists.
 *
 * ── purchaseCard is required, supplied, and validated here ───────────────────
 * `transaction.purchaseCard` is required by the sale, authorization and manual-
 * authorization schemas. An earlier revision omitted it and reported it as an
 * unresolved question for Shift4; that was wrong. The caller supplies it from
 * `engine/shift4/purchaseCardData.ts`, which derives all three fields from real
 * PineTree merchant and payment data, and this builder enforces the documented
 * limits. It is NOT added to refund, whose Cloud variant does not require it.
 *
 * SECURITY: pure. No I/O, no credential, no environment read.
 */

import {
  SHIFT4_PURCHASE_CARD_LIMITS,
  shift4RequiresPurchaseCard,
  type Shift4CloudDevice,
} from "./contract"
import { Shift4CloudRequestError, buildShift4CloudDeviceStatusRequest } from "./deviceStatus"

/** Operations that carry a documented Commerce Engine For Cloud body. */
export type Shift4CloudTransactionOperation =
  | "sale"
  | "authorization"
  | "refund"
  | "manual_authorization"

/** Level 2 purchasing-card data, as the schema publishes it. */
export type Shift4CloudPurchaseCard = Readonly<{
  customerReference: string
  destinationPostalCode: string
  productDescriptors: readonly string[]
}>

export type Shift4CloudAmount = Readonly<{
  total: number
  tax: number
}>

export type Shift4CloudClerk = Readonly<{ numericId: number }>

export type Shift4CloudTransactionBlock = Readonly<{
  invoice: string
  notes?: string
  /** Six characters, alphanumeric. Manual-authorization requests only. */
  authorizationCode?: string
  purchaseCard?: Shift4CloudPurchaseCard
}>

export type Shift4CloudCard = Readonly<{ present: "Y" | "N" }>

export type Shift4CloudTransactionRequest = Readonly<{
  dateTime: string
  amount: Shift4CloudAmount
  clerk: Shift4CloudClerk
  transaction: Shift4CloudTransactionBlock
  device: Shift4CloudDevice
  card?: Shift4CloudCard
}>

export type Shift4CloudTransactionBuild = Readonly<{
  operation: Shift4CloudTransactionOperation
  endpoint: string
  body: Shift4CloudTransactionRequest
}>

const ENDPOINTS: Record<Shift4CloudTransactionOperation, string> = {
  sale: "/transactions/sale",
  authorization: "/transactions/authorization",
  refund: "/transactions/refund",
  manual_authorization: "/transactions/manualauthorization",
}

/** Documented max length of `transaction.invoice`. */
const INVOICE_MAX_LENGTH = 10

/** Documented max length of `transaction.authorizationCode`. */
const AUTHORIZATION_CODE_PATTERN = /^[A-Z0-9]{6}$/

/**
 * Validate Level 2 purchasing-card data against the documented limits.
 *
 * Enforced here as well as at the factory because this is the last point before
 * the wire: a caller assembling the object by hand still cannot exceed a limit.
 */
function assertPurchaseCard(purchaseCard: Shift4CloudPurchaseCard): Shift4CloudPurchaseCard {
  const customerReference = String(purchaseCard.customerReference || "").trim()
  const destinationPostalCode = String(purchaseCard.destinationPostalCode || "").trim()
  const productDescriptors = (purchaseCard.productDescriptors ?? []).map((entry) =>
    String(entry || "").trim()
  ).filter(Boolean)

  if (!customerReference || customerReference.length > SHIFT4_PURCHASE_CARD_LIMITS.customerReference) {
    throw new Shift4CloudRequestError(
      "transaction.purchaseCard.customerReference is required and must be at most 25 characters.",
      "invalid_purchase_card"
    )
  }
  if (
    !destinationPostalCode ||
    destinationPostalCode.length > SHIFT4_PURCHASE_CARD_LIMITS.destinationPostalCode
  ) {
    throw new Shift4CloudRequestError(
      "transaction.purchaseCard.destinationPostalCode is required and must be at most 9 characters.",
      "invalid_purchase_card"
    )
  }
  if (
    productDescriptors.length < 1 ||
    productDescriptors.length > SHIFT4_PURCHASE_CARD_LIMITS.productDescriptorCount ||
    productDescriptors.some((entry) => entry.length > SHIFT4_PURCHASE_CARD_LIMITS.productDescriptor)
  ) {
    throw new Shift4CloudRequestError(
      "transaction.purchaseCard.productDescriptors must contain one to four entries of at most 40 characters.",
      "invalid_purchase_card"
    )
  }

  return Object.freeze({
    customerReference,
    destinationPostalCode,
    productDescriptors: Object.freeze(productDescriptors),
  })
}

/**
 * Shift4 amounts are major-unit decimals (the spec's examples are `160`, `15`).
 * PineTree stores minor units, so conversion happens here once rather than at
 * each call site, where a missed division would silently send 100x the amount.
 */
export function shift4CloudAmountFromMinor(amountMinor: number): number {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new Shift4CloudRequestError(
      "Amounts must be supplied as a non-negative integer number of minor units.",
      "invalid_serial_number"
    )
  }
  return Number((amountMinor / 100).toFixed(2))
}

export function buildShift4CloudTransactionRequest(input: {
  operation: Shift4CloudTransactionOperation
  dateTime: string
  totalMinor: number
  taxMinor: number
  clerkNumericId: number
  invoice: string
  device: { manufacturer: string; serialNumber: string }
  /** Refund is card-present at the device; the spec requires `card.present`. */
  cardPresent?: boolean
  notes?: string
  /** Required for sale, authorization and manual authorization. */
  purchaseCard?: Shift4CloudPurchaseCard
  /** Six alphanumeric characters. Manual authorization only. */
  authorizationCode?: string
}): Shift4CloudTransactionBuild {
  // Reuse the device-status builder's validation so `device` is constructed and
  // validated in exactly one place. Its dateTime rule is the same rule.
  const validated = buildShift4CloudDeviceStatusRequest({
    dateTime: input.dateTime,
    manufacturer: input.device.manufacturer,
    serialNumber: input.device.serialNumber,
  })

  const invoice = String(input.invoice || "").trim()
  if (!invoice || invoice.length > INVOICE_MAX_LENGTH) {
    throw new Shift4CloudRequestError(
      `transaction.invoice is required and must be at most ${INVOICE_MAX_LENGTH} characters.`,
      "invalid_serial_number"
    )
  }

  if (!Number.isInteger(input.clerkNumericId) || input.clerkNumericId < 0) {
    throw new Shift4CloudRequestError(
      "clerk.numericId is required and must be a non-negative integer.",
      "invalid_serial_number"
    )
  }

  // purchaseCard is added only where the SELECTED schema requires it. Refund's
  // Cloud variant does not, and blindly attaching it would send a field the
  // documented body does not define.
  const needsPurchaseCard = shift4RequiresPurchaseCard(input.operation)
  if (needsPurchaseCard && !input.purchaseCard) {
    throw new Shift4CloudRequestError(
      `Shift4 ${input.operation} requires transaction.purchaseCard.`,
      "invalid_purchase_card"
    )
  }

  let authorizationCode: string | undefined
  if (input.operation === "manual_authorization") {
    authorizationCode = String(input.authorizationCode || "").trim().toUpperCase()
    if (!AUTHORIZATION_CODE_PATTERN.test(authorizationCode)) {
      throw new Shift4CloudRequestError(
        "transaction.authorizationCode must be exactly six alphanumeric characters.",
        "invalid_authorization_code"
      )
    }
  } else if (input.authorizationCode) {
    // Only manual authorization carries a voice approval code; attaching one
    // elsewhere would misrepresent how the transaction was approved.
    throw new Shift4CloudRequestError(
      "transaction.authorizationCode is only valid for manual authorization.",
      "invalid_authorization_code"
    )
  }

  const transaction: Shift4CloudTransactionBlock = Object.freeze({
    invoice,
    ...(input.notes ? { notes: input.notes } : {}),
    ...(authorizationCode ? { authorizationCode } : {}),
    ...(needsPurchaseCard && input.purchaseCard
      ? { purchaseCard: assertPurchaseCard(input.purchaseCard) }
      : {}),
  })

  const body: Shift4CloudTransactionRequest = Object.freeze({
    dateTime: validated.dateTime,
    amount: Object.freeze({
      total: shift4CloudAmountFromMinor(input.totalMinor),
      tax: shift4CloudAmountFromMinor(input.taxMinor),
    }),
    clerk: Object.freeze({ numericId: input.clerkNumericId }),
    transaction,
    device: validated.device,
    // `card.present` is documented as required for refund only. It is not added
    // to sale/authorization, where the spec does not require it.
    ...(input.operation === "refund"
      ? { card: Object.freeze({ present: (input.cardPresent === false ? "N" : "Y") as "Y" | "N" }) }
      : {}),
  })

  return Object.freeze({
    operation: input.operation,
    endpoint: ENDPOINTS[input.operation],
    body,
  })
}
