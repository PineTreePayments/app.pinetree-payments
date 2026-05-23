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

type CashOutAssetOption = {
  label: string
  asset: "SOL" | "USDC" | "ETH"
  network: "solana" | "base"
}

type OffRampSessionSummary = {
  id: string
  status: string
  asset: string
  network: string
  cryptoAmount: number | null
  quoteFiatAmount: number | null
  quoteFiatCurrency: string
  payoutMethod: string | null
}

type OffRampQuoteSummary = {
  provider: string
  moonPayCode: string
  asset: string
  network: string
  cryptoAmount: number
  fiatCurrency: string
  quoteFiatAmount: number | null
  providerFeeAmount: number | null
  platformFeeAmount: number | null
  totalFeeAmount: number | null
  payoutMethod: string | null
  quoteExpiresAt: string | null
}

type OffRampQuoteResponse = {
  success?: boolean
  session?: OffRampSessionSummary
  quote?: OffRampQuoteSummary | null
  providerCallsEnabled?: boolean
  fundMovementEnabled?: boolean
  error?: string
  support?: {
    supported?: boolean
    reason?: string
  }
}

type OffRampWidgetUrlResponse = {
  success?: boolean
  session?: OffRampSessionSummary
  widgetUrl?: string
  signed?: boolean
  providerCallsEnabled?: boolean
  fundMovementEnabled?: boolean
  nextStep?: string
  error?: string
}

type OffRampDepositInstructionPreviewResponse = {
  success?: boolean
  instructionReady?: boolean
  depositAddress?: string | null
  memo?: string | null
  destinationTag?: string | null
  approvalReady?: boolean
  message?: string
  fundMovementEnabled?: boolean
  nextStep?: string
  error?: string
}

type OffRampWalletApprovalPreviewResponse = {
  success?: boolean
  approvalReady?: boolean
  fromWalletAddress?: string | null
  destinationAddress?: string | null
  estimatedNetworkFee?: null
  message?: string
  instructionReady?: boolean
  fundMovementEnabled?: boolean
  signablePayload?: null
  nextStep?: string
  error?: string
}

type OffRampProviderAvailability = "unavailable" | "pending_approval" | "sandbox" | "production" | "disabled"

type OffRampProviderOption = {
  id: "moonpay" | "alchemy_pay" | "banxa"
  displayName: string
  status: OffRampProviderAvailability
  apiProvider: "moonpay" | null
}

const supportedOffRampProviders: OffRampProviderOption[] = [
  {
    id: "alchemy_pay",
    displayName: "Alchemy Pay",
    status: "pending_approval",
    apiProvider: null
  },
  {
    id: "banxa",
    displayName: "Banxa",
    status: "disabled",
    apiProvider: null
  },
  {
    id: "moonpay",
    displayName: "MoonPay",
    status: "unavailable",
    apiProvider: "moonpay"
  }
]

const currentOffRampProvider = supportedOffRampProviders.find((provider) =>
  provider.status === "production" || provider.status === "sandbox"
) || supportedOffRampProviders.find((provider) => provider.status === "pending_approval") || null

const isOffRampProviderActive =
  currentOffRampProvider?.status === "production" || currentOffRampProvider?.status === "sandbox"

const offRampSupportedAssets = [
  "SOL",
  "USDC on Solana",
  "ETH on Base",
  "USDC on Base"
]

const offRampAvailabilityCopy =
  "Availability depends on provider approval, region, asset, network, and payout method."

const pineTreePrimaryButton =
  "inline-flex min-h-10 items-center justify-center rounded-xl bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm shadow-[#0052FF]/20 transition hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-55"

const pineTreeDisabledButton =
  "inline-flex w-fit cursor-not-allowed items-center justify-center rounded-xl border border-[#0052FF]/20 bg-[#0052FF]/10 px-4 py-2 text-sm font-semibold text-[#0052FF]/55 shadow-sm shadow-[#0052FF]/5"

const pineTreeNeutralDisabledButton =
  "inline-flex w-fit cursor-not-allowed items-center justify-center rounded-xl border border-[#0052FF]/20 bg-[#0052FF]/10 px-4 py-2 text-sm font-semibold text-[#0052FF]/55 shadow-sm shadow-[#0052FF]/5"

const pineTreeDangerActionButton =
  "inline-flex w-fit items-center justify-center rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 shadow-sm transition hover:border-red-300 hover:bg-red-50 focus:outline-none focus:ring-4 focus:ring-red-100 disabled:cursor-not-allowed disabled:opacity-55"

const pineTreeSecondaryActionButton =
  "inline-flex w-fit items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-4 focus:ring-gray-100 disabled:cursor-not-allowed disabled:opacity-55"

const walletDetailPanelClass = "min-h-[430px] space-y-4"

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

function getCashOutAssetOptions(wallet: SelectedWallet | null): CashOutAssetOption[] {
  if (!wallet || wallet.isLightning) return []
  if (wallet.rail === "solana") {
    return [
      { label: "SOL on Solana", asset: "SOL", network: "solana" },
      { label: "USDC on Solana", asset: "USDC", network: "solana" }
    ]
  }
  if (wallet.rail === "base") {
    return [
      { label: "ETH on Base", asset: "ETH", network: "base" },
      { label: "USDC on Base", asset: "USDC", network: "base" }
    ]
  }
  return []
}

function getDefaultCashOutAsset(wallet: SelectedWallet | null) {
  return getCashOutAssetOptions(wallet)[0] || null
}

function formatCashOutAmount(value: number | null | undefined, currency = "USD") {
  if (value == null || !Number.isFinite(Number(value))) return "-"
  return `${currency} ${Number(value).toFixed(2)}`
}

function getExplorerUrl(rail: SelectedWallet["rail"], referenceTitle: string): string | null {
  if (!referenceTitle) return null
  if (rail === "solana") return `https://solscan.io/account/${referenceTitle}`
  if (rail === "base") return `https://basescan.org/address/${referenceTitle}`
  return null
}

function getDisconnectProvider(wallet: SelectedWallet | null): "solana" | "base" | "lightning" | null {
  if (!wallet) return null
  if (wallet.rail === "solana") return "solana"
  if (wallet.rail === "base") return "base"
  if (wallet.rail === "bitcoin_lightning") return "lightning"
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
  const [cashOutAsset, setCashOutAsset] = useState<CashOutAssetOption | null>(null)
  const [cashOutAmount, setCashOutAmount] = useState("")
  const [cashOutState, setCashOutState] = useState("")
  const [cashOutQuote, setCashOutQuote] = useState<OffRampQuoteSummary | null>(null)
  const [cashOutSession, setCashOutSession] = useState<OffRampSessionSummary | null>(null)
  const [cashOutError, setCashOutError] = useState<string | null>(null)
  const [cashOutInfo, setCashOutInfo] = useState<string | null>(null)
  const [cashOutLoading, setCashOutLoading] = useState(false)
  const [cashOutWidgetLoading, setCashOutWidgetLoading] = useState(false)
  const [cashOutDepositPreview, setCashOutDepositPreview] =
    useState<OffRampDepositInstructionPreviewResponse | null>(null)
  const [cashOutApprovalPreview, setCashOutApprovalPreview] =
    useState<OffRampWalletApprovalPreviewResponse | null>(null)
  const [cashOutPreviewLoading, setCashOutPreviewLoading] = useState(false)
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [disconnectError, setDisconnectError] = useState<string | null>(null)

  useEffect(() => {
    loadOverview(false)
  }, [])

  useEffect(() => {
    const defaultAsset = getDefaultCashOutAsset(selectedWallet)
    setCashOutAsset(defaultAsset)
    setCashOutAmount("")
    setCashOutState("")
    setCashOutQuote(null)
    setCashOutSession(null)
    setCashOutError(null)
    setCashOutInfo(null)
    setCashOutLoading(false)
    setCashOutWidgetLoading(false)
    setCashOutDepositPreview(null)
    setCashOutApprovalPreview(null)
    setCashOutPreviewLoading(false)
    setDisconnectConfirmOpen(false)
    setDisconnecting(false)
    setDisconnectError(null)
  }, [selectedWallet])

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

  async function disconnectSelectedWallet() {
    if (!selectedWallet) return
    const provider = getDisconnectProvider(selectedWallet)
    if (!provider) {
      setDisconnectError("This wallet connection cannot be disconnected from Wallets yet.")
      return
    }

    setDisconnecting(true)
    setDisconnectError(null)

    try {
      const token = await getMerchantToken()
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
          action: "disconnectProvider",
          provider
        })
      })
      const payload = (await res.json().catch(() => null)) as WalletOverviewResponse | null

      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error || "Disconnect failed")
      }

      setSelectedWallet(null)
      setDisconnectConfirmOpen(false)
      await loadOverview(true)
    } catch (err) {
      setDisconnectError(err instanceof Error ? err.message : "Disconnect failed")
    } finally {
      setDisconnecting(false)
    }
  }

  async function getMerchantToken() {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) {
      throw new Error("No active auth session")
    }
    return token
  }

  async function requestCashOutQuote() {
    if (!selectedWallet || !cashOutAsset) return
    if (!isOffRampProviderActive || !currentOffRampProvider?.apiProvider) {
      setCashOutError("Off-ramp provider is not currently available.")
      return
    }

    const amount = Number(cashOutAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setCashOutError("Enter a cash-out amount greater than zero.")
      return
    }

    setCashOutLoading(true)
    setCashOutError(null)
    setCashOutInfo(null)
    setCashOutQuote(null)
    setCashOutSession(null)
    setCashOutDepositPreview(null)
    setCashOutApprovalPreview(null)

    try {
      const token = await getMerchantToken()
      const res = await fetch("/api/off-ramp/quote", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
          provider: currentOffRampProvider.apiProvider,
          network: cashOutAsset.network,
          asset: cashOutAsset.asset,
          amount,
          fiatCurrency: "USD",
          payoutMethod: "ach_bank_transfer",
          sourceWalletAddress: selectedWallet.referenceTitle,
          refundWalletAddress: selectedWallet.referenceTitle,
          merchantState: cashOutState || null
        })
      })
      const payload = (await res.json().catch(() => null)) as OffRampQuoteResponse | null

      if (!res.ok || !payload?.success || !payload.quote || !payload.session) {
        const message = payload?.error || payload?.support?.reason || "Provider quote unavailable"
        throw new Error(
          message.includes("Currency not supported in test mode")
            ? "Provider returned: Currency not supported in test mode. This may change after production approval."
            : message
        )
      }

      setCashOutQuote(payload.quote)
      setCashOutSession(payload.session)
    } catch (err) {
      setCashOutError(err instanceof Error ? err.message : "Cash-out quote failed")
    } finally {
      setCashOutLoading(false)
    }
  }

  async function continueWithProvider() {
    if (!selectedWallet || !cashOutSession) return
    if (!isOffRampProviderActive) {
      setCashOutError("Off-ramp provider is not currently available.")
      return
    }

    setCashOutWidgetLoading(true)
    setCashOutError(null)
    setCashOutInfo(null)
    setCashOutDepositPreview(null)
    setCashOutApprovalPreview(null)

    try {
      const token = await getMerchantToken()
      const res = await fetch(`/api/off-ramp/sessions/${cashOutSession.id}/widget-url`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
          sourceWalletAddress: selectedWallet.referenceTitle,
          refundWalletAddress: selectedWallet.referenceTitle,
          redirectPath: "/dashboard/wallets",
          merchantState: cashOutState || null
        })
      })
      const payload = (await res.json().catch(() => null)) as OffRampWidgetUrlResponse | null

      if (!res.ok || !payload?.success || !payload.widgetUrl) {
        throw new Error(payload?.error || "Provider launch URL unavailable")
      }

      window.open(payload.widgetUrl, "_blank", "noopener,noreferrer")
      setCashOutSession(payload.session || cashOutSession)
      setCashOutInfo(
        "Complete provider verification and sale confirmation. PineTree will not move funds without wallet approval."
      )
    } catch (err) {
      setCashOutError(err instanceof Error ? err.message : "Provider launch failed")
    } finally {
      setCashOutWidgetLoading(false)
    }
  }

  async function checkDepositInstructions() {
    if (!cashOutSession) return

    setCashOutPreviewLoading(true)
    setCashOutError(null)
    setCashOutDepositPreview(null)
    setCashOutApprovalPreview(null)

    try {
      const token = await getMerchantToken()
      const depositRes = await fetch(
        `/api/off-ramp/sessions/${cashOutSession.id}/deposit-instructions/preview`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({})
        }
      )
      const depositPayload = (await depositRes.json().catch(() => null)) as
        OffRampDepositInstructionPreviewResponse | null

      if (!depositRes.ok || !depositPayload?.success) {
        throw new Error(depositPayload?.error || "Deposit instructions are not available yet.")
      }

      setCashOutDepositPreview(depositPayload)

      const approvalRes = await fetch(
        `/api/off-ramp/sessions/${cashOutSession.id}/wallet-approval/preview`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({})
        }
      )
      const approvalPayload = (await approvalRes.json().catch(() => null)) as
        OffRampWalletApprovalPreviewResponse | null

      if (!approvalRes.ok || !approvalPayload?.success) {
        throw new Error(approvalPayload?.error || "Wallet approval preview is not available yet.")
      }

      setCashOutApprovalPreview(approvalPayload)
    } catch (err) {
      setCashOutError(err instanceof Error ? err.message : "Deposit instruction preview failed")
    } finally {
      setCashOutPreviewLoading(false)
    }
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
  const cashOutAssetOptions = getCashOutAssetOptions(selectedWallet)
  const cashOutUnavailable = selectedWallet?.isLightning || cashOutAssetOptions.length === 0

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
                <NetworkStatusPill label="Off-ramp Provider" tone="slate" className="min-h-6 px-2 text-[10px]" />
                <NetworkStatusPill label="Provider pending" tone="amber" className="min-h-6 px-2 text-[10px]" />
              </div>
              <p className="mt-2 text-sm leading-6 text-gray-600">
                PineTree Cash Out is being configured for approved off-ramp providers.
              </p>
              <p className="mt-2 text-xs leading-5 text-gray-500">{offRampAvailabilityCopy}</p>
            </div>
            <button
              type="button"
              disabled
              className={cx(pineTreeDisabledButton, "shrink-0 lg:w-auto")}
            >
              Provider Setup Pending
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
            aria-label="Cash Out setup"
            className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-3xl border border-white/70 bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.22)] sm:rounded-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0052FF]">
                  Cash Out Setup
                </p>
                <h2 className="mt-1 text-lg font-semibold text-gray-950">Off-Ramp Provider Setup</h2>
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
              <div className="rounded-2xl border border-[#0052FF]/15 bg-[#0052FF]/5 p-4 shadow-[0_8px_24px_rgba(0,82,255,0.06)]">
                <p className="text-sm leading-6 text-gray-700">
                  Cash-out will let merchants move supported crypto balances to a bank account through an approved provider.
                </p>
                <p className="mt-2 text-sm font-semibold text-gray-950">
                  Provider access is currently pending approval.
                </p>
              </div>

              <p className="text-xs leading-5 text-gray-500">{offRampAvailabilityCopy}</p>

              <button
                type="button"
                disabled
                className={pineTreeDisabledButton}
              >
                Provider Setup Pending
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedWallet && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-4"
          onMouseDown={() => setSelectedWallet(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedWallet.displayName} wallet details`}
            className="flex h-[calc(100dvh-2rem)] max-h-[760px] min-h-[620px] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/70 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)] max-sm:h-[calc(100dvh-1.5rem)] max-sm:min-h-0 sm:rounded-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="shrink-0 flex items-start justify-between gap-4 border-b border-gray-100 p-5">
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

            <div className="shrink-0 overflow-x-auto border-b border-gray-100 bg-gray-50/70 px-2 py-2 [-ms-overflow-style:none] [scrollbar-width:none] sm:px-5 [&::-webkit-scrollbar]:hidden">
              <div className="mx-auto flex w-max min-w-max items-center gap-2 px-2">
                {detailTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={cx(
                      "whitespace-nowrap rounded-xl px-3 py-1.5 text-[11px] font-semibold leading-5 transition focus:outline-none focus:ring-4 focus:ring-blue-100 sm:px-3.5 sm:text-xs",
                      activeTab === tab.id
                        ? "bg-[#0052FF] text-white shadow-[0_5px_14px_rgba(0,82,255,0.18)]"
                        : "bg-white/90 text-gray-600 shadow-sm ring-1 ring-gray-200/80 hover:bg-white hover:text-gray-800"
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {activeTab === "overview" && (
                <div className={walletDetailPanelClass}>
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
                <div className={walletDetailPanelClass}>
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
                    className={pineTreeNeutralDisabledButton}
                  >
                    Prepare Send - Coming Soon
                  </button>

                  <p className="text-center text-[11px] text-gray-500">
                    PineTree never moves funds without merchant approval.
                  </p>
                </div>
              )}

              {activeTab === "provider_actions" && selectedWallet.isLightning && (
                <div className={walletDetailPanelClass}>
                  <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
                    <p className="text-sm font-semibold text-blue-950">Speed Provider Actions</p>
                    <p className="mt-1 text-sm leading-6 text-blue-900/75">
                      Manage Lightning-specific actions for balances connected through Speed. Withdrawals, payout setup, and provider transfers will appear here once enabled.
                    </p>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <DisabledField label="Amount" value="Coming soon" />
                    <label className="block rounded-xl border border-gray-100 bg-gray-50/70 p-3.5">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">
                        Destination Type
                      </span>
                      <select
                        disabled
                        value="Lightning invoice"
                        className="mt-2 w-full cursor-not-allowed border-0 bg-transparent p-0 text-sm font-semibold text-gray-500 outline-none"
                      >
                        <option>Lightning invoice</option>
                        <option>Bitcoin address</option>
                        <option>Bank payout through provider</option>
                      </select>
                    </label>
                  </div>

                  <div className="grid gap-3">
                    <DisabledField label="Destination / Invoice" value="Coming soon" />
                    <DisabledField label="Memo / Reference Optional" value="Coming soon" />
                  </div>

                  <button
                    type="button"
                    disabled
                    className={pineTreeNeutralDisabledButton}
                  >
                    Prepare Speed Withdrawal - Coming Soon
                  </button>

                  <p className="text-center text-[11px] text-gray-500">
                    PineTree will not move provider-managed funds without merchant confirmation.
                  </p>
                </div>
              )}

              {activeTab === "cash_out" && (
                <div className={walletDetailPanelClass}>
                  {selectedWallet.isLightning ? (
                    <>
                      <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4 shadow-[0_8px_24px_rgba(0,82,255,0.07)]">
                        <p className="text-base font-semibold text-blue-950">Bitcoin Lightning Cash Out</p>
                        <p className="mt-1 text-sm font-semibold text-[#0052FF]">
                          Provider-managed through Speed
                        </p>
                        <p className="mt-2 text-sm leading-6 text-blue-900/75">
                          Speed-supported withdrawals and payouts will appear here once enabled.
                        </p>
                      </div>

                      <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                        <p className="text-sm leading-6 text-gray-600">
                          Bitcoin Lightning cash-out is separate from Base/Solana off-ramp providers.
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled
                        className={pineTreeNeutralDisabledButton}
                      >
                        Speed Cash Out - Coming Soon
                      </button>

                      <p className="text-center text-[11px] text-gray-500">
                        PineTree will not move provider-managed funds without merchant confirmation.
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="rounded-2xl border border-[#0052FF]/20 bg-[#0052FF]/5 p-4 shadow-[0_8px_24px_rgba(0,82,255,0.07)]">
                        <p className="text-base font-semibold text-gray-950">PineTree Cash Out</p>
                        <p className="mt-1 text-sm font-semibold text-[#0052FF]">
                          {isOffRampProviderActive
                            ? "Payouts are processed through the configured off-ramp provider."
                            : "Off-ramp provider setup pending"}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-gray-700">
                          Cash-out will let merchants move supported crypto balances to a bank account through an approved provider.
                        </p>
                        {selectedWallet.rail === "base" ? (
                          <p className="mt-3 border-t border-[#0052FF]/10 pt-3 text-xs leading-5 text-gray-600">
                            Availability depends on provider approval, region, asset, network, and payout method.
                          </p>
                        ) : (
                          <p className="mt-3 border-t border-[#0052FF]/10 pt-3 text-xs leading-5 text-gray-600">
                            Availability depends on provider approval, region, asset, network, and payout method.
                          </p>
                        )}
                      </div>

                      {cashOutUnavailable && (
                        <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                          <p className="text-sm leading-6 text-gray-600">
                            PineTree Cash Out is not available for this wallet network yet.
                          </p>
                        </div>
                      )}

                      {!cashOutUnavailable && !isOffRampProviderActive && (
                        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-gray-950">Provider Setup Pending</p>
                              <p className="mt-1 text-sm leading-6 text-gray-600">
                                Base and Solana cash-out will activate after PineTree connects an approved off-ramp provider.
                              </p>
                            </div>
                            <NetworkStatusPill label="Pending" tone="amber" />
                          </div>
                          <div className="mt-4 flex flex-wrap gap-1.5">
                            {offRampSupportedAssets.map((asset) => (
                              <div
                                key={asset}
                                className="rounded-full border border-[#0052FF]/10 bg-[#0052FF]/5 px-2.5 py-1 text-[11px] font-semibold text-[#0052FF]/60"
                              >
                                {asset}
                              </div>
                            ))}
                          </div>
                          <button
                            type="button"
                            disabled
                            className={cx(pineTreeDisabledButton, "mt-4")}
                          >
                            Provider Setup Pending
                          </button>
                        </div>
                      )}

                      {!cashOutUnavailable && isOffRampProviderActive && (
                        <>
                          <div className="grid gap-3 md:grid-cols-2">
                            <label className="block rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">
                                Asset
                              </span>
                              <select
                                value={cashOutAsset?.label || ""}
                                onChange={(event) => {
                                  const next = cashOutAssetOptions.find((option) => option.label === event.target.value) || null
                                  setCashOutAsset(next)
                                  setCashOutQuote(null)
                                  setCashOutSession(null)
                                  setCashOutError(null)
                                  setCashOutInfo(null)
                                  setCashOutDepositPreview(null)
                                  setCashOutApprovalPreview(null)
                                }}
                                className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 outline-none focus:border-[#0052FF] focus:ring-4 focus:ring-blue-100"
                              >
                                {cashOutAssetOptions.map((option) => (
                                  <option key={option.label} value={option.label}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="block rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">
                                Amount
                              </span>
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={cashOutAmount}
                                onChange={(event) => {
                                  setCashOutAmount(event.target.value)
                                  setCashOutQuote(null)
                                  setCashOutSession(null)
                                  setCashOutError(null)
                                  setCashOutInfo(null)
                                  setCashOutDepositPreview(null)
                                  setCashOutApprovalPreview(null)
                                }}
                                placeholder="0.00"
                                className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 outline-none focus:border-[#0052FF] focus:ring-4 focus:ring-blue-100"
                              />
                            </label>
                          </div>

                          <div className="grid gap-3 md:grid-cols-2">
                            <DisabledField label="Payout Method" value="Bank transfer through configured provider" />
                            <label className="block rounded-xl border border-gray-100 bg-gray-50/70 p-3.5">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">
                                Merchant State
                              </span>
                              <input
                                value={cashOutState}
                                onChange={(event) => {
                                  setCashOutState(event.target.value.toUpperCase().slice(0, 2))
                                  setCashOutQuote(null)
                                  setCashOutSession(null)
                                  setCashOutError(null)
                                  setCashOutInfo(null)
                                  setCashOutDepositPreview(null)
                                  setCashOutApprovalPreview(null)
                                }}
                                placeholder="Optional"
                                className="mt-2 w-full border-0 bg-transparent p-0 text-sm font-semibold text-gray-700 outline-none"
                              />
                            </label>
                          </div>

                          <button
                            type="button"
                            onClick={requestCashOutQuote}
                            disabled={cashOutLoading || !cashOutAsset}
                            className={cx(pineTreePrimaryButton, "w-full disabled:cursor-not-allowed disabled:opacity-55")}
                          >
                            {cashOutLoading ? "Getting Quote..." : "Get Cash Out Quote"}
                          </button>

                          {cashOutQuote && (
                            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-gray-950">Provider Quote</p>
                                  <p className="mt-1 text-xs text-gray-500">
                                    {cashOutQuote.cryptoAmount} {cashOutQuote.asset} to {cashOutQuote.fiatCurrency}
                                  </p>
                                </div>
                                <NetworkStatusPill label={cashOutSession?.status || "QUOTE_READY"} tone="blue" />
                              </div>
                              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                                <DisabledField
                                  label="Payout"
                                  value={formatCashOutAmount(cashOutQuote.quoteFiatAmount, cashOutQuote.fiatCurrency)}
                                />
                                <DisabledField
                                  label="Fees"
                                  value={formatCashOutAmount(cashOutQuote.totalFeeAmount, cashOutQuote.fiatCurrency)}
                                />
                                <DisabledField label="Provider" value="Configured provider" />
                              </div>
                              <button
                                type="button"
                                onClick={continueWithProvider}
                                disabled={cashOutWidgetLoading || !cashOutSession}
                                className={cx(pineTreePrimaryButton, "mt-4 w-full disabled:cursor-not-allowed disabled:opacity-55")}
                              >
                                {cashOutWidgetLoading ? "Preparing provider..." : "Continue with Provider"}
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )}

                  {cashOutError && (
                    <div className="rounded-2xl border border-red-100 bg-red-50/70 p-4 text-sm leading-6 text-red-800">
                      {cashOutError}
                    </div>
                  )}

                  {cashOutInfo && (
                    <div className="rounded-2xl border border-blue-100 bg-blue-50/80 p-4 text-sm leading-6 text-blue-900">
                      {cashOutInfo}
                    </div>
                  )}

                  {!selectedWallet.isLightning && cashOutSession?.status === "AWAITING_APPROVAL" && (
                    <>
                      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-gray-950">
                              Provider Deposit Instructions
                            </p>
                            <p className="mt-1 text-sm leading-6 text-gray-600">
                              After the provider flow supplies deposit instructions, PineTree will prepare the wallet approval step here.
                            </p>
                          </div>
                          <NetworkStatusPill
                            label={cashOutDepositPreview?.instructionReady ? "Ready" : "Waiting"}
                            tone={cashOutDepositPreview?.instructionReady ? "blue" : "amber"}
                          />
                        </div>

                        {cashOutDepositPreview && (
                          <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50/80 p-3 text-sm leading-6 text-gray-600">
                            <p>
                              {cashOutDepositPreview.instructionReady
                                ? "Deposit instructions are available for preview."
                                : "Waiting for provider deposit instructions."}
                            </p>
                            {cashOutDepositPreview.depositAddress && (
                              <div className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-white/80 p-3 font-mono text-xs text-gray-700">
                                <p className="break-all">
                                  Deposit address: {cashOutDepositPreview.depositAddress}
                                </p>
                                {cashOutDepositPreview.memo && (
                                  <p className="break-all">Memo: {cashOutDepositPreview.memo}</p>
                                )}
                                {cashOutDepositPreview.destinationTag && (
                                  <p className="break-all">
                                    Destination tag: {cashOutDepositPreview.destinationTag}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={checkDepositInstructions}
                          disabled={cashOutPreviewLoading}
                          className={cx(pineTreePrimaryButton, "mt-4 w-full disabled:cursor-not-allowed disabled:opacity-55")}
                        >
                          {cashOutPreviewLoading ? "Checking..." : "Check Deposit Instructions"}
                        </button>
                      </div>

                      <div className="rounded-2xl border border-gray-200 bg-gray-50/80 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-gray-950">Wallet Approval</p>
                            <p className="mt-1 text-sm leading-6 text-gray-600">
                              Wallet approval is not enabled yet. PineTree will not move funds without explicit merchant approval.
                            </p>
                          </div>
                          <NetworkStatusPill
                            label={cashOutApprovalPreview?.approvalReady ? "Preview ready" : "Disabled"}
                            tone={cashOutApprovalPreview?.approvalReady ? "blue" : "slate"}
                          />
                        </div>

                        {cashOutApprovalPreview && (
                          <p className="mt-3 rounded-xl border border-gray-100 bg-white/80 p-3 text-sm leading-6 text-gray-600">
                            {cashOutApprovalPreview.message ||
                              "Wallet approval will be enabled after the provider supplies deposit instructions."}
                          </p>
                        )}

                        <button
                          type="button"
                          disabled
                          className={cx(pineTreeNeutralDisabledButton, "mt-4")}
                        >
                          Prepare Wallet Approval - Coming Soon
                        </button>
                      </div>
                    </>
                  )}

                  <button
                    type="button"
                    disabled
                    className={pineTreeDisabledButton}
                  >
                    Wallet Approval Disabled
                  </button>
                </div>
              )}

              {activeTab === "activity" && (
                <div className={walletDetailPanelClass}>
                  <WalletOperationEmptyState compact />
                </div>
              )}

              {activeTab === "settings" && (
                <div className={walletDetailPanelClass}>
                  <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">Wallet Label</p>
                    <p className="mt-2 text-sm font-semibold text-gray-950">{selectedWallet.displayName}</p>
                  </div>
                  <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">Default Payment Wallet</p>
                    <p className="mt-2 text-sm text-gray-600">Managed by PineTree payment routing settings.</p>
                  </div>
                  <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-950">
                          Connection Management
                        </p>
                        <p className="mt-1 text-sm leading-6 text-gray-600">
                          Disconnect this wallet from PineTree. Historical transactions stay saved.
                        </p>
                      </div>
                      <NetworkStatusPill label="No fund movement" tone="slate" />
                    </div>

                    {disconnectError && (
                      <p className="mt-3 rounded-xl border border-red-100 bg-white/80 p-3 text-sm leading-6 text-red-700">
                        {disconnectError}
                      </p>
                    )}

                    {!disconnectConfirmOpen ? (
                      <button
                        type="button"
                        onClick={() => {
                          setDisconnectConfirmOpen(true)
                          setDisconnectError(null)
                        }}
                        disabled={!getDisconnectProvider(selectedWallet)}
                        className={cx(pineTreeDangerActionButton, "mt-3")}
                      >
                        Disconnect Wallet
                      </button>
                    ) : (
                      <div className="mt-3 rounded-xl border border-gray-100 bg-white/80 p-3">
                        <p className="text-sm font-semibold text-gray-950">Disconnect this wallet?</p>
                        <p className="mt-1 text-sm leading-6 text-gray-600">
                          This removes it from Wallets and Providers setup. Funds and history are not affected.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setDisconnectConfirmOpen(false)}
                            disabled={disconnecting}
                            className={pineTreeSecondaryActionButton}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={disconnectSelectedWallet}
                            disabled={disconnecting}
                            className={pineTreeDangerActionButton}
                          >
                            {disconnecting ? "Disconnecting..." : "Disconnect Wallet"}
                          </button>
                        </div>
                      </div>
                    )}
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
