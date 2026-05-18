"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabaseClient"
import {
  CompactMetricTile,
  DashboardHeroCard,
  DashboardSection,
  GroupedMetricSurface,
  PineTreeInsightsCard
} from "@/components/dashboard/DashboardPrimitives"
import {
  formatDashboardNetwork,
  formatDashboardProvider
} from "@/components/dashboard/displayHelpers"

type ReportSummary = {
  grossVolume?: number
  totalVolume: number
  netSettlements?: number
  merchantNet: number
  estimatedTax: number
  taxesCollected?: number
  transactionCount: number
  avgTransaction: number
  failedPayments: number
  confirmedCount?: number
  successRate?: number
  providerTotals: Record<string, number>
  channelTotals: Record<string, number>
  networkTotals: Record<string, number>
}

type ReportKind = "today" | "yesterday" | "weekly" | "month" | "tax" | "year" | "transactions"

const REPORT_TITLES: Record<ReportKind, string> = {
  today: "Today's Report",
  yesterday: "Yesterday's Report",
  weekly: "Weekly Report",
  month: "Monthly Report",
  tax: "Tax Report",
  year: "Yearly Summary",
  transactions: "Transaction Export"
}

export default function ReportsPage() {
  const [loadingType, setLoadingType] = useState<ReportKind | null>(null)
  const [summary, setSummary] = useState<ReportSummary | null>(null)
  const [reportStatus, setReportStatus] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState("")

  // Email modal state
  const [emailModal, setEmailModal] = useState<{ type: ReportKind } | null>(null)
  const [emailRecipient, setEmailRecipient] = useState("")
  const [sendingEmail, setSendingEmail] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const emailInputRef = useRef<HTMLInputElement>(null)

  const fetchSummary = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return

      if (session.user?.email) setUserEmail(session.user.email)

      const start = new Date()
      start.setDate(1)
      start.setHours(0, 0, 0, 0)
      const end = new Date()

      const res = await fetch(
        `/api/reports?startDate=${start.toISOString()}&endDate=${end.toISOString()}`,
        {
          headers: { Authorization: `Bearer ${session.access_token}` },
          credentials: "include",
          cache: "no-store"
        }
      )
      if (!res.ok) return
      const data = (await res.json()) as ReportSummary
      setSummary(data)
    } catch {
      // Non-fatal — summary cards will show $0.00
    }
  }, [])

  useEffect(() => {
    void fetchSummary()
  }, [fetchSummary])

  // Focus email input when modal opens
  useEffect(() => {
    if (emailModal) {
      setTimeout(() => emailInputRef.current?.focus(), 50)
    }
  }, [emailModal])

  async function generateReport(type: ReportKind) {
    try {
      setLoadingType(type)
      setReportStatus(null)
      const isCsv = type === "transactions"
      toast(`Generating ${isCsv ? "CSV" : "PDF"}...`)

      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        toast.error("Please sign in to generate reports")
        return
      }

      const res = await fetch(`/api/reports/download?type=${type}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        credentials: "include",
        cache: "no-store"
      })

      if (!res.ok) {
        const payload = await res.json().catch(() => null) as { error?: string } | null
        throw new Error(payload?.error || "Failed to generate report")
      }

      const blob = await res.blob()
      const disposition = res.headers.get("content-disposition") || ""
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/i)
      const filename = filenameMatch?.[1] || `pinetree-report.${isCsv ? "csv" : "pdf"}`
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = objectUrl
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(objectUrl)
      const message = `${isCsv ? "CSV export" : "PDF report"} downloaded.`
      setReportStatus(message)
      toast.success(message)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to generate report"
      setReportStatus(message)
      toast.error(message)
    } finally {
      setLoadingType(null)
    }
  }

  function openEmailModal(type: ReportKind) {
    setEmailRecipient(userEmail)
    setEmailError(null)
    setEmailModal({ type })
  }

  function closeEmailModal() {
    if (sendingEmail) return
    setEmailModal(null)
    setEmailError(null)
  }

  async function sendReport() {
    if (!emailModal) return
    const recipient = emailRecipient.trim()
    if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      setEmailError("Please enter a valid email address.")
      return
    }

    try {
      setSendingEmail(true)
      setEmailError(null)

      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setEmailError("Please sign in to send reports.")
        return
      }

      const res = await fetch("/api/reports/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        credentials: "include",
        body: JSON.stringify({ type: emailModal.type, email: recipient })
      })

      const payload = (await res.json()) as { error?: string; sentTo?: string; filename?: string }

      if (!res.ok) {
        throw new Error(payload.error || "Failed to send report")
      }

      setEmailModal(null)
      toast.success(`${REPORT_TITLES[emailModal.type]} sent to ${payload.sentTo ?? recipient}`)
    } catch (error) {
      setEmailError(error instanceof Error ? error.message : "Failed to send report email")
    } finally {
      setSendingEmail(false)
    }
  }

  const fmt = (n: number) => `$${n.toFixed(2)}`
  const successfulPayments = summary
    ? Number(summary.confirmedCount ?? Math.max(0, summary.transactionCount - summary.failedPayments))
    : 0
  const successRate = summary?.successRate ?? (summary && summary.transactionCount > 0
    ? Math.round((successfulPayments / summary.transactionCount) * 100)
    : 0)
  const topProvider = summary
    ? Object.entries(summary.providerTotals || {}).sort((a, b) => b[1] - a[1])[0]
    : null
  const topNetwork = summary
    ? Object.entries(summary.networkTotals || {}).sort((a, b) => b[1] - a[1])[0]
    : null
  const insights = [
    topProvider && topProvider[1] > 0 ? `${formatDashboardProvider(topProvider[0])} leads provider volume for this reporting period.` : "",
    topNetwork && topNetwork[1] > 0 ? `${formatDashboardNetwork(topNetwork[0])} is the highest-volume network in the current summary.` : "",
    summary && summary.transactionCount > 0 ? `${successRate}% of tracked payments are confirmed or successful in this summary.` : ""
  ]

  const anyLoading = Boolean(loadingType)

  return (
    <div className="space-y-5 md:space-y-7">
      <div>
        <h1 className="text-2xl font-semibold text-gray-950 md:text-3xl">Reports</h1>
      </div>

      <DashboardHeroCard
        eyebrow="Month To Date"
        title="Financial summary"
        value={summary ? fmt(summary.grossVolume ?? summary.totalVolume) : "$0.00"}
        detail="Gross volume across the current report window."
        secondary={
          <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:min-w-[280px]">
            <CompactMetricTile
              label="Net Settlements"
              value={summary ? fmt(summary.netSettlements ?? summary.merchantNet) : "$0.00"}
              className="p-3 shadow-none"
            />
            <CompactMetricTile
              label="Est. Taxes"
              value={summary ? fmt(summary.taxesCollected ?? summary.estimatedTax) : "$0.00"}
              tone="amber"
              className="p-3 shadow-none"
            />
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:gap-4">
        <ReportStatTile label="Transactions"    value={summary ? String(summary.transactionCount) : "0"} />
        <ReportStatTile label="Avg Transaction" value={summary ? fmt(summary.avgTransaction) : "$0.00"}  accent="blue" />
        <ReportStatTile label="Failed"          value={summary ? String(summary.failedPayments) : "0"}   accent={summary?.failedPayments ? "red" : "green"} />
        <ReportStatTile label="Success Rate"    value={`${successRate}%`}                                accent="green" />
      </div>

      {summary && (
        <PineTreeInsightsCard
          insights={insights}
          emptyText="Report insights will appear when the current summary includes transaction volume."
        />
      )}

      {reportStatus && (
        <div className="rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm font-medium text-blue-700 shadow-sm">
          {reportStatus}
        </div>
      )}

      <DashboardSection title="Financial Reports" titleTone="blue">
        <GroupedMetricSurface>
          <div className="grid grid-cols-1 divide-y divide-gray-100 md:grid-cols-4 md:divide-x md:divide-y-0">
            <ReportCard title="Today's Report"     description="Summary of today's transactions and totals"        loading={loadingType === "today"}     disabled={anyLoading} actionLabel="Download PDF" action={() => generateReport("today")}     onEmail={() => openEmailModal("today")} />
            <ReportCard title="Yesterday's Report" description="Detailed summary of yesterday's transactions"     loading={loadingType === "yesterday"} disabled={anyLoading} actionLabel="Download PDF" action={() => generateReport("yesterday")} onEmail={() => openEmailModal("yesterday")} />
            <ReportCard title="Weekly Report"      description="Seven-day financial summary and ledger detail"    loading={loadingType === "weekly"}    disabled={anyLoading} actionLabel="Download PDF" action={() => generateReport("weekly")}    onEmail={() => openEmailModal("weekly")} />
            <ReportCard title="Monthly Report"     description="Complete monthly financial summary"               loading={loadingType === "month"}     disabled={anyLoading} actionLabel="Download PDF" action={() => generateReport("month")}     onEmail={() => openEmailModal("month")} />
          </div>
        </GroupedMetricSurface>
      </DashboardSection>

      <DashboardSection title="Tax & Compliance" titleTone="blue">
        <GroupedMetricSurface>
          <div className="grid grid-cols-1 divide-y divide-gray-100 md:grid-cols-3 md:divide-x md:divide-y-0">
            <ReportCard title="Tax Report"         description="Taxable sales and tax collected for the month"    loading={loadingType === "tax"}          disabled={anyLoading} actionLabel="Download PDF" action={() => generateReport("tax")}          onEmail={() => openEmailModal("tax")} />
            <ReportCard title="Yearly Summary"     description="Annual financial summary report"                  loading={loadingType === "year"}         disabled={anyLoading} actionLabel="Download PDF" action={() => generateReport("year")}         onEmail={() => openEmailModal("year")} />
            <ReportCard title="Transaction Export" description="CSV ledger export for the current report window"  loading={loadingType === "transactions"} disabled={anyLoading} actionLabel="Download CSV" action={() => generateReport("transactions")} onEmail={() => openEmailModal("transactions")} />
          </div>
        </GroupedMetricSurface>
      </DashboardSection>

      {/* Email modal */}
      {emailModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) closeEmailModal() }}
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-1 text-base font-semibold text-gray-950">
              Email {REPORT_TITLES[emailModal.type]}
            </div>
            <div className="mb-5 text-sm text-gray-500">
              Enter a recipient email address. The report will be generated and attached automatically.
            </div>

            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              Recipient
            </label>
            <input
              ref={emailInputRef}
              type="email"
              value={emailRecipient}
              onChange={(e) => { setEmailRecipient(e.target.value); setEmailError(null) }}
              onKeyDown={(e) => { if (e.key === "Enter") void sendReport() }}
              placeholder="you@example.com"
              disabled={sendingEmail}
              className="mb-1.5 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
            />

            {emailError && (
              <div className="mb-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-medium text-red-600">
                {emailError}
              </div>
            )}

            <div className="mt-4 flex gap-2.5">
              <button
                onClick={() => void sendReport()}
                disabled={sendingEmail}
                className="flex-1 inline-flex min-h-10 items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
              >
                {sendingEmail ? "Sending…" : "Send Report"}
              </button>
              <button
                onClick={closeEmailModal}
                disabled={sendingEmail}
                className="inline-flex min-h-10 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

type StatAccent = "blue" | "green" | "red" | "neutral"

function ReportStatTile({
  label,
  value,
  accent = "neutral"
}: {
  label: string
  value: string
  accent?: StatAccent
}) {
  const surface: Record<StatAccent, string> = {
    blue:    "bg-[#0c1a35] border border-blue-900/50 shadow-[0_8px_28px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(59,130,246,0.08)]",
    green:   "bg-[#091c14] border border-emerald-900/45 shadow-[0_8px_28px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(16,185,129,0.07)]",
    red:     "bg-[#1b0b0d] border border-red-900/40 shadow-[0_8px_28px_rgba(0,0,0,0.34)]",
    neutral: "bg-[#0f1728] border border-[#1e2c47] shadow-[0_8px_28px_rgba(0,0,0,0.30)]",
  }
  const labelCls: Record<StatAccent, string> = {
    blue:    "text-blue-400",
    green:   "text-emerald-400",
    red:     "text-red-400",
    neutral: "text-slate-400",
  }

  return (
    <div className={`min-w-0 rounded-2xl p-3.5 sm:p-4 ${surface[accent]}`}>
      <p className={`truncate text-[10px] font-semibold uppercase tracking-[0.13em] ${labelCls[accent]}`}>
        {label}
      </p>
      <div className="mt-1.5 min-w-0 text-xl font-semibold leading-tight text-white sm:text-2xl">
        {value}
      </div>
    </div>
  )
}

function ReportCard({ title, description, action, loading, disabled, actionLabel, onEmail }: {
  title: string
  description: string
  action: () => void
  loading: boolean
  disabled: boolean
  actionLabel: string
  onEmail: () => void
}) {
  return (
    <div className="min-w-0 p-3 md:p-4">
      <div className="text-sm font-semibold text-gray-950">{title}</div>
      <div className="mt-1 min-h-10 text-sm leading-5 text-gray-600">{description}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={action}
          disabled={disabled}
          className="inline-flex min-h-9 items-center justify-center rounded-xl bg-blue-600 px-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Generating..." : actionLabel}
        </button>
        <button
          onClick={onEmail}
          disabled={disabled}
          className="inline-flex min-h-9 items-center justify-center rounded-xl border border-gray-200 bg-white px-3.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
        >
          Email
        </button>
      </div>
    </div>
  )
}
