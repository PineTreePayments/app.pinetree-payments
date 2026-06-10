"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabaseClient"
import { getPaymentDisplayStatus } from "@/lib/utils/paymentStatus"
import StatusBadge from "@/components/ui/StatusBadge"
import {
  formatProviderReference,
  formatTransactionReference,
  getTransactionReferenceParts
} from "./transactionReference"
import {
  formatDashboardNetwork,
  formatDashboardProvider,
  formatTransactionSecondaryLabel
} from "@/components/dashboard/displayHelpers"

export type DashboardPaymentSummary = {
  id?: string | null
  created_at?: string | null
  gross_amount?: number | string | null
  merchant_amount?: number | string | null
  pinetree_fee?: number | string | null
  currency?: string | null
  status?: string | null
  provider_reference?: string | null
  metadata?: {
    split?: {
      lightningInvoice?: string | null
    } | null
  } | null
}

export type DashboardTransactionRow = {
  id: string
  payment_id?: string | null
  provider?: string | null
  status: string
  provider_transaction_id?: string | null
  network?: string | null
  channel?: string | null
  payments?: DashboardPaymentSummary | DashboardPaymentSummary[] | null
  created_at?: string | null
}

function parseTimestamp(value: string) {
  const hasTimezone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value)
  return new Date(hasTimezone ? value : `${value}Z`)
}

export function formatChicagoDateTime(value: string | null | undefined) {
  if (!value) return "-"
  const date = parseTimestamp(value)
  if (Number.isNaN(date.getTime())) return "-"

  return date.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  })
}

export function formatUsd(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(Number.isFinite(amount) ? amount : 0)
}

export function providerName(provider: string | null | undefined) {
  return formatDashboardProvider(provider)
}

export function networkName(network: string | null | undefined) {
  return formatDashboardNetwork(network)
}

function getPayment(tx: DashboardTransactionRow) {
  return Array.isArray(tx.payments) ? tx.payments[0] : tx.payments
}

type DetailDisplayRow = {
  label: string
  value: string | null | undefined
  mono?: boolean
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[150px_1fr] gap-1 sm:gap-4 py-2 border-b border-gray-100 last:border-none">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`min-w-0 text-sm text-gray-900 whitespace-normal break-all [overflow-wrap:anywhere] ${mono ? "font-mono text-xs leading-relaxed" : ""}`}>
        {value || "-"}
      </div>
    </div>
  )
}

function buildDetailRows(input: {
  tx: DashboardTransactionRow
  payment: DashboardPaymentSummary | null
  statusLabel: string
  statusTime: string | null
  references: ReturnType<typeof getTransactionReferenceParts>
}): DetailDisplayRow[] {
  const { tx, payment, statusLabel, statusTime, references } = input
  const provider = String(tx.provider || "").toLowerCase()
  const commonRows: DetailDisplayRow[] = [
    { label: "Reference", value: formatTransactionReference(tx), mono: true },
    { label: "Payment ID", value: references.paymentId, mono: true },
    { label: "Transaction ID", value: references.transactionId, mono: true },
    { label: "Amount", value: formatUsd(Number(payment?.gross_amount ?? 0)) },
    { label: "Currency", value: payment?.currency || null },
    { label: "Status", value: statusLabel },
    { label: "Date / Time", value: formatChicagoDateTime(statusTime) },
    { label: "Channel", value: tx.channel || null }
  ]

  if (provider === "cash") {
    return [
      ...commonRows.slice(0, 5),
      { label: "Payment Method", value: "Cash" },
      ...commonRows.slice(5),
      { label: "Cash Reference", value: formatTransactionReference(tx), mono: true }
    ]
  }

  if (
    provider === "lightning" ||
    provider === "lightning_speed" ||
    provider === "speed" ||
    provider === "tryspeed" ||
    provider === "lightning_nwc" ||
    provider === "nwc"
  ) {
    const lightningInvoice = payment?.metadata?.split?.lightningInvoice || null
    return [
      ...commonRows.slice(0, 5),
      { label: "Network", value: "Lightning" },
      { label: "Provider", value: providerName(tx.provider) },
      ...commonRows.slice(5),
      { label: "Provider Reference", value: formatProviderReference(tx.provider, references.providerReference), mono: true },
      { label: "Lightning Invoice", value: lightningInvoice, mono: true }
    ]
  }

  if (provider === "base") {
    return [
      ...commonRows.slice(0, 5),
      { label: "Network", value: "Base" },
      { label: "Provider", value: "Base Pay" },
      ...commonRows.slice(5),
      { label: "Blockchain Transaction", value: formatProviderReference(tx.provider, references.blockchainReference), mono: true },
      { label: "Provider Reference", value: formatProviderReference(tx.provider, references.providerReference), mono: true }
    ]
  }

  if (provider === "solana") {
    return [
      ...commonRows.slice(0, 5),
      { label: "Network", value: "Solana" },
      { label: "Provider", value: "Solana Pay" },
      ...commonRows.slice(5),
      { label: "Blockchain Transaction", value: formatProviderReference(tx.provider, references.blockchainReference), mono: true },
      { label: "Provider Reference", value: formatProviderReference(tx.provider, references.providerReference), mono: true }
    ]
  }

  return [
    ...commonRows.slice(0, 5),
    { label: "Network", value: networkName(tx.network) },
    { label: "Provider", value: providerName(tx.provider) },
    ...commonRows.slice(5),
    { label: "Blockchain Transaction", value: formatProviderReference(tx.provider, references.blockchainReference), mono: true },
    { label: "Provider Reference", value: formatProviderReference(tx.provider, references.providerReference), mono: true }
  ]
}

export default function TransactionActivityTable({
  transactions,
  emptyMessage = "No transactions found.",
  mobileInitialCount = 10
}: {
  transactions: DashboardTransactionRow[]
  emptyMessage?: string
  mobileInitialCount?: number
}) {
  const [selectedTx, setSelectedTx] = useState<DashboardTransactionRow | null>(null)
  const [visibleMobileCount, setVisibleMobileCount] = useState(mobileInitialCount)
  const [receiptLoading, setReceiptLoading] = useState<"view" | "download" | null>(null)

  const closeDetail = useCallback(() => setSelectedTx(null), [])

  const fetchReceipt = useCallback(async (paymentId: string, download: boolean) => {
    setReceiptLoading(download ? "download" : "view")
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error("Please sign in again")
      const path = `/api/receipts/${paymentId}${download ? "/download" : ""}`
      const response = await fetch(path, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store"
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error || "Receipt request failed")
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      if (download) {
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = `pinetree-receipt-${paymentId}.pdf`
        anchor.click()
        URL.revokeObjectURL(url)
      } else {
        const receiptWindow = window.open(url, "_blank", "noopener,noreferrer")
        if (!receiptWindow) {
          URL.revokeObjectURL(url)
          throw new Error("Allow popups to view the receipt")
        }
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Receipt request failed")
    } finally {
      setReceiptLoading(null)
    }
  }, [])

  useEffect(() => {
    if (!selectedTx) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeDetail()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [closeDetail, selectedTx])

  const selectedPayment = selectedTx ? getPayment(selectedTx) : null
  const selectedStatusTime = selectedTx?.created_at || selectedPayment?.created_at || null
  const selectedStatus = selectedTx
    ? getPaymentDisplayStatus(selectedTx.status)
    : null
  const selectedReferences = selectedTx ? getTransactionReferenceParts(selectedTx) : null
  const selectedDetailRows = selectedTx && selectedStatus && selectedReferences
    ? buildDetailRows({
        tx: selectedTx,
        payment: selectedPayment || null,
        statusLabel: selectedStatus.label,
        statusTime: selectedStatusTime,
        references: selectedReferences
      }).filter((row) => String(row.value || "").trim().length > 0)
    : []
  const visibleMobileTransactions = transactions.slice(0, visibleMobileCount)
  const hasMoreMobileTransactions = visibleMobileCount < transactions.length

  return (
    <>
      {/* Mobile card list — shown below md breakpoint */}
      <div className="md:hidden overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
        {transactions.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-gray-700">
            {emptyMessage}
          </div>
        )}
        {visibleMobileTransactions.map((tx) => {
          const payment = getPayment(tx)
          const statusTime = tx.created_at || payment?.created_at || null
          const reference = formatTransactionReference(tx)
          const secondaryLabel = formatTransactionSecondaryLabel(tx.provider, tx.network)

          return (
            <button
              key={tx.id}
              type="button"
              onClick={() => setSelectedTx(tx)}
              className="w-full border-b border-gray-100 bg-white px-4 py-3 text-left last:border-b-0 hover:bg-gray-50 focus:bg-blue-50/60 focus:outline-none"
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-sm font-medium text-gray-900">
                  {providerName(tx.provider)}
                  {secondaryLabel !== "-" && (
                    <span className="text-gray-400 font-normal"> · {secondaryLabel}</span>
                  )}
                </span>
                <StatusBadge status={tx.status} />
              </div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-sm font-semibold text-gray-900">
                  {formatUsd(Number(payment?.gross_amount ?? 0))}
                </span>
                <span className="text-xs text-gray-500">
                  {formatChicagoDateTime(statusTime)}
                </span>
              </div>
              <div className="text-xs text-gray-500 font-mono truncate">
                {reference}
              </div>
            </button>
          )
        })}
        {hasMoreMobileTransactions && (
          <div className="border-t border-gray-100 bg-gray-50/70 p-3">
            <button
              type="button"
              onClick={() => setVisibleMobileCount((current) => Math.min(current + mobileInitialCount, transactions.length))}
              className="inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-blue-200 bg-white px-4 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50"
            >
              Show More Transactions
            </button>
          </div>
        )}
      </div>

      {/* Desktop table — hidden below md breakpoint */}
      <div className="hidden max-h-[640px] overflow-auto rounded-xl border border-gray-100 bg-white md:block">
        <table className="w-full min-w-[980px] table-fixed">
          <colgroup>
            <col className="w-[190px]" />
            <col className="w-[120px]" />
            <col className="w-[90px]" />
            <col className="w-[120px]" />
            <col className="w-[150px]" />
            <col className="w-[130px]" />
            <col />
          </colgroup>

          <thead className="sticky top-0 z-10 border-b border-gray-200 bg-gray-50">
            <tr className="text-left text-sm text-gray-700">
              <th className="px-4 py-3 font-medium">Date / Time</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Currency</th>
              <th className="px-4 py-3 font-medium">Network</th>
              <th className="px-4 py-3 font-medium">Provider</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Reference</th>
            </tr>
          </thead>

          <tbody>
            {transactions.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-gray-700 py-16">
                  {emptyMessage}
                </td>
              </tr>
            )}

            {transactions.map((tx) => {
              const payment = getPayment(tx)
              const statusTime = tx.created_at || payment?.created_at || null
              const reference = formatTransactionReference(tx)

              return (
                <tr
                  key={tx.id}
                  tabIndex={0}
                  onClick={() => setSelectedTx(tx)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      setSelectedTx(tx)
                    }
                  }}
                  className="border-b border-gray-100 text-sm hover:bg-gray-50 cursor-pointer focus:outline-none focus:bg-blue-50/60"
                >
                  <td className="px-4 py-4 text-gray-900 whitespace-nowrap">
                    {formatChicagoDateTime(statusTime)}
                  </td>

                  <td className="px-4 py-4 font-medium text-gray-900 whitespace-nowrap">
                    {formatUsd(Number(payment?.gross_amount ?? 0))}
                  </td>

                  <td className="px-4 py-4 text-gray-900 whitespace-nowrap">
                    {payment?.currency || "-"}
                  </td>

                  <td className="px-4 py-4 text-gray-700 whitespace-nowrap">
                    {formatTransactionSecondaryLabel(tx.provider, tx.network)}
                  </td>

                  <td className="px-4 py-4 text-gray-900 whitespace-nowrap">
                    {providerName(tx.provider)}
                  </td>

                  <td className="px-4 py-4 whitespace-nowrap">
                    <StatusBadge status={tx.status} />
                  </td>

                  <td className="px-4 py-4 text-gray-600 font-mono text-[11px]">
                    <span className="block max-w-[220px] truncate" title={reference}>
                      {reference}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {selectedTx && selectedStatus && selectedReferences && (
        <div
          data-pinetree-overlay="true"
          className="pinetree-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-3"
          onMouseDown={closeDetail}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Transaction details"
            className="w-full max-w-xl max-h-[88vh] overflow-y-auto rounded-2xl border border-white/70 bg-white/95 shadow-[0_24px_80px_rgba(15,23,42,0.22)] p-5"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className="text-xs uppercase tracking-widest text-blue-700 font-medium">
                  Transaction
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mt-1">
                  Activity Details
                </h3>
              </div>

              <button
                type="button"
                onClick={closeDetail}
                className="rounded-full border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>

            <div className="rounded-xl border border-gray-100 bg-white p-4">
              {selectedDetailRows.map((row) => (
                <DetailRow
                  key={row.label}
                  label={row.label}
                  value={String(row.value || "")}
                  mono={row.mono}
                />
              ))}
            </div>
            {selectedPayment?.id && selectedPayment.status === "CONFIRMED" && (
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void fetchReceipt(String(selectedPayment.id), false)}
                  disabled={receiptLoading !== null}
                  className="inline-flex min-h-10 flex-1 items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {receiptLoading === "view" ? "Opening..." : "View Receipt"}
                </button>
                <button
                  type="button"
                  onClick={() => void fetchReceipt(String(selectedPayment.id), true)}
                  disabled={receiptLoading !== null}
                  className="inline-flex min-h-10 flex-1 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-700 disabled:opacity-60"
                >
                  {receiptLoading === "download" ? "Downloading..." : "Download Receipt"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
