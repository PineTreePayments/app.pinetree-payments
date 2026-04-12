"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/database/supabase"

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer
} from "recharts"

type DashboardOverviewResponse = {
  success?: boolean
  volume?: number
  txCount?: number
  successRate?: number
  providers?: number
  recentTx?: RecentTxRow[]
  chartData?: ChartPoint[]
  walletValue?: number
  lastRun?: string | null
  error?: string
}

type PaymentSummary = {
  subtotal_amount?: number | string | null
}

type RecentTxRow = {
  id: string
  status: string
  network?: string | null
  created_at: string
  payments?: PaymentSummary | PaymentSummary[] | null
}

type ChartPoint = {
  date: string
  volume: number
}

function parseTimestamp(value: string) {
  const hasTimezone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value)
  return new Date(hasTimezone ? value : `${value}Z`)
}

function formatChicagoDateTime(value: string | null) {
  if (!value) return "—"
  const date = parseTimestamp(value)
  if (Number.isNaN(date.getTime())) return "—"

  return date.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  })
}

export default function DashboardPage() {

  const router = useRouter()

  const [volume,setVolume] = useState(0)
  const [txCount,setTxCount] = useState(0)
  const [successRate,setSuccessRate] = useState(0)
  const [providers,setProviders] = useState(0)
  const [recentTx,setRecentTx] = useState<RecentTxRow[]>([])
  const [chartData,setChartData] = useState<ChartPoint[]>([])
  const [walletValue,setWalletValue] = useState(0)
  const [lastRun,setLastRun] = useState<string | null>(null)
  const [isSyncing,setIsSyncing] = useState(false)
  const [syncError,setSyncError] = useState<string | null>(null)

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
    setProviders(Number(payload.providers ?? 0))
    setRecentTx(payload.recentTx || [])
    setChartData(payload.chartData || [])
    setWalletValue(Number(payload.walletValue ?? 0))
    setLastRun(payload.lastRun || null)
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

  useEffect(()=>{
    void loadOverview().catch((err) => {
      console.error("Dashboard load failed:", err)
    })

    const interval = setInterval(() => {
      void loadOverview().catch((err) => {
        console.error("Dashboard poll failed:", err)
      })
    },15000)

    return () => clearInterval(interval)
  },[loadOverview])



  return (
    <div className="p-3 sm:p-4 md:p-8 bg-gray-100 min-h-screen">

      <h1 className="text-2xl font-semibold text-gray-900 mb-2">
        Overview
      </h1>

      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-sm text-gray-500">
          Last system update: {formatChicagoDateTime(lastRun)}
          <span className="text-gray-400 ml-2">(America/Chicago)</span>
        </p>

        <button
          onClick={syncNow}
          disabled={isSyncing}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSyncing ? "Syncing..." : "Sync Now"}
        </button>
      </div>

      {syncError && (
        <p className="text-sm text-red-600 mb-4">Sync error: {syncError}</p>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-4 md:p-6 shadow-sm mb-6 md:mb-10 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">

        <div>
          <p className="text-sm text-gray-500 mb-1">
            Wallet Balance
          </p>

          <p className="text-3xl font-semibold text-gray-900">
            ${walletValue.toFixed(2)}
          </p>

          <p className="text-sm text-gray-500 mt-1">
            Combined balance across connected wallets
          </p>
        </div>

        <button
          onClick={()=>router.push("/dashboard/wallets")}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition"
        >
          View Wallets
        </button>

      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 md:gap-6 mb-6 md:mb-10">

        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm min-w-0">
          <p className="text-sm text-gray-500 mb-1">Total Volume</p>
          <p className="text-3xl font-semibold text-gray-900">
            ${volume.toFixed(2)}
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 md:p-6 shadow-sm min-w-0">
          <p className="text-sm text-gray-500 mb-1">Transactions</p>
          <p className="text-3xl font-semibold text-gray-900">
            {txCount}
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 md:p-6 shadow-sm min-w-0">
          <p className="text-sm text-gray-500 mb-1">Success Rate</p>
          <p className="text-3xl font-semibold text-gray-900">
            {successRate}%
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 md:p-6 shadow-sm min-w-0">
          <p className="text-sm text-gray-500 mb-1">Active Providers</p>
          <p className="text-3xl font-semibold text-gray-900">
            {providers}
          </p>
        </div>

      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm mb-6 md:mb-10">

        <h2 className="text-lg font-semibold text-gray-900 mb-6">
          Transaction Volume
        </h2>

        <div className="h-64">

          <ResponsiveContainer width="100%" height="100%">

            <LineChart
              data={
                chartData.length > 0
                ? chartData
                : [
                  { date:"", volume:0 },
                  { date:"", volume:0 }
                ]
              }
            >

              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />

              <Line
                type="monotone"
                dataKey="volume"
                stroke="#2563eb"
                strokeWidth={3}
                dot={false}
              />

            </LineChart>

          </ResponsiveContainer>

        </div>

      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">

        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Recent Activity
        </h2>

        {recentTx.length === 0 && (
          <div className="text-gray-500 text-sm">
            No transactions yet.
          </div>
        )}

        {recentTx.length > 0 && (
          <div className="overflow-x-auto">

            <table className="w-full min-w-[720px] text-sm">

              <thead className="text-left text-gray-500 border-b">
                <tr>
                  <th className="py-2">Transaction</th>
                  <th className="py-2">Amount</th>
                  <th className="py-2">Network</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Time</th>
                </tr>
              </thead>

              <tbody>

                {recentTx.map((tx)=>{

                  const payment = Array.isArray(tx.payments)
                    ? tx.payments[0]
                    : tx.payments

                  const txDate = parseTimestamp(tx.created_at)
                  const now = new Date()
                  const ageMinutes = (now.getTime() - txDate.getTime()) / (1000 * 60)
                  
                  // Only expire PENDING status after 5 minutes. PROCESSING never expires.
                  const effectiveStatus = tx.status === "PENDING" && ageMinutes > 5
                    ? "EXPIRED"
                    : tx.status
                  
                  const statusClasses =
                    effectiveStatus === "CONFIRMED"
                      ? "bg-green-100 text-green-800"
                      : effectiveStatus === "FAILED"
                      ? "bg-red-100 text-red-800"
                      : effectiveStatus === "EXPIRED"
                      ? "bg-gray-100 text-gray-700"
                      : effectiveStatus === "PROCESSING"
                      ? "bg-blue-100 text-blue-800"
                      : "bg-amber-100 text-amber-800"

                  return(

                    <tr key={tx.id} className="border-b last:border-none">

                      <td className="py-3 font-mono text-xs text-gray-700">
                        {tx.id.slice(0,12)}...
                      </td>

                      <td className="py-3 text-gray-800 font-medium">
                        ${Number(payment?.subtotal_amount ?? 0).toFixed(2)}
                      </td>

                      <td className="py-3 text-gray-700">
                        {tx.network ?? "-"}
                      </td>

                      <td className="py-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusClasses}`}>
                          {effectiveStatus}
                        </span>
                      </td>

                      <td className="py-3 text-gray-500 text-xs">
                        {formatChicagoDateTime(tx.created_at)}
                      </td>

                    </tr>

                  )

                })}

              </tbody>

            </table>

          </div>
        )}

      </div>

    </div>
  )
}