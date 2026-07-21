"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, X } from "lucide-react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabaseClient"
import { useDashboardAutoRefresh } from "@/hooks/useDashboardAutoRefresh"
import TransactionActivityTable from "../TransactionActivityTable"
import {
  ChartCard,
  DashboardSection,
  GroupedMetricSurface,
  InlineMetric,
  PineTreeInsightsCard,
  dashboardHeroValueClass,
  dashboardPageTitleClass,
  dashboardSectionLabelClass
} from "@/components/dashboard/DashboardPrimitives"
import { SegmentedButtons } from "@/components/ui/SegmentedButtons"
import { modalCloseButtonClass } from "@/components/ui/ModalCloseButton"
import { ExpandIconButton } from "@/components/ui/ExpandIconButton"
import {
  buildNeutralInsight,
  countBy,
  formatDashboardNetwork,
  formatDashboardProvider,
  mostFrequentKey
} from "@/components/dashboard/displayHelpers"

import {
  type TransactionVolumeSeries
} from "@/components/dashboard/TransactionVolumeChart"
import TransactionVolumeChart from "@/components/dashboard/TransactionVolumeChart"

type Payment = {
  id?: string | null
  created_at: string
  gross_amount: number
  merchant_amount: number
  pinetree_fee: number
  currency: string
  status: string
  provider_reference?: string | null
}

type Transaction = {
  id: string
  payment_id?: string | null
  provider: string
  status: string
  provider_transaction_id: string
  network: string | null
  channel?: string | null
  payments: Payment | Payment[] | null
  created_at?: string
}

type ChartRow = {
  time: string
  solana: number
  base: number
  lightning: number
  coinbase: number
  shift4: number
  fluidpay?: number
  stripe?: number
  cash: number
}

const transactionVolumeSeries: TransactionVolumeSeries[] = [
  { key: "solana", label: "Solana SOL/USDC", color: "#8b5cf6" },
  { key: "base", label: "Base ETH/USDC", color: "#0052FF" },
  { key: "lightning", label: "Bitcoin Lightning", color: "#f59e0b" },
  { key: "coinbase", label: "Coinbase", color: "#1e40af" },
  { key: "shift4", label: "Card (Shift4)", color: "#14b8a6" },
  { key: "fluidpay", label: "Card (FluidPay)", color: "#0ea5e9" },
  { key: "stripe", label: "Card (Stripe)", color: "#635bff" },
  { key: "cash", label: "Cash (USD)", color: "#22c55e" }
]

const transactionChartRanges = [
  { label: "24H", value: "24h" },
  { label: "7D", value: "7d" },
  { label: "30D", value: "1m" },
  { label: "90D", value: "3m" },
  { label: "All", value: "1y" }
]

type TransactionsDashboardResponse = {
  success?: boolean
  transactions?: Transaction[]
  todayVolume?: number
  todayTransactions?: number
  confirmedRate?: number
  pagination?: { page: number; pageSize: number; total: number; totalPages: number }
  error?: string
}

type TransactionsChartResponse = {
  success?: boolean
  chartData?: ChartRow[]
  error?: string
}

type TimeFilter = "last_hour" | "last_24_hours" | "last_7_days" | "last_30_days" | "this_month" | "all"

const baseNetworkFilterOptions = [
  { value: "all", label: "All Networks" },
  { value: "bitcoin_lightning", label: "Bitcoin Lightning" },
  { value: "solana", label: "Solana" },
  { value: "base", label: "Base" },
]

const timeFilterOptions: Array<{ value: TimeFilter; label: string }> = [
  { value: "last_hour", label: "Last Hour" },
  { value: "last_24_hours", label: "Last 24 Hours" },
  { value: "last_7_days", label: "Last 7 Days" },
  { value: "last_30_days", label: "Last 30 Days" },
  { value: "this_month", label: "This Month" },
  { value: "all", label: "All Time" },
]

function normalizeNetworkFilterValue(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase()
  if (!normalized) return ""
  if (["lightning", "bitcoin_lightning", "btc_lightning", "lightning_btc", "bitcoin lightning"].includes(normalized)) {
    return "bitcoin_lightning"
  }
  return normalized.replace(/\s+/g, "_")
}

function getTimeFilterBounds(value: TimeFilter) {
  const now = new Date()
  const start = new Date(now)

  if (value === "last_hour") {
    start.setHours(start.getHours() - 1)
    return { startDate: start.toISOString(), endDate: now.toISOString() }
  }
  if (value === "last_24_hours") {
    start.setDate(start.getDate() - 1)
    return { startDate: start.toISOString(), endDate: now.toISOString() }
  }
  if (value === "last_7_days") {
    start.setDate(start.getDate() - 7)
    return { startDate: start.toISOString(), endDate: now.toISOString() }
  }
  if (value === "last_30_days") {
    start.setDate(start.getDate() - 30)
    return { startDate: start.toISOString(), endDate: now.toISOString() }
  }
  if (value === "this_month") {
    return {
      startDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
      endDate: now.toISOString()
    }
  }

  return { startDate: "", endDate: "" }
}

function parseTimestamp(value: string) {
  const hasTimezone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value)
  return new Date(hasTimezone ? value : `${value}Z`)
}

export default function TransactionsPage() {
  const tableRef = useRef<HTMLDivElement | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])

  const [todayVolume, setTodayVolume] = useState(0)
  const [todayTransactions, setTodayTransactions] = useState(0)
  const [confirmedRate, setConfirmedRate] = useState(0)

  const [networkFilter, setNetworkFilter] = useState("all")
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [totalPages, setTotalPages] = useState(1)
  const [totalTransactions, setTotalTransactions] = useState(0)
  const [filtersHydrated, setFiltersHydrated] = useState(false)
  const [loadingTransactions, setLoadingTransactions] = useState(true)
  const [transactionError, setTransactionError] = useState<string | null>(null)

  const [showChart, setShowChart] = useState(false)
  const [chartRange, setChartRange] = useState("24h")
  const [chartMode, setChartMode] = useState("all")
  const [chartData, setChartData] = useState<ChartRow[]>([])

  /* INSIGHTS */

  const [peakHour, setPeakHour] = useState("-")
  const [peakDay, setPeakDay] = useState("-")
  const [topProvider, setTopProvider] = useState("-")
  const [topNetwork, setTopNetwork] = useState("-")

  const [posTransactions, setPosTransactions] = useState(0)
  const [onlineTransactions, setOnlineTransactions] = useState(0)
  const [transactionInsight, setTransactionInsight] = useState("")

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const value = (name: string, fallback = "all") => params.get(name) || fallback
    setNetworkFilter(normalizeNetworkFilterValue(value("network")) || "all")
    const time = value("time") as TimeFilter
    setTimeFilter(timeFilterOptions.some((option) => option.value === time) ? time : "all")
    setPage(Math.max(1, Number(params.get("page") || 1) || 1))
    setPageSize([25, 50, 100].includes(Number(params.get("pageSize"))) ? Number(params.get("pageSize")) : 50)
    setFiltersHydrated(true)
  }, [])

  useEffect(() => {
    if (!filtersHydrated) return
    const params = new URLSearchParams()
    const setFilter = (name: string, value: string) => {
      if (value && value !== "all") params.set(name, value)
    }
    setFilter("network", networkFilter)
    setFilter("time", timeFilter)
    if (page > 1) params.set("page", String(page))
    if (pageSize !== 50) params.set("pageSize", String(pageSize))
    const query = params.toString()
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`)
  }, [filtersHydrated, networkFilter, page, pageSize, timeFilter])

  const callTransactionsApi = useCallback(async (method: "GET" | "POST", body?: unknown, query = "") => {
    const {
      data: { session }
    } = await supabase.auth.getSession()

    const token = session?.access_token
    if (!token) {
      throw new Error("Please sign in again")
    }

    const authRes = await fetch(`/api/transactions${query}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: method === "POST" ? JSON.stringify(body || {}) : undefined,
      credentials: "include",
      cache: "no-store"
    })

    const payload = await authRes.json().catch(() => null)
    if (!authRes.ok) {
      throw new Error(payload?.error || "Transactions API request failed")
    }

    return payload
  }, [])

  const formatUsd = useCallback((amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2
    }).format(Number.isFinite(amount) ? amount : 0)
  }, [])

  const calculateInsights = useCallback((data: Transaction[]) => {
    const qualifying = data.filter((tx) => {
      const payment = Array.isArray(tx.payments) ? tx.payments[0] : tx.payments
      const authoritativeStatus = String(payment?.status || tx.status || "").trim().toUpperCase()
      return authoritativeStatus === "CONFIRMED"
    })
    const hourMap: Record<string, number> = {}
    const dayMap: Record<string, number> = {}
    const channelMap: Record<string, number> = {}

    qualifying.forEach((tx) => {
      const payment = Array.isArray(tx.payments) ? tx.payments[0] : tx.payments
      if (!payment) return

      const sourceTime = tx.created_at || payment.created_at
      if (!sourceTime) return

      const d = parseTimestamp(sourceTime)
      if (Number.isNaN(d.getTime())) return

      const hour = String(d.getHours())
      const day = d.toLocaleDateString("default", { weekday: "long" })

      hourMap[hour] = (hourMap[hour] || 0) + 1
      dayMap[day] = (dayMap[day] || 0) + 1

      const channel = tx.channel || "pos"
      channelMap[channel] = (channelMap[channel] || 0) + 1
    })

    const providerMap = countBy(qualifying, (tx) => tx.provider)
    const networkMap = countBy(qualifying, (tx) => tx.network)
    const peakH = mostFrequentKey(hourMap)
    const peakD = mostFrequentKey(dayMap)
    const topP = mostFrequentKey(providerMap)
    const topN = mostFrequentKey(networkMap)

    setPosTransactions(channelMap["pos"] || 0)
    setOnlineTransactions(channelMap["online"] || 0)

    if (qualifying.length < 2) {
      setPeakHour("-")
      setPeakDay("-")
      setTopProvider("-")
      setTopNetwork("-")
      setTransactionInsight("")
      return
    }

    setPeakHour(peakH ? `${peakH}:00` : "-")
    setPeakDay(peakD || "-")
    setTopProvider(topP ? formatDashboardProvider(topP) : "-")
    setTopNetwork(topN ? formatDashboardNetwork(topN) : "-")

    if (topP && topN && peakH) {
      setTransactionInsight(
        `Based on confirmed transactions in the current ledger, ${peakH}:00 is the busiest hour, ${formatDashboardProvider(topP)} leads provider activity, and ${formatDashboardNetwork(topN)} leads network activity.`
      )
    } else if (topP) {
      setTransactionInsight(
        `${formatDashboardProvider(topP)} leads confirmed provider activity in the current ledger. Network mix will appear as more network-tagged transactions arrive.`
      )
    } else {
      setTransactionInsight("")
    }
  }, [])

  const loadDashboardData = useCallback(async () => {
    if (!filtersHydrated) return
    try {
      setLoadingTransactions(true)
      setTransactionError(null)
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (networkFilter !== "all") params.set("network", networkFilter)
      const timeBounds = getTimeFilterBounds(timeFilter)
      if (timeBounds.startDate) params.set("startDate", timeBounds.startDate)
      if (timeBounds.endDate) params.set("endDate", timeBounds.endDate)
      const payload = (await callTransactionsApi("GET", undefined, `?${params.toString()}`)) as TransactionsDashboardResponse

      setTodayVolume(Number(payload.todayVolume || 0))
      setTodayTransactions(Number(payload.todayTransactions || 0))
      setConfirmedRate(Number(payload.confirmedRate || 0))
      const responseTotalPages = payload.pagination?.totalPages || 1
      setTotalPages(responseTotalPages)
      setTotalTransactions(payload.pagination?.total || 0)
      if (page > responseTotalPages) {
        setPage(responseTotalPages)
        return
      }

      // Use transactions from the API (already merchant-scoped via auth)
      const apiTx = payload.transactions || []
      setTransactions(apiTx)
      calculateInsights(apiTx)
    } catch (error) {
      console.error(error)
      const message = error instanceof Error ? error.message : "Failed to load transactions"
      setTransactionError(message)
      toast.error(message)
    } finally {
      setLoadingTransactions(false)
    }
  }, [callTransactionsApi, calculateInsights, filtersHydrated, networkFilter, page, pageSize, timeFilter])

  const loadChartData = useCallback(async (range: string, mode = chartMode) => {
    try {
      const payload = (await callTransactionsApi("POST", {
        action: "chart",
        range,
        mode
      })) as TransactionsChartResponse

      setChartData(payload.chartData || [])
      toast.success("Chart updated")
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Failed to load chart data")
    }
  }, [callTransactionsApi, chartMode])

  useEffect(() => {
    let active = true
    ;(async () => {
      if (!active) return
      await loadDashboardData()
    })()

    return () => {
      active = false
    }
  }, [loadDashboardData])

  // Refresh transaction list when returning to this tab or refocusing.
  useDashboardAutoRefresh({ refresh: loadDashboardData, refreshOnMount: false })

  const filteredTransactions = transactions

  const networkFilterOptions = useMemo(() => {
    const options = new Map(baseNetworkFilterOptions.map((option) => [option.value, option.label]))
    transactions.forEach((transaction) => {
      const value = normalizeNetworkFilterValue(transaction.network)
      if (value && !options.has(value)) {
        options.set(value, formatDashboardNetwork(value))
      }
    })
    if (networkFilter !== "all" && !options.has(networkFilter)) {
      options.set(networkFilter, formatDashboardNetwork(networkFilter))
    }
    return Array.from(options, ([value, label]) => ({ value, label }))
  }, [networkFilter, transactions])

  const showChannelTransactions = useCallback((mode: "pos" | "online") => {
    setChartMode(mode)
    setShowChart(true)
    tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    void loadChartData(chartRange, mode)
  }, [chartRange, loadChartData])

  const filterSelectClass =
    "h-9 w-full min-w-0 appearance-none rounded-lg border border-blue-100 bg-blue-50/40 pl-3 pr-7 text-sm font-normal text-gray-600 outline-none transition hover:border-blue-200 hover:bg-blue-50/70 focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-50"

  const pageSizeSelectClass =
    "h-9 appearance-none rounded-lg border border-blue-100 bg-blue-50/40 pl-3 pr-7 text-sm font-normal text-gray-600 outline-none transition hover:border-blue-200 hover:bg-blue-50/70 focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-50"

  return (
    <div className="space-y-5 md:space-y-7">
      <div>
        <h1 className={dashboardPageTitleClass}>
          Transactions
        </h1>
      </div>

      <div className="grid gap-3 md:gap-4 lg:grid-cols-[1.18fr_0.82fr]">
        <button
          type="button"
          onClick={() => {
            setChartMode("all")
            setShowChart(true)
            void loadChartData(chartRange, "all")
          }}
          className="min-w-0 rounded-2xl border border-blue-200/80 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.14),transparent_34%),linear-gradient(135deg,#ffffff_0%,#f7fbff_54%,#eef5ff_100%)] p-4 text-left shadow-[0_14px_44px_rgba(37,99,235,0.11)] transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-[0_18px_54px_rgba(37,99,235,0.16)] focus:outline-none focus:ring-4 focus:ring-blue-100 sm:p-5"
        >
          <p className={dashboardSectionLabelClass}>
            Today&apos;s Volume
          </p>
          <div className={`mt-2 ${dashboardHeroValueClass}`}>
            {formatUsd(todayVolume)}
          </div>
          <p className="mt-2 text-sm leading-5 text-gray-600">Gross transaction volume for today.</p>
          <div
            data-transactions-hero-metrics
            className="mt-4 grid grid-cols-2 divide-x divide-blue-200/80 border-t border-blue-200/80 pt-3"
          >
            <div className="min-w-0 pr-4">
              <p className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.13em] text-gray-500">Transactions</p>
              <p className="mt-1 text-xl font-semibold leading-tight text-gray-950 sm:text-2xl">{todayTransactions.toString()}</p>
            </div>
            <div className="min-w-0 pl-4">
              <p className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.13em] text-gray-500">Success Rate</p>
              <p className="mt-1 text-xl font-semibold leading-tight text-gray-950 sm:text-2xl">{confirmedRate}%</p>
            </div>
          </div>
        </button>

        <GroupedMetricSurface title="Activity Breakdown" titleTone="blue">
          <div className="grid grid-cols-2 gap-x-4 gap-y-0">
            <InlineMetric label="Peak Hour" value={peakHour} className="border-b border-gray-100 pb-3" />
            <InlineMetric label="Peak Day" value={peakDay} className="border-b border-gray-100 pb-3" />
            <InlineMetric label="Top Provider" value={topProvider} className="pt-3" />
            <InlineMetric label="Top Network" value={topNetwork} className="pt-3" />
          </div>
        </GroupedMetricSurface>

        <GroupedMetricSurface title="Channel Mix" titleTone="blue" className="lg:col-span-2">
          <div className="grid grid-cols-2 divide-x divide-gray-100">
            <div className="relative min-w-0 overflow-hidden rounded-l-xl">
              <button
                type="button"
                onClick={() => showChannelTransactions("pos")}
                className="h-full w-full p-3 pb-9 text-left transition hover:bg-gray-50 focus:outline-none focus:ring-4 focus:ring-blue-100"
              >
                <InlineMetric label="POS Transactions" value={posTransactions.toString()} />
              </button>
              <ExpandIconButton
                onClick={() => showChannelTransactions("pos")}
                ariaLabel="Expand POS transactions chart"
                className="absolute bottom-2 right-2 !h-7 !w-7 [&>svg]:!h-3 [&>svg]:!w-3"
              />
            </div>
            <div className="relative min-w-0 overflow-hidden rounded-r-xl">
              <button
                type="button"
                onClick={() => showChannelTransactions("online")}
                className="h-full w-full p-3 pb-9 text-left transition hover:bg-blue-50/70 focus:outline-none focus:ring-4 focus:ring-blue-100"
              >
                <InlineMetric label="Online Payments" value={onlineTransactions.toString()} />
              </button>
              <ExpandIconButton
                onClick={() => showChannelTransactions("online")}
                ariaLabel="Expand online payments chart"
                className="absolute bottom-2 right-2 !h-7 !w-7 [&>svg]:!h-3 [&>svg]:!w-3"
              />
            </div>
          </div>
        </GroupedMetricSurface>
      </div>

      <PineTreeInsightsCard
        insights={[transactionInsight]}
        emptyText={buildNeutralInsight(
          transactions.some((tx) => {
            const payment = Array.isArray(tx.payments) ? tx.payments[0] : tx.payments
            return String(payment?.status || tx.status || "").trim().toUpperCase() === "CONFIRMED"
          }),
          "Complete more transactions to unlock activity insights."
        ) || "Complete more transactions to unlock activity insights."}
      />

      <DashboardSection title="Transaction Ledger" titleTone="blue">
        <div className="rounded-2xl border border-gray-200/80 bg-white p-3 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-3.5">
          <div className="grid min-w-0 grid-cols-2 gap-2 sm:max-w-[520px]">
            <label className="min-w-0">
              <span className="mb-1 block text-[10px] font-normal uppercase tracking-[0.11em] text-gray-700">Network</span>
              <div className="relative">
                <select
                  aria-label="Network filter"
                  className={filterSelectClass}
                  value={networkFilter}
                  onChange={(event) => {
                    setNetworkFilter(normalizeNetworkFilterValue(event.target.value) || "all")
                    setPage(1)
                  }}
                >
                  {networkFilterOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-blue-300" />
              </div>
            </label>
            <label className="min-w-0">
              <span className="mb-1 block text-[10px] font-normal uppercase tracking-[0.11em] text-gray-700">Time</span>
              <div className="relative">
                <select
                  aria-label="Time filter"
                  className={filterSelectClass}
                  value={timeFilter}
                  onChange={(event) => {
                    setTimeFilter(event.target.value as TimeFilter)
                    setPage(1)
                  }}
                >
                  {timeFilterOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-blue-300" />
              </div>
            </label>
          </div>
        </div>

      <div
        ref={tableRef}
        className="mt-3 md:rounded-2xl md:border md:border-gray-200/80 md:bg-white md:p-2.5 md:shadow-[0_10px_30px_rgba(15,23,42,0.05)]"
      >
        {transactionError ? (
          <div role="alert" className="m-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {transactionError} <button type="button" onClick={() => void loadDashboardData()} className="ml-2 font-semibold underline">Try again</button>
          </div>
        ) : null}
        {loadingTransactions ? <p className="px-4 py-8 text-center text-sm text-gray-500">Loading transactions…</p> : <TransactionActivityTable transactions={filteredTransactions} />}
        <div className="flex flex-col gap-3 border-t border-gray-100 px-2 py-3 text-sm text-gray-600 sm:flex-row sm:items-center sm:justify-between">
          <span>{totalTransactions} transactions</span>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="transactions-page-size">Page size</label>
            <div className="relative">
              <select
                id="transactions-page-size"
                aria-label="Page size"
                className={pageSizeSelectClass}
                value={pageSize}
                onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }}
              >
                <option value={25}>25 per page</option>
                <option value={50}>50 per page</option>
                <option value={100}>100 per page</option>
              </select>
              <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-blue-300" />
            </div>
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              className="rounded-lg border border-gray-200 px-3 py-1.5 font-medium disabled:opacity-40"
            >
              Previous
            </button>
            <span>Page {page} of {totalPages}</span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
              className="rounded-lg border border-gray-200 px-3 py-1.5 font-medium disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>
      </DashboardSection>

      {showChart && (
        <div data-pinetree-overlay="true" className="pinetree-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-3">
          <div className="relative max-h-[90vh] w-full max-w-[900px] overflow-y-auto rounded-2xl bg-white shadow-xl">
            <button
              type="button"
              onClick={() => setShowChart(false)}
              aria-label="Close expanded chart"
              className={`${modalCloseButtonClass} absolute right-3 top-3 z-10`}
            >
              <X size={18} aria-hidden="true" />
            </button>
            <ChartCard
              title={
                chartMode === "pos"
                  ? "POS Payment Volume"
                  : chartMode === "online"
                    ? "Online Payment Volume"
                    : "Transaction Volume"
              }
              subtitle="USD volume by provider from the existing transactions chart endpoint"
              className="border-0 pt-14 shadow-none"
            >

            <SegmentedButtons
              ariaLabel="Chart range"
              className="mb-6 flex flex-wrap gap-1.5"
              value={chartRange}
              onChange={(value) => {
                setChartRange(value)
                void loadChartData(value, chartMode)
              }}
              options={transactionChartRanges.map((range) => ({
                value: range.value,
                label: range.label,
              }))}
            />

            <TransactionVolumeChart
              data={chartData}
              xKey="time"
              series={transactionVolumeSeries}
              className="h-[300px] sm:h-[350px]"
              gradientId="transactions-volume"
              emptyDescription="Confirmed transactions will appear here for the selected range."
            />
            </ChartCard>
          </div>
        </div>
      )}
    </div>
  )
}
