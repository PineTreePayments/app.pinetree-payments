"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"

type WalletItem = {
  id: string
  network: string
  provider: string | null
  wallet_address: string
  assetSymbol: "SOL" | "ETH"
  nativeBalance: number
  usdValue: number
}

type WalletOverviewResponse = {
  success?: boolean
  wallets?: WalletItem[]
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

export default function WalletsPage() {
  const [wallets, setWallets] = useState<WalletItem[]>([])
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

  return (
    <div className="w-full px-4 md:px-8 py-6 md:py-10">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 mb-8">
        <h1 className="text-2xl md:text-3xl font-semibold text-black">Wallets</h1>

        <button
          onClick={() => loadOverview(true)}
          disabled={isRefreshing}
          className="px-4 py-2 bg-blue-600 text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {isRefreshing ? "Refreshing..." : "Refresh Balances"}
        </button>
      </div>

      {refreshError && (
        <p className="text-sm text-red-600 mb-4">Refresh error: {refreshError}</p>
      )}

      {lastRefreshAt && !refreshError && (
        <p className="text-xs text-gray-500 mb-4">
          Last wallet sync: {formatChicagoDateTime(lastRefreshAt)} (America/Chicago)
        </p>
      )}

      <div className="bg-white border border-gray-200 rounded-2xl p-5 md:p-8 mb-6 md:mb-8 shadow-sm w-full">
        <p className="text-sm text-blue-600 mb-2">Total Balance</p>
        <p className="text-4xl font-semibold text-black">${totalBalance.toFixed(2)}</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-5 md:p-8 shadow-sm w-full">
        <h2 className="text-lg font-semibold text-black mb-6">Connected Wallets</h2>

        <div className="space-y-5">
          {wallets.length === 0 && (
            <p className="text-gray-400 text-sm">No wallets connected yet</p>
          )}

          {wallets.map((w) => (
            <div key={w.id} className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border rounded-xl p-5 min-h-[90px]">
              <div>
                <p className="text-sm text-blue-600 font-medium mb-1">
                  {formatProvider(w.provider, w.network)}
                </p>

                <p className="text-base font-semibold text-black break-all">
                  {w.wallet_address}
                </p>
              </div>

              <div className="text-left sm:text-right">
                <p className="text-sm text-blue-600 mb-1">Balance</p>

                <p className="text-lg text-black font-semibold">
                  {Number(w.nativeBalance ?? 0).toFixed(6)} {w.assetSymbol}
                </p>

                <p className="text-xs text-gray-500 mt-1">
                  ${Number(w.usdValue ?? 0).toFixed(2)} USD
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
