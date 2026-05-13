"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabaseClient"
import {
  CompactMetricTile,
  DashboardHeroCard,
  DashboardSection,
  GroupedMetricSurface,
  MetricGrid,
  PineTreeInsightsCard
} from "@/components/dashboard/DashboardPrimitives"
import {
  formatDashboardNetwork,
  formatDashboardProvider
} from "@/components/dashboard/displayHelpers"

type ReportSummary = {
  totalVolume: number
  merchantNet: number
  estimatedTax: number
  transactionCount: number
  avgTransaction: number
  failedPayments: number
  providerTotals: Record<string, number>
  channelTotals: Record<string, number>
  networkTotals: Record<string, number>
}

export default function ReportsPage() {
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState<ReportSummary | null>(null)

  const fetchSummary = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return

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

  async function generateReport(type: string) {
    try {
      setLoading(true)
      toast("Generating report...")

      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        toast.error("Please sign in to generate reports")
        return
      }

      let start = new Date()
      let end = new Date()

      if (type === "today") {
        start.setHours(0, 0, 0, 0)
      }

      if (type === "yesterday") {
        start = new Date()
        start.setDate(start.getDate() - 1)
        start.setHours(0, 0, 0, 0)
        end = new Date(start)
        end.setHours(23, 59, 59, 999)
      }

      if (type === "month") {
        start = new Date(start.getFullYear(), start.getMonth(), 1)
      }

      if (type === "year") {
        start = new Date(start.getFullYear(), 0, 1)
      }

      const url = `/api/reports/pdf?startDate=${start.toISOString()}&endDate=${end.toISOString()}&type=${type}&token=${encodeURIComponent(session.access_token)}`
      window.open(url, "_blank")
      toast.success("Report opened in new tab")
    } catch {
      toast.error("Failed to generate report")
    } finally {
      setLoading(false)
    }
  }

  const fmt = (n: number) => `$${n.toFixed(2)}`
  const successfulPayments = summary
    ? Math.max(0, summary.transactionCount - summary.failedPayments)
    : 0
  const successRate = summary && summary.transactionCount > 0
    ? Math.round((successfulPayments / summary.transactionCount) * 100)
    : 0
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

  return (
    <div className="space-y-5 md:space-y-7">
      <div>
        <h1 className="text-2xl font-semibold text-gray-950 md:text-3xl">Reports</h1>
      </div>

      <DashboardHeroCard
        eyebrow="Month To Date"
        title="Financial summary"
        value={summary ? fmt(summary.totalVolume) : "$0.00"}
        detail="Gross volume across the current report window."
        secondary={
          <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:min-w-[280px]">
            <CompactMetricTile
              label="Net Settlements"
              value={summary ? fmt(summary.merchantNet) : "$0.00"}
              className="p-3 shadow-none"
            />
            <CompactMetricTile
              label="Est. Taxes"
              value={summary ? fmt(summary.estimatedTax) : "$0.00"}
              tone="amber"
              className="p-3 shadow-none"
            />
          </div>
        }
      />

      <MetricGrid columns="four">
        <CompactMetricTile
          label="Transactions"
          value={summary ? String(summary.transactionCount) : "0"}
        />
        <CompactMetricTile
          label="Avg Transaction"
          value={summary ? fmt(summary.avgTransaction) : "$0.00"}
          tone="blue"
        />
        <CompactMetricTile
          label="Failed"
          value={summary ? String(summary.failedPayments) : "0"}
          tone={summary?.failedPayments ? "red" : "green"}
        />
        <CompactMetricTile
          label="Success Rate"
          value={`${successRate}%`}
          tone="green"
        />
      </MetricGrid>

      {summary && (
        <PineTreeInsightsCard
          insights={insights}
          emptyText="Report insights will appear when the current summary includes transaction volume."
        />
      )}

      <DashboardSection title="Financial Reports" titleTone="blue">
        <GroupedMetricSurface>
          <div className="grid grid-cols-1 divide-y divide-gray-100 md:grid-cols-3 md:divide-x md:divide-y-0">
          <ReportCard title="Today's Report"    description="Summary of today's transactions and totals"          loading={loading} action={() => generateReport("today")} />
          <ReportCard title="Yesterday's Report" description="Detailed summary of yesterday's transactions"       loading={loading} action={() => generateReport("yesterday")} />
          <ReportCard title="Monthly Report"    description="Complete monthly financial summary"                  loading={loading} action={() => generateReport("month")} />
          </div>
        </GroupedMetricSurface>
      </DashboardSection>

      <DashboardSection title="Tax & Compliance" titleTone="blue">
        <GroupedMetricSurface>
          <div className="grid grid-cols-1 divide-y divide-gray-100 md:grid-cols-3 md:divide-x md:divide-y-0">
          <ReportCard title="Tax Report"         description="Generate tax summary for accounting or filing"      loading={loading} action={() => generateReport("month")} />
          <ReportCard title="Yearly Summary"     description="Annual financial summary report"                    loading={loading} action={() => generateReport("year")} />
          <ReportCard title="Transaction Export" description="Download full transaction history for bookkeeping"  loading={loading} action={() => generateReport("month")} />
          </div>
        </GroupedMetricSurface>
      </DashboardSection>
    </div>
  )
}

function ReportCard({ title, description, action, loading }: {
  title: string
  description: string
  action: () => void
  loading: boolean
}) {
  return (
    <div className="min-w-0 p-3 md:p-4">
      <div className="text-sm font-semibold text-gray-950">{title}</div>
      <div className="mt-1 min-h-10 text-sm leading-5 text-gray-600">{description}</div>
      <button
        onClick={action}
        disabled={loading}
        className="mt-3 inline-flex min-h-10 w-fit items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "Generating..." : "Generate PDF"}
      </button>
    </div>
  )
}
