"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import Button from "@/components/ui/Button"
import {
  CompactMetricTile,
  DashboardHeroCard,
  DashboardSection,
  MetricGrid,
  NetworkStatusPill
} from "@/components/dashboard/DashboardPrimitives"

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

  return "Connected"
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

  const totalConnections = wallets.length + paymentRails.length

  return (
    <div className="w-full space-y-5 md:space-y-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">
            Settlement Layer
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-gray-950 md:text-3xl">Wallets</h1>
        </div>

        <Button
          onClick={() => loadOverview(true)}
          disabled={isRefreshing}
        >
          {isRefreshing ? "Refreshing..." : "Refresh Balances"}
        </Button>
      </div>

      {refreshError && (
        <p className="text-sm text-red-600 mb-4">Refresh error: {refreshError}</p>
      )}

      <DashboardHeroCard
        eyebrow="Total Balance"
        title="Connected wallet and payment rail value"
        value={`$${totalBalance.toFixed(2)}`}
        detail={
          lastRefreshAt && !refreshError
            ? `Last wallet sync: ${formatChicagoDateTime(lastRefreshAt)} (America/Chicago)`
            : "Balances update from the wallet overview endpoint."
        }
      />

      <MetricGrid columns="three">
        <CompactMetricTile label="Connections" value={totalConnections} tone="blue" />
        <CompactMetricTile label="Wallets" value={wallets.length} />
        <CompactMetricTile label="Payment Rails" value={paymentRails.length} tone="slate" />
      </MetricGrid>

      <DashboardSection title="Connected Wallets" eyebrow="Balances">
        <div className="space-y-3">
          {wallets.length === 0 && paymentRails.length === 0 && (
            <div className="rounded-2xl border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500 shadow-sm">
              No wallets connected yet
            </div>
          )}

          {paymentRails.map((rail) => (
            <div key={rail.id} className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] transition hover:border-blue-200 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <p className="text-base font-semibold text-gray-950">Bitcoin Lightning</p>
                  <NetworkStatusPill label="Connected" tone="blue" />
                </div>

                <p
                  className="max-w-full truncate font-mono text-xs text-gray-500"
                  title={rail.speedAccountId}
                >
                  {formatSpeedAccountId(rail.speedAccountId)}
                </p>
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
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <p className="text-base font-semibold text-gray-950">
                    {formatProvider(w.provider, w.network)}
                  </p>
                  <NetworkStatusPill label={w.network} tone="blue" />
                </div>

                <p
                  className="max-w-full truncate font-mono text-xs text-gray-500"
                  title={w.wallet_address}
                >
                  {formatWalletAddress(w.wallet_address)}
                </p>
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
