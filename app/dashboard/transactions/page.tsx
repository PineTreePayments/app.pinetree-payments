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
  error?: string
}

type TransactionsChartResponse = {
  success?: boolean
  chartData?: ChartRow[]
  error?: string
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

  const callTransactionsApi = useCallback(async (method: "GET" | "POST", body?: unknown) => {
    const {
      data: { session }
    } = await supabase.auth.getSession()

    const token = session?.access_token
    if (!token) {
      throw new Error("Please sign in again")
    }

    const authRes = await fetch("/api/transactions", {
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
    const hourMap: Record<string, number> = {}
    const dayMap: Record<string, number> = {}
    const channelMap: Record<string, number> = {}

    data.forEach((tx) => {
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

    const providerMap = countBy(data, (tx) => tx.provider)
    const networkMap = countBy(data, (tx) => tx.network)
    const peakH = mostFrequentKey(hourMap)
    const peakD = mostFrequentKey(dayMap)
    const topP = mostFrequentKey(providerMap)
    const topN = mostFrequentKey(networkMap)

    setPeakHour(peakH ? `${peakH}:00` : "-")
    setPeakDay(peakD || "-")
    setTopProvider(topP ? formatDashboardProvider(topP) : "-")
    setTopNetwork(topN ? formatDashboardNetwork(topN) : "-")

    setPosTransactions(channelMap["pos"] || 0)
    setOnlineTransactions(channelMap["online"] || 0)

    if (!data.length) {
      setTransactionInsight("")
    } else if (topP && topN && peakH) {
      setTransactionInsight(
        `Based on the current ledger, ${peakH}:00 is the busiest hour, ${formatDashboardProvider(topP)} leads provider activity, and ${formatDashboardNetwork(topN)} leads network activity.`
      )
    } else if (topP) {
      setTransactionInsight(
        `${formatDashboardProvider(topP)} leads provider activity in the current ledger. Network mix will appear as more network-tagged transactions arrive.`
      )
    } else {
      setTransactionInsight("")
    }
  }, [])

  const loadDashboardData = useCallback(async () => {
    try {
      const payload = (await callTransactionsApi("GET")) as TransactionsDashboardResponse

      setTodayVolume(Number(payload.todayVolume || 0))
      setTodayTransactions(Number(payload.todayTransactions || 0))
      setConfirmedRate(Number(payload.confirmedRate || 0))

      // Use transactions from the API (already merchant-scoped via auth)
      const apiTx = payload.transactions || []
      setTransactions(apiTx)
      calculateInsights(apiTx)
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Failed to load transactions")
    }
  }, [callTransactionsApi, calculateInsights])

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

  const filteredTransactions = transactions.filter((tx) => {
    if (walletFilter !== "all" && tx.provider !== walletFilter) return false
    if (networkFilter !== "all" && tx.network !== networkFilter) return false
    if (channelFilter === "pos" && tx.channel !== "pos" && tx.provider !== "cash") return false
    if (channelFilter === "online" && tx.channel !== "online") return false
    return true
  })

  const showChannelTransactions = useCallback((mode: "pos" | "online") => {
    setChartMode(mode)
    setChannelFilter(mode)
    setWalletFilter("all")
    setNetworkFilter("all")
    setShowChart(true)
    tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    void loadChartData(chartRange, mode)
  }, [chartRange, loadChartData])

  const filterRowClass =
    "min-w-0"
  const filterLabelClass =
    "sr-only"
  const filterSelectClass =
    "h-8 w-full min-w-0 truncate rounded-full border border-gray-200 bg-white px-2 text-[10px] font-medium text-gray-900 shadow-sm outline-none transition focus:border-[#0052FF] focus:ring-4 focus:ring-blue-100 sm:h-9 sm:px-3 sm:text-sm sm:font-normal"

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
          transactions.length > 0,
          "Ledger insights will appear as provider and network activity builds."
        ) || "Ledger activity is available; additional network-tagged transactions will sharpen insights."}
      />

      <DashboardSection title="Transaction Ledger" titleTone="blue">
        <div className="rounded-2xl border border-gray-200/80 bg-white p-2 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-2.5">
          <div className="grid min-w-0 grid-cols-3 gap-1.5 sm:gap-3">
          <label className={filterRowClass}>
            <span className={filterLabelClass}>Wallet</span>
            <select
              aria-label="Wallet filter"
              className={filterSelectClass}
              value={walletFilter}
              onChange={(e) => setWalletFilter(e.target.value)}
            >
              <option value="all">All Wallets</option>
              <option value="solana">Solana Pay</option>
              <option value="coinbase">Coinbase Business</option>
              <option value="shift4">Shift4</option>
              <option value="base">Base Pay</option>
              <option value="lightning">Bitcoin Lightning</option>
              <option value="cash">Cash</option>
            </select>
          </label>

          <label className={filterRowClass}>
            <span className={filterLabelClass}>Network</span>
            <select
              aria-label="Network filter"
              className={filterSelectClass}
              value={networkFilter}
              onChange={(e) => setNetworkFilter(e.target.value)}
            >
              <option value="all">All Networks</option>
              <option value="solana">Solana</option>
              <option value="base">Base</option>
              <option value="ethereum">Ethereum</option>
              <option value="bitcoin_lightning">Bitcoin Lightning</option>
            </select>
          </label>

          <label className={filterRowClass}>
            <span className={filterLabelClass}>Channel</span>
            <select
              aria-label="Channel filter"
              className={filterSelectClass}
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
            >
              <option value="all">All Channels</option>
              <option value="pos">POS</option>
              <option value="online">Online</option>
            </select>
          </label>
          </div>
        </div>

      <div
        ref={tableRef}
        className="mt-3 md:rounded-2xl md:border md:border-gray-200/80 md:bg-white md:p-2.5 md:shadow-[0_10px_30px_rgba(15,23,42,0.05)]"
      >
        <TransactionActivityTable transactions={filteredTransactions} />
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
