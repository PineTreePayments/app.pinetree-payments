"use client"

import { useCallback, useEffect, useRef, useState } from "react"
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

type FocusedFilter = "provider" | "network" | "channel" | "method" | "asset" | "date"

const focusedFilterOptions: Array<{ value: FocusedFilter; label: string }> = [
  { value: "method", label: "Payment method" },
  { value: "channel", label: "Channel" },
  { value: "network", label: "Rail or network" },
  { value: "asset", label: "Asset or currency" },
  { value: "provider", label: "Provider" },
  { value: "date", label: "Date range" },
]

const statusFilterOptions = [
  { value: "all", label: "All statuses" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "PROCESSING", label: "Processing" },
  { value: "PENDING", label: "Waiting" },
  { value: "INCOMPLETE", label: "Incomplete" },
  { value: "FAILED", label: "Failed" },
]

const filterValueOptions: Record<Exclude<FocusedFilter, "date">, Array<{ value: string; label: string }>> = {
  method: [
    { value: "all", label: "All methods" },
    { value: "card", label: "Card" },
    { value: "crypto", label: "Crypto" },
    { value: "cash", label: "Cash" },
  ],
  channel: [
    { value: "all", label: "All channels" },
    { value: "pos", label: "POS" },
    { value: "online", label: "Online" },
  ],
  network: [
    { value: "all", label: "All rails and networks" },
    { value: "solana", label: "Solana" },
    { value: "base", label: "Base" },
    { value: "ethereum", label: "Ethereum" },
    { value: "bitcoin_lightning", label: "Bitcoin Lightning" },
  ],
  asset: [
    { value: "all", label: "All assets" },
    { value: "USD", label: "USD" },
    { value: "USDC", label: "USDC" },
    { value: "USDT", label: "USDT" },
    { value: "BTC", label: "BTC" },
    { value: "ETH", label: "ETH" },
    { value: "SOL", label: "SOL" },
  ],
  provider: [
    { value: "all", label: "All providers" },
    { value: "solana", label: "Solana Pay" },
    { value: "base", label: "Base Pay" },
    { value: "lightning_speed", label: "Bitcoin Lightning" },
    { value: "stripe", label: "Stripe" },
    { value: "shift4", label: "Shift4" },
    { value: "fluidpay", label: "FluidPay" },
    { value: "coinbase", label: "Coinbase Business" },
    { value: "cash", label: "Cash" },
  ],
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

  const [walletFilter, setWalletFilter] = useState("all")
  const [networkFilter, setNetworkFilter] = useState("all")
  const [channelFilter, setChannelFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [railFilter, setRailFilter] = useState("all")
  const [assetFilter, setAssetFilter] = useState("all")
  const [currencyFilter, setCurrencyFilter] = useState("all")
  const [sourceFilter, setSourceFilter] = useState("all")
  const [methodFilter, setMethodFilter] = useState("all")
  const [focusedFilter, setFocusedFilter] = useState<FocusedFilter>("method")
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false)
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
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
    setWalletFilter(value("provider"))
    setNetworkFilter(value("network"))
    setChannelFilter(value("channel"))
    setStatusFilter(value("status"))
    setRailFilter(value("rail"))
    setAssetFilter(value("asset"))
    setCurrencyFilter(value("currency"))
    setSourceFilter(value("source"))
    setMethodFilter(value("method"))
    setStartDate(value("startDate", ""))
    setEndDate(value("endDate", ""))
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
    setFilter("provider", walletFilter)
    setFilter("network", networkFilter)
    setFilter("channel", channelFilter)
    setFilter("status", statusFilter)
    setFilter("rail", railFilter)
    setFilter("asset", assetFilter)
    setFilter("currency", currencyFilter)
    setFilter("source", sourceFilter)
    setFilter("method", methodFilter)
    setFilter("startDate", startDate)
    setFilter("endDate", endDate)
    if (page > 1) params.set("page", String(page))
    if (pageSize !== 50) params.set("pageSize", String(pageSize))
    const query = params.toString()
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`)
  }, [assetFilter, channelFilter, currencyFilter, endDate, filtersHydrated, methodFilter, networkFilter, page, pageSize, railFilter, sourceFilter, startDate, statusFilter, walletFilter])

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
    if (startDate && endDate && endDate < startDate) {
      setTransactionError("End date must be on or after the start date.")
      setLoadingTransactions(false)
      return
    }
    try {
      setLoadingTransactions(true)
      setTransactionError(null)
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (walletFilter !== "all") params.set("provider", walletFilter)
      if (networkFilter !== "all") params.set("network", networkFilter)
      if (channelFilter !== "all") params.set("channel", channelFilter)
      if (statusFilter !== "all") params.set("status", statusFilter)
      if (railFilter !== "all") params.set("rail", railFilter)
      if (assetFilter !== "all") params.set("asset", assetFilter)
      if (currencyFilter !== "all") params.set("currency", currencyFilter)
      if (sourceFilter !== "all") params.set("source", sourceFilter)
      if (methodFilter !== "all") params.set("method", methodFilter)
      if (startDate) params.set("startDate", startDate)
      if (endDate) params.set("endDate", endDate)
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
  }, [assetFilter, callTransactionsApi, calculateInsights, channelFilter, currencyFilter, endDate, filtersHydrated, methodFilter, networkFilter, page, pageSize, railFilter, sourceFilter, startDate, statusFilter, walletFilter])

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

  const activeFilters = [
    statusFilter !== "all" ? { label: "Status", value: statusFilterOptions.find((option) => option.value === statusFilter)?.label || statusFilter } : null,
    walletFilter !== "all" ? { label: "Provider", value: filterValueOptions.provider.find((option) => option.value === walletFilter)?.label || walletFilter } : null,
    networkFilter !== "all" ? { label: "Rail", value: filterValueOptions.network.find((option) => option.value === networkFilter)?.label || networkFilter } : null,
    channelFilter !== "all" ? { label: "Channel", value: filterValueOptions.channel.find((option) => option.value === channelFilter)?.label || channelFilter } : null,
    methodFilter !== "all" ? { label: "Method", value: filterValueOptions.method.find((option) => option.value === methodFilter)?.label || methodFilter } : null,
    assetFilter !== "all" ? { label: "Asset", value: filterValueOptions.asset.find((option) => option.value === assetFilter)?.label || assetFilter } : null,
    currencyFilter !== "all" ? { label: "Currency", value: currencyFilter } : null,
    railFilter !== "all" ? { label: "Rail", value: railFilter } : null,
    sourceFilter !== "all" ? { label: "Source", value: sourceFilter } : null,
    startDate || endDate ? { label: "Dates", value: [startDate || "Any start", endDate || "Any end"].join(" to ") } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>

  const hasActiveFilters = activeFilters.length > 0

  function clearFilters() {
    setWalletFilter("all")
    setNetworkFilter("all")
    setChannelFilter("all")
    setStatusFilter("all")
    setRailFilter("all")
    setAssetFilter("all")
    setCurrencyFilter("all")
    setSourceFilter("all")
    setMethodFilter("all")
    setStartDate("")
    setEndDate("")
    setPage(1)
  }

  function getFocusedFilterValue(filter: FocusedFilter) {
    if (filter === "provider") return walletFilter
    if (filter === "network") return networkFilter
    if (filter === "channel") return channelFilter
    if (filter === "asset") return assetFilter
    if (filter === "method") return methodFilter
    return "all"
  }

  function setFocusedFilterValue(filter: FocusedFilter, value: string) {
    if (filter === "provider") setWalletFilter(value)
    if (filter === "network") setNetworkFilter(value)
    if (filter === "channel") setChannelFilter(value)
    if (filter === "asset") setAssetFilter(value)
    if (filter === "method") setMethodFilter(value)
    setPage(1)
  }

  const showChannelTransactions = useCallback((mode: "pos" | "online") => {
    setChartMode(mode)
    setChannelFilter(mode)
    setWalletFilter("all")
    setNetworkFilter("all")
    setShowChart(true)
    tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    void loadChartData(chartRange, mode)
  }, [chartRange, loadChartData])

  const filterSelectClass =
    "h-11 w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 text-base font-medium text-gray-900 shadow-sm outline-none transition focus:border-[#0052FF] focus:ring-4 focus:ring-blue-100 sm:text-sm sm:font-normal"

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
            <button
              type="button"
              onClick={() => showChannelTransactions("pos")}
              className="min-w-0 rounded-l-xl p-3 text-left transition hover:bg-gray-50 focus:outline-none focus:ring-4 focus:ring-blue-100"
            >
              <InlineMetric label="POS Transactions" value={posTransactions.toString()} />
            </button>
            <button
              type="button"
              onClick={() => showChannelTransactions("online")}
              className="min-w-0 rounded-r-xl p-3 text-left transition hover:bg-blue-50/70 focus:outline-none focus:ring-4 focus:ring-blue-100"
            >
              <InlineMetric label="Online Payments" value={onlineTransactions.toString()} />
            </button>
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
        <div className="rounded-2xl border border-gray-200/80 bg-white p-3 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-4">
          <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center">
          <label className="min-w-0 lg:w-52">
            <span className="sr-only">Status</span>
            <select
              aria-label="Status filter"
              className={filterSelectClass}
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
            >
              {statusFilterOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setAdvancedFiltersOpen((value) => !value)}
            className="inline-flex h-11 min-w-0 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-base font-semibold text-gray-800 shadow-sm transition hover:border-blue-200 hover:bg-blue-50/60 focus:outline-none focus:ring-4 focus:ring-blue-100 sm:text-sm lg:w-auto"
            aria-expanded={advancedFiltersOpen}
          >
            Filter{hasActiveFilters ? ` (${activeFilters.length})` : ""}
          </button>
          <button
            type="button"
            onClick={clearFilters}
            className={`h-11 rounded-xl border border-gray-200 bg-white px-4 text-base font-semibold text-gray-600 transition hover:bg-gray-50 sm:text-sm ${hasActiveFilters ? "inline-flex items-center justify-center" : "hidden"}`}
          >
            Clear
          </button>
          </div>
          {advancedFiltersOpen ? (
            <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50/50 p-3">
              <div className="grid gap-2 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto_auto] md:items-end">
                <label className="min-w-0">
                  <span className="mb-1 block text-xs font-semibold text-gray-600">Filter by</span>
                  <select
                    value={focusedFilter}
                    onChange={(event) => setFocusedFilter(event.target.value as FocusedFilter)}
                    className={filterSelectClass}
                  >
                    {focusedFilterOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                {focusedFilter === "date" ? (
                  <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                    <label className="min-w-0">
                      <span className="mb-1 block text-xs font-semibold text-gray-600">Start date</span>
                      <input aria-label="Start date" type="date" className={filterSelectClass} value={startDate} onChange={(event) => { setStartDate(event.target.value); setPage(1) }} />
                    </label>
                    <label className="min-w-0">
                      <span className="mb-1 block text-xs font-semibold text-gray-600">End date</span>
                      <input aria-label="End date" type="date" min={startDate || undefined} className={filterSelectClass} value={endDate} onChange={(event) => { setEndDate(event.target.value); setPage(1) }} />
                    </label>
                  </div>
                ) : (
                  <label className="min-w-0">
                    <span className="mb-1 block text-xs font-semibold text-gray-600">Value</span>
                    <select
                      aria-label={`${focusedFilterOptions.find((option) => option.value === focusedFilter)?.label || "Filter"} value`}
                      className={filterSelectClass}
                      value={getFocusedFilterValue(focusedFilter)}
                      onChange={(event) => setFocusedFilterValue(focusedFilter, event.target.value)}
                    >
                      {filterValueOptions[focusedFilter].map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => setAdvancedFiltersOpen(false)}
                  className="h-11 rounded-xl bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                >
                  Apply filters
                </button>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="h-11 rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-600 transition hover:bg-gray-50"
                >
                  Clear filters
                </button>
              </div>
            </div>
          ) : null}
          {activeFilters.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {activeFilters.map((filter) => (
                <span key={`${filter.label}-${filter.value}`} className="inline-flex max-w-full items-center rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-800">
                  <span className="truncate">{filter.label}: {filter.value}</span>
                </span>
              ))}
            </div>
          ) : null}
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
            <select
              id="transactions-page-size"
              aria-label="Page size"
              className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-sm font-medium text-gray-700"
              value={pageSize}
              onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }}
            >
              <option value={25}>25 per page</option>
              <option value={50}>50 per page</option>
              <option value={100}>100 per page</option>
            </select>
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
              onClick={() => setShowChart(false)}
              className="absolute right-3 top-3 z-10 inline-flex min-h-10 items-center justify-center rounded-xl bg-blue-600 px-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 sm:min-h-10 sm:px-4"
            >
              Close
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

            <div className="flex flex-wrap gap-2 mb-6">
              {transactionChartRanges.map((range) => (
                <button
                  key={range.value}
                  onClick={() => {
                    setChartRange(range.value)
                    void loadChartData(range.value, chartMode)
                  }}
                  className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${chartRange === range.value ? "bg-[#0052FF] text-white border-[#0052FF]" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"}`}
                >
                  {range.label}
                </button>
              ))}
            </div>

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
