"use client"

import { useEffect, useMemo, useState } from "react"
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

type DetailTab = "overview" | "send" | "provider_actions" | "cash_out" | "activity" | "settings"

type SelectedWallet = {
  displayName: string
  rail: "bitcoin_lightning" | "solana" | "base" | "ethereum"
  provider: string
  networkLabel: string
  reference: string
  referenceTitle: string
  referenceLabel: string
  assetSymbol: "SOL" | "ETH" | "BTC"
  nativeBalance: number
  usdValue: number
  decimals: number
  isLightning: boolean
}

const moonPaySupportedAssets = [
  "USDC on Solana",
  "SOL on Solana",
  "USDC on Base",
  "ETH on Base"
]

const moonPayDisclaimer =
  "Availability varies by state, asset, network, and payout method. Base network cash-out may not be available for New York residents."

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ")
}

function formatProvider(name?: string | null, network?: string) {
  const normalized = String(name || "").toLowerCase()
  const normalizedNetwork = String(network || "").toLowerCase()

  const map: Record<string, string> = {
    phantom: "Phantom",
    solflare: "Solflare",
    metamask: "MetaMask",
    trust: "Trust Wallet",
    base: "Base Wallet",
    baseapp: "Base Wallet"
  }

  if (normalized.includes("coinbase")) {
    if (normalizedNetwork === "base") return "Base Wallet"
    if (normalizedNetwork === "ethereum") return "Ethereum Wallet"
    return "Connected Wallet"
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

function normalizeWalletNetwork(network: string): SelectedWallet["rail"] {
  const n = String(network || "").toLowerCase().trim()
  if (n === "solana") return "solana"
  if (n === "base") return "base"
  if (n === "ethereum") return "ethereum"
  return "base"
}

function getExplorerUrl(rail: SelectedWallet["rail"], referenceTitle: string): string | null {
  if (!referenceTitle) return null
  if (rail === "solana") return `https://solscan.io/account/${referenceTitle}`
  if (rail === "base") return `https://basescan.org/address/${referenceTitle}`
  return null
}

function formatChicagoDateTime(value: string | null) {
  if (!value) return "-"
  const hasTimezone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value)
  const parsed = new Date(hasTimezone ? value : `${value}Z`)
  if (Number.isNaN(parsed.getTime())) return "-"

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

function DisabledField({
  label,
  value
}: {
  label: string
  value: string
}) {
  return (
    <label className="block rounded-xl border border-gray-100 bg-gray-50/70 p-3.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">
        {label}
      </span>
      <input
        disabled
        value={value}
        readOnly
        className="mt-2 w-full cursor-not-allowed border-0 bg-transparent p-0 text-sm font-semibold text-gray-500 outline-none"
      />
    </label>
  )
}

function WalletOperationEmptyState({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cx(
      "rounded-2xl border border-gray-200 bg-gradient-to-br from-white to-gray-50/80 shadow-[0_10px_30px_rgba(15,23,42,0.05)]",
      compact ? "p-4" : "p-5"
    )}>
      <div className="flex items-start gap-3">
        <span className="mt-1 h-2.5 w-2.5 rounded-full bg-blue-600 shadow-[0_0_18px_rgba(37,99,235,0.55)]" />
        <div>
          <p className="text-sm font-semibold text-gray-950">No wallet operations yet</p>
          <p className="mt-1 text-sm leading-6 text-gray-500">
            Send and cash-out history will appear here once wallet operations are enabled.
          </p>
        </div>
      </div>
    </div>
  )
}

export default function WalletsPage() {
  const [wallets, setWallets] = useState<WalletItem[]>([])
  const [paymentRails, setPaymentRails] = useState<PaymentRailItem[]>([])
  const [totalBalance, setTotalBalance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null)
  const [connectionsOpen, setConnectionsOpen] = useState(false)
  const [selectedWallet, setSelectedWallet] = useState<SelectedWallet | null>(null)
  const [activeTab, setActiveTab] = useState<DetailTab>("overview")
  const [cashOutSetupOpen, setCashOutSetupOpen] = useState(false)
  const [copiedRef, setCopiedRef] = useState(false)

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

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedRef(true)
      setTimeout(() => setCopiedRef(false), 2000)
    } catch {
      // Clipboard unavailable in this context.
    }
  }

  function openWalletDetail(wallet: SelectedWallet, tab: DetailTab = "overview") {
    setCopiedRef(false)
    setActiveTab(tab)
    setSelectedWallet(wallet)
  }

  function buildLightningWallet(rail: PaymentRailItem): SelectedWallet {
    return {
      displayName: "Bitcoin Lightning",
      rail: "bitcoin_lightning",
      provider: "Speed",
      networkLabel: "Bitcoin Lightning",
      reference: formatSpeedAccountId(rail.speedAccountId),
      referenceTitle: rail.speedAccountId,
      referenceLabel: "Speed Account ID",
      assetSymbol: "BTC",
      nativeBalance: rail.nativeBalance,
      usdValue: rail.usdValue,
      decimals: 8,
      isLightning: true
    }
  }

  function buildConnectedWallet(w: WalletItem): SelectedWallet {
    const rail = normalizeWalletNetwork(w.network)

    return {
      displayName: formatProvider(w.provider, w.network),
      rail,
      provider: formatProvider(w.provider, w.network),
      networkLabel: formatDashboardNetwork(w.network),
      reference: formatWalletAddress(w.wallet_address),
      referenceTitle: w.wallet_address,
      referenceLabel: "Wallet Address",
      assetSymbol: w.assetSymbol,
      nativeBalance: w.nativeBalance,
      usdValue: w.usdValue,
      decimals: 6,
      isLightning: false
    }
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

  const connectionRows = useMemo(() => [
    ...paymentRails.map((rail) => ({
      id: rail.id,
      name: "Bitcoin Lightning",
      provider: formatDashboardProvider(rail.provider),
      network: "Bitcoin Lightning",
      reference: formatSpeedAccountId(rail.speedAccountId),
      referenceTitle: rail.speedAccountId,
      status: rail.speedAccountId ? "Connected" : "Not Connected",
      balance: `${Number(rail.nativeBalance ?? 0).toFixed(8)} ${rail.assetSymbol}`,
      usdValue: `$${Number(rail.usdValue ?? 0).toFixed(2)} USD`
    })),
    ...wallets.map((wallet) => ({
      id: wallet.id,
      name: formatProvider(wallet.provider, wallet.network),
      provider: formatProvider(wallet.provider, wallet.network),
      network: formatDashboardNetwork(wallet.network),
      reference: formatWalletAddress(wallet.wallet_address),
      referenceTitle: wallet.wallet_address,
      status: wallet.wallet_address ? "Connected" : "Not Connected",
      balance: `${Number(wallet.nativeBalance ?? 0).toFixed(6)} ${wallet.assetSymbol}`,
      usdValue: `$${Number(wallet.usdValue ?? 0).toFixed(2)} USD`
    }))
  ], [paymentRails, wallets])

  const explorerUrl = selectedWallet
    ? getExplorerUrl(selectedWallet.rail, selectedWallet.referenceTitle)
    : null

  const detailTabs: Array<{ id: DetailTab; label: string }> = selectedWallet?.isLightning
    ? [
      { id: "overview", label: "Overview" },
      { id: "provider_actions", label: "Provider Actions" },
      { id: "cash_out", label: "Cash Out" },
      { id: "activity", label: "Activity" },
      { id: "settings", label: "Settings" }
    ]
    : [
      { id: "overview", label: "Overview" },
      { id: "send", label: "Send" },
      { id: "cash_out", label: "Cash Out" },
      { id: "activity", label: "Activity" },
      { id: "settings", label: "Settings" }
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
        <p className="mb-4 text-sm text-red-600">Refresh error: {refreshError}</p>
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
        <CompactMetricTile
          label="Connections"
          value={totalConnections}
          tone="blue"
          interactive
          onClick={() => setConnectionsOpen(true)}
        />
        <CompactMetricTile label="Total Value" value={`$${totalBalance.toFixed(2)}`} tone="slate" />
      </MetricGrid>

      <PineTreeInsightsCard
        insights={walletInsights}
        emptyText="Wallet insights will appear when connected wallets or account balances are available."
      />

      <DashboardSection title="Cash Out Setup" titleTone="blue">
        <div className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-semibold text-gray-950">Cash Out Setup</p>
                <NetworkStatusPill label="MoonPay" tone="slate" className="min-h-6 px-2 text-[10px]" />
                <NetworkStatusPill label="Setup required" tone="amber" className="min-h-6 px-2 text-[10px]" />
              </div>
              <p className="mt-2 text-sm leading-6 text-gray-600">
                Activate MoonPay once to enable PineTree Cash Out for supported wallets and assets.
              </p>
              <p className="mt-2 text-xs leading-5 text-gray-500">{moonPayDisclaimer}</p>
            </div>
            <button
              type="button"
              onClick={() => setCashOutSetupOpen(true)}
              className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl bg-gray-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-gray-800"
            >
              Set Up Cash Out
            </button>
          </div>
        </div>
      </DashboardSection>

      <DashboardSection title="Connected Wallets" titleTone="blue">
        <div className="grid gap-3 lg:grid-cols-2">
          {wallets.length === 0 && paymentRails.length === 0 && (
            <div className="rounded-2xl border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500 shadow-sm lg:col-span-2">
              No wallets connected yet
            </div>
          )}

          {paymentRails.map((rail) => {
            const wallet = buildLightningWallet(rail)

            return (
              <button
                key={rail.id}
                type="button"
                onClick={() => openWalletDetail(wallet)}
                className="group flex min-h-[156px] flex-col justify-between rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-[0_10px_30px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_18px_50px_rgba(15,23,42,0.10)] focus:outline-none focus:ring-4 focus:ring-blue-100 sm:p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-gray-950">Bitcoin Lightning</p>
                    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                      <NetworkStatusPill label="Speed" tone="slate" className="min-h-6 px-2 text-[10px]" />
                      <NetworkStatusPill label="Bitcoin Lightning" tone="slate" className="min-h-6 px-2 text-[10px]" />
                    </div>
                  </div>
                  <NetworkStatusPill
                    label={rail.speedAccountId ? "Connected" : "Not Connected"}
                    tone={rail.speedAccountId ? "blue" : "slate"}
                    className="shrink-0"
                  />
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <p className="min-w-0 truncate font-mono text-xs text-gray-500" title={rail.speedAccountId}>
                    {formatSpeedAccountId(rail.speedAccountId)}
                  </p>
                  <div className="text-left sm:text-right">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-500">Balance</p>
                    <p className="mt-1 text-lg font-semibold text-gray-950">
                      {Number(rail.nativeBalance ?? 0).toFixed(8)} {rail.assetSymbol}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      ${Number(rail.usdValue ?? 0).toFixed(2)} USD
                    </p>
                  </div>
                </div>

                <span className="mt-4 text-xs font-semibold text-blue-700 opacity-80 transition group-hover:opacity-100">
                  Manage
                </span>
              </button>
            )
          })}

          {wallets.map((w) => {
            const wallet = buildConnectedWallet(w)

            return (
              <button
                key={w.id}
                type="button"
                onClick={() => openWalletDetail(wallet)}
                className="group flex min-h-[156px] flex-col justify-between rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-[0_10px_30px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_18px_50px_rgba(15,23,42,0.10)] focus:outline-none focus:ring-4 focus:ring-blue-100 sm:p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-gray-950">
                      {wallet.displayName}
                    </p>
                    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                      <NetworkStatusPill label={wallet.provider} tone="slate" className="min-h-6 px-2 text-[10px]" />
                      <NetworkStatusPill label={wallet.networkLabel} tone="slate" className="min-h-6 px-2 text-[10px]" />
                    </div>
                  </div>
                  <NetworkStatusPill
                    label={w.wallet_address ? "Connected" : "Not Connected"}
                    tone={w.wallet_address ? "blue" : "slate"}
                    className="shrink-0"
                  />
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <p className="min-w-0 truncate font-mono text-xs text-gray-500" title={w.wallet_address}>
                    {formatWalletAddress(w.wallet_address)}
                  </p>
                  <div className="text-left sm:text-right">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-500">Balance</p>
                    <p className="mt-1 text-lg font-semibold text-gray-950">
                      {Number(w.nativeBalance ?? 0).toFixed(6)} {w.assetSymbol}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      ${Number(w.usdValue ?? 0).toFixed(2)} USD
                    </p>
                  </div>
                </div>

                <span className="mt-4 text-xs font-semibold text-blue-700 opacity-80 transition group-hover:opacity-100">
                  Manage
                </span>
              </button>
            )
          })}
        </div>
      </DashboardSection>

      <DashboardSection title="Recent Wallet Operations" titleTone="blue">
        <WalletOperationEmptyState />
      </DashboardSection>

      {connectionsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3"
          onMouseDown={() => setConnectionsOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Connected wallets and payment accounts"
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/70 bg-white p-4 shadow-[0_24px_80px_rgba(15,23,42,0.22)] sm:p-5"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0052FF]">
                  Connections
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  Connected wallets and payment accounts in this balance view.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConnectionsOpen(false)}
                className="inline-flex h-8 items-center justify-center rounded-full bg-[#0052FF] px-3 text-[11px] font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-100"
              >
                Close
              </button>
            </div>

            <div className="space-y-3">
              {connectionRows.length === 0 && (
                <div className="rounded-2xl border border-gray-100 bg-gray-50/70 px-4 py-8 text-center text-sm text-gray-500">
                  No connected wallets or payment accounts yet.
                </div>
              )}

              {connectionRows.map((connection) => (
                <div
                  key={connection.id}
                  className="rounded-2xl border border-gray-200/80 bg-gradient-to-br from-white to-gray-50/70 p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-950">{connection.name}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <NetworkStatusPill label={connection.provider} tone="slate" className="min-h-6 px-2 text-[10px]" />
                        <NetworkStatusPill label={connection.network} tone="slate" className="min-h-6 px-2 text-[10px]" />
                      </div>
                    </div>
                    <NetworkStatusPill
                      label={connection.status}
                      tone={connection.status === "Connected" ? "blue" : "slate"}
                      className="shrink-0"
                    />
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                    <p className="min-w-0 truncate font-mono text-xs text-gray-500" title={connection.referenceTitle}>
                      {connection.reference || "-"}
                    </p>
                    <div className="text-left sm:text-right">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-500">Balance</p>
                      <p className="mt-1 text-sm font-semibold text-gray-950">{connection.balance}</p>
                      <p className="mt-0.5 text-xs text-gray-500">{connection.usdValue}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {cashOutSetupOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-3"
          onMouseDown={() => setCashOutSetupOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="MoonPay Cash Out setup"
            className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-3xl border border-white/70 bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.22)] sm:rounded-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0052FF]">
                  Cash Out Setup
                </p>
                <h2 className="mt-1 text-lg font-semibold text-gray-950">Set Up Cash Out</h2>
              </div>
              <button
                type="button"
                onClick={() => setCashOutSetupOpen(false)}
                className="inline-flex h-8 shrink-0 items-center justify-center rounded-full bg-gray-100 px-3 text-[11px] font-semibold text-gray-700 shadow-sm transition hover:bg-gray-200 focus:outline-none focus:ring-4 focus:ring-gray-100"
              >
                Close
              </button>
            </div>

            <div className="mt-5 space-y-3">
              <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                <p className="text-sm leading-6 text-gray-700">
                  MoonPay will process fiat payout and compliance checks.
                </p>
                <p className="mt-2 text-sm leading-6 text-gray-700">
                  PineTree will keep the merchant experience unified and track supported cash-out sessions once enabled.
                </p>
                <p className="mt-2 text-sm font-semibold text-gray-950">
                  No MoonPay connection is live yet.
                </p>
              </div>

              <p className="text-xs leading-5 text-gray-500">{moonPayDisclaimer}</p>

              <button
                type="button"
                disabled
                className="w-full cursor-not-allowed rounded-xl border border-gray-200 bg-gray-100 px-4 py-3 text-sm font-semibold text-gray-400"
              >
                MoonPay Setup - Coming Soon
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedWallet && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-3"
          onMouseDown={() => setSelectedWallet(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedWallet.displayName} wallet details`}
            className="max-h-[94vh] w-full max-w-3xl overflow-hidden rounded-t-3xl border border-white/70 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)] sm:rounded-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 p-5">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0052FF]">
                  Wallet Details
                </p>
                <p className="mt-0.5 truncate text-lg font-semibold text-gray-950">
                  {selectedWallet.displayName}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <NetworkStatusPill label="Connected" tone="blue" className="min-h-5 px-2 text-[10px]" />
                  <NetworkStatusPill label={selectedWallet.provider} tone="slate" className="min-h-5 px-2 text-[10px]" />
                  <NetworkStatusPill label={selectedWallet.networkLabel} tone="slate" className="min-h-5 px-2 text-[10px]" />
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedWallet(null)}
                className="inline-flex h-8 shrink-0 items-center justify-center rounded-full bg-gray-100 px-3 text-[11px] font-semibold text-gray-700 shadow-sm transition hover:bg-gray-200 focus:outline-none focus:ring-4 focus:ring-gray-100"
              >
                Close
              </button>
            </div>

            <div className="overflow-x-auto border-b border-gray-100 bg-gray-50/60 px-3 py-2 sm:px-5">
              <div className="flex min-w-max items-center gap-1">
                {detailTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={cx(
                      "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                      activeTab === tab.id
                        ? "border border-gray-200 bg-white text-gray-950 shadow-sm"
                        : "text-gray-500 hover:text-gray-700"
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="max-h-[68vh] overflow-y-auto p-5">
              {activeTab === "overview" && (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">
                        {selectedWallet.referenceLabel}
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <p
                          className="min-w-0 truncate font-mono text-sm text-gray-700"
                          title={selectedWallet.referenceTitle}
                        >
                          {selectedWallet.reference}
                        </p>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(selectedWallet.referenceTitle)}
                          className="inline-flex shrink-0 items-center rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-600 shadow-sm transition hover:border-gray-300 hover:bg-gray-50"
                        >
                          {copiedRef ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">Balance</p>
                      <p className="mt-2 text-2xl font-semibold text-gray-950">
                        {Number(selectedWallet.nativeBalance ?? 0).toFixed(selectedWallet.decimals)}{" "}
                        {selectedWallet.assetSymbol}
                      </p>
                      <p className="mt-0.5 text-sm text-gray-500">
                        ${Number(selectedWallet.usdValue ?? 0).toFixed(2)} USD
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => loadOverview(true)}
                      disabled={isRefreshing}
                      className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm transition hover:border-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isRefreshing ? "Refreshing..." : "Refresh Balance"}
                    </button>

                    {explorerUrl && (
                      <a
                        href={explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-blue-600 shadow-sm transition hover:border-blue-200 hover:bg-blue-50"
                      >
                        View on Explorer
                      </a>
                    )}
                  </div>
                </div>
              )}

              {activeTab === "send" && !selectedWallet.isLightning && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
                    <p className="text-sm font-semibold text-blue-900">
                      Send crypto to any valid wallet or exchange address.
                    </p>
                    <p className="mt-1 text-sm leading-6 text-blue-900/75">
                      PineTree will prepare wallet operation payloads only after this workflow is enabled.
                    </p>
                  </div>

                  <div className="grid gap-3">
                    <DisabledField label="Asset" value={selectedWallet.assetSymbol} />
                    <DisabledField label="Destination Address" value="Coming soon" />
                    <DisabledField label="Amount" value="Coming soon" />
                  </div>

                  <button
                    type="button"
                    disabled
                    className="w-full cursor-not-allowed rounded-xl border border-gray-200 bg-gray-100 px-4 py-3 text-sm font-semibold text-gray-400"
                  >
                    Prepare Send - Coming Soon
                  </button>

                  <p className="text-center text-[11px] text-gray-500">
                    PineTree never moves funds without merchant approval.
                  </p>
                </div>
              )}

              {activeTab === "provider_actions" && selectedWallet.isLightning && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                    <p className="text-sm font-semibold text-gray-950">Provider Actions</p>
                    <p className="mt-1 text-sm leading-6 text-gray-600">
                      Speed and Lightning-specific actions will stay behind provider controls until a safe PineTree operation flow is enabled.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled
                    className="w-full cursor-not-allowed rounded-xl border border-gray-200 bg-gray-100 px-4 py-3 text-sm font-semibold text-gray-400"
                  >
                    Provider Actions - Coming Soon
                  </button>
                </div>
              )}

              {activeTab === "cash_out" && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-amber-100 bg-amber-50/70 p-4">
                    <p className="text-base font-semibold text-gray-950">Cash Out with PineTree</p>
                    <p className="mt-1 text-sm font-semibold text-amber-800">
                      Payouts processed through MoonPay.
                    </p>
                    <p className="mt-2 text-sm leading-6 text-amber-950/80">
                      Cash Out converts supported crypto to fiat through MoonPay's regulated flow.
                    </p>
                  </div>

                  {selectedWallet.isLightning ? (
                    <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                      <p className="text-sm leading-6 text-gray-600">
                        MoonPay currently targets Base and Solana assets for PineTree Cash Out. Speed and Lightning off-ramp support is not enabled yet.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">
                        Supported MoonPay Assets
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {moonPaySupportedAssets.map((asset) => (
                          <NetworkStatusPill key={asset} label={asset} tone="slate" />
                        ))}
                      </div>
                    </div>
                  )}

                  <p className="text-xs leading-5 text-gray-500">
                    Cash-out availability varies by state, asset, network, and payout method. Base network cash-out may not be available for New York residents through MoonPay.
                  </p>

                  <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                    <p className="text-sm font-semibold text-gray-950">
                      Cash Out requires MoonPay setup before this wallet can use bank withdrawal.
                    </p>
                    <button
                      type="button"
                      onClick={() => setCashOutSetupOpen(true)}
                      className="mt-3 inline-flex min-h-10 items-center justify-center rounded-xl bg-gray-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-gray-800"
                    >
                      Set Up Cash Out
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled
                    className="w-full cursor-not-allowed rounded-xl border border-gray-200 bg-gray-100 px-4 py-3 text-sm font-semibold text-gray-400"
                  >
                    MoonPay Cash Out - Setup Required
                  </button>
                </div>
              )}

              {activeTab === "activity" && (
                <WalletOperationEmptyState compact />
              )}

              {activeTab === "settings" && (
                <div className="space-y-3">
                  <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">Wallet Label</p>
                    <p className="mt-2 text-sm font-semibold text-gray-950">{selectedWallet.displayName}</p>
                  </div>
                  <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">Default Payment Wallet</p>
                    <p className="mt-2 text-sm text-gray-600">Managed by PineTree payment routing settings.</p>
                  </div>
                  <div className="rounded-2xl border border-red-100 bg-red-50/50 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-red-500">Disconnect Wallet</p>
                    <p className="mt-2 text-sm leading-6 text-red-900/75">
                      Disconnect controls will appear here once a safe merchant confirmation flow is enabled.
                    </p>
                    <button
                      type="button"
                      disabled
                      className="mt-3 cursor-not-allowed rounded-xl border border-red-100 bg-white/70 px-4 py-2 text-sm font-semibold text-red-300"
                    >
                      Disconnect - Coming Soon
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
