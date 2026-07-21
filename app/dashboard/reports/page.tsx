"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabaseClient"
import { useDashboardAutoRefresh } from "@/hooks/useDashboardAutoRefresh"
import StatusBadge from "@/components/ui/StatusBadge"
import { SegmentedButtons } from "@/components/ui/SegmentedButtons"
import { PrimaryActionButton } from "@/components/ui/PrimaryActionButton"
import {
  DashboardHeroCard,
  DashboardSection,
  GroupedMetricSurface,
  InlineMetric,
  dashboardPageTitleClass
} from "@/components/dashboard/DashboardPrimitives"
import {
  formatDashboardNetwork,
  formatDashboardProvider
} from "@/components/dashboard/displayHelpers"

type ReportPeriod = "end_of_day" | "today" | "weekly" | "month" | "year" | "custom"

type LedgerRow = {
  dateTime: string
  paymentId: string
  reference: string
  provider: string
  rail: string
  network: string
  asset: string
  gross: number
  pinetreeFee: number
  status: string
  canonicalStatus: string
}

type ReportSummary = {
  title: string
  startDate: string
  endDate: string
  timeZone: string
  isInProgress: boolean
  grossVolume: number
  netSettlements: number
  pineTreeFees: number
  taxesCollected: number
  transactionCount: number
  confirmedCount: number
  failedCount: number
  incompleteCount: number
  waitingCount: number
  processingCount: number
  refundedCount: number
  refundedAmount: number
  avgTransaction: number
  cardVolume: number
  cryptoVolume: number
  cashVolume: number
  providerTotals: Record<string, number>
  railTotals: Record<string, number>
  assetTotals: Record<string, number>
  networkTotals: Record<string, number>
  statusCounts: Record<string, number>
  reconciliation: {
    providerMatchesGross: boolean
    railMatchesGross: boolean
    assetMatchesCrypto: boolean
    variance: number
  }
  transactionsTable: LedgerRow[]
  totalLedgerRows: number
  transactionsTruncated: boolean
}

const PERIODS: Array<{ value: ReportPeriod; label: string }> = [
  { value: "end_of_day", label: "End of day" },
  { value: "today", label: "Today" },
  { value: "weekly", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
  { value: "custom", label: "Custom" }
]

function currency(value: number | undefined) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value || 0)
}

function reportQuery(period: ReportPeriod, startDate: string, endDate: string) {
  const params = new URLSearchParams({ type: period })
  if (period === "custom") {
    params.set("startDate", startDate)
    params.set("endDate", endDate)
  }
  return params
}

function Breakdown({
  title,
  totals,
  formatLabel = (value) => value
}: {
  title: string
  totals: Record<string, number>
  formatLabel?: (value: string) => string
}) {
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1])
  return (
    <GroupedMetricSurface title={title} titleTone="blue">
      {entries.length ? (
        <div className="divide-y divide-gray-100">
          {entries.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="min-w-0 truncate text-gray-600">{formatLabel(label)}</span>
              <span className="font-semibold text-gray-950">{currency(value)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="py-3 text-sm text-gray-500">No confirmed volume for this period.</p>
      )}
    </GroupedMetricSurface>
  )
}

export default function ReportsPage() {
  const [period, setPeriod] = useState<ReportPeriod>("month")
  const [customStart, setCustomStart] = useState("")
  const [customEnd, setCustomEnd] = useState("")
  const [appliedCustom, setAppliedCustom] = useState({ start: "", end: "" })
  const [summary, setSummary] = useState<ReportSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState<"csv" | "pdf" | null>(null)
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailRecipient, setEmailRecipient] = useState("")
  const [userEmail, setUserEmail] = useState("")
  const [sendingEmail, setSendingEmail] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)

  const activeStart = period === "custom" ? appliedCustom.start : ""
  const activeEnd = period === "custom" ? appliedCustom.end : ""

  const fetchSummary = useCallback(async () => {
    if (period === "custom" && (!activeStart || !activeEnd)) {
      setSummary(null)
      setError(null)
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      setError(null)
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error("Please sign in to view reports.")
      if (session.user.email) {
        setUserEmail(session.user.email)
        setEmailRecipient((current) => current || session.user.email || "")
      }
      const params = reportQuery(period, activeStart, activeEnd)
      const response = await fetch(`/api/reports?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        credentials: "include",
        cache: "no-store"
      })
      const payload = await response.json() as ReportSummary & { error?: string }
      if (!response.ok) throw new Error(payload.error || "Failed to load report")
      setSummary(payload)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load report")
    } finally {
      setLoading(false)
    }
  }, [activeEnd, activeStart, period])

  useEffect(() => {
    void fetchSummary()
  }, [fetchSummary])
  useDashboardAutoRefresh({ refresh: fetchSummary, refreshOnMount: false })

  useEffect(() => {
    if (emailOpen) emailRef.current?.focus()
  }, [emailOpen])

  function applyCustomRange() {
    if (!customStart || !customEnd) {
      setError("Choose both a start date and an end date.")
      return
    }
    if (customEnd < customStart) {
      setError("End date must be on or after the start date.")
      return
    }
    setAppliedCustom({ start: customStart, end: customEnd })
  }

  async function download(format: "csv" | "pdf") {
    if (period === "custom" && (!activeStart || !activeEnd)) return
    try {
      setExporting(format)
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error("Please sign in to export reports.")
      const params = reportQuery(period, activeStart, activeEnd)
      params.set("format", format)
      const response = await fetch(`/api/reports/download?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        credentials: "include",
        cache: "no-store"
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(payload?.error || "Failed to export report")
      }
      const blob = await response.blob()
      const disposition = response.headers.get("content-disposition") || ""
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `pinetree-report.${format}`
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = objectUrl
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(objectUrl)
      toast.success(`${format.toUpperCase()} report downloaded.`)
    } catch (exportError) {
      toast.error(exportError instanceof Error ? exportError.message : "Failed to export report")
    } finally {
      setExporting(null)
    }
  }

  async function sendEmail() {
    const recipient = emailRecipient.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      toast.error("Enter a valid email address.")
      return
    }
    try {
      setSendingEmail(true)
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error("Please sign in to email reports.")
      const response = await fetch("/api/reports/email", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json"
        },
        credentials: "include",
        body: JSON.stringify({
          type: period,
          email: recipient,
          startDate: period === "custom" ? activeStart : undefined,
          endDate: period === "custom" ? activeEnd : undefined
        })
      })
      const payload = await response.json() as { error?: string }
      if (!response.ok) throw new Error(payload.error || "Failed to send report")
      setEmailOpen(false)
      toast.success(`Report sent to ${recipient}.`)
    } catch (emailError) {
      toast.error(emailError instanceof Error ? emailError.message : "Failed to send report")
    } finally {
      setSendingEmail(false)
    }
  }

  const reconciled = Boolean(
    summary?.reconciliation.providerMatchesGross &&
    summary.reconciliation.railMatchesGross &&
    summary.reconciliation.assetMatchesCrypto
  )

  return (
    <div className="space-y-5 md:space-y-7">
      <h1 className={dashboardPageTitleClass}>Reports</h1>

      {!loading && summary ? (
        <DashboardHeroCard
          eyebrow={`${PERIODS.find((option) => option.value === period)?.label || "Report"}${summary.isInProgress ? " · In progress" : ""}`}
          title="Confirmed gross sales"
          value={currency(summary.grossVolume)}
          detail={`${summary.confirmedCount} confirmed of ${summary.transactionCount} tracked transactions.`}
          secondary={<div className="grid min-w-[300px] grid-cols-2 divide-x divide-blue-200/80"><InlineMetric label="Merchant net" value={currency(summary.netSettlements)} className="pr-4" /><InlineMetric label="PineTree fees" value={currency(summary.pineTreeFees)} className="pl-4" /></div>}
        />
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button onClick={() => void download("csv")} disabled={!summary || loading || Boolean(exporting)} className="rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm font-semibold text-gray-700 disabled:opacity-50">
          {exporting === "csv" ? "Exporting…" : "Export CSV"}
        </button>
        <button onClick={() => void download("pdf")} disabled={!summary || loading || Boolean(exporting)} className="rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm font-semibold text-gray-700 disabled:opacity-50">
          {exporting === "pdf" ? "Exporting…" : "Download PDF"}
        </button>
        <PrimaryActionButton onClick={() => { setEmailRecipient(userEmail); setEmailOpen(true) }} disabled={!summary || loading}>
          Email report
        </PrimaryActionButton>
      </div>

      <div className="rounded-2xl border border-gray-200/80 bg-white p-3 shadow-sm">
        <SegmentedButtons
          ariaLabel="Report period"
          className="flex flex-nowrap gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          value={period}
          onChange={(value) => { setPeriod(value); setError(null) }}
          options={PERIODS.map((option) => ({ value: option.value, label: option.label }))}
        />
        {period === "custom" ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <label className="text-xs font-semibold text-gray-600">Start date<input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} className="mt-1 block h-10 w-full rounded-xl border border-gray-200 px-3 text-sm font-normal text-gray-900" /></label>
            <label className="text-xs font-semibold text-gray-600">End date<input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} className="mt-1 block h-10 w-full rounded-xl border border-gray-200 px-3 text-sm font-normal text-gray-900" /></label>
            <PrimaryActionButton onClick={applyCustomRange} className="mt-auto">Apply range</PrimaryActionButton>
          </div>
        ) : null}
      </div>

      {error ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <div className="flex flex-wrap items-center justify-between gap-3"><span>{error}</span><button type="button" onClick={() => void fetchSummary()} className="font-semibold underline">Try again</button></div>
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-gray-200 bg-white px-5 py-12 text-center text-sm text-gray-500">Loading report…</div>
      ) : summary ? (
        <>
          {!reconciled ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              Report totals need review. Provider, rail, or crypto asset totals differ by {currency(summary.reconciliation.variance)}.
            </div>
          ) : (
            <div className="rounded-2xl border border-blue-200/80 bg-blue-50/80 px-4 py-3 text-sm font-medium text-blue-800 shadow-[0_8px_24px_rgba(37,99,235,0.07)]">Provider and rail totals reconcile to confirmed gross sales, and crypto assets reconcile to crypto volume.</div>
          )}

          <DashboardSection title="Summary" titleTone="blue">
            <div className="grid gap-3 lg:grid-cols-2">
              <GroupedMetricSurface dense titleTone="blue" title="Volume Summary">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 lg:grid-cols-4">
                  <InlineMetric size="compact" label="Average confirmed transaction" value={currency(summary.avgTransaction)} className="border-b border-gray-100 pb-2.5 lg:border-b-0 lg:pb-0" />
                  <InlineMetric size="compact" label="Card volume" value={currency(summary.cardVolume)} className="border-b border-gray-100 pb-2.5 lg:border-b-0 lg:pb-0" />
                  <InlineMetric size="compact" label="Crypto volume" value={currency(summary.cryptoVolume)} />
                  <InlineMetric size="compact" label="Cash volume" value={currency(summary.cashVolume)} />
                </div>
              </GroupedMetricSurface>
              <GroupedMetricSurface dense titleTone="blue" title="Payment Activity">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 lg:grid-cols-4">
                  <InlineMetric size="compact" label="Tax collected" value={currency(summary.taxesCollected)} className="border-b border-gray-100 pb-2.5 lg:border-b-0 lg:pb-0" />
                  <InlineMetric size="compact" label="Refunds" value={`${summary.refundedCount} · ${currency(summary.refundedAmount)}`} className="border-b border-gray-100 pb-2.5 lg:border-b-0 lg:pb-0" />
                  <InlineMetric size="compact" label="Pending / processing" value={`${summary.waitingCount} / ${summary.processingCount}`} />
                  <InlineMetric size="compact" label="Failed / incomplete" value={`${summary.failedCount} / ${summary.incompleteCount}`} />
                </div>
              </GroupedMetricSurface>
            </div>
          </DashboardSection>

          <DashboardSection title="Breakdowns" titleTone="blue">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Breakdown title="Providers" totals={summary.providerTotals} formatLabel={formatDashboardProvider} />
              <Breakdown title="Rails" totals={summary.railTotals} />
              <Breakdown title="Assets" totals={summary.assetTotals} />
              <Breakdown title="Networks" totals={summary.networkTotals} formatLabel={formatDashboardNetwork} />
            </div>
          </DashboardSection>

          <DashboardSection title="Status breakdown" titleTone="blue">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {Object.entries(summary.statusCounts).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
                <div key={status} className="rounded-xl border border-gray-200 bg-white px-3.5 py-2.5"><p className="truncate text-[10px] font-semibold uppercase tracking-[0.13em] text-gray-500">{status}</p><p className="mt-0.5 text-base font-semibold leading-tight text-gray-950 sm:text-lg">{count}</p></div>
              ))}
            </div>
          </DashboardSection>

          <DashboardSection title="Transaction ledger" titleTone="blue">
            {summary.totalLedgerRows === 0 ? (
              <div className="rounded-2xl border border-gray-200 bg-white px-5 py-10 text-center text-sm text-gray-500">No transactions were recorded in this period.</div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
                <table className="min-w-[880px] w-full text-left text-sm">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Reference</th><th className="px-4 py-3">Provider</th><th className="px-4 py-3">Rail</th><th className="px-4 py-3">Network / asset</th><th className="px-4 py-3 text-right">Gross</th><th className="px-4 py-3 text-right">Fee</th><th className="px-4 py-3">Status</th></tr></thead>
                  <tbody className="divide-y divide-gray-100">{summary.transactionsTable.map((row) => (
                    <tr key={`${row.paymentId}-${row.reference}`}><td className="whitespace-nowrap px-4 py-3 text-gray-600">{new Intl.DateTimeFormat("en-US", { timeZone: summary.timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(row.dateTime))}</td><td className="max-w-[180px] truncate px-4 py-3 font-mono text-xs text-gray-600">{row.reference}</td><td className="px-4 py-3">{formatDashboardProvider(row.provider)}</td><td className="px-4 py-3">{row.rail}</td><td className="px-4 py-3">{formatDashboardNetwork(row.network)} · {row.asset}</td><td className="px-4 py-3 text-right font-semibold">{currency(row.gross)}</td><td className="px-4 py-3 text-right">{currency(row.pinetreeFee)}</td><td className="px-4 py-3"><StatusBadge status={row.canonicalStatus} /></td></tr>
                  ))}</tbody>
                </table>
                {summary.transactionsTruncated ? <p className="border-t border-gray-100 px-4 py-3 text-xs text-gray-500">Showing the first {summary.transactionsTable.length} of {summary.totalLedgerRows} rows. CSV export includes the complete period.</p> : null}
              </div>
            )}
          </DashboardSection>
        </>
      ) : period === "custom" ? (
        <div className="rounded-2xl border border-gray-200 bg-white px-5 py-10 text-center text-sm text-gray-500">Choose a custom date range to generate a report.</div>
      ) : null}

      {emailOpen ? (
        <div data-pinetree-overlay="true" className="pinetree-modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-4" onClick={(event) => { if (event.target === event.currentTarget && !sendingEmail) setEmailOpen(false) }}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-base font-semibold text-gray-950">Email this report</h2>
            <p className="mt-1 text-sm text-gray-500">The attachment will use the selected period and exact date boundaries shown above.</p>
            <input ref={emailRef} type="email" value={emailRecipient} onChange={(event) => setEmailRecipient(event.target.value)} className="mt-4 h-11 w-full rounded-xl border border-gray-200 px-3 text-sm" placeholder="you@example.com" />
            <div className="mt-4 flex gap-2"><button type="button" onClick={() => void sendEmail()} disabled={sendingEmail} className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{sendingEmail ? "Sending…" : "Send report"}</button><button type="button" onClick={() => setEmailOpen(false)} disabled={sendingEmail} className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700">Cancel</button></div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
