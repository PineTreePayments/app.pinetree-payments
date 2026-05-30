"use client"

import { useEffect, useMemo, useRef, useState } from "react"
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

type NwcConnectionStatus = {
  connected: boolean
  walletLabel: string | null
  canMakeInvoice: boolean
  canLookupInvoice: boolean
  canPayInvoice: boolean
  canCollectFee: boolean
  ready: boolean
  missingPermissions: string[]
  readinessReason: string | null
  lastTestedAt: string | null
  connectionError: string | null
}

type PaymentRailItem = {
  id: string
  type: "bitcoin_lightning"
  provider: "Direct Lightning Wallet"
  status: "Connected" | "Not Connected" | "Error"
  walletLabel: string
  assetSymbol: "BTC"
  nativeBalance: number
  usdValue: number
  nwcConnectionStatus: NwcConnectionStatus | null
}

type WalletOperationSummary = {
  id: string
  provider: string
  operationType: string
  asset: string
  network: string
  amount: number
  destinationType: string
  status: string
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
}

type WalletOverviewResponse = {
  success?: boolean
  wallets?: WalletItem[]
  paymentRails?: PaymentRailItem[]
  recentOperations?: WalletOperationSummary[]
  totalUsd?: number
  lastRun?: string | null
  error?: string
}

type DetailTab = "overview" | "send" | "cash_out" | "lightning_wallet" | "activity" | "settings"
type ActivityFilter = "all" | "completed" | "failed" | "drafts"

type NwcTestResult = {
  success: boolean
  connected: boolean
  ready?: boolean
  missingPermissions?: string[]
  readinessReason?: string
  canMakeInvoice: boolean
  canLookupInvoice?: boolean
  canPayInvoice: boolean
  canCollectFee: boolean
  walletAlias?: string
  error?: string
}

type SelectedWallet = {
  id: string
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
  nwcConnectionStatus?: NwcConnectionStatus | null
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

const albyHubAppsUrl = process.env.NEXT_PUBLIC_ALBY_HUB_APPS_URL || "https://getalby.com/hub/apps"
const albyNwcDocsUrl = process.env.NEXT_PUBLIC_ALBY_NWC_DOCS_URL || "https://guides.getalby.com/user-guide/alby-account-and-browser-extension/alby-hub/nwc"
const zeusIosUrl = process.env.NEXT_PUBLIC_ZEUS_IOS_URL || "https://apps.apple.com/us/app/zeus-ln/id1456038895"
const zeusAndroidUrl = process.env.NEXT_PUBLIC_ZEUS_ANDROID_URL || "https://play.google.com/store/apps/details?id=app.zeusln"
const zeusNwcDocsUrl = process.env.NEXT_PUBLIC_ZEUS_DOCS_URL || "https://zeusln.app"

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

function getOperationGroupLabel(operation: WalletOperationSummary) {
  if (operation.status === "DRAFT") return "Drafts"
  if (operation.status === "VALIDATION_FAILED" || operation.status === "FAILED") return "Needs attention"
  if (operation.status === "COMPLETED") return "Completed"
  return "Recent activity"
}

function formatOperationStatusForMerchant(status: string) {
  if (status === "DRAFT") return "Saved"
  if (status === "VALIDATION_FAILED") return "Failed"
  return status
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

function CompactStatusRow({
  label,
  value
}: {
  label: string
  value: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50/70 px-3.5 py-3">
      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400">
        {label}
      </span>
      <span className="min-w-0 truncate text-right text-sm font-semibold text-gray-800">
        {value}
      </span>
    </div>
  )
}

function CapabilityCard({
  title,
  status,
  description,
  tone = "blue"
}: {
  title: string
  status: string
  description: string
  tone?: "blue" | "slate" | "amber"
}) {
  const toneClass = tone === "blue"
    ? "border-[#0052FF]/15 bg-[#0052FF]/5"
    : tone === "amber"
      ? "border-amber-200 bg-amber-50/70"
      : "border-gray-100 bg-gray-50/70"

  return (
    <div className={cx("rounded-2xl border p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]", toneClass)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-950">{title}</p>
          <p className="mt-1 text-sm leading-6 text-gray-600">{description}</p>
        </div>
        <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 shadow-sm ring-1 ring-gray-200/80">
          {status}
        </span>
      </div>
    </div>
  )
}

function StatTile({
  label,
  value,
  helper,
  tone = "slate"
}: {
  label: string
  value: string
  helper: string
  tone?: "blue" | "slate" | "amber"
}) {
  const toneClass = tone === "blue"
    ? "border-[#0052FF]/15 bg-[#0052FF]/5"
    : tone === "amber"
      ? "border-amber-200 bg-amber-50/70"
      : "border-gray-100 bg-gray-50/70"

  return (
    <div className={cx("rounded-2xl border p-3 shadow-[0_6px_18px_rgba(15,23,42,0.035)] sm:p-4", toneClass)}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400 sm:text-[11px]">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold text-gray-950 sm:text-base" title={value}>
        {value}
      </p>
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-600 sm:text-sm sm:leading-6">
        {helper}
      </p>
    </div>
  )
}

function CapabilityBadge({
  label,
  value,
  tone = "blue"
}: {
  label: string
  value: string
  tone?: "blue" | "slate" | "amber"
}) {
  const toneClass = tone === "blue"
    ? "border-[#0052FF]/15 bg-[#0052FF]/5 text-[#0052FF]"
    : tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-gray-200 bg-white text-gray-600"

  return (
    <div className={cx("rounded-xl border px-3 py-2", toneClass)}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] opacity-70">{label}</p>
      <p className="mt-1 text-xs font-semibold sm:text-sm">{value}</p>
    </div>
  )
}

function CapabilityRow({
  enabled,
  label,
  detail
}: {
  enabled: boolean
  label: string
  detail: string
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
      <span
        className={cx(
          "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
          enabled ? "bg-[#0052FF] text-white" : "bg-gray-200 text-gray-500"
        )}
        aria-hidden="true"
      >
        {enabled ? "ON" : "NO"}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-950">{label}</p>
        <p className="mt-1 text-sm leading-6 text-gray-600">{detail}</p>
      </div>
    </div>
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
          <p className="text-sm font-semibold text-gray-950">No cash-out activity yet</p>
          <p className="mt-1 text-sm leading-6 text-gray-500">
            Cash-out previews, submitted withdrawals, and provider status updates will appear here.
          </p>
        </div>
      </div>
    </div>
  )
}

export default function WalletsPage() {
  const [wallets, setWallets] = useState<WalletItem[]>([])
  const [paymentRails, setPaymentRails] = useState<PaymentRailItem[]>([])
  const [recentOperations, setRecentOperations] = useState<WalletOperationSummary[]>([])
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
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all")
  // NWC Lightning wallet connection state
  const [nwcUri, setNwcUri] = useState("")
  const [nwcWalletLabel, setNwcWalletLabel] = useState("")
  const [nwcTestResult, setNwcTestResult] = useState<NwcTestResult | null>(null)
  const [nwcTestLoading, setNwcTestLoading] = useState(false)
  const [nwcConnectLoading, setNwcConnectLoading] = useState(false)
  const [nwcConnectError, setNwcConnectError] = useState<string | null>(null)
  const [nwcConnectSuccess, setNwcConnectSuccess] = useState<string | null>(null)
  const [nwcSetupWallet, setNwcSetupWallet] = useState<"alby" | "zeus" | "other" | null>(null)
  const [nwcInstructionsOpen, setNwcInstructionsOpen] = useState(false)
  const nwcInputRef = useRef<HTMLInputElement>(null)

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
    setActivityFilter("all")
    setNwcUri("")
    setNwcWalletLabel("")
    setNwcTestResult(null)
    setNwcConnectError(null)
    setNwcConnectSuccess(null)
    setNwcSetupWallet(null)
    setNwcInstructionsOpen(false)
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
      setRecentOperations(payload?.recentOperations || [])
      setTotalBalance(Number(payload?.totalUsd ?? 0) || 0)
      setLastRefreshAt(payload?.lastRun || null)
      setSelectedWallet((current) => {
        if (!current?.isLightning) return current
        // Prefer the same rail by ID; fall back to any lightning rail to handle
        // the placeholder → real-ID transition after a new connection is saved.
        const nextRail =
          (payload?.paymentRails || []).find((rail) => rail.id === current.id) ??
          (payload?.paymentRails || []).find((rail) => rail.type === "bitcoin_lightning")
        return nextRail ? buildLightningWallet(nextRail) : current
      })
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

  async function testNwcUri() {
    const uri = nwcUri.trim()
    if (!uri) {
      setNwcConnectError("Paste an NWC connection string first.")
      return
    }
    setNwcTestLoading(true)
    setNwcTestResult(null)
    setNwcConnectError(null)
    setNwcConnectSuccess(null)
    try {
      const token = await getMerchantToken()
      const res = await fetch("/api/wallets/lightning/test", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ nwcUri: uri })
      })
      const payload = await res.json().catch(() => null) as NwcTestResult | null
      if (!res.ok && !payload) throw new Error("Test request failed")
      setNwcTestResult(payload as NwcTestResult)
      if (payload?.error) setNwcConnectError(payload.error)
    } catch (err) {
      setNwcConnectError(err instanceof Error ? err.message : "Connection test failed")
    } finally {
      setNwcTestLoading(false)
    }
  }

  async function connectNwcWallet() {
    const uri = nwcUri.trim()
    if (!uri) {
      setNwcConnectError("Paste an NWC connection string first.")
      return
    }
    setNwcConnectLoading(true)
    setNwcConnectError(null)
    setNwcConnectSuccess(null)
    try {
      const token = await getMerchantToken()
      const res = await fetch("/api/wallets/lightning/connect", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
          action: "connect",
          nwcUri: uri,
          walletLabel: nwcWalletLabel.trim() || "Lightning Wallet"
        })
      })
      const payload = await res.json().catch(() => null) as { success?: boolean; error?: string; message?: string } | null
      if (!res.ok || !payload?.success) throw new Error(payload?.error || "Connection failed")
      setNwcConnectSuccess(payload?.message || "Lightning wallet connected.")
      setNwcUri("")
      setNwcTestResult(null)
      await loadOverview(false)
    } catch (err) {
      setNwcConnectError(err instanceof Error ? err.message : "Connection failed")
    } finally {
      setNwcConnectLoading(false)
    }
  }

  async function disconnectNwcWallet() {
    setDisconnecting(true)
    setDisconnectError(null)
    try {
      const token = await getMerchantToken()
      const res = await fetch("/api/wallets/lightning/connect", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ action: "disconnect" })
      })
      const payload = await res.json().catch(() => null) as { success?: boolean; error?: string } | null
      if (!res.ok || !payload?.success) throw new Error(payload?.error || "Disconnect failed")
      setSelectedWallet(null)
      setDisconnectConfirmOpen(false)
      await loadOverview(true)
    } catch (err) {
      setDisconnectError(err instanceof Error ? err.message : "Disconnect failed")
    } finally {
      setDisconnecting(false)
    }
  }

  function buildLightningWallet(rail: PaymentRailItem): SelectedWallet {
    const label = rail.walletLabel || "Lightning Wallet"
    return {
      id: rail.id,
      displayName: label,
      rail: "bitcoin_lightning",
      provider: rail.provider,
      networkLabel: "Bitcoin Lightning",
      reference: label,
      referenceTitle: label,
      referenceLabel: "Wallet",
      assetSymbol: "BTC",
      nativeBalance: rail.nativeBalance,
      usdValue: rail.usdValue,
      decimals: 8,
      isLightning: true,
      nwcConnectionStatus: rail.nwcConnectionStatus
    }
  }

  function buildConnectedWallet(w: WalletItem): SelectedWallet {
    const rail = normalizeWalletNetwork(w.network)

    return {
      id: w.id,
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
      Boolean(rail.nwcConnectionStatus?.connected) &&
      (Number(rail.nativeBalance ?? 0) > 0 || Number(rail.usdValue ?? 0) > 0)
  )
  const totalConnections = wallets.length + paymentRails.length
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
      name: rail.walletLabel || "Bitcoin Lightning",
      provider: formatDashboardProvider(rail.provider),
      network: "Bitcoin Lightning",
      reference: rail.walletLabel || "—",
      referenceTitle: rail.walletLabel || "",
      status: rail.nwcConnectionStatus?.connected ? "Connected" : "Not Connected",
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
  const nwcStatus = selectedWallet?.nwcConnectionStatus || null
  const lightningActivity = recentOperations
  const filteredLightningActivity = lightningActivity.filter((operation) => {
    if (activityFilter === "completed") return operation.status === "COMPLETED"
    if (activityFilter === "failed") return operation.status === "FAILED" || operation.status === "VALIDATION_FAILED"
    if (activityFilter === "drafts") return operation.status === "DRAFT"
    return true
  })
  const activityGroups = filteredLightningActivity.reduce(
    (groups, operation) => {
      const label = getOperationGroupLabel(operation)
      groups[label] = [...(groups[label] || []), operation]
      return groups
    },
    {} as Record<string, WalletOperationSummary[]>
  )
  const activityGroupOrder = ["Recent activity", "Completed", "Needs attention", "Drafts"]

  const detailTabs: Array<{ id: DetailTab; label: string }> = selectedWallet?.isLightning
    ? [
      { id: "overview", label: "Overview" },
      { id: "lightning_wallet", label: "Manage Wallet" },
      { id: "activity", label: "Activity" }
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
            const nwcConnected = Boolean(rail.nwcConnectionStatus?.connected)

            return (
              <button
                key={rail.id}
                type="button"
                onClick={() => openWalletDetail(wallet, "lightning_wallet")}
                className="group flex min-h-[156px] flex-col justify-between rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-[0_10px_30px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_18px_50px_rgba(15,23,42,0.10)] focus:outline-none focus:ring-4 focus:ring-blue-100 sm:p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-gray-950">
                      {rail.walletLabel || "Bitcoin Lightning"}
                    </p>
                    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                      <NetworkStatusPill label="Direct Lightning" tone="slate" className="min-h-6 px-2 text-[10px]" />
                      <NetworkStatusPill label="Bitcoin Lightning" tone="slate" className="min-h-6 px-2 text-[10px]" />
                    </div>
                  </div>
                  <NetworkStatusPill
                    label={nwcConnected ? "Connected" : "Not Connected"}
                    tone={nwcConnected ? "blue" : "slate"}
                    className="shrink-0"
                  />
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <div className="flex flex-wrap gap-1.5">
                    {nwcConnected && rail.nwcConnectionStatus?.canMakeInvoice && (
                      <span className="rounded-full border border-[#0052FF]/15 bg-[#0052FF]/5 px-2 py-0.5 text-[10px] font-semibold text-[#0052FF]">
                        Receive
                      </span>
                    )}
                    {nwcConnected && rail.nwcConnectionStatus?.ready && (
                      <span className="rounded-full border border-[#0052FF]/15 bg-[#0052FF]/5 px-2 py-0.5 text-[10px] font-semibold text-[#0052FF]">
                        Ready
                      </span>
                    )}
                    {!nwcConnected && (
                      <span className="text-xs text-gray-400">Tap to connect a wallet</span>
                    )}
                  </div>
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
                  {nwcConnected ? "Manage" : "Connect Wallet"}
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
                  PineTree Wallet
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

            <div className="shrink-0 overflow-x-auto border-b border-gray-100 bg-gray-50/70 px-2 py-2 [-ms-overflow-style:none] [scrollbar-width:none] sm:px-5 sm:py-3 [&::-webkit-scrollbar]:hidden">
              <div className="mx-auto flex w-max min-w-max items-center gap-2 px-1 sm:gap-3 sm:px-2">
                {detailTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={cx(
                      "min-h-9 whitespace-nowrap rounded-xl px-3 py-1.5 text-[11px] font-semibold leading-5 transition focus:outline-none focus:ring-4 focus:ring-blue-100 sm:min-h-11 sm:px-5 sm:py-2 sm:text-sm",
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

            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              {activeTab === "overview" && (
                <div className={walletDetailPanelClass}>
                  {selectedWallet.isLightning ? (
                    <>
                      <div className="grid grid-cols-2 gap-2 sm:gap-3">
                        <StatTile
                          label="Wallet"
                          value={nwcStatus?.walletLabel || "Not Connected"}
                          helper={nwcStatus?.connected ? "NWC wallet connected" : "Connect a wallet to accept Lightning payments"}
                          tone={nwcStatus?.connected ? "blue" : "slate"}
                        />
                        <StatTile
                          label="Invoice Creation"
                          value={nwcStatus?.canMakeInvoice ? "Supported" : nwcStatus?.connected ? "Not Supported" : "—"}
                          helper="Required to accept Lightning payments from customers"
                          tone={nwcStatus?.canMakeInvoice ? "blue" : "slate"}
                        />
                        <StatTile
                          label="Fee Collection"
                          value={nwcStatus?.ready ? "Ready" : nwcStatus?.connected ? "Not Ready" : "—"}
                          helper={nwcStatus?.ready ? "PineTree can collect the $0.15 service-fee invoice" : `Missing NWC permissions: ${(nwcStatus?.missingPermissions || ["make_invoice", "lookup_invoice", "pay_invoice"]).join(", ")}`}
                          tone={nwcStatus?.ready ? "blue" : "amber"}
                        />
                        <StatTile
                          label="Last Sync"
                          value={lastRefreshAt ? formatChicagoDateTime(lastRefreshAt) : "Not available"}
                          helper="Refresh to update wallet status"
                          tone="slate"
                        />
                      </div>
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
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

              {activeTab === "cash_out" && (
                <div className={walletDetailPanelClass}>
                  {selectedWallet.isLightning ? (
                    <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                      <p className="text-sm font-semibold text-gray-950">Lightning Wallet</p>
                      <p className="mt-1 text-sm leading-6 text-gray-600">
                        Direct Lightning wallets receive Bitcoin instantly. Cash-out to your bank is managed separately outside PineTree.
                      </p>
                    </div>
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

                  {!selectedWallet.isLightning && (
                    <button
                      type="button"
                      disabled
                      className={pineTreeDisabledButton}
                    >
                      Wallet Approval Disabled
                    </button>
                  )}
                </div>
              )}

              {activeTab === "lightning_wallet" && selectedWallet.isLightning && (
                <div className={walletDetailPanelClass}>
                  {nwcStatus?.connected ? (
                    <>
                      <div className="rounded-2xl border border-[#0052FF]/15 bg-[#0052FF]/5 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-gray-950">{nwcStatus.walletLabel || "Lightning Wallet"}</p>
                            <p className="mt-1 text-sm leading-6 text-gray-600">
                              {nwcStatus.ready
                                ? "Ready for live Lightning payments."
                                : "Connected, but not ready for live payments. Grant the missing permissions in your wallet to enable Lightning."}
                            </p>
                          </div>
                          <NetworkStatusPill
                            label={nwcStatus.ready ? "Ready" : "Not ready"}
                            tone={nwcStatus.ready ? "blue" : "amber"}
                          />
                        </div>
                        <div className="mt-4 grid grid-cols-3 gap-2">
                          <CapabilityBadge label="Invoices" value={nwcStatus.canMakeInvoice ? "Yes" : "No"} tone={nwcStatus.canMakeInvoice ? "blue" : "slate"} />
                          <CapabilityBadge label="Payment check" value={nwcStatus.canLookupInvoice ? "Yes" : "No"} tone={nwcStatus.canLookupInvoice ? "blue" : "slate"} />
                          <CapabilityBadge label="Service fee" value={nwcStatus.canPayInvoice ? "Yes" : "No"} tone={nwcStatus.canPayInvoice ? "blue" : "amber"} />
                        </div>
                      </div>

                      {!nwcStatus.ready && (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
                          <p className="text-sm font-semibold text-gray-950">Not ready for live Lightning payments</p>
                          <p className="mt-1 text-sm leading-6 text-gray-700">
                            Your wallet is connected but missing required permissions. Open your wallet, find the PineTree connection, and grant the missing permissions.
                          </p>
                          <div className="mt-3 space-y-2">
                            <CapabilityRow
                              enabled={nwcStatus.canMakeInvoice}
                              label="Create customer invoices"
                              detail="Required — generates the payment request your customers scan to pay"
                            />
                            <CapabilityRow
                              enabled={nwcStatus.canLookupInvoice}
                              label="Check payment status"
                              detail="Required — confirms when the customer's payment arrives in your wallet"
                            />
                            <CapabilityRow
                              enabled={nwcStatus.canPayInvoice}
                              label="Pay PineTree service fee"
                              detail="Required — pays PineTree's $0.15 fee after each customer payment. PineTree only pays its own service-fee invoice, nothing else."
                            />
                          </div>
                          {!nwcStatus.canPayInvoice && (
                            <p className="mt-3 text-xs leading-5 text-amber-700">
                              PineTree collects a $0.15 service fee by sending a small fee invoice to your wallet after each customer payment. Enable a spending limit in your wallet to restrict PineTree to service fees only.
                            </p>
                          )}
                        </div>
                      )}

                      <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                        <p className="text-sm font-semibold text-gray-950">Connect a different wallet</p>
                        <p className="mt-1 text-sm leading-6 text-gray-600">
                          Paste a new connection string to replace the current wallet. The wallet must allow creating invoices, checking payment status, and paying the PineTree service fee.
                        </p>
                        <div className="mt-3 space-y-2">
                          <input
                            ref={nwcInputRef}
                            type="text"
                            value={nwcUri}
                            onChange={(e) => { setNwcUri(e.target.value); setNwcTestResult(null); setNwcConnectError(null); setNwcConnectSuccess(null) }}
                            placeholder="nostr+walletconnect://..."
                            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 font-mono text-xs text-gray-800 outline-none focus:border-[#0052FF] focus:ring-4 focus:ring-blue-100"
                          />
                          <input
                            type="text"
                            value={nwcWalletLabel}
                            onChange={(e) => setNwcWalletLabel(e.target.value)}
                            placeholder="Wallet name (optional)"
                            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 outline-none focus:border-[#0052FF] focus:ring-4 focus:ring-blue-100"
                          />
                          {nwcTestResult && (
                            <div className={cx(
                              "rounded-2xl border p-4",
                              nwcTestResult.ready ? "border-[#0052FF]/15 bg-[#0052FF]/5" : "border-amber-200 bg-amber-50/70"
                            )}>
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-sm font-semibold text-gray-950">
                                  {nwcTestResult.ready
                                    ? "Ready for live Lightning payments"
                                    : nwcTestResult.connected
                                      ? "Connected, but not ready for live payments"
                                      : "Could not connect to wallet"}
                                </p>
                                <NetworkStatusPill
                                  label={nwcTestResult.ready ? "Ready" : nwcTestResult.connected ? "Partial" : "Failed"}
                                  tone={nwcTestResult.ready ? "blue" : nwcTestResult.connected ? "amber" : "slate"}
                                />
                              </div>
                              {nwcTestResult.walletAlias && (
                                <p className="mt-1 text-xs text-gray-500">Wallet: {nwcTestResult.walletAlias}</p>
                              )}
                              <div className="mt-3 space-y-2">
                                <CapabilityRow
                                  enabled={Boolean(nwcTestResult.canMakeInvoice)}
                                  label="Create customer invoices"
                                  detail="Required — generates the payment request your customers scan to pay"
                                />
                                <CapabilityRow
                                  enabled={Boolean(nwcTestResult.canLookupInvoice)}
                                  label="Check payment status"
                                  detail="Required — confirms when the customer's payment arrives"
                                />
                                <CapabilityRow
                                  enabled={Boolean(nwcTestResult.canPayInvoice)}
                                  label="Pay PineTree service fee"
                                  detail="Required — pays PineTree's $0.15 fee after each customer payment. PineTree only pays its own fee invoice."
                                />
                              </div>
                              {nwcTestResult.error && !nwcTestResult.connected && (
                                <p className="mt-2 text-xs text-red-700">{nwcTestResult.error}</p>
                              )}
                            </div>
                          )}
                          {nwcTestResult?.connected && !nwcTestResult.canPayInvoice && (
                            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
                              <p className="text-xs leading-5 text-amber-800">
                                Lightning payments cannot go live until your wallet grants the service fee permission. PineTree uses this only to collect its $0.15 fee after each customer payment. Enable a spending limit in your wallet to restrict PineTree to service fees only.
                              </p>
                            </div>
                          )}
                          <div className="flex gap-2">
                            <button type="button" onClick={testNwcUri} disabled={nwcTestLoading || !nwcUri.trim()} className={cx(pineTreeSecondaryActionButton, "flex-1 justify-center disabled:cursor-not-allowed disabled:opacity-55")}>
                              {nwcTestLoading ? "Testing..." : "Test Connection"}
                            </button>
                            <button type="button" onClick={connectNwcWallet} disabled={nwcConnectLoading || !nwcUri.trim()} className={cx(pineTreePrimaryButton, "flex-1 disabled:cursor-not-allowed disabled:opacity-55")}>
                              {nwcConnectLoading ? "Saving..." : "Save New Wallet"}
                            </button>
                          </div>
                        </div>
                      </div>

                      {disconnectConfirmOpen ? (
                        <div className="rounded-2xl border border-red-100 bg-white p-4">
                          <p className="text-sm font-semibold text-gray-950">Disconnect Lightning wallet?</p>
                          <p className="mt-1 text-sm leading-6 text-gray-600">
                            Removes the NWC connection. New Lightning invoices cannot be created until you reconnect.
                          </p>
                          {disconnectError && <p className="mt-2 text-sm text-red-600">{disconnectError}</p>}
                          <div className="mt-3 flex gap-2">
                            <button type="button" onClick={() => setDisconnectConfirmOpen(false)} disabled={disconnecting} className={pineTreeSecondaryActionButton}>Cancel</button>
                            <button type="button" onClick={disconnectNwcWallet} disabled={disconnecting} className={pineTreeDangerActionButton}>
                              {disconnecting ? "Disconnecting..." : "Disconnect"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button type="button" onClick={() => setDisconnectConfirmOpen(true)} className={cx(pineTreeDangerActionButton, "self-start")}>
                          Disconnect Wallet
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="space-y-4 rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                        <div>
                          <p className="text-sm font-semibold text-gray-950">Connect your Lightning wallet</p>
                          <p className="mt-1 text-xs leading-5 text-gray-600">
                            Create a PineTree connection in your Lightning wallet, enable the three required permissions, then paste the connection string below.
                          </p>
                        </div>

                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">Choose your wallet</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {(["alby", "zeus", "other"] as const).map((wallet) => (
                              <button
                                key={wallet}
                                type="button"
                                onClick={() => { setNwcSetupWallet(wallet); setNwcInstructionsOpen(false) }}
                                className={cx(
                                  "rounded-xl border px-3 py-1.5 text-sm font-semibold transition",
                                  nwcSetupWallet === wallet
                                    ? "border-[#0052FF] bg-[#0052FF] text-white"
                                    : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                                )}
                              >
                                {wallet === "alby" ? "Alby Hub / Alby Go" : wallet === "zeus" ? "Zeus Wallet" : "Other NWC Wallet"}
                              </button>
                            ))}
                          </div>
                        </div>

                        {nwcSetupWallet === "alby" && (
                          <div className="flex flex-wrap gap-2">
                            <a href={albyHubAppsUrl} target="_blank" rel="noopener noreferrer" className={pineTreeSecondaryActionButton}>Open Alby Hub Apps</a>
                            <a href={albyNwcDocsUrl} target="_blank" rel="noopener noreferrer" className={pineTreeSecondaryActionButton}>Alby NWC Setup Guide</a>
                          </div>
                        )}
                        {nwcSetupWallet === "zeus" && (
                          <div className="flex flex-wrap gap-2">
                            <a href={zeusIosUrl} target="_blank" rel="noopener noreferrer" className={pineTreeSecondaryActionButton}>Zeus (iOS)</a>
                            <a href={zeusAndroidUrl} target="_blank" rel="noopener noreferrer" className={pineTreeSecondaryActionButton}>Zeus (Android)</a>
                            <a href={zeusNwcDocsUrl} target="_blank" rel="noopener noreferrer" className={pineTreeSecondaryActionButton}>Zeus Guide</a>
                          </div>
                        )}

                        {nwcSetupWallet && (
                          <div>
                            <button
                              type="button"
                              onClick={() => setNwcInstructionsOpen((o) => !o)}
                              className="flex items-center gap-1.5 text-xs font-semibold text-[#0052FF] hover:underline focus:outline-none"
                            >
                              <span>{nwcInstructionsOpen ? "▾" : "▸"}</span>
                              {nwcSetupWallet === "alby"
                                ? "How to find this in Alby"
                                : nwcSetupWallet === "zeus"
                                  ? "How to find this in Zeus"
                                  : "How to find this in your wallet"}
                            </button>
                            {nwcInstructionsOpen && (
                              <div className="mt-2 rounded-xl border border-gray-200 bg-white px-3 py-3">
                                {nwcSetupWallet === "alby" && (
                                  <ol className="list-decimal list-inside space-y-1 text-xs leading-5 text-gray-600">
                                    <li>Log into your Alby Hub</li>
                                    <li>Go to <strong>Apps</strong> &rarr; <strong>Add App</strong></li>
                                    <li>Name the connection <strong>PineTree</strong></li>
                                    <li>Enable: <strong>make_invoice</strong>, <strong>lookup_invoice</strong>, <strong>pay_invoice</strong></li>
                                    <li>Set a monthly spending budget of <strong>$5–$10</strong> to limit PineTree to service fees only</li>
                                    <li>Click <strong>Add App</strong> and copy the connection string</li>
                                  </ol>
                                )}
                                {nwcSetupWallet === "zeus" && (
                                  <ol className="list-decimal list-inside space-y-1 text-xs leading-5 text-gray-600">
                                    <li>Open Zeus on your phone</li>
                                    <li>Go to <strong>Settings &rarr; Embedded Node &rarr; Nostr Wallet Connect</strong></li>
                                    <li>Tap <strong>Add connection</strong></li>
                                    <li>Enable: <strong>make_invoice</strong>, <strong>lookup_invoice</strong>, <strong>pay_invoice</strong></li>
                                    <li>Set a spending limit if your version supports it</li>
                                    <li>Copy the connection string</li>
                                  </ol>
                                )}
                                {nwcSetupWallet === "other" && (
                                  <p className="text-xs leading-5 text-gray-600">
                                    Look for <strong>Nostr Wallet Connect</strong>, <strong>NWC</strong>, or <strong>App Connections</strong> in your wallet settings.
                                    When creating a connection, enable: <strong>make_invoice</strong>, <strong>lookup_invoice</strong>, <strong>pay_invoice</strong>.
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">Required permissions</p>
                          <ul className="mt-2 space-y-1 text-xs leading-5 text-gray-600">
                            <li>Create invoices — lets customers pay to your wallet</li>
                            <li>Check payment status — confirms when payment arrives</li>
                            <li>Pay PineTree&apos;s $0.15 service-fee invoice — PineTree only uses this to collect its own fee after each customer payment</li>
                          </ul>
                        </div>

                        <div className="space-y-2">
                          <input
                            ref={nwcInputRef}
                            type="text"
                            value={nwcUri}
                            onChange={(e) => { setNwcUri(e.target.value); setNwcTestResult(null); setNwcConnectError(null); setNwcConnectSuccess(null) }}
                            placeholder="nostr+walletconnect://..."
                            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 font-mono text-xs text-gray-800 outline-none focus:border-[#0052FF] focus:ring-4 focus:ring-blue-100"
                          />
                          <input
                            type="text"
                            value={nwcWalletLabel}
                            onChange={(e) => setNwcWalletLabel(e.target.value)}
                            placeholder="Wallet name (optional, e.g. Alby Hub)"
                            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 outline-none focus:border-[#0052FF] focus:ring-4 focus:ring-blue-100"
                          />
                        </div>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={testNwcUri}
                            disabled={nwcTestLoading || !nwcUri.trim()}
                            className={cx(pineTreeSecondaryActionButton, "flex-1 justify-center disabled:cursor-not-allowed disabled:opacity-55")}
                          >
                            {nwcTestLoading ? "Testing..." : "Test Connection"}
                          </button>
                          <button
                            type="button"
                            onClick={connectNwcWallet}
                            disabled={nwcConnectLoading || !nwcUri.trim()}
                            className={cx(pineTreePrimaryButton, "flex-1 disabled:cursor-not-allowed disabled:opacity-55")}
                          >
                            {nwcConnectLoading ? "Saving..." : "Connect Wallet"}
                          </button>
                        </div>
                      </div>

                      {nwcTestResult && (
                        <div className={cx(
                          "rounded-2xl border p-4",
                          nwcTestResult.ready ? "border-[#0052FF]/15 bg-[#0052FF]/5" : "border-amber-200 bg-amber-50/70"
                        )}>
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-gray-950">
                              {nwcTestResult.ready
                                ? "Ready for live Lightning payments"
                                : nwcTestResult.connected
                                  ? "Connected, but not ready for live payments"
                                  : "Could not connect to wallet"}
                            </p>
                            <NetworkStatusPill
                              label={nwcTestResult.ready ? "Ready" : nwcTestResult.connected ? "Partial" : "Failed"}
                              tone={nwcTestResult.ready ? "blue" : nwcTestResult.connected ? "amber" : "slate"}
                            />
                          </div>
                          {nwcTestResult.walletAlias && (
                            <p className="mt-1 text-xs text-gray-500">Wallet: {nwcTestResult.walletAlias}</p>
                          )}
                          <div className="mt-3 space-y-2">
                            <CapabilityRow
                              enabled={Boolean(nwcTestResult.canMakeInvoice)}
                              label="Create customer invoices"
                              detail="Required — generates the payment request your customers scan to pay"
                            />
                            <CapabilityRow
                              enabled={Boolean(nwcTestResult.canLookupInvoice)}
                              label="Check payment status"
                              detail="Required — confirms when the customer's payment arrives in your wallet"
                            />
                            <CapabilityRow
                              enabled={Boolean(nwcTestResult.canPayInvoice)}
                              label="Pay PineTree service fee"
                              detail="Required for PineTree's $0.15 service fee. PineTree only uses this permission to pay PineTree's own service-fee invoice after a customer payment."
                            />
                          </div>
                          {!nwcTestResult.connected && nwcTestResult.error && (
                            <div className="mt-3 rounded-xl border border-red-100 bg-white/80 p-3">
                              <p className="text-xs font-semibold text-red-700">Could not connect</p>
                              <p className="mt-1 text-xs leading-5 text-red-600">{nwcTestResult.error}</p>
                              <p className="mt-2 text-xs text-gray-500">
                                Check that the connection string is complete, your wallet is online, and its relay is reachable.
                              </p>
                            </div>
                          )}
                          {nwcTestResult.connected && !nwcTestResult.canPayInvoice && (
                            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
                              <p className="text-xs font-semibold text-amber-900">Missing: Pay PineTree service fee</p>
                              <p className="mt-1 text-xs leading-5 text-amber-800">
                                Required for PineTree&apos;s $0.15 service fee. PineTree only uses this permission to pay PineTree&apos;s own service-fee invoice after a customer payment.
                                {nwcSetupWallet === "alby" && " In Alby Hub, set a monthly spending budget to limit PineTree to service fees only."}
                                {nwcSetupWallet === "zeus" && " In Zeus, enable pay_invoice and set a spending limit when editing the NWC connection."}
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {nwcConnectError && (
                    <div className="rounded-2xl border border-red-100 bg-red-50/70 p-3 text-sm leading-6 text-red-800">
                      {nwcConnectError}
                    </div>
                  )}

                  {nwcConnectSuccess && (
                    <div className="rounded-2xl border border-[#0052FF]/15 bg-[#0052FF]/5 p-3 text-sm leading-6 text-[#0052FF]">
                      {nwcConnectSuccess}
                    </div>
                  )}
                </div>
              )}

              {activeTab === "activity" && (
                <div className={walletDetailPanelClass}>
                  {selectedWallet.isLightning && lightningActivity.length > 0 ? (
                    <>
                      <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {([
                          ["all", "All Activity"],
                          ["completed", "Completed"],
                          ["failed", "Failed"],
                          ["drafts", "Drafts"]
                        ] as Array<[ActivityFilter, string]>).map(([id, label]) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setActivityFilter(id)}
                            className={cx(
                              "min-h-10 shrink-0 rounded-xl px-4 text-xs font-semibold shadow-sm transition focus:outline-none focus:ring-4 focus:ring-blue-100",
                              activityFilter === id
                                ? "bg-[#0052FF] text-white"
                                : "border border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      {filteredLightningActivity.length === 0 ? (
                        <WalletOperationEmptyState compact />
                      ) : (
                        <div className="space-y-4">
                          {activityGroupOrder
                            .filter((group) => activityGroups[group]?.length)
                            .map((group) => (
                              <div key={group} className="space-y-2">
                                <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">
                                  {group}
                                </p>
                                {activityGroups[group].map((operation) => (
                                  <div
                                    key={operation.id}
                                    className={cx(
                                      "rounded-2xl border p-4",
                                      operation.status === "VALIDATION_FAILED" || operation.status === "FAILED"
                                        ? "border-amber-200 bg-amber-50/70"
                                        : operation.status === "DRAFT"
                                        ? "border-gray-100 bg-white"
                                        : "border-gray-100 bg-gray-50/70"
                                    )}
                                  >
                                    <div className="grid gap-3 sm:grid-cols-4">
                                      <div>
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">Type</p>
                                        <p className="mt-1 text-sm font-semibold text-gray-950">
                                          {operation.operationType.replace(/_/g, " ")}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">Status</p>
                                        <div className="mt-1">
                                          <NetworkStatusPill
                                            label={formatOperationStatusForMerchant(operation.status)}
                                            tone={operation.status === "VALIDATION_FAILED" ? "amber" : "blue"}
                                          />
                                        </div>
                                      </div>
                                      <div>
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">Amount</p>
                                        <p className="mt-1 text-sm font-semibold text-gray-950">{operation.amount} {operation.asset}</p>
                                      </div>
                                      <div>
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">Date</p>
                                        <p className="mt-1 text-sm text-gray-600">{formatChicagoDateTime(operation.createdAt)}</p>
                                      </div>
                                    </div>
                                    {operation.errorMessage && (
                                      <p className="mt-3 rounded-xl border border-amber-100 bg-amber-50/80 p-3 text-xs leading-5 text-amber-800">
                                        {operation.errorMessage}
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <WalletOperationEmptyState compact />
                  )}
                </div>
              )}

              {activeTab === "settings" && !selectedWallet.isLightning && (
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
