"use client"

import { useCallback, useEffect, useState } from "react"
import { getPaymentDisplayStatus } from "@/lib/utils/paymentStatus"
import StatusBadge from "@/components/ui/StatusBadge"
import {
  formatTransactionReference,
  getTransactionReferenceParts
} from "./transactionReference"

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
  if (provider === "coinbase") return "Coinbase Business"
  if (provider === "solana") return "Solana Pay"
  if (provider === "shift4") return "Shift4"
  if (provider === "base") return "Base Pay"
  if (provider === "lightning") return "Bitcoin Lightning"
  if (provider === "cash") return "Cash"
  return provider || "-"
}

export function networkName(network: string | null | undefined) {
  if (!network) return "-"
  if (network.toLowerCase() === "cash") return "Cash"
  if (network.toLowerCase() === "solana") return "Solana"
  if (network.toLowerCase() === "base") return "Base"
  if (network.toLowerCase() === "ethereum") return "Ethereum"
  if (network.toLowerCase() === "bitcoin_lightning" || network.toLowerCase() === "bitcoin lightning") return "Bitcoin Lightning"
  return network.charAt(0).toUpperCase() + network.slice(1).toLowerCase()
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

  if (provider === "lightning") {
    const lightningInvoice = payment?.metadata?.split?.lightningInvoice || null
    return [
      ...commonRows.slice(0, 5),
      { label: "Network", value: "Bitcoin Lightning" },
      { label: "Provider", value: "Bitcoin Lightning" },
      ...commonRows.slice(5),
      { label: "Provider Reference", value: references.providerReference, mono: true },
      { label: "Lightning Invoice", value: lightningInvoice, mono: true }
    ]
  }

  if (provider === "base") {
    return [
      ...commonRows.slice(0, 5),
      { label: "Network", value: "Base" },
      { label: "Provider", value: "Base Pay" },
      ...commonRows.slice(5),
      { label: "Blockchain Transaction", value: references.blockchainReference, mono: true },
      { label: "Provider Reference", value: references.providerReference, mono: true }
    ]
  }

  if (provider === "solana") {
    return [
      ...commonRows.slice(0, 5),
      { label: "Network", value: "Solana" },
      { label: "Provider", value: "Solana Pay" },
      ...commonRows.slice(5),
      { label: "Blockchain Transaction", value: references.blockchainReference, mono: true },
      { label: "Provider Reference", value: references.providerReference, mono: true }
    ]
  }

  return [
    ...commonRows.slice(0, 5),
    { label: "Network", value: networkName(tx.network) },
    { label: "Provider", value: providerName(tx.provider) },
    ...commonRows.slice(5),
    { label: "Blockchain Transaction", value: references.blockchainReference, mono: true },
    { label: "Provider Reference", value: references.providerReference, mono: true }
  ]
}

export default function TransactionActivityTable({
  transactions,
  emptyMessage = "No transactions found."
}: {
  transactions: DashboardTransactionRow[]
  emptyMessage?: string
}) {
  const [selectedTx, setSelectedTx] = useState<DashboardTransactionRow | null>(null)

  const closeDetail = useCallback(() => setSelectedTx(null), [])

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
    ? selectedPayment
      ? getPaymentDisplayStatus(selectedPayment.status || selectedTx.status, selectedStatusTime || "")
      : { status: selectedTx.status, classes: "bg-gray-100 text-gray-700" }
    : null
  const selectedReferences = selectedTx ? getTransactionReferenceParts(selectedTx) : null
  const selectedDetailRows = selectedTx && selectedStatus && selectedReferences
    ? buildDetailRows({
        tx: selectedTx,
        payment: selectedPayment || null,
        statusLabel: selectedStatus.status,
        statusTime: selectedStatusTime,
        references: selectedReferences
      }).filter((row) => String(row.value || "").trim().length > 0)
    : []

  return (
    <>
      {/* Mobile card list — shown below md breakpoint */}
      <div className="md:hidden space-y-2">
        {transactions.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm px-4 py-12 text-center text-gray-700 text-sm">
            {emptyMessage}
          </div>
        )}
        {transactions.map((tx) => {
          const payment = getPayment(tx)
          const statusTime = tx.created_at || payment?.created_at || null
          const displayStatus = payment
            ? getPaymentDisplayStatus(payment.status || tx.status, statusTime || "")
            : { status: tx.status, classes: "bg-gray-100 text-gray-700" }
          const reference = formatTransactionReference(tx)

          return (
            <button
              key={tx.id}
              type="button"
              onClick={() => setSelectedTx(tx)}
              className="w-full text-left bg-white border border-gray-200 rounded-2xl shadow-sm px-4 py-3 hover:bg-gray-50 focus:outline-none focus:bg-blue-50/60"
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-sm font-medium text-gray-900">
                  {providerName(tx.provider)}
                  {tx.provider !== "cash" && tx.network && (
                    <span className="text-gray-400 font-normal"> · {networkName(tx.network)}</span>
                  )}
                </span>
                <StatusBadge label={displayStatus.status} classes={displayStatus.classes} />
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
      </div>

      {/* Desktop table — hidden below md breakpoint */}
      <div className="hidden md:block bg-white border border-gray-200 rounded-2xl shadow-sm overflow-x-auto">
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

          <thead className="bg-gray-50 border-b border-gray-200">
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
              const displayStatus = payment
                ? getPaymentDisplayStatus(payment.status || tx.status, statusTime || "")
                : { status: tx.status, classes: "bg-gray-100 text-gray-700" }
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
                    {networkName(tx.provider === "cash" ? "cash" : tx.network)}
                  </td>

                  <td className="px-4 py-4 text-gray-900 whitespace-nowrap">
                    {providerName(tx.provider)}
                  </td>

                  <td className="px-4 py-4 whitespace-nowrap">
                    <StatusBadge label={displayStatus.status} classes={displayStatus.classes} />
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
          className="fixed inset-0 bg-black/30 backdrop-blur-[2px] flex items-center justify-center z-50 p-3"
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
                  PineTree Transaction
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
          </div>
        </div>
      )}
    </>
  )
}
