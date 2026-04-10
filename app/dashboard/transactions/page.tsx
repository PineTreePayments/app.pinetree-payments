"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { supabase } from "@/lib/database/supabase"

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
  created_at: string
  total_amount: number
  currency: string
  status: string
}

type Transaction = {
  id: string
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
  coinbase: number
  shift4: number
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

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([])

  const [todayVolume, setTodayVolume] = useState(0)
  const [todayTransactions, setTodayTransactions] = useState(0)
  const [confirmedRate, setConfirmedRate] = useState(0)

  const [walletFilter, setWalletFilter] = useState("all")
  const [networkFilter, setNetworkFilter] = useState("all")

  const [showChart, setShowChart] = useState(false)
  const [chartRange, setChartRange] = useState("24h")
  const [chartMode, setChartMode] = useState("all")
  const [chartData, setChartData] = useState<ChartRow[]>([])

  /* INSIGHTS */

  const [peakHour, setPeakHour] = useState("-")
  const [peakDay, setPeakDay] = useState("-")
  const [topProvider, setTopProvider] = useState("-")
  const [topNetwork, setTopNetwork] = useState("-")

  const [posPercent, setPosPercent] = useState(0)
  const [onlinePercent, setOnlinePercent] = useState(0)
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
    return provider || "-"
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

      const d = new Date(payment.created_at)
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
    setTopNetwork(topN)

    const pos = channelMap["pos"] || 0
    const online = channelMap["online"] || 0
    const total = pos + online

    setPosPercent(total > 0 ? Math.round((pos / total) * 100) : 0)
    setOnlinePercent(total > 0 ? Math.round((online / total) * 100) : 0)

    if (topP === "-" || topN === "-") {
      setAiInsight("No insights yet.")
    } else {
      setAiInsight(
        `Your busiest hour is ${peakH}:00. ${providerName(topP)} is your most used provider, and ${topN} is your most used network.`
      )
    }
  }, [providerName])

  const loadDashboardData = useCallback(async () => {
    try {
      const payload = (await callTransactionsApi("GET")) as TransactionsDashboardResponse
      const tx = payload.transactions || []

      setTransactions(tx)
      setTodayVolume(Number(payload.todayVolume || 0))
      setTodayTransactions(Number(payload.todayTransactions || 0))
      setConfirmedRate(Number(payload.confirmedRate || 0))
      calculateInsights(tx)
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Failed to load transactions")
    }
  }, [callTransactionsApi, calculateInsights])

  const loadChartData = useCallback(async (range: string) => {
    try {
      const payload = (await callTransactionsApi("POST", {
        action: "chart",
        range,
        mode: chartMode
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

  function statusStyle(status: string) {
    if (status === "CONFIRMED") return "bg-green-100 text-green-700"
    if (status === "FAILED") return "bg-red-100 text-red-700"
    if (status === "PENDING") return "bg-yellow-100 text-yellow-700"
    return "bg-gray-100 text-gray-700"
  }

  const filteredTransactions = transactions.filter((tx) => {
    if (walletFilter !== "all" && tx.provider !== walletFilter) return false
    if (networkFilter !== "all" && tx.network !== networkFilter) return false
    return true
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">
        Transactions
      </h1>

      {/* SUMMARY */}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
        <div
          className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm cursor-pointer hover:bg-gray-50"
          onClick={() => {
            setChartMode("all")
            setShowChart(true)
            loadChartData(chartRange)
          }}
        >
          <div className="text-sm text-gray-600">Today&apos;s Volume</div>
          <div className="text-xl font-semibold text-gray-900 mt-1">
            ${todayVolume.toFixed(2)}
          </div>
        </div>

        <AnalyticsCard title="Transactions" value={todayTransactions.toString()} />

        <AnalyticsCard
          title="Confirmed Rate"
          value={`${confirmedRate}%`}
        />
      </div>

      {/* INSIGHTS */}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-10">
        <AnalyticsCard title="Peak Hour" value={peakHour} />
        <AnalyticsCard title="Peak Day" value={peakDay} />
        <AnalyticsCard title="Top Provider" value={topProvider} />
        <AnalyticsCard title="Top Network" value={topNetwork} />
      </div>

      {/* CHANNEL MIX */}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">

        <div
          className="cursor-pointer"
          onClick={() => {
            setChartMode("pos")
            setShowChart(true)
            loadChartData(chartRange)
          }}
        >
          <AnalyticsCard title="POS Payments" value={`${posPercent}%`} />
        </div>

        <div
          className="cursor-pointer"
          onClick={() => {
            setChartMode("online")
            setShowChart(true)
            loadChartData(chartRange)
          }}
        >
          <AnalyticsCard title="Online Payments" value={`${onlinePercent}%`} />
        </div>

      </div>

      {/* AI INSIGHT */}

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-10">
        <div className="text-sm text-blue-700 font-medium mb-1">
          PineTree Insights
        </div>

        <div className="text-gray-900 text-sm">
          {aiInsight}
        </div>
      </div>

      {/* FILTERS */}

      <div className="flex flex-wrap gap-4 mb-6">
        <select
          className="border border-gray-300 rounded px-3 py-2 text-sm bg-white text-gray-900"
          value={walletFilter}
          onChange={(e) => setWalletFilter(e.target.value)}
        >
          <option value="all">All Wallets</option>
          <option value="solana">Solana Pay</option>
          <option value="coinbase">Coinbase Business</option>
          <option value="shift4">Shift4</option>
          <option value="base">Base Pay</option>
        </select>

        <select
          className="border border-gray-300 rounded px-3 py-2 text-sm bg-white text-gray-900"
          value={networkFilter}
          onChange={(e) => setNetworkFilter(e.target.value)}
        >
          <option value="all">All Networks</option>
          <option value="solana">Solana</option>
          <option value="base">Base</option>
          <option value="ethereum">Ethereum</option>
        </select>
      </div>

      {/* TABLE */}

      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-x-auto">
        <table className="w-full min-w-[860px]">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr className="text-left text-sm text-gray-700">
              <th className="px-6 py-3 font-medium">Date</th>
              <th className="px-6 py-3 font-medium">Amount</th>
              <th className="px-6 py-3 font-medium">Currency</th>
              <th className="px-6 py-3 font-medium">Network</th>
              <th className="px-6 py-3 font-medium">Provider</th>
              <th className="px-6 py-3 font-medium">Status</th>
              <th className="px-6 py-3 font-medium">Reference</th>
            </tr>
          </thead>

          <tbody>
            {filteredTransactions.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-gray-700 py-16">
                  No transactions found.
                </td>
              </tr>
            )}

            {filteredTransactions.map((tx) => {
              const payment = Array.isArray(tx.payments) ? tx.payments[0] : tx.payments

              return (
                <tr
                  key={tx.id}
                  className="border-b border-gray-100 text-sm hover:bg-gray-50"
                >
                  <td className="px-6 py-4 text-gray-900">
                    {payment ? new Date(payment.created_at).toLocaleString() : "—"}
                  </td>

                  <td className="px-6 py-4 font-medium text-gray-900">
                    {payment ? `$${Number(payment.total_amount).toFixed(2)}` : "—"}
                  </td>

                  <td className="px-6 py-4 text-gray-900">
                    {payment?.currency || "—"}
                  </td>

                  <td className="px-6 py-4 text-gray-700">
                    {tx.network || "—"}
                  </td>

                  <td className="px-6 py-4 text-gray-900">
                    {providerName(tx.provider)}
                  </td>

                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusStyle(tx.status)}`}>
                      {tx.status}
                    </span>
                  </td>

                  <td className="px-6 py-4 text-gray-700 font-mono text-xs">
                    {tx.provider_transaction_id}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* CHART */}

      {showChart && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-3">
          <div className="bg-white w-full max-w-[900px] max-h-[90vh] overflow-y-auto p-4 sm:p-6 rounded-lg shadow-lg">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-6">
              <h2 className="text-lg font-semibold text-gray-900">
                {chartMode === "pos"
                  ? "POS Payment Volume"
                  : chartMode === "online"
                  ? "Online Payment Volume"
                  : "Transaction Volume"}
              </h2>

              <button
                onClick={() => setShowChart(false)}
                className="text-gray-600"
              >
                Close
              </button>
            </div>

            <div className="flex flex-wrap gap-2 mb-6">
              {["24h", "7d", "1m", "3m", "6m", "1y"].map((r) => (
                <button
                  key={r}
                  onClick={() => {
                    setChartRange(r)
                    loadChartData(r)
                  }}
                  className={`px-3 py-1 rounded border ${chartRange === r ? "bg-blue-600 text-white" : "bg-white text-gray-700"}`}
                >
                  {r.toUpperCase()}
                </button>
              ))}
            </div>

            <ResponsiveContainer width="100%" height={350}>
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
                />

                <Tooltip
                  contentStyle={{
                    background: "#fff",
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    boxShadow: "0 6px 18px rgba(0,0,0,0.08)"
                  }}
                />

                <Legend wrapperStyle={{ fontSize: "12px" }} />

                <Bar dataKey="solana" stackId="a" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="base" stackId="a" fill="#2563eb" radius={[4, 4, 0, 0]} />
                <Bar dataKey="coinbase" stackId="a" fill="#1e40af" radius={[4, 4, 0, 0]} />
                <Bar dataKey="shift4" stackId="a" fill="#14b8a6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}

function AnalyticsCard({ title, value }: { title: string, value: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
      <div className="text-sm text-gray-600">{title}</div>
      <div className="text-xl font-semibold text-gray-900 mt-1">{value}</div>
    </div>
  )
}