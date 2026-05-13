"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabaseClient"
import TransactionActivityTable from "../TransactionActivityTable"
import {
  ChartCard,
  CompactMetricTile,
  DashboardSection,
  MetricGrid,
  PineTreeInsightsCard
} from "@/components/dashboard/DashboardPrimitives"

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid
} from "recharts"

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
  cash: number
}

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
  const [aiInsight, setAiInsight] = useState("No insights yet.")

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

  const providerName = useCallback((provider: string) => {
    if (provider === "coinbase") return "Coinbase Business"
    if (provider === "solana") return "Solana Pay"
    if (provider === "shift4") return "Shift4"
    if (provider === "base") return "Base Pay"
    if (provider === "lightning") return "Bitcoin Lightning"
    if (provider === "cash") return "Cash"
    return provider || "-"
  }, [])

  const networkName = useCallback((network: string | null) => {
    if (!network) return "-"
    if (network.toLowerCase() === "cash") return "Cash"
    if (network.toLowerCase() === "solana") return "Solana"
    if (network.toLowerCase() === "base") return "Base"
    if (network.toLowerCase() === "ethereum") return "Ethereum"
    if (network.toLowerCase() === "bitcoin_lightning" || network.toLowerCase() === "bitcoin lightning") return "Bitcoin Lightning"
    return network.charAt(0).toUpperCase() + network.slice(1).toLowerCase()
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
    const providerMap: Record<string, number> = {}
    const networkMap: Record<string, number> = {}
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
      providerMap[tx.provider] = (providerMap[tx.provider] || 0) + 1
      networkMap[tx.network || "unknown"] = (networkMap[tx.network || "unknown"] || 0) + 1

      const channel = tx.channel || "pos"
      channelMap[channel] = (channelMap[channel] || 0) + 1
    })

    function maxKey(obj: Record<string, number>) {
      const sorted = Object.entries(obj).sort((a, b) => b[1] - a[1])
      return sorted[0]?.[0] || "-"
    }

    const peakH = maxKey(hourMap)
    const peakD = maxKey(dayMap)
    const topP = maxKey(providerMap)
    const topN = maxKey(networkMap)

    setPeakHour(peakH === "-" ? "-" : `${peakH}:00`)
    setPeakDay(peakD)
    setTopProvider(providerName(topP))
    setTopNetwork(networkName(topN))

    setPosTransactions(channelMap["pos"] || 0)
    setOnlineTransactions(channelMap["online"] || 0)

    if (topP === "-" || topN === "-") {
      setAiInsight("No insights yet.")
    } else {
      setAiInsight(
        `Your busiest hour is ${peakH}:00. ${providerName(topP)} is your most used provider, and ${networkName(topN)} is your most used network.`
      )
    }
  }, [providerName, networkName])

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

  return (
    <div className="space-y-5 md:space-y-7">
      <div>
        <h1 className="text-2xl font-semibold text-gray-950 md:text-3xl">
          Transactions
        </h1>
      </div>

      <MetricGrid columns="three">
        <CompactMetricTile
          label="Today's Volume"
          value={formatUsd(todayVolume)}
          tone="blue"
          interactive
          onClick={() => {
            setChartMode("all")
            setShowChart(true)
            void loadChartData(chartRange, "all")
          }}
        />

        <CompactMetricTile label="Transactions" value={todayTransactions.toString()} />

        <CompactMetricTile
          label="Confirmed Rate"
          value={`${confirmedRate}%`}
          tone="green"
        />
      </MetricGrid>

      <MetricGrid columns="four">
        <CompactMetricTile label="Peak Hour" value={peakHour} />
        <CompactMetricTile label="Peak Day" value={peakDay} />
        <CompactMetricTile label="Top Provider" value={topProvider} tone="blue" />
        <CompactMetricTile label="Top Network" value={topNetwork} tone="slate" />
      </MetricGrid>

      <MetricGrid columns="two">
        <CompactMetricTile
          label="POS Transactions"
          value={posTransactions.toString()}
          interactive
          onClick={() => showChannelTransactions("pos")}
        />

        <CompactMetricTile
          label="Online Transactions"
          value={onlineTransactions.toString()}
          tone="blue"
          interactive
          onClick={() => showChannelTransactions("online")}
        />
      </MetricGrid>

      <PineTreeInsightsCard insights={[aiInsight === "No insights yet." ? "" : aiInsight]} />

      <DashboardSection title="Transaction Ledger">
        <div className="grid grid-cols-1 gap-2 rounded-2xl border border-gray-200 bg-white p-3 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:grid-cols-3">
          <select
            aria-label="Wallet filter"
            className="min-h-11 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:border-blue-400 focus:bg-white focus:outline-none"
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

          <select
            aria-label="Network filter"
            className="min-h-11 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:border-blue-400 focus:bg-white focus:outline-none"
            value={networkFilter}
            onChange={(e) => setNetworkFilter(e.target.value)}
          >
            <option value="all">All Networks</option>
            <option value="solana">Solana</option>
            <option value="base">Base</option>
            <option value="ethereum">Ethereum</option>
            <option value="bitcoin_lightning">Bitcoin Lightning</option>
          </select>

          <select
            aria-label="Channel filter"
            className="min-h-11 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:border-blue-400 focus:bg-white focus:outline-none"
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
          >
            <option value="all">All Channels</option>
            <option value="pos">POS</option>
            <option value="online">Online</option>
          </select>
        </div>

      <div ref={tableRef} className="mt-3">
        <TransactionActivityTable transactions={filteredTransactions} />
      </div>
      </DashboardSection>

      {showChart && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
          <div className="max-h-[90vh] w-full max-w-[900px] overflow-y-auto rounded-2xl bg-white shadow-xl">
            <ChartCard
              title={
                chartMode === "pos"
                  ? "POS Payment Volume"
                  : chartMode === "online"
                    ? "Online Payment Volume"
                    : "Transaction Volume"
              }
              subtitle="USD volume by provider from the existing transactions chart endpoint"
              action={
              <button
                onClick={() => setShowChart(false)}
                className="inline-flex min-h-9 items-center rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
              >
                Close
              </button>
              }
              className="border-0 shadow-none"
            >

            <div className="flex flex-wrap gap-2 mb-6">
              {["24h", "7d", "1m", "3m", "6m", "1y"].map((r) => (
                <button
                  key={r}
                  onClick={() => {
                    setChartRange(r)
                    void loadChartData(r, chartMode)
                  }}
                  className={`px-3 py-1.5 rounded-xl border text-sm font-medium transition ${chartRange === r ? "bg-[#0052FF] text-white border-[#0052FF]" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"}`}
                >
                  {r.toUpperCase()}
                </button>
              ))}
            </div>

            <div className="h-[300px] sm:h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 20, right: 20, left: 0, bottom: 10 }}
              >
                <CartesianGrid
                  stroke="#e5e7eb"
                  strokeDasharray="4 4"
                  vertical={false}
                />

                <XAxis
                  dataKey="time"
                  axisLine={{ stroke: "#2563eb", strokeWidth: 2 }}
                  tickLine={false}
                  tick={{ fill: "#374151", fontSize: 12 }}
                />

                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#374151", fontSize: 12 }}
                  tickFormatter={(value) => formatUsd(Number(value))}
                />

                <Tooltip
                  formatter={(value, name) => [formatUsd(Number(value)), `${name} Volume (USD)`]}
                  labelFormatter={(label) => `Period: ${label}`}
                  contentStyle={{
                    background: "#fff",
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    boxShadow: "0 6px 18px rgba(0,0,0,0.08)"
                  }}
                />

                <Legend wrapperStyle={{ fontSize: "12px" }} />

                <Bar dataKey="solana" name="Solana SOL/USDC" stackId="a" fill="#8b5cf6" radius={[0, 0, 0, 0]} />
                <Bar dataKey="base" name="Base ETH/USDC" stackId="a" fill="#0052FF" radius={[0, 0, 0, 0]} />
                <Bar dataKey="lightning" name="Bitcoin Lightning" stackId="a" fill="#f59e0b" radius={[0, 0, 0, 0]} />
                <Bar dataKey="coinbase" name="Coinbase" stackId="a" fill="#1e40af" radius={[0, 0, 0, 0]} />
                <Bar dataKey="shift4" name="Card (Shift4)" stackId="a" fill="#14b8a6" radius={[0, 0, 0, 0]} />
                <Bar dataKey="cash" name="Cash (USD)" stackId="a" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            </div>
            </ChartCard>
          </div>
        </div>
      )}
    </div>
  )
}
