"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabaseClient"

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

  return (
    <div className="space-y-8 md:space-y-10">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl md:text-3xl font-semibold text-gray-900">Reports</h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 md:gap-6">
        <SummaryCard title="Gross Volume"       value={summary ? fmt(summary.totalVolume)    : "$0.00"} />
        <SummaryCard title="Transactions"        value={summary ? String(summary.transactionCount) : "0"} />
        <SummaryCard title="Net Settlements"     value={summary ? fmt(summary.merchantNet)    : "$0.00"} />
        <SummaryCard title="Estimated Taxes"     value={summary ? fmt(summary.estimatedTax)   : "$0.00"} />
      </div>

      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
          <SummaryCard title="Avg Transaction"   value={fmt(summary.avgTransaction)} />
          <SummaryCard title="Failed Payments"   value={String(summary.failedPayments)} />
          <SummaryCard title="PineTree Fees"     value={fmt(summary.totalVolume - summary.merchantNet)} />
        </div>
      )}

      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-gray-900">Financial Reports</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
          <ReportCard title="Today's Report"    description="Summary of today's transactions and totals"          loading={loading} action={() => generateReport("today")} />
          <ReportCard title="Yesterday's Report" description="Detailed summary of yesterday's transactions"       loading={loading} action={() => generateReport("yesterday")} />
          <ReportCard title="Monthly Report"    description="Complete monthly financial summary"                  loading={loading} action={() => generateReport("month")} />
        </div>
      </div>

      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-gray-900">Tax & Compliance</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
          <ReportCard title="Tax Report"         description="Generate tax summary for accounting or filing"      loading={loading} action={() => generateReport("month")} />
          <ReportCard title="Yearly Summary"     description="Annual financial summary report"                    loading={loading} action={() => generateReport("year")} />
          <ReportCard title="Transaction Export" description="Download full transaction history for bookkeeping"  loading={loading} action={() => generateReport("month")} />
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 md:p-5 shadow-sm min-w-0">
      <div className="text-sm text-gray-500">{title}</div>
      <div className="text-2xl font-semibold text-gray-900 mt-1">{value}</div>
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
    <div className="border border-gray-200 rounded-lg p-4 md:p-6 bg-white shadow-sm space-y-4 min-w-0">
      <div className="text-lg font-semibold text-gray-900">{title}</div>
      <div className="text-sm text-gray-600">{description}</div>
      <button
        onClick={action}
        disabled={loading}
        className="w-full sm:w-auto bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition disabled:opacity-50"
      >
        {loading ? "Generating..." : "Generate PDF"}
      </button>
    </div>
  )
}
