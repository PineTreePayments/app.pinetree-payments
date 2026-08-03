/**
 * The ONE admin transaction view model.
 *
 * Every admin surface that opens a transaction — Overview, Transaction
 * Explorer, Reports, search results, support references, future diagnostics —
 * consumes this exact shape. It mirrors the payload of
 * `GET /api/admin/transactions/:id`, which is produced by
 * `getAdminTransactionDetailEngine` from the canonical projector. No surface
 * may define its own transaction-detail type or re-map these fields.
 */

import type {
  CanonicalLifecycleEvent,
  CanonicalTransaction,
  CanonicalTransactionAttempt,
  CanonicalTransactionDiagnostic,
} from "@/engine/canonicalTransactions"

/**
 * The canonical payment as it crosses the API boundary. Structurally the
 * engine's `CanonicalTransaction`; the fields are listed explicitly so the
 * presentation layer's contract stays visible at the boundary it renders.
 */
export type AdminTransactionDetailPayment = Pick<
  CanonicalTransaction,
  | "paymentId"
  | "attemptId"
  | "merchantId"
  | "providerReference"
  | "transactionHash"
  | "rail"
  | "network"
  | "asset"
  | "currency"
  | "amountMinor"
  | "displayAmount"
  | "canonicalStatus"
  | "displayStatus"
  | "occurredAt"
  | "createdAt"
  | "updatedAt"
  | "confirmedAt"
  | "source"
  | "paymentSource"
  | "provider"
  | "channel"
  | "paymentMode"
  | "adjustmentStatus"
  | "adjustedAt"
  | "merchantAmountMinor"
  | "grossAmountMinor"
  | "feeAmountMinor"
  | "subtotalAmountMinor"
  | "transactionAmountMinor"
  | "metadata"
> & {
  // Evidence collections are optional so a narrower admin surface (a search
  // result, a support reference) can pass a lighter payload without forking
  // the type. The panel simply hides the sections it has no evidence for.
  lifecycleEvents?: CanonicalLifecycleEvent[]
  attempts?: CanonicalTransactionAttempt[]
  diagnostics?: CanonicalTransactionDiagnostic[]
  raw?: Partial<CanonicalTransaction["raw"]>
}

/** Audit evidence rows from `payment_events` for this payment. */
export type AdminTransactionDetailEvent = {
  id: string
  event_type: string
  provider_event: string | null
  raw_payload: unknown
  created_at: string
}

export type AdminTransactionDetailMerchant = {
  id: string
  email: string | null
  business_name: string | null
}

/** Exactly the `GET /api/admin/transactions/:id` response body. */
export type AdminTransactionDetail = {
  payment: AdminTransactionDetailPayment
  events: AdminTransactionDetailEvent[]
  merchant: AdminTransactionDetailMerchant | null
}

/**
 * Optional sections. Every admin entry point renders the same component; a
 * surface may hide an internal region, but it can never restyle or re-map one.
 */
export type AdminTransactionDetailSections = {
  showTimeline?: boolean
  showWatcherEvents?: boolean
  showDiagnostics?: boolean
  showProviderMetadata?: boolean
  showAttemptHistory?: boolean
}

export const ADMIN_TRANSACTION_DETAIL_SECTION_DEFAULTS: Required<AdminTransactionDetailSections> = {
  showTimeline: true,
  showWatcherEvents: true,
  showDiagnostics: true,
  showProviderMetadata: true,
  showAttemptHistory: true,
}
