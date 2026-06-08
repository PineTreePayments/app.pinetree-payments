"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  BarChart3,
  Boxes,
  ChevronRight,
  Link2,
  ReceiptText,
  ShoppingCart,
  WalletCards
} from "lucide-react"
import { supabase } from "@/lib/supabaseClient"
import { AUTO_POLLING_ENABLED } from "@/lib/utils/polling"
import TransactionActivityTable, {
  type DashboardTransactionRow
} from "./TransactionActivityTable"

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid
} from "recharts"
import {
  ChartCard,
  DashboardSection,
  GroupedMetricSurface,
  InlineMetric,
  PineTreeInsightsCard,
  dashboardHeroValueClass,
  dashboardPageTitleClass,
  dashboardSectionLabelClass,
  dashboardSupportingTextClass,
} from "@/components/dashboard/DashboardPrimitives"

type DashboardOverviewResponse = {
  success?: boolean
  volume?: number
  txCount?: number
  successRate?: number
  providers?: number
  recentTx?: DashboardTransactionRow[]
  chartData?: ChartPoint[]
  walletValue?: number
  lastRun?: string | null
  today?: {
    volume: number
    transactionCount: number
    averageTransaction: number
    confirmed: number
    incomplete: number
    failed: number
  }
  railBreakdown?: Record<string, { count: number; volume: number }>
  railReadiness?: Array<{
    id: string
    label: string
    status: "Connected" | "Not Connected" | "Requires Configuration" | "Disabled"
    detail: string
  }>
  inventory?: {
    available: boolean
    totalItems: number
    lowStock: number
    outOfStock: number
    connectedProviders?: number
    lastSyncAt?: string | null
  }
  error?: string
}

type ChartPoint = {
  date: string
  volume: number
}

type ChartRange = "7D" | "30D" | "90D" | "ALL"

function parseTimestamp(value: string) {
  const hasTimezone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value)
  return new Date(hasTimezone ? value : `${value}Z`)
}

function formatUsd(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(Number.isFinite(amount) ? amount : 0)
}

function getChartWindow(data: ChartPoint[], range: ChartRange) {
  if (range === "ALL" || data.length === 0) return data

  const daysByRange: Record<Exclude<ChartRange, "ALL">, number> = {
    "7D": 7,
    "30D": 30,
    "90D": 90
  }
  const days = daysByRange[range]
  const datedRows = data
    .map((point) => ({ point, date: parseTimestamp(point.date) }))
    .filter((row) => !Number.isNaN(row.date.getTime()))

  if (!datedRows.length) {
    return data.slice(Math.max(data.length - days, 0))
  }

  const latest = new Date(Math.max(...datedRows.map((row) => row.date.getTime())))
  const cutoff = new Date(latest)
  cutoff.setDate(cutoff.getDate() - (days - 1))
  cutoff.setHours(0, 0, 0, 0)

  const filtered = datedRows
    .filter((row) => row.date >= cutoff)
    .map((row) => row.point)

  return filtered.length ? filtered : data
}

export default function DashboardPage() {
  const [volume, setVolume] = useState(0)
  const [txCount, setTxCount] = useState(0)
  const [successRate, setSuccessRate] = useState(0)
  const [recentTx, setRecentTx] = useState<DashboardTransactionRow[]>([])
  const [chartData, setChartData] = useState<ChartPoint[]>([])
  const [today, setToday] = useState<NonNullable<DashboardOverviewResponse["today"]>>({
    volume: 0,
    transactionCount: 0,
    averageTransaction: 0,
    confirmed: 0,
    incomplete: 0,
    failed: 0
  })
  const [railReadiness, setRailReadiness] = useState<NonNullable<DashboardOverviewResponse["railReadiness"]>>([])
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [chartRange, setChartRange] = useState<ChartRange>("30D")
  const [chartExpanded, setChartExpanded] = useState(false)

  const callOverviewApi = useCallback(async (sync: boolean) => {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token

    if (!token) {
      throw new Error("No active auth session")
    }

    const endpoint = sync ? "/api/dashboard/overview?sync=1" : "/api/dashboard/overview"
    const res = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      credentials: "include",
      cache: "no-store"
    })

    const payload = (await res.json().catch(() => null)) as DashboardOverviewResponse | null

    if (!res.ok) {
      throw new Error(payload?.error || "Failed to load dashboard overview")
    }

    return payload || {}
  }, [])

  const applyOverviewPayload = useCallback((payload: DashboardOverviewResponse) => {
    setVolume(Number(payload.volume ?? 0))
    setTxCount(Number(payload.txCount ?? 0))
    setSuccessRate(Number(payload.successRate ?? 0))
    setChartData(payload.chartData || [])
    setRecentTx(payload.recentTx || [])
    if (payload.today) setToday(payload.today)
    setRailReadiness(payload.railReadiness || [])
  }, [])

  const loadOverview = useCallback(async () => {
    const payload = await callOverviewApi(false)
    applyOverviewPayload(payload)
  }, [applyOverviewPayload, callOverviewApi])

  async function syncNow() {
    setIsSyncing(true)
    setSyncError(null)
    try {
      const payload = await callOverviewApi(true)
      applyOverviewPayload(payload)
    } catch (err) {
      console.error("Manual sync failed:", err)
      setSyncError(err instanceof Error ? err.message : "Sync failed")
    } finally {
      setIsSyncing(false)
    }
  }

  useEffect(() => {
    void loadOverview().catch((err) => {
      console.error("Dashboard load failed:", err)
    })

    if (!AUTO_POLLING_ENABLED) {
      return
    }

    const interval = setInterval(() => {
      void loadOverview().catch((err) => {
        console.error("Dashboard poll failed:", err)
      })
    }, 15000)

    return () => clearInterval(interval)
  }, [loadOverview])

  const connectedRailRows = railReadiness.filter((rail) => rail.status === "Connected")
  const overviewInsights = [
    today.transactionCount > 0
      ? `Average transaction today is ${formatUsd(today.averageTransaction)}.`
      : "",
    today.transactionCount > 0 && today.failed === 0
      ? "No failed payments today."
      : today.failed > 0
        ? `${today.failed} payment${today.failed === 1 ? "" : "s"} failed today and may need review.`
        : "",
    today.confirmed > 0
      ? `${today.confirmed} confirmed payment${today.confirmed === 1 ? "" : "s"} generated ${formatUsd(today.volume)} today.`
      : ""
  ]

  const quickActions = [
    { label: "Open POS", href: "/dashboard/pos", icon: ShoppingCart },
    { label: "Create Checkout Link", href: "/dashboard/checkout", icon: Link2 },
    { label: "View Transactions", href: "/dashboard/transactions", icon: ReceiptText },
    { label: "Manage Wallets", href: "/dashboard/wallets", icon: WalletCards },
    { label: "Open Reports", href: "/dashboard/reports", icon: BarChart3 },
    { label: "Manage Inventory", href: "/dashboard/inventory", icon: Boxes }
  ]

  const visibleChartData = useMemo(
    () => getChartWindow(chartData, chartRange),
    [chartData, chartRange]
  )
  const chartDisplayData = visibleChartData.length > 0
    ? visibleChartData
    : [
      { date: "", volume: 0 },
      { date: "", volume: 0 }
    ]

  const renderChartControls = (showExpand = true) => (
    <div className="flex flex-wrap items-center gap-2">
      {(["7D", "30D", "90D", "ALL"] as ChartRange[]).map((range) => (
        <button
          key={range}
          type="button"
          onClick={() => setChartRange(range)}
          className={`inline-flex h-8 items-center justify-center rounded-full border px-3 text-[11px] font-semibold transition focus:outline-none focus:ring-4 focus:ring-blue-100 ${
            chartRange === range
              ? "border-[#0052FF] bg-[#0052FF] text-white"
              : "border-gray-200 bg-white text-gray-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
          }`}
        >
          {range === "ALL" ? "All" : range}
        </button>
      ))}
      {showExpand && (
        <button
          type="button"
          onClick={() => setChartExpanded(true)}
          className="inline-flex h-8 items-center justify-center rounded-full border border-gray-200 bg-white px-3 text-[11px] font-semibold text-gray-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-100"
        >
          Expand
        </button>
      )}
    </div>
  )

  const renderVolumeChart = (className: string, gradientId = "overviewVolumeGradient") => (
    <div className={className}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={chartDisplayData}
          margin={{ top: 8, right: 8, left: -12, bottom: 16 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#2563eb" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#f1f5f9" strokeDasharray="2 8" vertical={false} />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#64748b", fontSize: 9 }}
            interval="preserveStartEnd"
            minTickGap={36}
            dy={8}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            width={52}
            tick={{ fill: "#64748b", fontSize: 9 }}
            tickFormatter={(value) => formatUsd(Number(value))}
          />
          <Tooltip
            formatter={(value) => [formatUsd(Number(value)), "Volume (USD)"]}
            labelFormatter={(label) => `Date: ${label}`}
            contentStyle={{
              background: "#fff",
              border: "1px solid #dbeafe",
              borderRadius: "12px",
              boxShadow: "0 18px 50px rgba(15,23,42,0.12)",
              fontSize: "12px"
            }}
          />
          <Area
            type="monotone"
            dataKey="volume"
            stroke="#2563eb"
            strokeWidth={2.25}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0, fill: "#1d4ed8" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )

  return (
    <div className="space-y-5 md:space-y-7">

      <div className="flex items-center justify-between gap-3">
        <h1 className={dashboardPageTitleClass}>
          Overview
        </h1>
        <button
          onClick={syncNow}
          disabled={isSyncing}
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 px-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-10 sm:px-4"
        >
          <span className="sm:hidden">{isSyncing ? "Syncing" : "Sync"}</span>
          <span className="hidden sm:inline">{isSyncing ? "Syncing..." : "Sync Now"}</span>
        </button>
      </div>

      {syncError && (
        <p className="text-sm text-red-600 mb-4">Sync error: {syncError}</p>
      )}

      {/* 1 — Today's Confirmed Sales */}
      <div className="relative overflow-hidden rounded-2xl border border-blue-200/80 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.13),transparent_34%),linear-gradient(135deg,#ffffff_0%,#f7fbff_48%,#eef5ff_100%)] px-4 py-3 shadow-[0_10px_28px_rgba(37,99,235,0.09)] sm:px-5 sm:py-3.5">
        <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-blue-300/80 to-transparent" />
        <div className="relative">
          <p className={dashboardSectionLabelClass}>
            Today&apos;s Confirmed Sales
          </p>
          <h2 className={`mt-1 font-medium ${dashboardSupportingTextClass}`}>
            Confirmed merchant payment volume since midnight
          </h2>
          <div className={`mt-0.5 ${dashboardHeroValueClass}`}>
            {formatUsd(today.volume)}
          </div>
          <div className="mt-1 text-xs leading-5 text-gray-600">
            {today.confirmed} confirmed payment{today.confirmed === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      {/* 2 — Performance and health */}
      <div className="grid gap-3 lg:grid-cols-2 md:gap-4">
        <GroupedMetricSurface title="Today's Performance" titleTone="blue">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
            <InlineMetric label="Payments" value={today.transactionCount} />
            <InlineMetric label="Average" value={formatUsd(today.averageTransaction)} />
            <InlineMetric label="Confirmed" value={today.confirmed} />
          </div>
        </GroupedMetricSurface>
        <GroupedMetricSurface title="Activity Health" titleTone="blue">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
            <InlineMetric label="Success Rate" value={`${successRate}%`} />
            <InlineMetric label="Incomplete" value={today.incomplete} />
            <InlineMetric label="Failed" value={today.failed} />
          </div>
        </GroupedMetricSurface>
      </div>

      {/* 3 — Compact payment operations */}
      <DashboardSection title="Payment Operations" titleTone="blue">
        <div className="rounded-2xl border border-blue-100 bg-blue-50/55 px-4 py-3.5 shadow-[0_8px_24px_rgba(37,99,235,0.06)] sm:px-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-left">
              <p className="text-sm font-semibold text-gray-950">
                Active rails:{" "}
                <span className="font-medium text-gray-700">
                  {connectedRailRows.length
                    ? connectedRailRows.map((rail) => rail.label).join(", ")
                    : "None connected"}
                </span>
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-5 sm:pl-6">
              <Link href="/dashboard/providers" className="text-xs font-semibold text-blue-700 hover:text-blue-800">
                Manage Rails
              </Link>
              <Link href="/dashboard/transactions" className="text-xs font-semibold text-blue-700 hover:text-blue-800">
                View Transactions
              </Link>
            </div>
          </div>
        </div>
      </DashboardSection>

      <DashboardSection title="Quick Actions" titleTone="blue" className="md:hidden">
        <div className="rounded-2xl border border-white/80 bg-white/80 p-2 shadow-[0_10px_30px_rgba(15,23,42,0.05)] backdrop-blur">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            {quickActions.map(({ label, href, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="group flex min-h-14 min-w-0 items-center gap-2.5 rounded-xl border border-gray-100 bg-gradient-to-br from-white to-gray-50/80 px-3 py-2.5 text-gray-900 transition hover:-translate-y-0.5 hover:border-blue-200 hover:from-blue-50/70 hover:to-white hover:text-blue-700 hover:shadow-sm"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 ring-1 ring-blue-100 transition group-hover:bg-blue-600 group-hover:text-white">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 text-xs font-semibold leading-4">
                  {label}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-blue-500" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </div>
      </DashboardSection>

      {/* 4 — Transaction Volume */}
      <ChartCard
        title="Transaction Volume"
        titleTone="blue"
        subtitle="Confirmed payment volume over time"
        action={renderChartControls()}
        className="overflow-hidden pb-5 sm:pb-5"
      >
        <div
          role="button"
          tabIndex={0}
          onClick={() => setChartExpanded(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              setChartExpanded(true)
            }
          }}
          className="cursor-pointer rounded-xl outline-none transition focus:ring-4 focus:ring-blue-100"
          aria-label="Expand transaction volume chart"
        >
          {renderVolumeChart("h-36 pb-3 sm:h-56 sm:pb-0", "overviewVolumeGradient")}
        </div>
      </ChartCard>

      {chartExpanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3"
          onMouseDown={() => setChartExpanded(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Expanded transaction volume chart"
            className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-white/70 bg-white p-4 shadow-[0_24px_80px_rgba(15,23,42,0.22)] sm:p-5"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className={dashboardSectionLabelClass}>
                  Transaction Volume
                </p>
                <p className="mt-1 text-sm text-gray-500">Confirmed payment volume over time</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {renderChartControls(false)}
                <button
                  type="button"
                  onClick={() => setChartExpanded(false)}
                  className="inline-flex h-8 items-center justify-center rounded-full bg-[#0052FF] px-3 text-[11px] font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-100"
                >
                  Close
                </button>
              </div>
            </div>
            {renderVolumeChart("h-[320px] sm:h-[520px]", "overviewVolumeGradientExpanded")}
          </div>
        </div>
      )}

      {/* 5 — Historical summary */}
      <GroupedMetricSurface title="Historical Summary" titleTone="blue">
        <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
          <InlineMetric label="All-Time Volume" value={formatUsd(volume)} />
          <InlineMetric label="All Transactions" value={txCount} />
          <InlineMetric label="Success Rate" value={`${successRate}%`} />
          <InlineMetric label="Confirmed Today" value={today.confirmed} />
        </div>
      </GroupedMetricSurface>

      <PineTreeInsightsCard
        insights={overviewInsights}
        emptyText="Insights will appear as confirmed payment activity builds."
      />

      {/* 7 — Recent Activity */}
      <DashboardSection title="Recent Activity" titleTone="blue">
        <TransactionActivityTable
          transactions={recentTx}
          emptyMessage="No transactions yet."
        />
      </DashboardSection>

    </div>
  )
}
