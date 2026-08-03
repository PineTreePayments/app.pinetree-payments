/**
 * The ONE admin transaction formatting/field-mapping module.
 *
 * Money, dates, event labels and metadata extraction for admin transaction
 * detail all live here. `AdminTransactionDetailPanel` is the only consumer;
 * admin pages never format a transaction field themselves.
 *
 * Provider/rail/network/source NAMING is not owned here — it is shared with
 * every other Admin surface via components/admin/displayFormatters.
 */

import {
  formatProviderName,
  formatRailName,
} from "@/components/admin/displayFormatters"
import type {
  AdminTransactionDetailEvent,
  AdminTransactionDetailPayment,
} from "./types"

// ─── Money & time ──────────────────────────────────────────────────────────────

/** Minor units → the payment's own currency. One money formatter, everywhere. */
export function formatAdminMoney(minor: number | null | undefined, currency = "USD"): string {
  const amount = Number(minor ?? 0) / 100
  const code = String(currency || "USD").trim().toUpperCase() || "USD"
  if (/^[A-Z]{3}$/.test(code)) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: code,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount)
    } catch {
      // Fall through to a stable non-ISO representation.
    }
  }
  return `${amount.toFixed(2)} ${code}`.trim()
}

export function formatAdminDateTime(iso: string | null | undefined): string {
  const value = String(iso || "").trim()
  if (!value) return "—"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "—"
  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

// ─── Payment field mapping ─────────────────────────────────────────────────────

export function adminPaymentGrossMinor(payment: AdminTransactionDetailPayment): number {
  return payment.grossAmountMinor ?? payment.amountMinor ?? 0
}

export function adminPaymentMerchantMinor(payment: AdminTransactionDetailPayment): number {
  return payment.merchantAmountMinor ?? 0
}

export function adminPaymentFeeMinor(payment: AdminTransactionDetailPayment): number {
  return payment.feeAmountMinor ?? 0
}

export function adminPaymentCreatedAt(payment: AdminTransactionDetailPayment): string {
  return payment.occurredAt || payment.createdAt || ""
}

export function adminPaymentUpdatedAt(payment: AdminTransactionDetailPayment): string {
  return payment.updatedAt || adminPaymentCreatedAt(payment)
}

/** The on-chain hash when one exists, otherwise the provider's own reference. */
export function adminPaymentReference(payment: AdminTransactionDetailPayment): string | null {
  return payment.transactionHash || payment.providerReference || null
}

/**
 * How the payment originated. The label is read straight off the canonical
 * record — the UI never re-derives it from `channel` or metadata. A response
 * that somehow arrives without the field (a stale in-flight response during a
 * rollout) reads "Unknown source" rather than being guessed at.
 */
export function adminPaymentSourceLabel(payment: AdminTransactionDetailPayment): string {
  return payment.paymentSource?.label || "Unknown source"
}

/**
 * Rail label. `rail` is the canonical, already-resolved rail ("Bitcoin
 * Lightning", "Base", "Card"…); `network` is only consulted for legacy rows
 * the projector could not resolve. Both go through the rail vocabulary, so a
 * rail is never labelled with a provider's product name.
 */
export function adminPaymentRailLabel(payment: AdminTransactionDetailPayment): string {
  return formatRailName(payment.rail || payment.network)
}

/** Kept as the module's provider entry point; the naming itself is shared. */
export function formatAdminProvider(provider: string | null | undefined): string {
  return formatProviderName(provider)
}

export function adminPaymentProviderLabel(payment: AdminTransactionDetailPayment): string {
  return formatAdminProvider(payment.provider)
}

// ─── Lifecycle event mapping ───────────────────────────────────────────────────

const EVENT_LABELS: Record<string, string> = {
  "payment.created": "Created",
  "payment.pending": "Waiting",
  "payment.processing": "Processing",
  "payment.confirmed": "Confirmed",
  "payment.failed": "Failed",
  "payment.cancelled": "Canceled",
  "payment.canceled": "Canceled",
  "payment.incomplete": "Incomplete",
  "payment.expired": "Expired",
  "payment.refunded": "Refunded",
  "payment.disputed": "Disputed",
}

export function adminEventLabel(event: AdminTransactionDetailEvent): string {
  const type = String(event.event_type || "payment.created").trim().toLowerCase()
  return EVENT_LABELS[type] ?? type
}

export function adminEventProviderEvent(event: AdminTransactionDetailEvent): string | null {
  const value = String(event.provider_event || "").trim()
  return value || null
}

export function adminEventOccurredAt(event: AdminTransactionDetailEvent): string {
  return String(event.created_at || "")
}

export type AdminEventPayload = {
  adminAction: string | null
  failureReason: string | null
  txHash: string | null
}

export function adminEventPayload(rawPayload: unknown): AdminEventPayload {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return { adminAction: null, failureReason: null, txHash: null }
  }
  const payload = rawPayload as Record<string, unknown>
  const text = (value: unknown): string | null => {
    const normalized = String(value ?? "").trim()
    return normalized || null
  }
  return {
    adminAction: text(payload.adminAction ?? payload.admin_action),
    failureReason: text(
      payload.failureReason ?? payload.failure_reason ?? payload.error ?? payload.reason
    ),
    txHash: text(payload.txHash ?? payload.tx_hash ?? payload.signature ?? payload.hash),
  }
}

/**
 * Watcher-detected evidence: rows the chain watcher or the reconciliation
 * engine appended. `payment_events.provider_event` is the marker the watcher
 * writes (`watcher.detected`), so this is a filter over recorded evidence, not
 * an inference about what happened.
 */
const WATCHER_EVENT_PREFIXES = ["watcher.", "reconciliation."]

export function isAdminWatcherEvent(event: AdminTransactionDetailEvent): boolean {
  const providerEvent = adminEventProviderEvent(event)?.toLowerCase() ?? ""
  return WATCHER_EVENT_PREFIXES.some((prefix) => providerEvent.startsWith(prefix))
}

export function isAdminActionEvent(event: AdminTransactionDetailEvent): boolean {
  return Boolean(adminEventPayload(event.raw_payload).adminAction)
}

/** Long hashes render head…tail so a 66-character hash never blows out a row. */
export function truncateHash(value: string, head = 12, tail = 8): string {
  return value.length > head + tail + 1
    ? `${value.slice(0, head)}…${value.slice(-tail)}`
    : value
}

// ─── Wallet / routing metadata ─────────────────────────────────────────────────

export type AdminPaymentRouting = {
  merchantWallet: string | null
  pinetreeWallet: string | null
  splitContract: string | null
  strategy: string | null
}

export function adminPaymentRouting(
  payment: AdminTransactionDetailPayment
): AdminPaymentRouting {
  const metadata = payment.metadata
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return { merchantWallet: null, pinetreeWallet: null, splitContract: null, strategy: null }
  }
  const m = metadata as Record<string, unknown>
  const text = (value: unknown): string | null => {
    const normalized = String(value ?? "").trim()
    return normalized || null
  }
  return {
    merchantWallet: text(m.merchant_wallet ?? m.merchantWallet ?? m.wallet_address),
    pinetreeWallet: text(
      m.pinetree_wallet ?? m.treasury_wallet ?? m.pinetreeWallet ?? m.treasuryWallet
    ),
    splitContract: text(m.split_contract ?? m.splitContract ?? m.splitContractAddress),
    strategy: text(m.strategy),
  }
}

export function hasAdminPaymentRouting(routing: AdminPaymentRouting): boolean {
  return Boolean(
    routing.merchantWallet || routing.pinetreeWallet || routing.splitContract || routing.strategy
  )
}
