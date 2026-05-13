"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import {
  CompactMetricTile,
  DashboardHeroCard,
  DashboardSection,
  MetricGrid,
  NetworkStatusPill,
  PineTreeInsightsCard
} from "@/components/dashboard/DashboardPrimitives"
import {
  formatDashboardNetwork,
  formatDashboardProvider
} from "@/components/dashboard/displayHelpers"

type WalletItem = {
  id: string
  network: string
  provider: string | null
  wallet_address: string
  assetSymbol: "SOL" | "ETH"
  nativeBalance: number
  usdValue: number
}

type PaymentRailItem = {
  id: string
  type: "bitcoin_lightning"
  provider: "Speed"
  status: "Connected"
  speedAccountId: string
  assetSymbol: "BTC"
  nativeBalance: number
  usdValue: number
}

type WalletOverviewResponse = {
  success?: boolean
  wallets?: WalletItem[]
  paymentRails?: PaymentRailItem[]
  totalUsd?: number
  lastRun?: string | null
  error?: string
}

function formatProvider(name?: string | null, network?: string) {
  const normalized = String(name || "").toLowerCase()

  const map: Record<string, string> = {
    phantom: "Phantom",
    solflare: "Solflare",
    metamask: "MetaMask",
    trust: "Trust Wallet",
    coinbase: "Coinbase Wallet",
    base: "Base Wallet",
    baseapp: "Base Wallet"
  }

  if (normalized && map[normalized]) return map[normalized]
  if (network === "solana") return "Phantom"
  if (network === "base") return "Base Wallet"
  if (network === "ethereum") return "MetaMask"

  return formatDashboardProvider(name)
}

function formatWalletAddress(address: string) {
  const trimmed = address.trim()
  if (trimmed.length <= 14) return trimmed

  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`
}

function formatSpeedAccountId(accountId: string) {
  const trimmed = accountId.trim()
  if (trimmed.length <= 16) return trimmed

  return `${trimmed.slice(0, 8)}...${trimmed.slice(-4)}`
}

export default function WalletsPage() {
  const [wallets, setWallets] = useState<WalletItem[]>([])
  const [paymentRails, setPaymentRails] = useState<PaymentRailItem[]>([])
  const [totalBalance, setTotalBalance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null)

  useEffect(() => {
    loadOverview(false)
  }, [])

  async function loadOverview(refresh: boolean) {
    setIsRefreshing(true)
    setRefreshError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      if (!token) {
        throw new Error("No active auth session")
      }

      const endpoint = refresh
        ? "/api/wallets/overview?refresh=1"
        : "/api/wallets/overview"

      const res = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${token}`
        },
        credentials: "include",
        cache: "no-store"
      })

      const payload = (await res.json().catch(() => null)) as WalletOverviewResponse | null

      if (!res.ok) {
        throw new Error(payload?.error || "Failed to load wallet overview")
      }

      setWallets(payload?.wallets || [])
      setPaymentRails(payload?.paymentRails || [])
      setTotalBalance(Number(payload?.totalUsd ?? 0) || 0)
      setLastRefreshAt(payload?.lastRun || null)
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : "Wallet refresh failed")
    } finally {
      setIsRefreshing(false)
    }
  }

  function formatChicagoDateTime(value: string | null) {
    if (!value) return "—"
    const hasTimezone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value)
    const parsed = new Date(hasTimezone ? value : `${value}Z`)
    if (Number.isNaN(parsed.getTime())) return "—"

    return parsed.toLocaleString("en-US", {
      timeZone: "America/Chicago",
      month: "numeric",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit"
    })
  }

  const balancedRails = paymentRails.filter(
    (rail) =>
      Boolean(rail.speedAccountId) &&
      (Number(rail.nativeBalance ?? 0) > 0 || Number(rail.usdValue ?? 0) > 0)
  )
  const totalConnections = wallets.length + balancedRails.length
  const walletInsights = [
    totalConnections > 0
      ? `${totalConnections} connected ${totalConnections === 1 ? "wallet or payment account is" : "wallets and payment accounts are"} included in this balance view.`
      : "",
    totalBalance > 0
      ? `Visible wallet and account balances total $${totalBalance.toFixed(2)}.`
      : ""
  ]

  return (
    <div className="w-full space-y-5 md:space-y-7">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-950 md:text-3xl">Wallets</h1>
        </div>

        <button
          type="button"
          onClick={() => loadOverview(true)}
          disabled={isRefreshing}
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 px-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-10 sm:px-4"
        >
          <span className="sm:hidden">{isRefreshing ? "Refreshing" : "Refresh"}</span>
          <span className="hidden sm:inline">{isRefreshing ? "Refreshing..." : "Refresh Balances"}</span>
        </button>
      </div>

      {refreshError && (
        <p className="text-sm text-red-600 mb-4">Refresh error: {refreshError}</p>
      )}

      <DashboardHeroCard
        eyebrow="Total Balance"
        title="Connected wallet and account value"
        value={`$${totalBalance.toFixed(2)}`}
        detail={
          lastRefreshAt && !refreshError
            ? `Last wallet sync: ${formatChicagoDateTime(lastRefreshAt)} (America/Chicago)`
            : "Balances update from the wallet overview endpoint."
        }
      />

      <MetricGrid columns="two">
        <CompactMetricTile label="Connections" value={totalConnections} tone="blue" />
        <CompactMetricTile label="Total Value" value={`$${totalBalance.toFixed(2)}`} tone="slate" />
      </MetricGrid>

      <PineTreeInsightsCard
        insights={walletInsights}
        emptyText="Wallet insights will appear when connected wallets or account balances are available."
      />

      <DashboardSection title="Connected Wallets" titleTone="blue">
        <div className="space-y-3">
          {wallets.length === 0 && paymentRails.length === 0 && (
            <div className="rounded-2xl border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500 shadow-sm">
              No wallets connected yet
            </div>
          )}

          {paymentRails.map((rail) => (
            <div key={rail.id} className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] transition hover:border-blue-200 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <p className="text-base font-semibold text-gray-950">Bitcoin Lightning</p>
                  <NetworkStatusPill
                    label={rail.speedAccountId ? "Connected" : "Not Connected"}
                    tone={rail.speedAccountId ? "blue" : "slate"}
                    className="shrink-0"
                  />
                </div>

                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <p
                    className="max-w-full truncate font-mono text-xs text-gray-500"
                    title={rail.speedAccountId}
                  >
                    {formatSpeedAccountId(rail.speedAccountId)}
                  </p>
                  <NetworkStatusPill label={formatDashboardProvider(rail.provider)} tone="slate" className="min-h-6 px-2 text-[10px]" />
                </div>
              </div>

              <div className="shrink-0 text-left sm:text-right">
                <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-500">Balance</p>

                <p className="mt-1 text-lg font-semibold text-gray-950">
                  {Number(rail.nativeBalance ?? 0).toFixed(8)} {rail.assetSymbol}
                </p>

                <p className="text-xs text-gray-500 mt-1">
                  ${Number(rail.usdValue ?? 0).toFixed(2)} USD
                </p>
              </div>
            </div>
          ))}

          {wallets.map((w) => (
          <div key={w.id} className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] transition hover:border-blue-200 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <p className="text-base font-semibold text-gray-950">
                    {formatProvider(w.provider, w.network)}
                  </p>
                  <NetworkStatusPill
                    label={w.wallet_address ? "Connected" : "Not Connected"}
                    tone={w.wallet_address ? "blue" : "slate"}
                    className="shrink-0"
                  />
                </div>

                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <p
                    className="max-w-full truncate font-mono text-xs text-gray-500"
                    title={w.wallet_address}
                  >
                    {formatWalletAddress(w.wallet_address)}
                  </p>
                  <NetworkStatusPill label={formatDashboardNetwork(w.network)} tone="slate" className="min-h-6 px-2 text-[10px]" />
                </div>
              </div>

              <div className="shrink-0 text-left sm:text-right">
                <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-500">Balance</p>

                <p className="mt-1 text-lg font-semibold text-gray-950">
                  {Number(w.nativeBalance ?? 0).toFixed(6)} {w.assetSymbol}
                </p>

                <p className="text-xs text-gray-500 mt-1">
                  ${Number(w.usdValue ?? 0).toFixed(2)} USD
                </p>
              </div>
            </div>
          ))}
        </div>
      </DashboardSection>
    </div>
  )
}
