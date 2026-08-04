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
 * ── The purchaseCard gap is reported, not papered over ───────────────────────
 * The spec marks `transaction.purchaseCard` required for sale and authorization
 * while its own retail example omits it. PineTree has no truthful source for
 * `customerReference` / `destinationPostalCode` / `productDescriptors` in an
 * ordinary retail sale. The builder therefore OMITS it and reports it through
 * `unresolvedRequiredFields`, so the gap reaches a human instead of being
 * filled with invented values.
 *
 * SECURITY: pure. No I/O, no credential, no environment read.
 */

import {
  SHIFT4_CLOUD_UNRESOLVED_REQUIRED_FIELDS,
  type Shift4CloudDevice,
} from "./contract"
import { Shift4CloudRequestError, buildShift4CloudDeviceStatusRequest } from "./deviceStatus"

/** Operations that carry a documented Commerce Engine For Cloud body. */
export type Shift4CloudTransactionOperation = "sale" | "authorization" | "refund"

export type Shift4CloudAmount = Readonly<{
  total: number
  tax: number
}>

export type Shift4CloudClerk = Readonly<{ numericId: number }>

export type Shift4CloudTransactionBlock = Readonly<{
  invoice: string
  notes?: string
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
  /**
   * Documented-required fields PineTree cannot supply truthfully yet. Non-empty
   * means this request is NOT ready to send, however healthy every gate is.
   */
  unresolvedRequiredFields: readonly string[]
}>

const ENDPOINTS: Record<Shift4CloudTransactionOperation, string> = {
  sale: "/transactions/sale",
  authorization: "/transactions/authorization",
  refund: "/transactions/refund",
}

/** Documented max length of `transaction.invoice`. */
const INVOICE_MAX_LENGTH = 10

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

  const transaction: Shift4CloudTransactionBlock = Object.freeze({
    invoice,
    ...(input.notes ? { notes: input.notes } : {}),
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
    unresolvedRequiredFields:
      input.operation === "refund"
        ? Object.freeze([])
        : SHIFT4_CLOUD_UNRESOLVED_REQUIRED_FIELDS,
  })
}
