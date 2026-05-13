"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
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
  CompactMetricTile,
  DashboardHeroCard,
  DashboardSection,
  MetricGrid,
  PineTreeInsightsCard
} from "@/components/dashboard/DashboardPrimitives"
import {
  countBy,
  formatDashboardNetwork,
  formatDashboardProvider,
  mostFrequentKey
} from "@/components/dashboard/displayHelpers"

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
  error?: string
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

function formatUsd(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(Number.isFinite(amount) ? amount : 0)
}

function getOverviewInsights(input: {
  recentTx: DashboardTransactionRow[]
  providers: number
  successRate: number
  volume: number
}) {
  const providerCounts = countBy(input.recentTx, (tx) => tx.provider)
  const networkCounts = countBy(
    input.recentTx,
    (tx) => tx.provider === "cash" ? null : tx.network
  )
  const topProvider = mostFrequentKey(providerCounts)
  const topNetwork = mostFrequentKey(networkCounts)
  const insights: string[] = []

  if (topProvider) {
    insights.push(`${formatDashboardProvider(topProvider)} is your most used provider in recent activity.`)
  }

  if (topNetwork) {
    insights.push(`${formatDashboardNetwork(topNetwork)} is leading recent network activity.`)
  }

  if (input.providers > 0) {
    insights.push(`${input.providers} payment ${input.providers === 1 ? "provider is" : "providers are"} active for routing.`)
  }

  if (input.volume > 0 && input.successRate > 0) {
    insights.push(`Current success rate is ${input.successRate}% across tracked dashboard volume.`)
  }

  return insights
}

export default function DashboardPage() {

  const router = useRouter()

  const [volume,setVolume] = useState(0)
  const [txCount,setTxCount] = useState(0)
  const [successRate,setSuccessRate] = useState(0)
  const [providers,setProviders] = useState(0)
  const [recentTx,setRecentTx] = useState<DashboardTransactionRow[]>([])
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
    setProviders(Number(payload.providers ?? 0))
    setChartData(payload.chartData || [])
    setWalletValue(Number(payload.walletValue ?? 0))
    setLastRun(payload.lastRun || null)
    setRecentTx(payload.recentTx || [])
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

    if (!AUTO_POLLING_ENABLED) {
      return
    }

    const interval = setInterval(() => {
      void loadOverview().catch((err) => {
        console.error("Dashboard poll failed:", err)
      })
    },15000)

    return () => clearInterval(interval)
  },[loadOverview])



  const overviewInsights = getOverviewInsights({ recentTx, providers, successRate, volume })

  return (
    <div className="space-y-5 md:space-y-7">

      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-950 md:text-3xl">
            Overview
          </h1>
        </div>

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

      <DashboardHeroCard
        eyebrow="Live Balance"
        title="Combined balance across connected wallets"
        value={formatUsd(walletValue)}
        detail={
          <>
            Last system update: {formatChicagoDateTime(lastRun)}
            <span className="text-gray-400"> (America/Chicago)</span>
          </>
        }
        action={
          <button
            onClick={()=>router.push("/dashboard/wallets")}
            className="inline-flex min-h-10 w-fit self-start items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 sm:self-auto md:px-5"
          >
            View Wallets
          </button>
        }
      />

      <MetricGrid>
        <CompactMetricTile label="Total Volume" value={formatUsd(volume)} tone="blue" />
        <CompactMetricTile label="Transactions" value={txCount} />
        <CompactMetricTile label="Success Rate" value={`${successRate}%`} tone="green" />
        <CompactMetricTile label="Active Providers" value={providers} tone="slate" />
      </MetricGrid>

      <ChartCard
        title="Transaction Volume"
        titleTone="blue"
        subtitle="Recent confirmed payment volume"
        className="overflow-hidden pb-5 sm:pb-5"
      >
        <div className="h-36 pb-3 sm:h-64 sm:pb-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={
                chartData.length > 0
                ? chartData
                : [
                  { date:"", volume:0 },
                  { date:"", volume:0 }
                ]
              }
              margin={{ top: 8, right: 8, left: -12, bottom: 16 }}
            >
              <defs>
                <linearGradient id="overviewVolumeGradient" x1="0" y1="0" x2="0" y2="1">
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
                fill="url(#overviewVolumeGradient)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0, fill: "#1d4ed8" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <PineTreeInsightsCard insights={overviewInsights} />

      <DashboardSection title="Recent Activity" titleTone="blue">
        <TransactionActivityTable
          transactions={recentTx}
          emptyMessage="No transactions yet."
        />
      </DashboardSection>

    </div>
  )
}
