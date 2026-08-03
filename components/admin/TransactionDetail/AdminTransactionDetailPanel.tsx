"use client"

/**
 * The canonical Admin Transaction Detail panel.
 *
 * This is the ONLY transaction-detail implementation inside Admin. Overview,
 * Transaction Explorer, Reports, search results, support references and future
 * diagnostics all render this exact component from this exact data model — no
 * surface owns transaction JSX, formatting or field mapping of its own.
 *
 * Merchant-facing transaction views are deliberately NOT part of this
 * consolidation: only Admin shows timeline, watcher evidence, attempt history
 * and engine diagnostics.
 *
 * Shell geometry matches AdminSupportTicketPanel: right-side slide-over,
 * full width on mobile, drawer width from sm up, backdrop at z-40.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { Copy, X } from "lucide-react"
import PaymentStatusBadge from "@/components/ui/StatusBadge"
import { modalCloseButtonClass } from "@/components/ui/ModalCloseButton"
import { formatNetworkName } from "@/components/admin/displayFormatters"
import { getPaymentDisplayStatus } from "@/lib/utils/paymentStatus"
import {
  adminEventLabel,
  adminEventOccurredAt,
  adminEventPayload,
  adminEventProviderEvent,
  adminPaymentCreatedAt,
  adminPaymentFeeMinor,
  adminPaymentGrossMinor,
  adminPaymentMerchantMinor,
  adminPaymentRailLabel,
  adminPaymentProviderLabel,
  adminPaymentReference,
  adminPaymentRouting,
  adminPaymentSourceLabel,
  adminPaymentUpdatedAt,
  formatAdminDateTime,
  formatAdminMoney,
  formatAdminProvider,
  hasAdminPaymentRouting,
  isAdminActionEvent,
  isAdminWatcherEvent,
  truncateHash,
} from "./format"
import {
  ADMIN_TRANSACTION_DETAIL_SECTION_DEFAULTS,
  type AdminTransactionDetail,
  type AdminTransactionDetailEvent,
  type AdminTransactionDetailSections,
} from "./types"

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

const pillClass =
  "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium"

/**
 * Payment-source pill — the Live badge's treatment inverted into PineTree
 * blue: very light blue fill, medium blue border, PineTree blue text.
 */
export const adminSourcePillClass = `${pillClass} border-blue-200 bg-blue-50 text-blue-700`

// ─── Small shared pieces ───────────────────────────────────────────────────────

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1500)
        })
      }}
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      className="ml-1.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 transition-colors hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
    >
      {copied ? (
        <span aria-hidden="true" className="text-[10px] font-semibold text-emerald-600">✓</span>
      ) : (
        <Copy size={11} aria-hidden="true" />
      )}
    </button>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">
      {children}
    </p>
  )
}

function Field({
  label,
  value,
  mono,
  copyValue,
  span,
}: {
  label: string
  value: ReactNode
  mono?: boolean
  copyValue?: string
  span?: boolean
}) {
  return (
    <div className={`min-w-0 ${span ? "sm:col-span-2" : ""}`}>
      <p className="text-gray-400">{label}</p>
      <div className="mt-0.5 flex items-start gap-1">
        <div className={`min-w-0 flex-1 break-words text-gray-700 ${mono ? "font-mono break-all" : ""}`}>
          {value}
        </div>
        {copyValue ? <CopyButton value={copyValue} label={label} /> : null}
      </div>
    </div>
  )
}

function MonoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
      <p className="text-gray-400">{label}</p>
      <div className="mt-0.5 flex items-start gap-1">
        <p className="min-w-0 flex-1 break-all font-mono text-[11px] leading-relaxed text-gray-700">
          {value}
        </p>
        <CopyButton value={value} label={label} />
      </div>
    </div>
  )
}

function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
      <p className="text-xs text-gray-400">{children}</p>
    </div>
  )
}

function EventRow({ event }: { event: AdminTransactionDetailEvent }) {
  const payload = adminEventPayload(event.raw_payload)
  const isAdminAction = Boolean(payload.adminAction)
  const providerEvent = adminEventProviderEvent(event)

  return (
    <div
      className={`min-w-0 rounded-xl px-3 py-2.5 ${
        isAdminAction ? "border border-amber-100 bg-amber-50" : "bg-gray-50"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
            isAdminAction ? "bg-amber-400" : "bg-blue-400"
          }`}
        />
        <div className="min-w-0 flex-1 text-xs">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
            <p className="min-w-0 break-words font-medium text-gray-800">{adminEventLabel(event)}</p>
            <p className="shrink-0 text-[11px] text-gray-400">
              {formatAdminDateTime(adminEventOccurredAt(event))}
            </p>
          </div>
          {providerEvent && (
            <p className="mt-0.5 break-words text-[11px] text-gray-400">{providerEvent}</p>
          )}
          {payload.txHash && (
            <div className="mt-1 flex min-w-0 items-center gap-1">
              <p
                className="min-w-0 truncate font-mono text-[11px] text-gray-500"
                title={payload.txHash}
              >
                {truncateHash(payload.txHash)}
              </p>
              <CopyButton value={payload.txHash} label="transaction hash" />
            </div>
          )}
          {payload.failureReason && (
            <p className="mt-1 break-words text-[11px] text-red-600">↳ {payload.failureReason}</p>
          )}
          {isAdminAction && (
            <p className="mt-1 break-words text-[11px] font-medium text-amber-700">
              Admin action: {payload.adminAction}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Panel ─────────────────────────────────────────────────────────────────────

export default function AdminTransactionDetailPanel({
  paymentId,
  detail,
  loading,
  error,
  onClose,
  sections,
  footer,
}: {
  /** Payment being opened — shown in the header before the fetch resolves. */
  paymentId: string
  detail: AdminTransactionDetail | null
  loading: boolean
  error?: string | null
  onClose: () => void
  sections?: AdminTransactionDetailSections
  footer?: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const {
    showTimeline,
    showWatcherEvents,
    showDiagnostics,
    showProviderMetadata,
    showAttemptHistory,
  } = { ...ADMIN_TRANSACTION_DETAIL_SECTION_DEFAULTS, ...sections }

  // Return focus to the row that opened the panel.
  useEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      returnFocusRef.current?.focus?.()
    }
  }, [])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation()
        onClose()
        return
      }

      if (event.key !== "Tab") return
      const container = panelRef.current
      if (!container) return

      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((element) => element.offsetParent !== null || element === document.activeElement)
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    },
    [onClose]
  )

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [handleKeyDown])

  const payment = detail?.payment ?? null
  const headerId = payment?.paymentId || paymentId
  const events = detail?.events ?? []
  const watcherEvents = events.filter(isAdminWatcherEvent)
  const adminEvents = events.filter(isAdminActionEvent)
  const routing = payment ? adminPaymentRouting(payment) : null
  const attempts = payment?.attempts ?? []
  const diagnostics = payment?.diagnostics ?? []

  return (
    <>
      <div
        data-pinetree-overlay="true"
        className="pinetree-modal-backdrop fixed inset-0 z-40"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-transaction-title"
        className="fixed inset-y-0 right-0 z-50 flex h-[100dvh] max-h-[100dvh] w-full max-w-full flex-col bg-white shadow-2xl sm:w-[600px] lg:w-[680px]"
      >
        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div className="flex-none border-b border-gray-100 px-5 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">
                Platform Transaction Detail
              </p>
              <div className="mt-1 flex min-w-0 items-start gap-1">
                <h2
                  id="admin-transaction-title"
                  className="min-w-0 flex-1 break-all font-mono text-sm leading-snug text-gray-800"
                >
                  {headerId}
                </h2>
                <CopyButton value={headerId} label="payment ID" />
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close transaction detail"
              className={modalCloseButtonClass}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <div
              aria-label="Loading transaction detail"
              role="status"
              className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"
            />
          </div>
        ) : !payment ? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
            <p className="text-sm text-gray-400">{error || "Failed to load transaction detail."}</p>
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden overscroll-contain px-5 py-5 sm:px-6">

            {/* ── Status, payment source and amounts ────────────────────────── */}
            <div className="min-w-0 space-y-3 rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <PaymentStatusBadge status={payment.canonicalStatus} />
                {/* How the payment originated — read from the canonical record,
                    never inferred here. */}
                <span className={adminSourcePillClass}>{adminPaymentSourceLabel(payment)}</span>
                {/* Test mode is called out because it means the payment moved
                    no real money. Production payments get no counterpart badge
                    — that was the duplicate this row deliberately dropped. */}
                {payment.paymentMode === "test" && (
                  <span className={`${pillClass} border-amber-200 bg-amber-50 text-amber-700`}>
                    Test
                  </span>
                )}
                {payment.adjustmentStatus && (
                  <span className={`${pillClass} border-slate-200 bg-slate-50 text-slate-700`}>
                    {payment.adjustmentStatus === "REFUNDED" ? "Refunded" : "Disputed"}
                  </span>
                )}
              </div>
              <p className="break-words text-xs text-gray-500">
                {getPaymentDisplayStatus(payment.canonicalStatus).message}
              </p>
              <div className="grid grid-cols-3 gap-3 pt-1">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-gray-400">
                    Gross Total
                  </p>
                  <p className="mt-1 break-words text-base font-bold text-gray-900 sm:text-lg">
                    {formatAdminMoney(adminPaymentGrossMinor(payment), payment.currency)}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-gray-400">
                    Merchant
                  </p>
                  <p className="mt-1 break-words text-base font-bold text-gray-900 sm:text-lg">
                    {formatAdminMoney(adminPaymentMerchantMinor(payment), payment.currency)}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-gray-400">
                    Service fee
                  </p>
                  <p className="mt-1 break-words text-base font-bold text-[#0052FF] sm:text-lg">
                    {formatAdminMoney(adminPaymentFeeMinor(payment), payment.currency)}
                  </p>
                </div>
              </div>
            </div>

            {/* ── Merchant / provider core details ──────────────────────────── */}
            <div>
              <SectionLabel>Core Details</SectionLabel>
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 text-xs sm:grid-cols-2">
                <Field
                  label="Merchant ID"
                  value={payment.merchantId || "—"}
                  mono
                  copyValue={payment.merchantId || undefined}
                />
                <Field
                  label="Business / Email"
                  value={
                    detail?.merchant ? (
                      <>
                        <span className="break-words">
                          {detail.merchant.business_name || detail.merchant.email || "—"}
                        </span>
                        {detail.merchant.business_name && detail.merchant.email && (
                          <span className="block break-all text-[11px] text-gray-400">
                            {detail.merchant.email}
                          </span>
                        )}
                      </>
                    ) : (
                      "—"
                    )
                  }
                />
                {/* Renders the rail vocabulary, so it is labelled "Rail" — the
                    raw network is in Admin Diagnostics as "Stored Network". */}
                <Field label="Rail" value={adminPaymentRailLabel(payment)} />
                <Field label="Provider" value={adminPaymentProviderLabel(payment)} />
                <Field label="Currency" value={payment.currency || "USD"} />
                <Field label="Asset" value={payment.asset || "—"} />
                <Field label="Payment Source" value={adminPaymentSourceLabel(payment)} />
                <Field
                  label="Payment Mode"
                  value={payment.paymentMode === "test" ? "Test" : "Live"}
                />
                <Field label="Created" value={formatAdminDateTime(adminPaymentCreatedAt(payment))} />
                <Field label="Updated" value={formatAdminDateTime(adminPaymentUpdatedAt(payment))} />
                {payment.confirmedAt && (
                  <Field label="Confirmed" value={formatAdminDateTime(payment.confirmedAt)} />
                )}
                {payment.adjustedAt && (
                  <Field label="Adjusted" value={formatAdminDateTime(payment.adjustedAt)} />
                )}
              </div>
            </div>

            {/* ── Transaction hash / provider reference ─────────────────────── */}
            {adminPaymentReference(payment) && (
              <div>
                <SectionLabel>Reference / Hash</SectionLabel>
                <div className="space-y-2 text-xs">
                  {payment.transactionHash && (
                    <MonoCard label="Transaction Hash" value={payment.transactionHash} />
                  )}
                  {payment.providerReference &&
                    payment.providerReference !== payment.transactionHash && (
                      <MonoCard label="Provider Reference" value={payment.providerReference} />
                    )}
                </div>
              </div>
            )}

            {/* ── Wallet & routing (provider metadata) ──────────────────────── */}
            {showProviderMetadata && routing && hasAdminPaymentRouting(routing) && (
              <div>
                <SectionLabel>Wallet &amp; Routing</SectionLabel>
                <div className="space-y-2 text-xs">
                  {routing.merchantWallet && (
                    <MonoCard label="Merchant Wallet" value={routing.merchantWallet} />
                  )}
                  {routing.pinetreeWallet && (
                    <MonoCard label="PineTree Treasury Wallet" value={routing.pinetreeWallet} />
                  )}
                  {routing.splitContract && (
                    <MonoCard label="Split Contract" value={routing.splitContract} />
                  )}
                  {routing.strategy && (
                    <div className="min-w-0 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                      <p className="text-gray-400">Strategy</p>
                      <p className="mt-0.5 break-words text-gray-700">{routing.strategy}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Payment timeline ──────────────────────────────────────────── */}
            {showTimeline && (
              <div>
                <SectionLabel>Payment Timeline</SectionLabel>
                {events.length === 0 ? (
                  <EmptyNote>No payment events recorded for this payment.</EmptyNote>
                ) : (
                  <div className="space-y-1.5">
                    {events.map((event) => (
                      <EventRow key={event.id} event={event} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Watcher-detected evidence ─────────────────────────────────── */}
            {showWatcherEvents && (
              <div>
                <SectionLabel>Watcher Detection</SectionLabel>
                {watcherEvents.length === 0 ? (
                  <EmptyNote>
                    No watcher or reconciliation evidence recorded for this payment.
                  </EmptyNote>
                ) : (
                  <div className="space-y-1.5">
                    {watcherEvents.map((event) => (
                      <EventRow key={`watcher-${event.id}`} event={event} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Processing history (payment attempts) ─────────────────────── */}
            {showAttemptHistory && attempts.length > 0 && (
              <div>
                <SectionLabel>Processing History</SectionLabel>
                <div className="space-y-1.5">
                  {attempts.map((attempt) => (
                    <div
                      key={attempt.id}
                      className="min-w-0 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-xs"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                        <p className="min-w-0 break-words font-medium text-gray-800">
                          {attempt.status || "Unknown status"}
                          {attempt.isAdjustment ? " · adjustment" : ""}
                        </p>
                        <p className="shrink-0 text-[11px] text-gray-400">
                          {formatAdminDateTime(attempt.updatedAt || attempt.createdAt)}
                        </p>
                      </div>
                      <p className="mt-0.5 break-words text-[11px] text-gray-500">
                        {[
                          attempt.provider ? formatAdminProvider(attempt.provider) : null,
                          attempt.network ? formatNetworkName(attempt.network) : null,
                          attempt.totalAmountMinor != null
                            ? formatAdminMoney(attempt.totalAmountMinor, payment.currency)
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "No attempt metadata recorded"}
                      </p>
                      {attempt.providerReference && (
                        <div className="mt-1 flex min-w-0 items-center gap-1">
                          <p
                            className="min-w-0 truncate font-mono text-[11px] text-gray-500"
                            title={attempt.providerReference}
                          >
                            {truncateHash(attempt.providerReference)}
                          </p>
                          <CopyButton
                            value={attempt.providerReference}
                            label="provider reference"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Engine / admin diagnostics ────────────────────────────────── */}
            {showDiagnostics && (
              <div>
                <SectionLabel>Admin Diagnostics</SectionLabel>
                <div className="space-y-2 text-xs">
                  {adminEvents.length > 0 && (
                    <div className="min-w-0 space-y-1 rounded-2xl border border-amber-200/60 bg-amber-50/50 px-4 py-3">
                      <p className="font-semibold text-amber-800">Admin cleanup detected</p>
                      {adminEvents.map((event) => {
                        const payload = adminEventPayload(event.raw_payload)
                        return (
                          <p key={`admin-${event.id}`} className="break-words text-amber-700">
                            {adminEventLabel(event)} · {payload.adminAction}
                            {payload.failureReason ? ` — ${payload.failureReason}` : ""}
                            <span className="ml-1 text-amber-500">
                              {formatAdminDateTime(adminEventOccurredAt(event))}
                            </span>
                          </p>
                        )
                      })}
                    </div>
                  )}

                  {diagnostics.length > 0 && (
                    <div className="min-w-0 space-y-1 rounded-2xl border border-red-200/60 bg-red-50/50 px-4 py-3">
                      <p className="font-semibold text-red-800">Canonical projection diagnostics</p>
                      {diagnostics.map((diagnostic) => (
                        <p key={diagnostic.code} className="break-words text-red-700">
                          {diagnostic.code}: {diagnostic.message}
                        </p>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                    <Field label="Attempt ID" value={payment.attemptId || "—"} mono />
                    {/* Raw stored value, like its "Stored …" siblings below.
                        "Payment Source" above is the user-facing label; the
                        "Stored Source" name is reserved for this raw
                        diagnostic reading of the `channel` column. */}
                    <Field label="Stored Source" value={payment.channel || "—"} />
                    <Field label="Canonical Status" value={payment.canonicalStatus} />
                    <Field label="Stored Status" value={payment.raw?.paymentStatus || "—"} />
                    <Field label="Stored Network" value={payment.raw?.network || "—"} />
                    <Field
                      label="Attempt Status"
                      value={payment.raw?.transactionStatus || "—"}
                    />
                  </div>

                  {adminEvents.length === 0 && diagnostics.length === 0 && (
                    <EmptyNote>
                      No admin actions or projection diagnostics recorded for this payment.
                    </EmptyNote>
                  )}
                </div>
              </div>
            )}

            {footer && <div className="border-t border-gray-100 pt-4">{footer}</div>}
          </div>
        )}
      </div>
    </>
  )
}
