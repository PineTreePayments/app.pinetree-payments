"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import Button from "@/components/ui/Button"

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
  paymentAddress: string
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

  return (
    <div className="w-full px-4 md:px-8 py-6 md:py-10">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 mb-8">
        <h1 className="text-2xl md:text-3xl font-semibold text-black">Wallets</h1>

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
          {wallets.length === 0 && paymentRails.length === 0 && (
            <p className="text-gray-400 text-sm">No wallets connected yet</p>
          )}

          {paymentRails.map((rail) => (
            <div key={rail.id} className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 min-h-[90px] shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-blue-200 hover:shadow-[0_20px_60px_rgba(15,23,42,0.12),0_0_40px_rgba(37,99,235,0.18)] focus-within:-translate-y-1 focus-within:border-blue-200 focus-within:shadow-[0_20px_60px_rgba(15,23,42,0.12),0_0_40px_rgba(37,99,235,0.18)]">
              <div className="min-w-0 flex-1">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <p className="text-base font-semibold text-gray-900">
                    Bitcoin Lightning
                  </p>
                  <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold leading-none text-blue-700">
                    {rail.status}
                  </span>
                </div>

                <p className="text-sm font-medium text-gray-600">
                  Speed merchant account
                </p>
              </div>

              <div className="grid w-full gap-2 text-left sm:w-auto sm:min-w-[260px]">
                <div className="grid grid-cols-[112px_1fr] items-start gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    Provider
                  </span>
                  <span className="min-w-0 text-sm font-semibold text-gray-950">
                    {rail.provider}
                  </span>
                </div>

                <div className="grid grid-cols-[112px_1fr] items-start gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    Account
                  </span>
                  <span className="min-w-0 break-all text-sm font-semibold text-gray-950" title={rail.speedAccountId}>
                    {formatSpeedAccountId(rail.speedAccountId)}
                  </span>
                </div>

                <div className="grid grid-cols-[112px_1fr] items-start gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    Payment Address
                  </span>
                  <span className="min-w-0 break-all text-sm font-semibold text-gray-950" title={rail.paymentAddress}>
                    {rail.paymentAddress}
                  </span>
                </div>

                <div className="grid grid-cols-[112px_1fr] items-start gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    Status
                  </span>
                  <span className="min-w-0 text-sm font-semibold text-gray-950">
                    {rail.status}
                  </span>
                </div>
              </div>
            </div>
          ))}

          {wallets.map((w) => (
          <div key={w.id} className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 min-h-[90px] shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-blue-200 hover:shadow-[0_20px_60px_rgba(15,23,42,0.12),0_0_40px_rgba(37,99,235,0.18)] focus-within:-translate-y-1 focus-within:border-blue-200 focus-within:shadow-[0_20px_60px_rgba(15,23,42,0.12),0_0_40px_rgba(37,99,235,0.18)]">
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold text-gray-800 mb-1">
                  {formatProvider(w.provider, w.network)}
                </p>

                <p
                  className="max-w-full truncate text-base font-semibold text-black"
                  title={w.wallet_address}
                >
                  {formatWalletAddress(w.wallet_address)}
                </p>
              </div>

              <div className="text-left sm:text-right shrink-0">
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
