"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Transaction } from "@solana/web3.js"
import { getDetectedSolanaWallets, getSolanaTransactionSignature } from "@/lib/wallets/solana"
import { supabase } from "@/lib/supabaseClient"
import { getSpeedDashboardLinks } from "@/lib/speedDashboardLinks"
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

type DetailTab = "overview" | "send" | "settlement" | "lightning_wallet" | "activity" | "settings"
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

// ─── Settlement destinations ──────────────────────────────────────────────────

type SettlementDestination = {
  id: string
  label: string
  exchange_name: string
  asset: string
  network: string
  address: string
  memo_or_tag: string | null
  is_default: boolean
  account_type: SettlementDestinationAccountType
  source: SettlementDestinationSource
  connected_provider: "mesh" | "manual" | null
  external_account_name: string | null
  external_account_id: string | null
  institution_name: string | null
  last_verified_at: string | null
  created_at: string
}

type SettlementDestinationAccountType =
  | "business_exchange"
  | "personal_exchange"
  | "external_wallet"
  | "other"

type SettlementDestinationSource =
  | "manual"
  | "mesh"
  | "provider_import"
  | "unknown"

type DestinationForm = {
  id: string | null
  label: string
  exchangeName: string
  assetNetwork: string
  address: string
  memoOrTag: string
  isDefault: boolean
  confirmed: boolean
  accountType: SettlementDestinationAccountType
  personalExchangeAcknowledged: boolean
}

const SETTLEMENT_ASSET_NETWORK_OPTIONS = [
  { value: "SOL|solana",  label: "SOL on Solana",  asset: "SOL",  network: "solana" },
  { value: "USDC|solana", label: "USDC on Solana", asset: "USDC", network: "solana" },
  { value: "USDC|base",   label: "USDC on Base",   asset: "USDC", network: "base" },
  { value: "ETH|base",    label: "ETH on Base",    asset: "ETH",  network: "base" },
]

const SETTLEMENT_EXCHANGE_OPTIONS = [
  "Coinbase",
  "Kraken",
  "Gemini",
  "Robinhood",
  "Strike",
  "Custom Wallet",
]

function emptyDestinationForm(): DestinationForm {
  return {
    id: null,
    label: "",
    exchangeName: "",
    assetNetwork: "",
    address: "",
    memoOrTag: "",
    isDefault: false,
    confirmed: false,
    accountType: "business_exchange",
    personalExchangeAcknowledged: false
  }
}

const DESTINATION_ACCOUNT_TYPE_OPTIONS: Array<{ value: SettlementDestinationAccountType; label: string }> = [
  { value: "business_exchange", label: "Business exchange account, recommended" },
  { value: "personal_exchange", label: "Personal exchange account" },
  { value: "external_wallet", label: "External wallet" },
  { value: "other", label: "Other" }
]

const MESH_CONNECT_ENABLED = process.env.NEXT_PUBLIC_MESH_CONNECT_ENABLED === "true"

function getDestinationAccountTypeLabel(type?: string | null) {
  if (type === "business_exchange") return "Business Exchange"
  if (type === "personal_exchange") return "Personal Exchange"
  if (type === "external_wallet") return "External Wallet"
  return "Other"
}

function getDestinationSourceLabel(dest: Pick<SettlementDestination, "source" | "connected_provider">) {
  if (dest.source === "mesh" || dest.connected_provider === "mesh") return "Mesh Connected"
  return "Manual"
}

function getExplorerTxUrl(network: string, txHash: string): string | null {
  if (!txHash) return null
  const n = network.toLowerCase()
  if (n === "solana") return `https://solscan.io/tx/${txHash}`
  if (n === "base")   return `https://basescan.org/tx/${txHash}`
  return null
}

function destAssetNetworkValue(dest: SettlementDestination) {
  return `${dest.asset}|${dest.network}`
}

function formatSettlementAddress(address: string) {
  if (address.length <= 16) return address
  return `${address.slice(0, 8)}…${address.slice(-6)}`
}

type SettlementWithdrawal = {
  id: string
  settlement_destination_id: string | null
  movement_type?: string
  destination_kind?: string | null
  destination_label: string
  exchange_name: string
  asset: string
  network: string
  amount: number
  destination_address: string
  memo_or_tag: string | null
  status: string
  tx_hash: string | null
  failure_reason: string | null
  created_at: string
  submitted_at: string | null
}

type BaseTxParams = {
  from: string
  to: string
  value: string
  data: string
  gas: string
}

type WithdrawPrepareResult = {
  withdrawal: SettlementWithdrawal
  unsigned_tx_base64: string | null
  tx_params: BaseTxParams | null
}

type WithdrawStep = "review" | "preparing" | "prepared" | "signing" | "submitted" | "failed"
type SendStep = "form" | "review" | "preparing" | "prepared" | "signing" | "submitted" | "failed"
type SendDestinationMode = "saved" | "manual"

type DirectSendTransfer = {
  id: null
  wallet_id: string | null
  asset: "SOL" | "USDC" | "ETH"
  network: "solana" | "base"
  amount: number
  destination_address: string
  destination_label: string
  status: "PREPARED"
  estimated_fee_label: string
}

type DirectSendPrepareResult = {
  transfer: DirectSendTransfer
  unsigned_tx_base64: string | null
  tx_params: BaseTxParams | null
}

type DirectSendSubmitResponse = {
  success?: boolean
  withdrawal?: SettlementWithdrawal
  error?: string
}

// ─── End settlement types ─────────────────────────────────────────────────────

// Mesh SDK callback payload shape (onIntegrationConnected)
type MeshIntegrationData = {
  accessToken?: {
    accountTokens?: Array<{
      accessToken: string
      accountId?: string
      accountName?: string
    }>
    brokerType?: string
    brokerName?: string
  }
  integrationId?: string
  institutionName?: string
  institutionId?: string
}

type MeshActiveConnection = {
  id: string
  institutionName: string | null
  accessToken: string | null
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

// Gas/fee reserves for safe "Withdraw All" calculations.
// These are client-side safety buffers only — the wallet still estimates final network fees.
const BASE_ETH_GAS_RESERVE    = 0.00015   // ETH reserved for gas on Base
const SOLANA_SOL_FEE_RESERVE  = 0.01      // SOL reserved for fees and rent on Solana

const albyHubAppsUrl = process.env.NEXT_PUBLIC_ALBY_HUB_APPS_URL || "https://getalby.com/hub/apps"
const albyNwcDocsUrl = process.env.NEXT_PUBLIC_ALBY_NWC_DOCS_URL || "https://guides.getalby.com/user-guide/alby-account-and-browser-extension/alby-hub/nwc"
const zeusIosUrl = process.env.NEXT_PUBLIC_ZEUS_IOS_URL || "https://apps.apple.com/us/app/zeus-ln/id1456038895"
const zeusAndroidUrl = process.env.NEXT_PUBLIC_ZEUS_ANDROID_URL || "https://play.google.com/store/apps/details?id=app.zeusln"
const zeusNwcDocsUrl = process.env.NEXT_PUBLIC_ZEUS_DOCS_URL || "https://zeusln.app"
const lightningSpeedLinks = getSpeedDashboardLinks([
  "dashboard",
  "autoSwap",
  "payouts",
  "apiKeys",
  "webhooks",
  "docs"
])

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

function getSendAssetOptions(wallet: SelectedWallet | null): CashOutAssetOption[] {
  return getCashOutAssetOptions(wallet)
}

function getDefaultSendAsset(wallet: SelectedWallet | null) {
  return getSendAssetOptions(wallet)[0] || null
}

function getDestinationAssetOptions(wallet: SelectedWallet | null) {
  if (!wallet || wallet.isLightning) return []
  return SETTLEMENT_ASSET_NETWORK_OPTIONS.filter((option) => option.network === wallet.rail)
}

function networkDisplayLabel(network: string): string {
  if (network === "solana") return "Solana"
  if (network === "base") return "Base"
  if (network === "ethereum") return "Ethereum"
  if (network === "bitcoin_lightning") return "Bitcoin Lightning"
  return network ? network.charAt(0).toUpperCase() + network.slice(1) : ""
}

function assetNetworkDisplayLabel(asset: string, network: string): string {
  return `${asset} on ${networkDisplayLabel(network)}`
}

function getMeshImportOptions(walletNetwork: string) {
  if (walletNetwork === "solana") {
    return [
      { asset: "SOL",  network: "solana", label: "SOL on Solana" },
      { asset: "USDC", network: "solana", label: "USDC on Solana" }
    ]
  }
  if (walletNetwork === "base") {
    return [
      { asset: "ETH",  network: "base", label: "ETH on Base" },
      { asset: "USDC", network: "base", label: "USDC on Base" }
    ]
  }
  return []
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

  // Settlement destination state
  const [settlementDestinations, setSettlementDestinations] = useState<SettlementDestination[]>([])
  const [destLoading, setDestLoading] = useState(false)
  const [destLoadError, setDestLoadError] = useState<string | null>(null)
  const [destModalOpen, setDestModalOpen] = useState(false)
  const [destForm, setDestForm] = useState<DestinationForm>(emptyDestinationForm())
  const [destSaving, setDestSaving] = useState(false)
  const [destSaveError, setDestSaveError] = useState<string | null>(null)
  const [destDeleteConfirmId, setDestDeleteConfirmId] = useState<string | null>(null)
  const [destDeleting, setDestDeleting] = useState(false)
  const [withdrawReview, setWithdrawReview] = useState<SettlementDestination | null>(null)
  const [destSettingDefault, setDestSettingDefault] = useState<string | null>(null)
  const [settlementMode, setSettlementMode] = useState<"manual" | "end_of_day" | "auto">("manual")
  const [settlementPrefSaving, setSettlementPrefSaving] = useState(false)
  const [moveMoneyOpen, setMoveMoneyOpen] = useState(false)
  // USDC balance state
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null)
  const [usdcBalanceLoading, setUsdcBalanceLoading] = useState(false)
  const [usdcBalanceError, setUsdcBalanceError] = useState<string | null>(null)
  const [usdcBalanceRefreshedAt, setUsdcBalanceRefreshedAt] = useState<string | null>(null)
  // Withdrawal status check state
  const [checkingStatusId, setCheckingStatusId] = useState<string | null>(null)
  const [checkedPendingIds, setCheckedPendingIds] = useState<string[]>([])
  // Withdrawal execution state
  const [withdrawStep, setWithdrawStep] = useState<WithdrawStep>("review")
  const [withdrawAmount, setWithdrawAmount] = useState("")
  const [withdrawRecord, setWithdrawRecord] = useState<WithdrawPrepareResult | null>(null)
  const [withdrawError, setWithdrawError] = useState<string | null>(null)
  const [withdrawTxHash, setWithdrawTxHash] = useState<string | null>(null)
  const [sendAsset, setSendAsset] = useState<CashOutAssetOption | null>(() => getDefaultSendAsset(null))
  const [sendDestinationMode, setSendDestinationMode] = useState<SendDestinationMode>("saved")
  const [sendSavedDestinationId, setSendSavedDestinationId] = useState("")
  const [sendDestination, setSendDestination] = useState("")
  const [sendAmount, setSendAmount] = useState("")
  const [sendStep, setSendStep] = useState<SendStep>("form")
  const [sendRecord, setSendRecord] = useState<DirectSendPrepareResult | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendTxHash, setSendTxHash] = useState<string | null>(null)
  // Settlement history
  const [settlementHistory, setSettlementHistory] = useState<SettlementWithdrawal[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [settlementActivityExpanded, setSettlementActivityExpanded] = useState(false)
  const [settlementAdvancedOpen, setSettlementAdvancedOpen] = useState(false)
  const [nwcAdvancedOpen, setNwcAdvancedOpen] = useState(false)
  const [addressBookNotice, setAddressBookNotice] = useState<string | null>(null)

  // Global Address Book modal state (wallet-neutral view of all saved addresses)
  const [addressBookOpen, setAddressBookOpen] = useState(false)
  const [addressBookFilter, setAddressBookFilter] = useState<"all" | "solana" | "base">("all")

  // Mesh exchange connection state
  const [meshLinking, setMeshLinking] = useState(false)
  const [meshLinkError, setMeshLinkError] = useState<string | null>(null)
  const [meshImportStep, setMeshImportStep] = useState<"idle" | "connected" | "importing" | "done">("idle")
  const [meshConnection, setMeshConnection] = useState<MeshActiveConnection | null>(null)
  const [meshImportAssets, setMeshImportAssets] = useState<string[]>([])
  const [meshImporting, setMeshImporting] = useState(false)
  const [meshImportError, setMeshImportError] = useState<string | null>(null)
  const [meshImportResult, setMeshImportResult] = useState<{ imported: number; updated: number } | null>(null)

  useEffect(() => {
    loadOverview(false)
  }, [])

  useEffect(() => {
    if ((activeTab === "settlement" || activeTab === "send" || activeTab === "activity") && selectedWallet && !selectedWallet.isLightning) {
      loadSettlementDestinations()
      refreshSettlementBalances()
      if (activeTab === "settlement" || activeTab === "activity") {
        loadSettlementHistory()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedWallet?.id])

  // Load all destinations when the global Address Book opens (no wallet required)
  useEffect(() => {
    if (addressBookOpen) {
      loadSettlementDestinations()
      setAddressBookFilter("all")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressBookOpen])

  useEffect(() => {
    const defaultAsset = getDefaultCashOutAsset(selectedWallet)
    setCashOutAsset(defaultAsset)
    setSendAsset(getDefaultSendAsset(selectedWallet))
    setSendDestinationMode("saved")
    setSendSavedDestinationId("")
    setSendDestination("")
    setSendAmount("")
    setSendStep("form")
    setSendRecord(null)
    setSendError(null)
    setSendTxHash(null)
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
    // Settlement destination reset
    setSettlementDestinations([])
    setDestLoading(false)
    setDestLoadError(null)
    setDestModalOpen(false)
    setDestForm(emptyDestinationForm())
    setDestSaveError(null)
    setDestDeleteConfirmId(null)
    setDestDeleting(false)
    setWithdrawReview(null)
    setDestSettingDefault(null)
    setSettlementMode("manual")
    setSettlementPrefSaving(false)
    setMoveMoneyOpen(false)
    setUsdcBalance(null)
    setUsdcBalanceLoading(false)
    setUsdcBalanceError(null)
    setUsdcBalanceRefreshedAt(null)
    setCheckingStatusId(null)
    setCheckedPendingIds([])
    // Withdrawal flow reset
    setWithdrawStep("review")
    setWithdrawAmount("")
    setWithdrawRecord(null)
    setWithdrawError(null)
    setWithdrawTxHash(null)
    setSettlementHistory([])
    setHistoryLoading(false)
    setSettlementActivityExpanded(false)
    setSettlementAdvancedOpen(false)
    setNwcAdvancedOpen(false)
    // Address book notice clears on wallet change (the modal itself stays open if already open)
    setAddressBookNotice(null)
    // Mesh state reset
    setMeshLinking(false)
    setMeshLinkError(null)
    setMeshImportStep("idle")
    setMeshConnection(null)
    setMeshImportAssets([])
    setMeshImporting(false)
    setMeshImportError(null)
    setMeshImportResult(null)
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

  // ── Settlement destination API calls ────────────────────────────────────────

  async function loadSettlementDestinations() {
    setDestLoading(true)
    setDestLoadError(null)
    try {
      const token = await getMerchantToken()
      const res = await fetch("/api/wallets/settlement/destinations", {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
        cache: "no-store"
      })
      const payload = await res.json().catch(() => null) as { success?: boolean; destinations?: SettlementDestination[]; error?: string } | null
      if (!res.ok || !payload?.success) throw new Error(payload?.error || "Failed to load destinations")
      setSettlementDestinations(payload.destinations || [])
    } catch (err) {
      setDestLoadError(err instanceof Error ? err.message : "Failed to load destinations")
    } finally {
      setDestLoading(false)
    }
  }

  async function saveSettlementDestination() {
    const option = SETTLEMENT_ASSET_NETWORK_OPTIONS.find((o) => o.value === destForm.assetNetwork)
    if (!option) { setDestSaveError("Select an asset and network."); return }

    setDestSaving(true)
    setDestSaveError(null)
    try {
      const token = await getMerchantToken()
      const body = destForm.id
        ? {
            action: "update",
            id: destForm.id,
            label: destForm.label,
            exchange_name: destForm.exchangeName,
            asset: option.asset,
            network: option.network,
            wallet_network: selectedWallet?.rail || null,
            address: destForm.address,
            memo_or_tag: destForm.memoOrTag || null,
            is_default: false,
            account_type: destForm.accountType,
            source: "manual",
            connected_provider: "manual",
            personal_exchange_acknowledged: destForm.personalExchangeAcknowledged
          }
        : {
            action: "create",
            label: destForm.label,
            exchange_name: destForm.exchangeName,
            asset: option.asset,
            network: option.network,
            wallet_network: selectedWallet?.rail || null,
            address: destForm.address,
            memo_or_tag: destForm.memoOrTag || null,
            is_default: false,
            account_type: destForm.accountType,
            source: "manual",
            connected_provider: "manual",
            personal_exchange_acknowledged: destForm.personalExchangeAcknowledged
          }

      const res = await fetch("/api/wallets/settlement/destinations", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify(body)
      })
      const payload = await res.json().catch(() => null) as { success?: boolean; destinations?: SettlementDestination[]; error?: string } | null
      if (!res.ok || !payload?.success) throw new Error(payload?.error || "Save failed")
      setSettlementDestinations(payload.destinations || [])
      setDestModalOpen(false)
      setDestForm(emptyDestinationForm())
    } catch (err) {
      setDestSaveError(err instanceof Error ? err.message : "Save failed")
    } finally {
      setDestSaving(false)
    }
  }

  function openAddSavedAddress(assetNetwork?: string) {
    const firstOption = destinationAssetOptions[0]
    setDestForm({
      ...emptyDestinationForm(),
      assetNetwork: assetNetwork || firstOption?.value || ""
    })
    setDestSaveError(null)
    setDestModalOpen(true)
  }

  // ── Mesh exchange connection handlers ──────────────────────────────────────

  async function connectExchange() {
    if (!MESH_CONNECT_ENABLED || meshLinking) return
    setMeshLinking(true)
    setMeshLinkError(null)
    setMeshImportStep("idle")
    setMeshConnection(null)
    setMeshImportResult(null)

    try {
      const token = await getMerchantToken()
      const res = await fetch("/api/mesh/link-token", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store"
      })
      const payload = (await res.json().catch(() => null)) as {
        success?: boolean
        link_token?: string
        error?: string
      } | null

      if (!res.ok || !payload?.success || !payload.link_token) {
        throw new Error(payload?.error || "Failed to get Mesh link token")
      }

      const { createLink } = await import("@meshconnect/web-link-sdk")

      const meshLink = createLink({
        clientId: process.env.NEXT_PUBLIC_MESH_CLIENT_ID || "",
        onIntegrationConnected: async (data: MeshIntegrationData) => {
          setMeshLinking(false)
          await handleMeshConnected(data)
        },
        onExit: (err?: string) => {
          setMeshLinking(false)
          if (err) setMeshLinkError(String(err))
        },
        onEvent: () => {}
      })

      meshLink.openLink(payload.link_token)
    } catch (err) {
      setMeshLinking(false)
      setMeshLinkError(err instanceof Error ? err.message : "Failed to connect exchange")
    }
  }

  async function handleMeshConnected(integration: MeshIntegrationData) {
    try {
      const accountTokens = integration.accessToken?.accountTokens || []
      const primaryToken  = accountTokens[0]
      const accessToken   = primaryToken?.accessToken || null
      const accountId     = primaryToken?.accountId   || null
      const brokerName    = integration.accessToken?.brokerName || null

      const token = await getMerchantToken()
      const res = await fetch("/api/mesh/connect-callback", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
          integration_id:   integration.integrationId   || null,
          institution_name: integration.institutionName || brokerName,
          institution_id:   integration.institutionId   || null,
          broker_name:      brokerName,
          account_id:       accountId
        })
      })
      const payload = (await res.json().catch(() => null)) as {
        success?: boolean
        connection?: { id: string; institution_name: string | null }
        error?: string
      } | null

      if (!res.ok || !payload?.success || !payload.connection) {
        throw new Error(payload?.error || "Failed to save exchange connection")
      }

      const resolvedName = payload.connection.institution_name || brokerName || null
      setMeshConnection({ id: payload.connection.id, institutionName: resolvedName, accessToken })

      // Pre-select all available asset options for this wallet context
      const walletNetwork = selectedWallet?.rail || ""
      setMeshImportAssets(getMeshImportOptions(walletNetwork).map((o) => `${o.asset}|${o.network}`))
      setMeshImportStep("connected")
    } catch (err) {
      setMeshLinkError(err instanceof Error ? err.message : "Failed to save exchange connection")
    }
  }

  async function importMeshAddresses() {
    if (!meshConnection || meshImportAssets.length === 0) return
    setMeshImporting(true)
    setMeshImportError(null)

    try {
      const token  = await getMerchantToken()
      const assets = meshImportAssets.map((val) => {
        const [asset, network] = val.split("|")
        return { asset, network }
      })

      const res = await fetch("/api/mesh/import-addresses", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
          connection_id:    meshConnection.id,
          access_token:     meshConnection.accessToken,
          wallet_network:   selectedWallet?.rail,
          institution_name: meshConnection.institutionName,
          assets
        })
      })
      const payload = (await res.json().catch(() => null)) as {
        success?: boolean
        imported?: number
        updated?: number
        destinations?: SettlementDestination[]
        errors?: string[]
        error?: string
      } | null

      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error || "Import failed")
      }

      setSettlementDestinations(payload.destinations || [])
      setMeshImportResult({ imported: payload.imported || 0, updated: payload.updated || 0 })
      setMeshImportStep("done")
    } catch (err) {
      setMeshImportError(err instanceof Error ? err.message : "Import failed")
    } finally {
      setMeshImporting(false)
    }
  }

  // ── End Mesh handlers ──────────────────────────────────────────────────────

  async function setPreferredDestination(id: string) {
    setDestSettingDefault(id)
    try {
      const token = await getMerchantToken()
      const res = await fetch("/api/wallets/settlement/destinations", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ action: "setDefault", id })
      })
      const payload = await res.json().catch(() => null) as { success?: boolean; destinations?: SettlementDestination[] } | null
      if (payload?.success) setSettlementDestinations(payload.destinations || [])
    } catch {
      // Non-critical — silently absorb
    } finally {
      setDestSettingDefault(null)
    }
  }

  async function deleteSettlementDestination(id: string) {
    setDestDeleting(true)
    try {
      const token = await getMerchantToken()
      const res = await fetch("/api/wallets/settlement/destinations", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ action: "delete", id })
      })
      const payload = await res.json().catch(() => null) as { success?: boolean; destinations?: SettlementDestination[]; error?: string } | null
      if (!res.ok || !payload?.success) throw new Error(payload?.error || "Delete failed")
      setSettlementDestinations(payload.destinations || [])
      setDestDeleteConfirmId(null)
    } catch (err) {
      setDestLoadError(err instanceof Error ? err.message : "Delete failed")
    } finally {
      setDestDeleting(false)
    }
  }

  // ── Settlement preference API calls ──────────────────────────────────────────

  async function loadSettlementPreferences() {
    try {
      const token = await getMerchantToken()
      const res = await fetch("/api/wallets/settlement/preferences", {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
        cache: "no-store"
      })
      const payload = await res.json().catch(() => null) as { success?: boolean; mode?: string } | null
      if (payload?.success && payload.mode) {
        setSettlementMode(payload.mode as "manual" | "end_of_day" | "auto")
      }
    } catch {
      // Preferences are non-critical; silently fall back to "manual"
    }
  }

  async function saveSettlementPreference(mode: "manual" | "end_of_day" | "auto") {
    setSettlementPrefSaving(true)
    try {
      const token = await getMerchantToken()
      await fetch("/api/wallets/settlement/preferences", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ mode })
      })
    } catch {
      // Non-critical — preference is still applied locally
    } finally {
      setSettlementPrefSaving(false)
    }
  }

  // ── Settlement balance and status API calls ───────────────────────────────────

  async function refreshSettlementBalances() {
    if (!selectedWallet || selectedWallet.isLightning) return
    const network = selectedWallet.rail
    const address = selectedWallet.referenceTitle
    if (network !== "base" && network !== "solana") return

    setUsdcBalanceLoading(true)
    setUsdcBalanceError(null)
    try {
      const token = await getMerchantToken()
      const res = await fetch(
        `/api/wallets/settlement/balances?wallet_address=${encodeURIComponent(address)}&network=${encodeURIComponent(network)}`,
        { headers: { Authorization: `Bearer ${token}` }, credentials: "include", cache: "no-store" }
      )
      const payload = await res.json().catch(() => null) as {
        success?: boolean
        usdc?: number | null
        usdcError?: string | null
        refreshedAt?: string
      } | null
      if (payload?.success) {
        setUsdcBalance(payload.usdc ?? null)
        setUsdcBalanceRefreshedAt(payload.refreshedAt ?? null)
        if (payload.usdcError) setUsdcBalanceError("Unable to refresh USDC balance right now.")
      }
    } catch {
      setUsdcBalanceError("Unable to refresh USDC balance right now.")
    } finally {
      setUsdcBalanceLoading(false)
    }
  }

  async function checkWithdrawalStatus(id: string) {
    setCheckingStatusId(id)
    try {
      const token = await getMerchantToken()
      const res = await fetch("/api/wallets/settlement/withdrawals", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ action: "checkStatus", id })
      })
      const payload = await res.json().catch(() => null) as {
        success?: boolean
        withdrawal?: SettlementWithdrawal
        chainStatus?: string
        error?: string
      } | null
      if (payload?.success && payload.withdrawal) {
        setSettlementHistory((prev) =>
          prev.map((w) => (w.id === id ? { ...w, ...payload.withdrawal } : w)) as SettlementWithdrawal[]
        )
        if (payload.chainStatus === "pending") {
          setCheckedPendingIds((prev) => prev.includes(id) ? prev : [...prev, id])
        }
      }
    } catch {
      // Non-critical — user can retry
    } finally {
      setCheckingStatusId(null)
    }
  }

  // ── Settlement withdrawal API calls ──────────────────────────────────────────

  async function loadSettlementHistory() {
    setHistoryLoading(true)
    try {
      const token = await getMerchantToken()
      const res = await fetch("/api/wallets/settlement/withdrawals?limit=10", {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
        cache: "no-store"
      })
      const payload = await res.json().catch(() => null) as { success?: boolean; withdrawals?: SettlementWithdrawal[] } | null
      if (payload?.success) setSettlementHistory(payload.withdrawals || [])
    } catch {
      // History is non-critical — silently ignore load failures
    } finally {
      setHistoryLoading(false)
    }
  }

  async function prepareWithdrawal() {
    if (!withdrawReview || !selectedWallet) return
    if (!withdrawAmount.trim() || Number(withdrawAmount) <= 0) {
      setWithdrawError("Enter a valid withdrawal amount greater than zero.")
      return
    }
    setWithdrawStep("preparing")
    setWithdrawError(null)
    try {
      const token = await getMerchantToken()
      const res = await fetch("/api/wallets/settlement/withdrawals", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
          action: "prepare",
          settlement_destination_id: withdrawReview.id,
          wallet_id: selectedWallet.id,
          wallet_address: selectedWallet.referenceTitle,
          wallet_network: selectedWallet.rail,
          amount: withdrawAmount.trim()
        })
      })
      const payload = await res.json().catch(() => null) as (WithdrawPrepareResult & { success?: boolean; error?: string }) | null
      if (!res.ok || !payload?.success) throw new Error(payload?.error || "Preparation failed")
      setWithdrawRecord(payload)
      setWithdrawStep("prepared")
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : "Preparation failed")
      setWithdrawStep("failed")
    }
  }

  async function signAndSubmitWithdrawal() {
    if (!withdrawRecord || !selectedWallet) return
    setWithdrawStep("signing")
    setWithdrawError(null)

    try {
      let txHash: string

      if (withdrawRecord.withdrawal.network === "solana" && withdrawRecord.unsigned_tx_base64) {
        // ── Solana signing ────────────────────────────────────────────────────
        const wallets = getDetectedSolanaWallets()
        // Prefer the wallet whose connected public key matches the merchant address
        const walletEntry = wallets.find(
          (w) => String(w.provider.publicKey?.toString() || "") === selectedWallet.referenceTitle
        ) || wallets[0]

        if (!walletEntry) {
          throw new Error("No Solana wallet detected. Install Phantom or Solflare and ensure it is unlocked.")
        }

        await walletEntry.provider.connect()

        const tx = Transaction.from(Buffer.from(withdrawRecord.unsigned_tx_base64, "base64"))
        const signResult = await walletEntry.provider.signAndSendTransaction(tx)
        txHash = getSolanaTransactionSignature(signResult)

        if (!txHash) throw new Error("No transaction signature returned from wallet.")

      } else if (withdrawRecord.withdrawal.network === "base" && withdrawRecord.tx_params) {
        // ── Base signing ──────────────────────────────────────────────────────
        const eth = (window as Window & {
          ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }
        }).ethereum

        if (!eth) {
          throw new Error("No Ethereum wallet detected. Install MetaMask or Base Wallet and ensure it is unlocked.")
        }

        const params = withdrawRecord.tx_params
        const rawResult = await eth.request({
          method: "eth_sendTransaction",
          params: [{
            from: params.from,
            to: params.to,
            value: params.value,
            data: params.data,
            gas: params.gas
          }]
        })
        txHash = String(rawResult || "").trim()
        if (!txHash) throw new Error("No transaction hash returned from wallet.")

      } else {
        throw new Error("Missing transaction data. Please prepare the withdrawal again.")
      }

      setWithdrawTxHash(txHash)

      // ── Record hash on server ─────────────────────────────────────────────
      const token = await getMerchantToken()
      const submitRes = await fetch("/api/wallets/settlement/withdrawals", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ action: "submit", id: withdrawRecord.withdrawal.id, tx_hash: txHash })
      })
      const submitPayload = await submitRes.json().catch(() => null) as { success?: boolean; error?: string } | null
      if (!submitRes.ok || !submitPayload?.success) {
        // Hash was broadcast — don't block the success state, just note the record error
        console.warn("[settlement] Hash broadcast but server record update failed:", submitPayload?.error)
      }

      setWithdrawStep("submitted")
      // Refresh history
      await loadSettlementHistory()

    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : "Wallet signing failed")
      setWithdrawStep("failed")
    }
  }

  // ── End settlement withdrawal API calls ───────────────────────────────────────

  // ── End settlement destination API calls ─────────────────────────────────────

  async function prepareDirectSend() {
    if (!selectedWallet || !sendAsset) return
    const destinationAddress = activeSendDestinationAddress.trim()
    if (!destinationAddress) {
      setSendError(sendDestinationMode === "saved" ? "Choose a saved destination or enter an address manually." : "Enter a destination address.")
      return
    }
    if (!sendAmount.trim() || Number(sendAmount) <= 0) {
      setSendError("Enter a valid amount greater than zero.")
      return
    }

    setSendStep("preparing")
    setSendError(null)
    try {
      const token = await getMerchantToken()
      const res = await fetch("/api/wallets/settlement/withdrawals", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
          action: "prepare_direct",
          wallet_id: selectedWallet.id,
          wallet_address: selectedWallet.referenceTitle,
          wallet_network: selectedWallet.rail,
          asset: sendAsset.asset,
          destination_address: destinationAddress,
          amount: sendAmount.trim()
        })
      })
      const payload = await res.json().catch(() => null) as (DirectSendPrepareResult & { success?: boolean; error?: string }) | null
      if (!res.ok || !payload?.success) throw new Error(payload?.error || "Send preparation failed")
      setSendRecord(payload)
      setSendStep("prepared")
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Send preparation failed")
      setSendStep("failed")
    }
  }

  async function signAndSubmitDirectSend() {
    if (!sendRecord || !selectedWallet) return
    setSendStep("signing")
    setSendError(null)

    try {
      let txHash: string

      if (sendRecord.transfer.network === "solana" && sendRecord.unsigned_tx_base64) {
        const wallets = getDetectedSolanaWallets()
        const walletEntry = wallets.find(
          (w) => String(w.provider.publicKey?.toString() || "") === selectedWallet.referenceTitle
        ) || wallets[0]

        if (!walletEntry) {
          throw new Error("No Solana wallet detected. Install Phantom or Solflare and ensure it is unlocked.")
        }

        await walletEntry.provider.connect()
        const tx = Transaction.from(Buffer.from(sendRecord.unsigned_tx_base64, "base64"))
        const signResult = await walletEntry.provider.signAndSendTransaction(tx)
        txHash = getSolanaTransactionSignature(signResult)
        if (!txHash) throw new Error("No transaction signature returned from wallet.")
      } else if (sendRecord.transfer.network === "base" && sendRecord.tx_params) {
        const eth = (window as Window & {
          ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }
        }).ethereum

        if (!eth) {
          throw new Error("No Ethereum wallet detected. Install MetaMask or Base Wallet and ensure it is unlocked.")
        }

        const params = sendRecord.tx_params
        const rawResult = await eth.request({
          method: "eth_sendTransaction",
          params: [{
            from: params.from,
            to: params.to,
            value: params.value,
            data: params.data,
            gas: params.gas
          }]
        })
        txHash = String(rawResult || "").trim()
        if (!txHash) throw new Error("No transaction hash returned from wallet.")
      } else {
        throw new Error("Missing transaction data. Please review the send again.")
      }

      setSendTxHash(txHash)
      const token = await getMerchantToken()
      const submitRes = await fetch("/api/wallets/settlement/withdrawals", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
          action: "submit_direct",
          wallet_id: selectedWallet.id,
          asset: sendRecord.transfer.asset,
          network: sendRecord.transfer.network,
          amount: String(sendRecord.transfer.amount),
          destination_address: sendRecord.transfer.destination_address,
          destination_label: selectedSendDestination?.label || null,
          destination_kind: selectedSendDestination ? "saved_destination" : "manual_address",
          tx_hash: txHash
        })
      })
      const submitPayload = await submitRes.json().catch(() => null) as DirectSendSubmitResponse | null
      if (!submitRes.ok || !submitPayload?.success) {
        throw new Error(submitPayload?.error || "Send was submitted, but activity could not be saved.")
      }
      if (submitPayload.withdrawal) {
        setSettlementHistory((prev) => {
          const existing = prev.some((item) => item.id === submitPayload.withdrawal?.id)
          return existing
            ? prev.map((item) => item.id === submitPayload.withdrawal?.id ? submitPayload.withdrawal as SettlementWithdrawal : item)
            : [submitPayload.withdrawal as SettlementWithdrawal, ...prev]
        })
      }
      setSendStep("submitted")
      await refreshSettlementBalances()
      await loadSettlementHistory()
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Wallet signing failed")
      setSendStep("failed")
    }
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
  const sendAssetOptions = getSendAssetOptions(selectedWallet)
  const destinationAssetOptions = getDestinationAssetOptions(selectedWallet)
  const sendSavedDestinations = settlementDestinations.filter((dest) =>
    sendAsset && dest.asset === sendAsset.asset && dest.network === sendAsset.network
  )
  const savedDestinationsForWallet = settlementDestinations.filter((dest) =>
    selectedWallet && !selectedWallet.isLightning && dest.network === selectedWallet.rail
  )
  const addressBookFilteredDestinations = settlementDestinations.filter((dest) => {
    if (addressBookFilter === "all") return true
    return dest.network === addressBookFilter
  })
  // When the global address book is open without a selected wallet, allow all networks in the Add Address form
  const activeAddressFormOptions = (addressBookOpen && !selectedWallet)
    ? SETTLEMENT_ASSET_NETWORK_OPTIONS
    : destinationAssetOptions
  const firstAddressBookWallet = wallets[0] ? buildConnectedWallet(wallets[0]) : null
  const selectedSendDestination = sendSavedDestinations.find((dest) => dest.id === sendSavedDestinationId) || null
  const activeSendDestinationAddress = sendDestinationMode === "saved"
    ? selectedSendDestination?.address || ""
    : sendDestination
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

  const settlementSummary = useMemo(() => {
    // Per-asset/network preferred destinations map
    const preferredByAssetNetwork: Record<string, SettlementDestination> = {}
    for (const dest of settlementDestinations) {
      if (dest.is_default) {
        preferredByAssetNetwork[`${dest.asset}|${dest.network}`] = dest
      }
    }

    // Current wallet context
    const walletRail   = selectedWallet?.rail ?? ""
    const walletAsset  = selectedWallet?.assetSymbol ?? ""
    const nativeBalance = Number(selectedWallet?.nativeBalance ?? 0)

    // Preferred destinations for the current wallet
    const preferredForNative = (walletAsset && walletRail)
      ? (preferredByAssetNetwork[`${walletAsset}|${walletRail}`] ?? null)
      : null
    const preferredForUsdc = walletRail
      ? (preferredByAssetNetwork[`USDC|${walletRail}`] ?? null)
      : null

    // Gas-safe "Withdraw All" amounts
    const nativeReserve = walletRail === "base" ? BASE_ETH_GAS_RESERVE
      : walletRail === "solana" ? SOLANA_SOL_FEE_RESERVE
        : 0
    const nativeWithdrawAll = Math.max(0, nativeBalance - nativeReserve)
    const nativeEnoughForWithdrawal = nativeBalance > nativeReserve && nativeWithdrawAll > 0
    const usdcWithdrawAll = (usdcBalance !== null && usdcBalance > 0) ? usdcBalance : null

    // Pending and history
    const pendingWithdrawals = settlementHistory.filter((w) =>
      ["PREPARED", "AWAITING_SIGNATURE", "SUBMITTED"].includes(w.status)
    )
    const now = new Date()
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const thisMonthDone = settlementHistory.filter(
      (w) =>
        (w.status === "SUBMITTED" || w.status === "CONFIRMED") &&
        new Date(w.created_at) >= firstOfMonth
    )
    const monthlyTotal = thisMonthDone.reduce((sum, w) => sum + Number(w.amount), 0)
    const lastWithdrawal = settlementHistory.find(
      (w) => w.status === "SUBMITTED" || w.status === "CONFIRMED"
    )

    return {
      preferredByAssetNetwork,
      preferredForNative,
      preferredForUsdc,
      // Legacy keys kept for backwards compat
      preferredDestLabel: preferredForNative?.label ?? null,
      preferredDestExchange: preferredForNative?.exchange_name ?? null,
      destinationCount: settlementDestinations.length,
      pendingWithdrawals,
      pendingCount: pendingWithdrawals.length,
      thisMonthCount: thisMonthDone.length,
      monthlyTotal,
      lastWithdrawalDate: lastWithdrawal?.submitted_at ?? lastWithdrawal?.created_at ?? null,
      walletRail,
      walletAsset,
      nativeReserve,
      nativeWithdrawAll,
      nativeEnoughForWithdrawal,
      usdcWithdrawAll
    }
  }, [settlementDestinations, settlementHistory, selectedWallet, usdcBalance])

  const detailTabs: Array<{ id: DetailTab; label: string }> = selectedWallet?.isLightning
    ? [
      { id: "overview", label: "Overview" },
      { id: "lightning_wallet", label: "Manage Wallet" },
      { id: "activity", label: "Activity" }
    ]
    : [
      { id: "overview", label: "Overview" },
      { id: "send", label: "Send" },
      { id: "settlement", label: "Wallet Config" },
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

      <DashboardSection title="Wallet Addresses" titleTone="blue">
        <div className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-semibold text-gray-950">PineTree Address Book</p>
                <NetworkStatusPill label="Global address book" tone="blue" className="min-h-6 px-2 text-[10px]" />
              </div>
              <p className="mt-2 text-sm leading-5 text-gray-600">
                Saved exchange and wallet addresses for faster sends.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setAddressBookNotice(null)
                setAddressBookOpen(true)
              }}
              className={cx(pineTreeSecondaryActionButton, "shrink-0 sm:w-auto")}
            >
              Manage Addresses
            </button>
          </div>
          {addressBookNotice && (
            <p className="mt-3 text-xs leading-5 text-gray-500">{addressBookNotice}</p>
          )}
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
                      <NetworkStatusPill label="Direct Wallet (NWC)" tone="slate" className="min-h-6 px-2 text-[10px]" />
                      <NetworkStatusPill label="Bitcoin Lightning" tone="slate" className="min-h-6 px-2 text-[10px]" />
                      <NetworkStatusPill label="Advanced" tone="amber" className="min-h-6 px-2 text-[10px]" />
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
                  {nwcConnected ? "Manage" : "Connect Direct Wallet"}
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
            aria-label="Settlement setup"
            className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-3xl border border-white/70 bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.22)] sm:rounded-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0052FF]">
                  Settlement Setup
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

      {/* ── Global Address Book Modal ───────────────────────────────────────── */}
      {addressBookOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/50 p-0 sm:items-start sm:p-6"
          onMouseDown={() => setAddressBookOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="PineTree Address Book"
            className="relative mt-0 max-h-[94dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-white/70 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)] sm:mt-8 sm:rounded-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0052FF]">
                  Address Book
                </p>
                <h2 className="mt-0.5 text-lg font-semibold text-gray-950">PineTree Address Book</h2>
                <p className="mt-0.5 text-xs leading-5 text-gray-500">
                  Saved exchange and wallet addresses for faster sends. Addresses shown here span all connected wallets.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAddressBookOpen(false)}
                className="inline-flex h-8 shrink-0 items-center justify-center rounded-full bg-gray-100 px-3 text-[11px] font-semibold text-gray-700 shadow-sm transition hover:bg-gray-200 focus:outline-none focus:ring-4 focus:ring-gray-100"
              >
                Close
              </button>
            </div>

            {/* Network filter tabs */}
            <div className="flex items-center gap-1 border-b border-gray-100 px-5 py-2.5">
              {(["all", "solana", "base"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setAddressBookFilter(f)}
                  className={cx(
                    "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                    addressBookFilter === f
                      ? "bg-[#0052FF] text-white shadow-sm"
                      : "text-gray-500 hover:bg-gray-100"
                  )}
                >
                  {f === "all" ? "All" : networkDisplayLabel(f)}
                </button>
              ))}
              <span className="ml-auto text-xs text-gray-400">
                {addressBookFilteredDestinations.length} address{addressBookFilteredDestinations.length === 1 ? "" : "es"}
              </span>
            </div>

            {/* Address list */}
            <div className="p-5">
              {destLoadError && (
                <div className="mb-4 rounded-xl border border-red-100 bg-red-50/70 p-3 text-sm text-red-800">
                  {destLoadError}
                </div>
              )}

              {destLoading ? (
                <div className="rounded-2xl border border-gray-100 bg-gray-50/70 px-4 py-8 text-center text-sm text-gray-500">
                  Loading addresses…
                </div>
              ) : addressBookFilteredDestinations.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 px-4 py-10 text-center">
                  <p className="text-sm font-semibold text-gray-700">
                    {addressBookFilter === "all" ? "No saved addresses yet" : `No ${networkDisplayLabel(addressBookFilter)} addresses saved`}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-gray-500">
                    Add an address below to make future sends faster.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {addressBookFilteredDestinations.map((dest) => (
                    <div key={dest.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm transition hover:border-[#0052FF]/20">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-gray-950">{dest.label}</p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                              {getDestinationAccountTypeLabel(dest.account_type)}
                            </span>
                            <span className={cx(
                              "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                              dest.source === "mesh" || dest.connected_provider === "mesh"
                                ? "border-[#0052FF]/25 bg-[#0052FF]/10 text-[#0052FF]"
                                : "border-gray-200 bg-gray-50 text-gray-500"
                            )}>
                              {getDestinationSourceLabel(dest)}
                            </span>
                            {dest.institution_name && (
                              <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                                {dest.institution_name}
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-[11px] text-gray-400">{dest.exchange_name}</p>
                        </div>
                        <span className="shrink-0 rounded-xl border border-[#0052FF]/15 bg-[#0052FF]/5 px-2.5 py-1 text-[11px] font-semibold text-[#0052FF]">
                          {assetNetworkDisplayLabel(dest.asset, dest.network)}
                        </span>
                      </div>
                      <p className="mt-2 font-mono text-xs text-gray-400" title={dest.address}>
                        {formatSettlementAddress(dest.address)}
                      </p>
                      {dest.memo_or_tag && (
                        <p className="mt-0.5 text-[10px] text-gray-400">Memo: {dest.memo_or_tag}</p>
                      )}

                      {destDeleteConfirmId === dest.id ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <p className="text-xs font-semibold text-gray-700">Delete this address?</p>
                          <button type="button" onClick={() => setDestDeleteConfirmId(null)} disabled={destDeleting} className={pineTreeSecondaryActionButton}>
                            Cancel
                          </button>
                          <button type="button" onClick={() => deleteSettlementDestination(dest.id)} disabled={destDeleting} className={pineTreeDangerActionButton}>
                            {destDeleting ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                      ) : (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setDestForm({
                                id: dest.id,
                                label: dest.label,
                                exchangeName: dest.exchange_name,
                                assetNetwork: destAssetNetworkValue(dest),
                                address: dest.address,
                                memoOrTag: dest.memo_or_tag || "",
                                isDefault: false,
                                confirmed: true,
                                accountType: dest.account_type || "other",
                                personalExchangeAcknowledged: dest.account_type === "personal_exchange"
                              })
                              setDestSaveError(null)
                              setDestModalOpen(true)
                            }}
                            className={pineTreeSecondaryActionButton}
                          >
                            Edit
                          </button>
                          <button type="button" onClick={() => setDestDeleteConfirmId(dest.id)} className={pineTreeDangerActionButton}>
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer actions */}
            <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 px-5 py-4">
              <button
                type="button"
                onClick={() => {
                  setDestForm({ ...emptyDestinationForm(), assetNetwork: SETTLEMENT_ASSET_NETWORK_OPTIONS[0].value })
                  setDestSaveError(null)
                  setDestModalOpen(true)
                }}
                className={pineTreePrimaryButton}
              >
                Add Address
              </button>
              {MESH_CONNECT_ENABLED ? (
                <button
                  type="button"
                  onClick={connectExchange}
                  disabled={meshLinking}
                  className={pineTreeSecondaryActionButton}
                >
                  {meshLinking ? "Connecting..." : "Connect Exchange"}
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button type="button" disabled className={cx(pineTreeSecondaryActionButton, "cursor-not-allowed opacity-55")}>
                    Connect Exchange
                  </button>
                  <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                    Not configured
                  </span>
                </div>
              )}
              <p className="w-full text-xs leading-5 text-gray-400">
                Saved addresses do not affect where customer payments are received.
              </p>
            </div>
          </div>
        </div>
      )}

      {destModalOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-3"
          onMouseDown={() => { setDestModalOpen(false); setDestSaveError(null) }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={destForm.id ? "Edit saved address" : "Add saved address"}
            className="max-h-[94dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-white/70 bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.22)] sm:max-h-[92vh] sm:rounded-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0052FF]">
                  Saved Address
                </p>
                <h2 className="mt-1 text-lg font-semibold text-gray-950">
                  {destForm.id ? "Edit Saved Address" : "Add Saved Address"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => { setDestModalOpen(false); setDestSaveError(null) }}
                className="inline-flex h-8 shrink-0 items-center justify-center rounded-full bg-gray-100 px-3 text-[11px] font-semibold text-gray-700 shadow-sm transition hover:bg-gray-200 focus:outline-none focus:ring-4 focus:ring-gray-100"
              >
                Close
              </button>
            </div>

            <div className="mt-5 space-y-4">
              {/* Exchange */}
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">Exchange / wallet</span>
                <select
                  value={destForm.exchangeName}
                  onChange={(e) => setDestForm((f) => ({ ...f, exchangeName: e.target.value }))}
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-800 outline-none focus:border-[#0052FF] focus:ring-4 focus:ring-blue-100"
                >
                  <option value="">Select exchange…</option>
                  {SETTLEMENT_EXCHANGE_OPTIONS.map((ex) => (
                    <option key={ex} value={ex}>{ex}</option>
                  ))}
                </select>
              </label>

              <div>
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">Address type</span>
                <div className="mt-2 grid gap-2">
                  {DESTINATION_ACCOUNT_TYPE_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className={cx(
                        "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition",
                        destForm.accountType === option.value
                          ? "border-[#0052FF]/30 bg-[#0052FF]/5"
                          : "border-gray-200 bg-white hover:bg-gray-50"
                      )}
                    >
                      <input
                        type="radio"
                        name="destination-account-type"
                        value={option.value}
                        checked={destForm.accountType === option.value}
                        onChange={() => setDestForm((f) => ({
                          ...f,
                          accountType: option.value,
                          personalExchangeAcknowledged: option.value === "personal_exchange" ? f.personalExchangeAcknowledged : false
                        }))}
                        className="h-4 w-4 border-gray-300 text-[#0052FF] focus:ring-[#0052FF]"
                      />
                      <span className="text-sm font-semibold text-gray-800">{option.label}</span>
                    </label>
                  ))}
                </div>
                {destForm.accountType === "business_exchange" && (
                  <p className="mt-2 rounded-xl border border-[#0052FF]/15 bg-[#0052FF]/5 p-3 text-xs leading-5 text-gray-700">
                    Recommended for business funds, accounting, and bank withdrawal records.
                  </p>
                )}
                {destForm.accountType === "personal_exchange" && (
                  <div className="mt-2 rounded-xl border border-amber-100 bg-amber-50/70 p-3">
                    <p className="text-xs leading-5 text-amber-900">
                      For business payments, PineTree recommends using an exchange account and bank account registered to the business. Personal exchange accounts may create accounting, tax, or compliance issues.
                    </p>
                    <label className="mt-2 flex cursor-pointer items-start gap-2">
                      <input
                        type="checkbox"
                        checked={destForm.personalExchangeAcknowledged}
                        onChange={(e) => setDestForm((f) => ({ ...f, personalExchangeAcknowledged: e.target.checked }))}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#0052FF] focus:ring-[#0052FF]"
                      />
                      <span className="text-xs font-semibold leading-5 text-amber-900">
                        I understand this destination may not be registered to the business.
                      </span>
                    </label>
                  </div>
                )}
                {destForm.accountType === "external_wallet" && (
                  <p className="mt-2 rounded-xl border border-gray-100 bg-gray-50/70 p-3 text-xs leading-5 text-gray-600">
                    Use this for a self-custody wallet or cold wallet you control.
                  </p>
                )}
              </div>

              {/* Label */}
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">Nickname</span>
                <span className="ml-1.5 text-[10px] text-gray-400">(e.g. "Coinbase USDC")</span>
                <input
                  type="text"
                  value={destForm.label}
                  onChange={(e) => setDestForm((f) => ({ ...f, label: e.target.value.slice(0, 80) }))}
                  placeholder="My Coinbase USDC wallet"
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 outline-none focus:border-[#0052FF] focus:ring-4 focus:ring-blue-100"
                />
              </label>

              {/* Asset / Network */}
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">Asset/network</span>
                <select
                  value={destForm.assetNetwork}
                  onChange={(e) => setDestForm((f) => ({ ...f, assetNetwork: e.target.value }))}
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-800 outline-none focus:border-[#0052FF] focus:ring-4 focus:ring-blue-100"
                >
                  <option value="">Select asset and network…</option>
                  {activeAddressFormOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </label>

              {/* Address */}
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">Wallet Address</span>
                <input
                  type="text"
                  value={destForm.address}
                  onChange={(e) => setDestForm((f) => ({ ...f, address: e.target.value.trim() }))}
                  placeholder={
                    destForm.assetNetwork.includes("base")
                      ? "0x…"
                      : destForm.assetNetwork.includes("solana")
                        ? "Solana public key"
                        : "Destination address"
                  }
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 font-mono text-sm text-gray-800 outline-none focus:border-[#0052FF] focus:ring-4 focus:ring-blue-100"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>

              {/* Memo / Tag */}
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
                  Memo / Tag
                  <span className="ml-1.5 font-normal text-gray-400">(optional)</span>
                </span>
                <input
                  type="text"
                  value={destForm.memoOrTag}
                  onChange={(e) => setDestForm((f) => ({ ...f, memoOrTag: e.target.value.slice(0, 200) }))}
                  placeholder="Required by some exchanges"
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 outline-none focus:border-[#0052FF] focus:ring-4 focus:ring-blue-100"
                />
              </label>

              {/* Warning */}
              <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-3">
                <p className="text-xs leading-5 text-amber-900">
                  Saved addresses make future sends faster. They do not change where customer payments are received.
                </p>
                <p className="mt-1 text-xs leading-5 text-amber-900">
                  PineTree helps you save destinations and prepare transfers. For business funds, use exchange and bank accounts registered to your business whenever possible.
                </p>
              </div>

              {/* Confirmation */}
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
                <input
                  type="checkbox"
                  checked={destForm.confirmed}
                  onChange={(e) => setDestForm((f) => ({ ...f, confirmed: e.target.checked }))}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#0052FF] focus:ring-[#0052FF]"
                />
                <span className="text-sm leading-5 text-gray-700">
                  I confirm this address supports the selected asset and network.
                </span>
              </label>

              {destSaveError && (
                <div className="rounded-xl border border-red-100 bg-red-50/70 p-3 text-sm text-red-800">
                  {destSaveError}
                </div>
              )}

              <div className="sticky bottom-0 -mx-5 -mb-5 flex flex-col-reverse gap-2 border-t border-gray-100 bg-white p-4 sm:mx-0 sm:mb-0 sm:flex-row sm:justify-end sm:border-t-0 sm:p-0">
                <button
                  type="button"
                  onClick={() => { setDestModalOpen(false); setDestSaveError(null) }}
                  className={pineTreeSecondaryActionButton}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveSettlementDestination}
                  disabled={
                    destSaving ||
                    !destForm.label.trim() ||
                    !destForm.exchangeName ||
                    !destForm.assetNetwork ||
                    !destForm.address.trim() ||
                    !destForm.confirmed ||
                    (destForm.accountType === "personal_exchange" && !destForm.personalExchangeAcknowledged)
                  }
                  className={cx(pineTreePrimaryButton, "disabled:cursor-not-allowed disabled:opacity-55")}
                >
                  {destSaving ? "Saving..." : "Save Address"}
                </button>
              </div>
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
                  {sendStep === "form" || sendStep === "failed" ? (
                    <>
                      <div className="rounded-2xl border border-[#0052FF]/15 bg-[#0052FF]/5 p-3">
                        <p className="text-sm font-semibold text-gray-950">Send from this wallet</p>
                        <p className="mt-1 text-sm leading-5 text-gray-600">
                          Choose a saved address or enter one manually.
                        </p>
                      </div>

                      <div className="grid gap-3">
                        <label className="block">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">Asset</span>
                          <select
                            value={sendAsset ? `${sendAsset.asset}|${sendAsset.network}` : ""}
                            onChange={(e) => {
                              const option = sendAssetOptions.find((item) => `${item.asset}|${item.network}` === e.target.value) || null
                              setSendAsset(option)
                              setSendSavedDestinationId("")
                              setSendError(null)
                            }}
                            className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none focus:border-[#0052FF] focus:ring-4 focus:ring-blue-100"
                          >
                            {sendAssetOptions.map((option) => (
                              <option key={`${option.asset}|${option.network}`} value={`${option.asset}|${option.network}`}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">Destination mode</span>
                          <select
                            value={sendDestinationMode}
                            onChange={(e) => {
                              setSendDestinationMode(e.target.value as SendDestinationMode)
                              setSendError(null)
                            }}
                            className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none focus:border-[#0052FF] focus:ring-4 focus:ring-blue-100"
                          >
                            <option value="saved">Use saved destination</option>
                            <option value="manual">Enter address manually</option>
                          </select>
                        </label>
                        {sendDestinationMode === "saved" ? (
                          <label className="block">
                            <span className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">Saved address</span>
                            <select
                              value={sendSavedDestinationId}
                              onChange={(e) => { setSendSavedDestinationId(e.target.value); setSendError(null) }}
                              className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none focus:border-[#0052FF] focus:ring-4 focus:ring-blue-100"
                            >
                              <option value="">
                                {sendSavedDestinations.length ? "Choose saved address..." : "No saved address for this asset"}
                              </option>
                              {sendSavedDestinations.map((dest) => (
                                <option key={dest.id} value={dest.id}>
                                  {dest.label} - {getDestinationAccountTypeLabel(dest.account_type)} - {formatSettlementAddress(dest.address)}
                                </option>
                              ))}
                            </select>
                            {selectedSendDestination && (
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-700">
                                  {getDestinationAccountTypeLabel(selectedSendDestination.account_type)}
                                </span>
                                {selectedSendDestination.account_type === "personal_exchange" && (
                                  <span className="text-xs font-semibold text-amber-700">
                                    Personal account selected. Business exchange accounts are recommended for business funds.
                                  </span>
                                )}
                              </div>
                            )}
                            {!selectedSendDestination && sendSavedDestinations.length === 0 && sendAsset && (
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span className="text-xs text-gray-500">No saved address for this asset yet.</span>
                                <button
                                  type="button"
                                  onClick={() => openAddSavedAddress(`${sendAsset.asset}|${sendAsset.network}`)}
                                  className="text-xs font-semibold text-[#0052FF] hover:underline"
                                >
                                  Add Address
                                </button>
                              </div>
                            )}
                          </label>
                        ) : (
                          <label className="block">
                            <span className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">Destination address</span>
                            <input
                              type="text"
                              value={sendDestination}
                              onChange={(e) => { setSendDestination(e.target.value); setSendError(null) }}
                              placeholder={selectedWallet.rail === "base" ? "0x..." : "Solana address"}
                              className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 font-mono text-sm text-gray-900 outline-none focus:border-[#0052FF] focus:ring-4 focus:ring-blue-100"
                            />
                          </label>
                        )}
                        <label className="block">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">Amount</span>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={sendAmount}
                            onChange={(e) => { setSendAmount(e.target.value); setSendError(null) }}
                            placeholder="0.00"
                            className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none focus:border-[#0052FF] focus:ring-4 focus:ring-blue-100"
                          />
                        </label>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        <CompactStatusRow
                          label="Available"
                          value={sendAsset?.asset === "USDC"
                            ? (usdcBalanceLoading ? "Loading..." : usdcBalance !== null ? `${usdcBalance.toFixed(2)} USDC` : "USDC unavailable")
                            : `${Number(selectedWallet.nativeBalance ?? 0).toFixed(Math.min(selectedWallet.decimals, 6))} ${selectedWallet.assetSymbol}`}
                        />
                        <CompactStatusRow label="Network" value={sendAsset?.network === "base" ? "Base" : "Solana"} />
                      </div>

                      {sendError && (
                        <div className="rounded-2xl border border-red-100 bg-red-50/70 p-3 text-sm leading-6 text-red-700">
                          {sendError}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setActiveTab("overview")}
                          className={pineTreeSecondaryActionButton}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => setSendStep("review")}
                          disabled={!sendAsset || !activeSendDestinationAddress.trim() || !sendAmount.trim() || Number(sendAmount) <= 0}
                          className={cx(pineTreePrimaryButton, "disabled:cursor-not-allowed disabled:opacity-55")}
                        >
                          Review Send
                        </button>
                      </div>
                    </>
                  ) : null}

                  {sendStep === "review" && sendAsset && (
                    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                      <p className="text-sm font-semibold text-gray-950">Review Send</p>
                      <div className="mt-3 grid gap-2">
                        <CompactStatusRow label="Asset" value={sendAsset.asset} />
                        <CompactStatusRow label="Network" value={networkDisplayLabel(sendAsset.network)} />
                        <CompactStatusRow label="Amount" value={`${sendAmount} ${sendAsset.asset}`} />
                        {selectedSendDestination && <CompactStatusRow label="Destination nickname" value={selectedSendDestination.label} />}
                        <CompactStatusRow label="Destination address" value={formatSettlementAddress(activeSendDestinationAddress)} />
                        <CompactStatusRow label="Estimated fee" value="wallet will estimate" />
                      </div>
                      <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs leading-5 text-amber-800">
                        Only send to an address on the selected network. Your wallet will prompt you to approve before funds move.
                      </p>
                      {sendError && (
                        <p className="mt-3 rounded-xl border border-red-100 bg-red-50/70 p-3 text-sm leading-6 text-red-700">
                          {sendError}
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" onClick={() => setSendStep("form")} className={pineTreeSecondaryActionButton}>
                          Cancel
                        </button>
                        <button type="button" onClick={prepareDirectSend} className={pineTreePrimaryButton}>
                          Continue to Approval
                        </button>
                      </div>
                    </div>
                  )}

                  {sendStep === "preparing" && (
                    <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4 text-sm text-gray-600">
                      Preparing wallet transaction...
                    </div>
                  )}

                  {sendStep === "prepared" && sendRecord && (
                    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                      {/* Transaction summary */}
                      <p className="text-sm font-semibold text-gray-950">Approve from your wallet</p>
                      <p className="mt-1 text-xs leading-5 text-gray-500">
                        Use the phone or device that holds this wallet to approve the transfer.
                      </p>
                      <div className="mt-3 grid gap-2">
                        <CompactStatusRow label="Asset" value={sendRecord.transfer.asset} />
                        <CompactStatusRow label="Network" value={networkDisplayLabel(sendRecord.transfer.network)} />
                        <CompactStatusRow label="Amount" value={`${sendRecord.transfer.amount} ${sendRecord.transfer.asset}`} />
                        {selectedSendDestination && <CompactStatusRow label="Destination" value={selectedSendDestination.label} />}
                        <CompactStatusRow label="Address" value={formatSettlementAddress(sendRecord.transfer.destination_address)} />
                        <CompactStatusRow label="Fee" value={sendRecord.transfer.estimated_fee_label} />
                      </div>

                      {/* Approval options */}
                      <div className="mt-4 space-y-2">
                        {/* Option 1: Scan with phone — deferred */}
                        <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-600">Scan with phone</p>
                              <p className="mt-0.5 text-xs leading-5 text-gray-400">
                                Mobile approval QR is not yet configured for merchant sends.
                              </p>
                            </div>
                            <span className="shrink-0 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-400">
                              Coming soon
                            </span>
                          </div>
                        </div>

                        {/* Option 2: Open mobile wallet — deferred */}
                        <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-600">Open mobile wallet</p>
                              <p className="mt-0.5 text-xs leading-5 text-gray-400">
                                {sendRecord.transfer.network === "solana"
                                  ? "Phantom and Solflare mobile approval is not yet configured for sends."
                                  : "Base Wallet, MetaMask, and Trust Wallet mobile approval is not yet configured for sends."}
                              </p>
                            </div>
                            <span className="shrink-0 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-400">
                              Coming soon
                            </span>
                          </div>
                        </div>

                        {/* Option 3: Approve on this device — working fallback */}
                        <div className="rounded-xl border border-[#0052FF]/15 bg-[#0052FF]/5 p-3">
                          <p className="text-sm font-semibold text-gray-950">Approve on this device</p>
                          <p className="mt-0.5 text-xs leading-5 text-gray-600">
                            {sendRecord.transfer.network === "solana"
                              ? "If Phantom or Solflare is installed and unlocked on this device, you can approve here."
                              : "If MetaMask or Base Wallet is installed and unlocked on this device, you can approve here."}
                          </p>
                        </div>
                      </div>

                      {sendError && (
                        <p className="mt-3 rounded-xl border border-red-100 bg-red-50/70 p-3 text-sm leading-6 text-red-700">
                          {sendError}
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" onClick={() => setSendStep("review")} className={pineTreeSecondaryActionButton}>
                          Back
                        </button>
                        <button type="button" onClick={signAndSubmitDirectSend} className={pineTreePrimaryButton}>
                          Confirm in Wallet
                        </button>
                      </div>
                    </div>
                  )}

                  {sendStep === "signing" && (
                    <div className="rounded-2xl border border-[#0052FF]/15 bg-[#0052FF]/5 p-4 text-sm font-semibold text-[#0052FF]">
                      Waiting for wallet approval...
                    </div>
                  )}

                  {sendStep === "submitted" && sendRecord && (
                    <div className="rounded-2xl border border-[#0052FF]/15 bg-[#0052FF]/5 p-4">
                      <p className="text-sm font-semibold text-gray-950">Send Submitted</p>
                      <div className="mt-3 grid gap-2">
                        <CompactStatusRow label="Amount" value={`${sendRecord.transfer.amount} ${sendRecord.transfer.asset}`} />
                        <CompactStatusRow label="Destination" value={formatSettlementAddress(sendRecord.transfer.destination_address)} />
                        {sendTxHash && <CompactStatusRow label="Transaction" value={formatSettlementAddress(sendTxHash)} />}
                      </div>
                      {sendTxHash && getExplorerTxUrl(sendRecord.transfer.network, sendTxHash) && (
                        <a
                          href={getExplorerTxUrl(sendRecord.transfer.network, sendTxHash) || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cx(pineTreeSecondaryActionButton, "mt-3")}
                        >
                          View on Explorer
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => setActiveTab("activity")}
                        className={cx(pineTreeSecondaryActionButton, "mt-3 ml-2")}
                      >
                        View in Activity
                      </button>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "settlement" && (
                <div className={walletDetailPanelClass}>
                  {!selectedWallet.isLightning && !withdrawReview ? (
                    <div className="rounded-2xl border border-gray-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-950">Saved Addresses</p>
                          <p className="mt-0.5 text-xs text-gray-500">Save exchange or wallet addresses you use often.</p>
                        </div>
                        <NetworkStatusPill label="Address Book" tone="blue" className="shrink-0" />
                      </div>

                      <div className="p-4">
                        {destLoadError && (
                          <div className="mb-3 rounded-xl border border-red-100 bg-red-50/70 p-3 text-sm text-red-800">
                            {destLoadError}
                          </div>
                        )}

                        {destLoading ? (
                          <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-4 py-5 text-center text-sm text-gray-500">
                            Loading addresses...
                          </div>
                        ) : savedDestinationsForWallet.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 px-4 py-5 text-center">
                            <p className="text-sm font-semibold text-gray-700">No saved addresses</p>
                            <p className="mt-1 text-xs leading-5 text-gray-500">Add an address to make future sends faster.</p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {savedDestinationsForWallet.map((dest) => (
                              <div key={dest.id} className="rounded-2xl border border-gray-100 bg-white p-3.5 shadow-sm transition hover:border-[#0052FF]/20">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <p className="min-w-0 truncate text-sm font-semibold text-gray-950">{dest.label}</p>
                                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                      <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                                        {getDestinationAccountTypeLabel(dest.account_type)}
                                      </span>
                                      <span className={cx(
                                        "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                                        dest.source === "mesh" || dest.connected_provider === "mesh"
                                          ? "border-[#0052FF]/25 bg-[#0052FF]/10 text-[#0052FF]"
                                          : "border-gray-200 bg-gray-50 text-gray-500"
                                      )}>
                                        {dest.source === "mesh" || dest.connected_provider === "mesh" ? "Mesh Connected" : "Manual"}
                                      </span>
                                      {dest.institution_name && (
                                        <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                                          {dest.institution_name}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <span className="shrink-0 rounded-xl border border-[#0052FF]/15 bg-[#0052FF]/5 px-2.5 py-1 text-[11px] font-semibold text-[#0052FF]">
                                    {assetNetworkDisplayLabel(dest.asset, dest.network)}
                                  </span>
                                </div>
                                <p className="mt-2 truncate font-mono text-xs text-gray-400" title={dest.address}>
                                  {formatSettlementAddress(dest.address)}
                                </p>
                                {dest.memo_or_tag && (
                                  <p className="mt-0.5 text-[10px] text-gray-400">Memo: {dest.memo_or_tag}</p>
                                )}

                                {destDeleteConfirmId === dest.id ? (
                                  <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <p className="text-xs font-semibold text-gray-700">Delete this address?</p>
                                    <button type="button" onClick={() => setDestDeleteConfirmId(null)} disabled={destDeleting} className={pineTreeSecondaryActionButton}>
                                      Cancel
                                    </button>
                                    <button type="button" onClick={() => deleteSettlementDestination(dest.id)} disabled={destDeleting} className={pineTreeDangerActionButton}>
                                      {destDeleting ? "Deleting..." : "Delete"}
                                    </button>
                                  </div>
                                ) : (
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setDestForm({
                                          id: dest.id,
                                          label: dest.label,
                                          exchangeName: dest.exchange_name,
                                          assetNetwork: destAssetNetworkValue(dest),
                                          address: dest.address,
                                          memoOrTag: dest.memo_or_tag || "",
                                          isDefault: false,
                                          confirmed: true,
                                          accountType: dest.account_type || "other",
                                          personalExchangeAcknowledged: dest.account_type === "personal_exchange"
                                        })
                                        setDestSaveError(null)
                                        setDestModalOpen(true)
                                      }}
                                      className={pineTreeSecondaryActionButton}
                                    >
                                      Edit
                                    </button>
                                    <button type="button" onClick={() => setDestDeleteConfirmId(dest.id)} className={pineTreeDangerActionButton}>
                                      Delete
                                    </button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                          <button type="button" onClick={() => openAddSavedAddress()} className={pineTreePrimaryButton}>
                            Add Address
                          </button>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={MESH_CONNECT_ENABLED ? connectExchange : undefined}
                              disabled={!MESH_CONNECT_ENABLED || meshLinking}
                              title={MESH_CONNECT_ENABLED
                                ? "Connect an exchange to import deposit addresses automatically."
                                : "Set MESH_CLIENT_ID, MESH_CLIENT_SECRET, and NEXT_PUBLIC_MESH_CONNECT_ENABLED=true to enable."}
                              className={cx(pineTreeSecondaryActionButton, "disabled:cursor-not-allowed disabled:opacity-55")}
                            >
                              {meshLinking ? "Connecting..." : "Connect Exchange"}
                            </button>
                            {!MESH_CONNECT_ENABLED && (
                              <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                                Not configured
                              </span>
                            )}
                          </div>
                        </div>
                        {meshLinkError && (
                          <p className="mt-2 text-xs font-semibold text-red-700">{meshLinkError}</p>
                        )}
                        {MESH_CONNECT_ENABLED && meshImportStep === "connected" && meshConnection && (
                          <div className="mt-4 rounded-2xl border border-[#0052FF]/15 bg-[#0052FF]/5 p-4">
                            <p className="text-sm font-semibold text-gray-950">Import Exchange Addresses</p>
                            {meshConnection.institutionName && (
                              <p className="mt-0.5 text-xs text-gray-500">Connected to {meshConnection.institutionName}</p>
                            )}
                            <div className="mt-3 space-y-2">
                              {getMeshImportOptions(selectedWallet?.rail || "").map((opt) => {
                                const key = `${opt.asset}|${opt.network}`
                                return (
                                  <label key={key} className="flex cursor-pointer items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={meshImportAssets.includes(key)}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setMeshImportAssets((prev) => [...prev, key])
                                        } else {
                                          setMeshImportAssets((prev) => prev.filter((k) => k !== key))
                                        }
                                      }}
                                      className="h-4 w-4 rounded border-gray-300"
                                    />
                                    <span className="text-sm font-semibold text-gray-800">{opt.label}</span>
                                  </label>
                                )
                              })}
                            </div>
                            {meshImportError && (
                              <p className="mt-3 text-xs font-semibold text-red-700">{meshImportError}</p>
                            )}
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={importMeshAddresses}
                                disabled={meshImporting || meshImportAssets.length === 0}
                                className={cx(pineTreePrimaryButton, "disabled:cursor-not-allowed disabled:opacity-55")}
                              >
                                {meshImporting ? "Importing..." : "Import Selected"}
                              </button>
                              <button
                                type="button"
                                onClick={() => { setMeshImportStep("idle"); setMeshConnection(null); setMeshImportError(null) }}
                                disabled={meshImporting}
                                className={pineTreeSecondaryActionButton}
                              >
                                Cancel
                              </button>
                            </div>
                            <p className="mt-3 text-xs leading-5 text-gray-500">
                              Mesh imports exchange deposit addresses. PineTree Send still prepares transfers for wallet approval.
                            </p>
                          </div>
                        )}
                        {MESH_CONNECT_ENABLED && meshImportStep === "done" && meshImportResult && (
                          <div className="mt-4 rounded-2xl border border-[#0052FF]/15 bg-[#0052FF]/5 p-4">
                            <p className="text-sm font-semibold text-gray-950">Import Complete</p>
                            <p className="mt-1 text-sm leading-6 text-gray-600">
                              {meshImportResult.imported > 0 && `${meshImportResult.imported} address${meshImportResult.imported === 1 ? "" : "es"} imported. `}
                              {meshImportResult.updated > 0 && `${meshImportResult.updated} verified. `}
                              {meshImportResult.imported === 0 && meshImportResult.updated === 0 && "No new addresses found."}
                            </p>
                            <button
                              type="button"
                              onClick={() => { setMeshImportStep("idle"); setMeshConnection(null); setMeshImportResult(null) }}
                              className={cx(pineTreeSecondaryActionButton, "mt-3")}
                            >
                              Done
                            </button>
                          </div>
                        )}
                        <p className="mt-3 text-xs leading-5 text-gray-500">
                          {MESH_CONNECT_ENABLED
                            ? "Connect an exchange to import deposit addresses. Saved addresses do not change where customer payments are received."
                            : "Mesh integration will let merchants import exchange deposit addresses automatically."}
                        </p>
                      </div>
                    </div>
                  ) : selectedWallet.isLightning ? (
                    <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                      <p className="text-sm font-semibold text-gray-950">Lightning Wallet</p>
                      <p className="mt-1 text-sm leading-6 text-gray-600">
                        Direct Lightning wallets receive Bitcoin instantly. Settlement is managed separately outside PineTree.
                      </p>
                    </div>
                  ) : withdrawReview ? (
                    /* ── Withdrawal flow ────────────────────────────────────────── */
                    <div className="space-y-4">
                      {/* Back button — only show when not submitted */}
                      {withdrawStep !== "submitted" && (
                        <button
                          type="button"
                          onClick={() => {
                            setWithdrawReview(null)
                            setWithdrawStep("review")
                            setWithdrawAmount("")
                            setWithdrawRecord(null)
                            setWithdrawError(null)
                            setWithdrawTxHash(null)
                          }}
                          className="flex items-center gap-1.5 text-sm font-semibold text-[#0052FF] hover:underline focus:outline-none"
                        >
                          ← Back to Destinations
                        </button>
                      )}

                      {/* Step indicator */}
                      <div className="flex items-center gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {(["Review", "Prepare", "Confirm", "Done"] as const).map((label, i) => {
                          const stepActive =
                            (i === 0 && (withdrawStep === "review" || withdrawStep === "failed")) ||
                            (i === 1 && (withdrawStep === "preparing" || withdrawStep === "prepared")) ||
                            (i === 2 && withdrawStep === "signing") ||
                            (i === 3 && withdrawStep === "submitted")
                          const stepDone =
                            (i === 0 && withdrawStep !== "review" && withdrawStep !== "failed") ||
                            (i === 1 && (withdrawStep === "signing" || withdrawStep === "submitted")) ||
                            (i === 2 && withdrawStep === "submitted")
                          return (
                            <div key={label} className="flex shrink-0 items-center gap-1">
                              {i > 0 && <div className="h-px w-3 shrink-0 bg-gray-200" />}
                              <span className={cx(
                                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                                stepActive ? "bg-[#0052FF] text-white"
                                  : stepDone ? "bg-[#0052FF]/20 text-[#0052FF]"
                                    : "bg-gray-100 text-gray-400"
                              )}>
                                {stepDone ? "✓" : String(i + 1)}
                              </span>
                              <span className={cx(
                                "text-[11px] font-semibold",
                                stepActive ? "text-gray-950"
                                  : stepDone ? "text-[#0052FF]"
                                    : "text-gray-400"
                              )}>
                                {label}
                              </span>
                            </div>
                          )
                        })}
                      </div>

                      {/* ── Step: review + enter amount ── */}
                      {(withdrawStep === "review" || withdrawStep === "failed") && (
                        <>
                          <div className="rounded-2xl border border-[#0052FF]/15 bg-[#0052FF]/5 p-4 shadow-[0_8px_24px_rgba(0,82,255,0.06)]">
                            <p className="text-base font-semibold text-gray-950">Withdraw to Exchange</p>
                            <p className="mt-1 text-sm leading-6 text-gray-700">
                              Your wallet will prompt you to approve this transaction. PineTree does not move funds — you sign and broadcast directly.
                            </p>
                          </div>

                          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                            <div className="space-y-3">
                              <CompactStatusRow label="Destination"    value={withdrawReview.label} />
                              <CompactStatusRow label="Exchange"       value={withdrawReview.exchange_name} />
                              <CompactStatusRow label="Asset / Network" value={`${withdrawReview.asset} on ${networkDisplayLabel(withdrawReview.network)}`} />
                              <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50/70 px-3.5 py-3">
                                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400">Address</span>
                                <div className="flex min-w-0 items-center gap-2">
                                  <span className="min-w-0 truncate font-mono text-sm font-semibold text-gray-800" title={withdrawReview.address}>
                                    {formatSettlementAddress(withdrawReview.address)}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => copyToClipboard(withdrawReview.address)}
                                    className="shrink-0 inline-flex items-center rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-600 shadow-sm transition hover:border-gray-300 hover:bg-gray-50"
                                  >
                                    {copiedRef ? "Copied" : "Copy"}
                                  </button>
                                </div>
                              </div>
                              {withdrawReview.memo_or_tag && (
                                <CompactStatusRow label="Memo / Tag" value={withdrawReview.memo_or_tag} />
                              )}
                            </div>
                          </div>

                          {/* Wallet balance info — balance-aware */}
                          {(withdrawReview.network === selectedWallet?.rail) && (() => {
                            const isNativeAsset = withdrawReview.asset === selectedWallet.assetSymbol
                            const isUsdc = withdrawReview.asset === "USDC"
                            const nativeBal = Number(selectedWallet.nativeBalance ?? 0)
                            const withdrawAmt = Number(withdrawAmount) || 0
                            const nativeExceeds = isNativeAsset && withdrawAmt > nativeBal && nativeBal > 0
                            const usdcExceeds = isUsdc && usdcBalance !== null && withdrawAmt > usdcBalance && usdcBalance >= 0
                            return (
                              <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-4 py-3">
                                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400">
                                  Available balance
                                </p>
                                <div className="mt-1 space-y-0.5">
                                  {isNativeAsset && (
                                    <p className="text-sm font-semibold text-gray-800">
                                      {nativeBal.toFixed(selectedWallet.decimals)} {selectedWallet.assetSymbol}
                                    </p>
                                  )}
                                  {isUsdc && (
                                    <p className="text-sm font-semibold text-gray-800">
                                      {usdcBalanceLoading
                                        ? "USDC: loading…"
                                        : usdcBalance !== null
                                          ? `${usdcBalance.toFixed(2)} USDC`
                                          : usdcBalanceError
                                            ? "USDC balance unavailable"
                                            : "USDC: — (tap Refresh in summary)"}
                                    </p>
                                  )}
                                  {!isNativeAsset && !isUsdc && (
                                    <p className="text-sm text-gray-600">
                                      Verify in your wallet before withdrawing.
                                    </p>
                                  )}
                                </div>
                                {nativeExceeds && (
                                  <p className="mt-2 text-xs font-semibold text-amber-700">
                                    Amount exceeds detected balance. Reduce the amount or refresh balance.
                                  </p>
                                )}
                                {usdcExceeds && (
                                  <p className="mt-2 text-xs font-semibold text-amber-700">
                                    Amount exceeds detected USDC balance. Reduce the amount or refresh.
                                  </p>
                                )}
                                {isUsdc && usdcBalance === null && !usdcBalanceLoading && !usdcBalanceError && (
                                  <p className="mt-1 text-[10px] text-gray-400">
                                    Balance will be verified by your wallet and network during signing.
                                  </p>
                                )}
                                {isUsdc && usdcBalanceError && (
                                  <p className="mt-1 text-[10px] text-gray-400">
                                    Balance will be verified by your wallet and network during signing.
                                  </p>
                                )}
                              </div>
                            )
                          })()}

                          {/* Amount input */}
                          <label className="block">
                            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
                              Amount ({withdrawReview.asset})
                            </span>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={withdrawAmount}
                              onChange={(e) => {
                                setWithdrawAmount(e.target.value)
                                setWithdrawError(null)
                              }}
                              placeholder="0.00"
                              className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-800 outline-none focus:border-[#0052FF] focus:ring-4 focus:ring-blue-100"
                            />
                          </label>

                          {/* Safety warnings */}
                          <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-3.5">
                            <p className="text-xs font-semibold text-amber-900">Before confirming</p>
                            <ul className="mt-1.5 list-disc list-inside space-y-0.5 text-xs leading-5 text-amber-800">
                              <li>PineTree cannot reverse transfers sent to the wrong network or address.</li>
                              <li>Confirm your exchange deposit address supports this exact asset and network.</li>
                              <li>PineTree does not control your exchange account or bank withdrawal process.</li>
                            </ul>
                          </div>

                          {/* Network mismatch warning */}
                          {withdrawReview.network !== selectedWallet?.rail && (
                            <div className="rounded-xl border border-red-100 bg-red-50/70 p-3.5 text-sm text-red-800">
                              Network mismatch: this destination is for <strong>{networkDisplayLabel(withdrawReview.network)}</strong> but your connected wallet is on <strong>{networkDisplayLabel(selectedWallet?.rail ?? "")}</strong>. Please select a matching destination or connect the correct wallet.
                            </div>
                          )}

                          {withdrawError && (
                            <div className="rounded-xl border border-red-100 bg-red-50/70 p-3.5 text-sm text-red-800">
                              {withdrawError}
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={prepareWithdrawal}
                            disabled={
                              !withdrawAmount.trim() ||
                              Number(withdrawAmount) <= 0 ||
                              withdrawReview.network !== selectedWallet?.rail
                            }
                            className={cx(pineTreePrimaryButton, "w-full disabled:cursor-not-allowed disabled:opacity-55")}
                          >
                            Prepare Withdrawal
                          </button>
                        </>
                      )}

                      {/* ── Step: preparing (loading) ── */}
                      {withdrawStep === "preparing" && (
                        <div className="rounded-2xl border border-gray-100 bg-gray-50/70 px-4 py-8 text-center">
                          <p className="text-sm font-semibold text-gray-700">Validating and preparing transaction…</p>
                          <p className="mt-1 text-xs text-gray-500">Building unsigned transaction for your wallet to sign.</p>
                        </div>
                      )}

                      {/* ── Step: prepared — ready to sign ── */}
                      {withdrawStep === "prepared" && withdrawRecord && (
                        <>
                          <div className="rounded-2xl border border-[#0052FF]/15 bg-[#0052FF]/5 p-4">
                            <p className="text-base font-semibold text-gray-950">Transaction Prepared</p>
                            <p className="mt-1 text-sm leading-6 text-gray-700">
                              The transaction has been validated and prepared. Click Confirm in Wallet — your wallet extension will open and ask you to approve.
                            </p>
                          </div>

                          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                            <div className="space-y-3">
                              <CompactStatusRow label="Destination"    value={withdrawReview.label} />
                              <CompactStatusRow label="Asset / Network" value={`${withdrawRecord.withdrawal.asset} on ${networkDisplayLabel(withdrawRecord.withdrawal.network)}`} />
                              <CompactStatusRow label="Amount"         value={`${withdrawRecord.withdrawal.amount} ${withdrawRecord.withdrawal.asset}`} />
                              <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50/70 px-3.5 py-3">
                                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400">To Address</span>
                                <span className="min-w-0 truncate font-mono text-sm font-semibold text-gray-800" title={withdrawRecord.withdrawal.destination_address}>
                                  {formatSettlementAddress(withdrawRecord.withdrawal.destination_address)}
                                </span>
                              </div>
                              {withdrawRecord.withdrawal.memo_or_tag && (
                                <CompactStatusRow label="Memo / Tag" value={withdrawRecord.withdrawal.memo_or_tag} />
                              )}
                            </div>
                          </div>

                          <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-3.5 text-xs leading-5 text-gray-600">
                            Your wallet will open and ask you to approve this transaction. PineTree does not have access to your wallet keys — you control the approval.
                          </div>

                          {withdrawError && (
                            <div className="rounded-xl border border-red-100 bg-red-50/70 p-3.5 text-sm text-red-800">
                              {withdrawError}
                            </div>
                          )}

                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setWithdrawStep("review")
                                setWithdrawError(null)
                              }}
                              className={pineTreeSecondaryActionButton}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={signAndSubmitWithdrawal}
                              className={cx(pineTreePrimaryButton, "flex-1")}
                            >
                              Confirm in Wallet
                            </button>
                          </div>
                        </>
                      )}

                      {/* ── Step: signing (waiting for wallet) ── */}
                      {withdrawStep === "signing" && (
                        <div className="rounded-2xl border border-[#0052FF]/15 bg-[#0052FF]/5 px-4 py-8 text-center">
                          <p className="text-sm font-semibold text-gray-950">Waiting for wallet approval…</p>
                          <p className="mt-1 text-xs text-gray-600">
                            Your wallet extension should have opened. Approve the transaction to proceed.
                          </p>
                        </div>
                      )}

                      {/* ── Step: submitted ── */}
                      {withdrawStep === "submitted" && withdrawRecord && (
                        <>
                          <div className="rounded-2xl border border-[#0052FF]/15 bg-[#0052FF]/5 p-4">
                            <p className="text-base font-semibold text-gray-950">Withdrawal Submitted</p>
                            <p className="mt-1 text-sm leading-6 text-gray-700">
                              Your transaction was signed and broadcast. It may take a few moments to appear on-chain.
                            </p>
                          </div>

                          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                            <div className="space-y-3">
                              <CompactStatusRow label="Destination"    value={withdrawRecord.withdrawal.destination_label} />
                              <CompactStatusRow label="Asset / Network" value={`${withdrawRecord.withdrawal.asset} on ${networkDisplayLabel(withdrawRecord.withdrawal.network)}`} />
                              <CompactStatusRow label="Amount"         value={`${withdrawRecord.withdrawal.amount} ${withdrawRecord.withdrawal.asset}`} />
                              <CompactStatusRow label="Status"         value="Submitted" />
                            </div>
                            {withdrawTxHash && (
                              <div className="mt-4">
                                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400">Transaction Hash</p>
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                  <span className="min-w-0 truncate font-mono text-xs text-gray-700" title={withdrawTxHash}>
                                    {formatSettlementAddress(withdrawTxHash)}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => copyToClipboard(withdrawTxHash)}
                                    className="shrink-0 inline-flex items-center rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-600 shadow-sm transition hover:border-gray-300 hover:bg-gray-50"
                                  >
                                    {copiedRef ? "Copied" : "Copy"}
                                  </button>
                                  {getExplorerTxUrl(withdrawRecord.withdrawal.network, withdrawTxHash) && (
                                    <a
                                      href={getExplorerTxUrl(withdrawRecord.withdrawal.network, withdrawTxHash)!}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="shrink-0 inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 shadow-sm transition hover:bg-blue-100"
                                    >
                                      View on Explorer
                                    </a>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-3.5 text-xs leading-5 text-gray-600">
                            Confirmation happens on-chain. PineTree will not mark this confirmed automatically — check the explorer link above to verify receipt.
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setWithdrawReview(null)
                              setWithdrawStep("review")
                              setWithdrawAmount("")
                              setWithdrawRecord(null)
                              setWithdrawError(null)
                              setWithdrawTxHash(null)
                            }}
                            className={pineTreeSecondaryActionButton}
                          >
                            Back to Destinations
                          </button>
                        </>
                      )}
                    </div>
                  ) : (
                    /* ── Main settlement tab ── */
                    <>
                      {/* ── Address Book Summary ── */}
                      <div className="hidden">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#0052FF]">Address Book Summary</p>
                        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {/* Balance tile */}
                          <div className="rounded-xl border border-white/70 bg-white/60 p-3">
                            <div className="flex items-center justify-between gap-1">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Balance</p>
                              {(selectedWallet?.rail === "base" || selectedWallet?.rail === "solana") && (
                                <button type="button" onClick={refreshSettlementBalances} disabled={usdcBalanceLoading}
                                  className="text-[10px] font-semibold text-[#0052FF] hover:underline disabled:opacity-40 focus:outline-none">
                                  {usdcBalanceLoading ? "…" : "Refresh"}
                                </button>
                              )}
                            </div>
                            <p className="mt-1 truncate text-sm font-semibold text-gray-950" title={`${Number(selectedWallet?.nativeBalance ?? 0)} ${selectedWallet?.assetSymbol}`}>
                              {Number(selectedWallet?.nativeBalance ?? 0).toFixed(Math.min(selectedWallet?.decimals ?? 6, 6))} {selectedWallet?.assetSymbol}
                            </p>
                            {(selectedWallet?.rail === "base" || selectedWallet?.rail === "solana") && (
                              <p className={cx("mt-0.5 text-[10px]", usdcBalanceError ? "text-amber-600" : "text-gray-400")}>
                                {usdcBalanceLoading ? "USDC: loading…"
                                  : usdcBalanceError ? "USDC: unavailable"
                                  : usdcBalance !== null ? `USDC: ${usdcBalance.toFixed(2)}`
                                  : "USDC: —"}
                              </p>
                            )}
                            {usdcBalanceRefreshedAt && !usdcBalanceLoading && (
                              <p className="mt-0.5 text-[9px] text-gray-300" title={usdcBalanceRefreshedAt}>
                                refreshed {new Date(usdcBalanceRefreshedAt).toLocaleTimeString()}
                              </p>
                            )}
                          </div>
                          {/* Saved destination tile */}
                          <div className="rounded-xl border border-white/70 bg-white/60 p-3">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Saved address</p>
                            <p className="mt-1 truncate text-sm font-semibold text-gray-950">
                              {settlementSummary.preferredForNative?.label ?? "Not set"}
                            </p>
                            <p className="mt-0.5 truncate text-[10px] text-gray-400">
                              {settlementSummary.preferredForNative
                                ? `${settlementSummary.preferredForNative.exchange_name} · ${settlementSummary.walletAsset}`
                                : `For ${settlementSummary.walletAsset} on ${settlementSummary.walletRail || "—"}`}
                            </p>
                          </div>
                          {/* Pending tile */}
                          <div className="rounded-xl border border-white/70 bg-white/60 p-3">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Pending</p>
                            <p className={cx("mt-1 text-sm font-semibold", settlementSummary.pendingCount > 0 ? "text-amber-700" : "text-gray-950")}>
                              {settlementSummary.pendingCount}
                            </p>
                            <p className="mt-0.5 text-[10px] text-gray-400">
                              {settlementSummary.pendingCount > 0 ? "Need attention" : "None"}
                            </p>
                          </div>
                          {/* This month tile */}
                          <div className="rounded-xl border border-white/70 bg-white/60 p-3">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">This month</p>
                            <p className="mt-1 text-sm font-semibold text-gray-950">
                              {settlementSummary.thisMonthCount > 0 ? `${settlementSummary.thisMonthCount} sent` : "—"}
                            </p>
                            <p className="mt-0.5 truncate text-[10px] text-gray-400">
                              {settlementSummary.monthlyTotal > 0 ? `≈ ${settlementSummary.monthlyTotal.toFixed(4)}` : "No activity"}
                            </p>
                          </div>
                        </div>

                        {/* Send shortcut button */}
                        {!moveMoneyOpen && (settlementSummary.walletRail === "base" || settlementSummary.walletRail === "solana") && (
                          <button
                            type="button"
                            onClick={() => setMoveMoneyOpen(true)}
                            className={cx(pineTreePrimaryButton, "mt-4")}
                          >
                            Send Shortcut →
                          </button>
                        )}
                        {moveMoneyOpen && (
                          <button
                            type="button"
                            onClick={() => setMoveMoneyOpen(false)}
                            className={cx(pineTreeSecondaryActionButton, "mt-4")}
                          >
                            Close Shortcut
                          </button>
                        )}
                      </div>

                      {/* ── Send Shortcut Panel ── */}
                      {false && moveMoneyOpen && !withdrawReview && (
                        <div className="rounded-2xl border border-gray-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                          <div className="border-b border-gray-100 px-4 py-3">
                            <p className="text-sm font-semibold text-gray-950">Send Shortcut</p>
                            <p className="mt-0.5 text-xs leading-5 text-gray-500">Move funds to your exchange account.</p>
                          </div>

                          <div className="divide-y divide-gray-100">
                            {/* ── Native asset card ── */}
                            <div className="p-4">
                              <p className="text-sm font-semibold text-gray-950">
                                {settlementSummary.walletAsset} on {settlementSummary.walletRail}
                              </p>
                              <div className="mt-2 space-y-0.5 text-xs text-gray-600">
                                <p>Available: <span className="font-semibold">{Number(selectedWallet?.nativeBalance ?? 0).toFixed(Math.min(selectedWallet?.decimals ?? 6, 6))} {settlementSummary.walletAsset}</span></p>
                                <p className="text-gray-400">Gas/fee reserve: {settlementSummary.nativeReserve} {settlementSummary.walletAsset}</p>
                                <p>Withdraw All amount: <span className="font-semibold">{settlementSummary.nativeWithdrawAll.toFixed(Math.min(selectedWallet?.decimals ?? 6, 6))} {settlementSummary.walletAsset}</span></p>
                              </div>
                              <p className="mt-2 text-xs text-gray-500">
                                {settlementSummary.preferredForNative
                                  ? `→ ${settlementSummary.preferredForNative?.label ?? ""} · ${settlementSummary.preferredForNative?.exchange_name ?? ""}`
                                  : `No saved address for ${settlementSummary.walletAsset} on ${settlementSummary.walletRail}.`}
                              </p>
                              {!settlementSummary.nativeEnoughForWithdrawal && settlementSummary.preferredForNative && (
                                <p className="mt-2 text-xs font-semibold text-amber-700">
                                  Not enough {settlementSummary.walletAsset} available after {settlementSummary.nativeReserve} {settlementSummary.walletAsset} gas/fee reserve.
                                </p>
                              )}
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  disabled={!settlementSummary.preferredForNative || !settlementSummary.nativeEnoughForWithdrawal}
                                  onClick={() => {
                                    if (!settlementSummary.preferredForNative) return
                                    setWithdrawReview(settlementSummary.preferredForNative)
                                    setWithdrawAmount(settlementSummary.nativeWithdrawAll.toFixed(Math.min(selectedWallet?.decimals ?? 6, 8)))
                                    setWithdrawStep("review")
                                    setWithdrawRecord(null)
                                    setWithdrawError(null)
                                    setWithdrawTxHash(null)
                                    setMoveMoneyOpen(false)
                                  }}
                                  className={cx(pineTreePrimaryButton, "disabled:cursor-not-allowed disabled:opacity-55")}
                                >
                                  Withdraw All
                                </button>
                                <button
                                  type="button"
                                  disabled={!settlementSummary.preferredForNative}
                                  onClick={() => {
                                    if (!settlementSummary.preferredForNative) return
                                    setWithdrawReview(settlementSummary.preferredForNative)
                                    setWithdrawAmount("")
                                    setWithdrawStep("review")
                                    setWithdrawRecord(null)
                                    setWithdrawError(null)
                                    setWithdrawTxHash(null)
                                    setMoveMoneyOpen(false)
                                  }}
                                  className={cx(pineTreeSecondaryActionButton, "disabled:cursor-not-allowed disabled:opacity-55")}
                                >
                                  Enter Amount
                                </button>
                              </div>
                              {!settlementSummary.preferredForNative && (
                                <p className="mt-2 text-xs text-amber-700">
                                  Add a saved address for {settlementSummary.walletAsset} on {settlementSummary.walletRail}.
                                </p>
                              )}
                            </div>

                            {/* ── USDC card ── */}
                            {(settlementSummary.walletRail === "base" || settlementSummary.walletRail === "solana") && (
                              <div className="p-4">
                                <p className="text-sm font-semibold text-gray-950">
                                  USDC on {settlementSummary.walletRail}
                                </p>
                                <div className="mt-2 space-y-0.5 text-xs text-gray-600">
                                  {usdcBalanceLoading ? (
                                    <p className="text-gray-400">Loading USDC balance…</p>
                                  ) : usdcBalance !== null ? (
                                    <p>Available: <span className="font-semibold">{(usdcBalance ?? 0).toFixed(2)} USDC</span></p>
                                  ) : (
                                    <p className="text-gray-400">USDC balance unknown — tap Refresh in the summary above.</p>
                                  )}
                                  <p className="text-gray-400">No gas deduction for USDC (network fees paid in {settlementSummary.walletAsset})</p>
                                </div>
                                <p className="mt-2 text-xs text-gray-500">
                                  {settlementSummary.preferredForUsdc
                                    ? `→ ${settlementSummary.preferredForUsdc?.label ?? ""} · ${settlementSummary.preferredForUsdc?.exchange_name ?? ""}`
                                    : `No saved address for USDC on ${settlementSummary.walletRail}.`}
                                </p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    disabled={!settlementSummary.preferredForUsdc || !settlementSummary.usdcWithdrawAll}
                                    onClick={() => {
                                      if (!settlementSummary.preferredForUsdc || !settlementSummary.usdcWithdrawAll) return
                                      setWithdrawReview(settlementSummary.preferredForUsdc)
                                      setWithdrawAmount(settlementSummary.usdcWithdrawAll.toFixed(2))
                                      setWithdrawStep("review")
                                      setWithdrawRecord(null)
                                      setWithdrawError(null)
                                      setWithdrawTxHash(null)
                                      setMoveMoneyOpen(false)
                                    }}
                                    className={cx(pineTreePrimaryButton, "disabled:cursor-not-allowed disabled:opacity-55")}
                                  >
                                    Withdraw All USDC
                                  </button>
                                  <button
                                    type="button"
                                    disabled={!settlementSummary.preferredForUsdc}
                                    onClick={() => {
                                      if (!settlementSummary.preferredForUsdc) return
                                      setWithdrawReview(settlementSummary.preferredForUsdc)
                                      setWithdrawAmount("")
                                      setWithdrawStep("review")
                                      setWithdrawRecord(null)
                                      setWithdrawError(null)
                                      setWithdrawTxHash(null)
                                      setMoveMoneyOpen(false)
                                    }}
                                    className={cx(pineTreeSecondaryActionButton, "disabled:cursor-not-allowed disabled:opacity-55")}
                                  >
                                    Enter Amount
                                  </button>
                                </div>
                                {!settlementSummary.preferredForUsdc && (
                                  <p className="mt-2 text-xs text-amber-700">
                                    Add a saved address for USDC on {settlementSummary.walletRail}.
                                  </p>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="border-t border-gray-100 px-4 py-3">
                            <p className="text-[11px] leading-5 text-gray-500">
                              PineTree prepares the transaction, but your wallet must approve it. PineTree cannot reverse transfers sent to the wrong address or network.
                            </p>
                          </div>
                        </div>
                      )}

                      {/* ── Pending Withdrawals ── */}
                      {false && settlementSummary.pendingCount > 0 && (
                        <div className="rounded-2xl border border-amber-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                          <div className="flex items-center justify-between gap-3 border-b border-amber-100 px-4 py-3">
                            <p className="text-sm font-semibold text-amber-900">Pending Withdrawals</p>
                            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                              {settlementSummary.pendingCount}
                            </span>
                          </div>
                          <div className="divide-y divide-gray-100">
                            {settlementSummary.pendingWithdrawals.map((w) => {
                              const statusClass =
                                w.status === "SUBMITTED"
                                  ? "bg-[#0052FF]/10 text-[#0052FF]"
                                  : "bg-amber-100 text-amber-800"
                              const explorerUrl = w.tx_hash ? getExplorerTxUrl(w.network, w.tx_hash) : null
                              const canResume = w.status === "PREPARED" || w.status === "AWAITING_SIGNATURE"
                              return (
                                <div key={w.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="text-sm font-semibold text-gray-950">{w.destination_label}</p>
                                      <span className={cx("rounded-full px-2 py-0.5 text-[10px] font-semibold", statusClass)}>
                                        {w.status.replace(/_/g, " ")}
                                      </span>
                                    </div>
                                    <p className="mt-0.5 text-xs text-gray-500">
                                      {w.amount} {w.asset} · {networkDisplayLabel(w.network)} · {w.exchange_name}
                                    </p>
                                    {w.tx_hash && (
                                      <div className="mt-1 flex flex-wrap items-center gap-2">
                                        <span className="font-mono text-[10px] text-gray-400" title={w.tx_hash}>
                                          {formatSettlementAddress(w.tx_hash)}
                                        </span>
                                        {explorerUrl && (
                                          <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
                                            className="text-[10px] font-semibold text-blue-600 hover:underline">
                                            Explorer ↗
                                          </a>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    {canResume && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const dest = settlementDestinations.find((d) => d.id === w.settlement_destination_id)
                                          if (!dest) return
                                          setWithdrawReview(dest)
                                          setWithdrawAmount(String(w.amount))
                                          setWithdrawStep("review")
                                          setWithdrawRecord(null)
                                          setWithdrawError(null)
                                          setWithdrawTxHash(null)
                                        }}
                                        className={pineTreeSecondaryActionButton}
                                      >
                                        Resume
                                      </button>
                                    )}
                                    {w.status === "SUBMITTED" && (
                                      <button
                                        type="button"
                                        onClick={() => checkWithdrawalStatus(w.id)}
                                        disabled={checkingStatusId === w.id}
                                        className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:border-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        {checkingStatusId === w.id ? "Checking…" : "Check status"}
                                      </button>
                                    )}
                                    {checkedPendingIds.includes(w.id) && w.status === "SUBMITTED" && (
                                      <span className="text-[11px] text-gray-500">Still waiting for confirmation.</span>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* ── Exchange Destinations ── */}
                      <div className="rounded-2xl border border-gray-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
                          <p className="text-sm font-semibold text-gray-950">Saved Addresses</p>
                          <NetworkStatusPill label="Address book" tone="blue" className="shrink-0" />
                        </div>

                        <div className="p-4">
                          <p className="text-sm leading-6 text-gray-600">
                            Save exchange or wallet addresses you use often.
                          </p>

                          {destLoadError && (
                            <div className="mt-3 rounded-xl border border-red-100 bg-red-50/70 p-3 text-sm text-red-800">
                              {destLoadError}
                            </div>
                          )}

                          {destLoading ? (
                            <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50/70 px-4 py-6 text-center text-sm text-gray-500">
                              Loading destinations…
                            </div>
                          ) : savedDestinationsForWallet.length === 0 ? (
                            <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50/50 px-4 py-6 text-center">
                              <p className="text-sm font-semibold text-gray-700">No saved destinations</p>
                              <p className="mt-1 text-xs leading-5 text-gray-500">
                                Add a saved address to make future sends faster.
                              </p>
                            </div>
                          ) : (
                            <div className="mt-4 space-y-3">
                              {savedDestinationsForWallet.map((dest) => {
                                const isCompatible = dest.network === selectedWallet?.rail
                                return (
                                  <div
                                    key={dest.id}
                                    className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm transition hover:border-[#0052FF]/20"
                                  >
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                      <div className="min-w-0 flex-1">
                                        <p className="text-sm font-semibold text-gray-950">{dest.label}</p>
                                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                          <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                                            {getDestinationAccountTypeLabel(dest.account_type)}
                                          </span>
                                          <span className={cx(
                                            "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                                            dest.source === "mesh" || dest.connected_provider === "mesh"
                                              ? "border-[#0052FF]/25 bg-[#0052FF]/10 text-[#0052FF]"
                                              : "border-gray-200 bg-gray-50 text-gray-500"
                                          )}>
                                            {getDestinationSourceLabel(dest)}
                                          </span>
                                          {dest.institution_name && (
                                            <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                                              {dest.institution_name}
                                            </span>
                                          )}
                                          {!isCompatible && selectedWallet?.rail && (
                                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                                              Different network
                                            </span>
                                          )}
                                        </div>
                                        <p className="mt-0.5 text-[11px] text-gray-400">{dest.exchange_name}</p>
                                      </div>
                                      <span className="shrink-0 rounded-xl border border-[#0052FF]/15 bg-[#0052FF]/5 px-2.5 py-1 text-[11px] font-semibold text-[#0052FF]">
                                        {assetNetworkDisplayLabel(dest.asset, dest.network)}
                                      </span>
                                    </div>
                                    <p className="mt-2 font-mono text-xs text-gray-400" title={dest.address}>
                                      {formatSettlementAddress(dest.address)}
                                    </p>
                                    {dest.memo_or_tag && (
                                      <p className="mt-0.5 text-[10px] text-gray-400">Memo: {dest.memo_or_tag}</p>
                                    )}

                                    {destDeleteConfirmId === dest.id ? (
                                      <div className="mt-3 flex flex-wrap items-center gap-2">
                                        <p className="text-xs font-semibold text-gray-700">Delete this destination?</p>
                                        <button
                                          type="button"
                                          onClick={() => setDestDeleteConfirmId(null)}
                                          disabled={destDeleting}
                                          className={pineTreeSecondaryActionButton}
                                        >
                                          Cancel
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => deleteSettlementDestination(dest.id)}
                                          disabled={destDeleting}
                                          className={pineTreeDangerActionButton}
                                        >
                                          {destDeleting ? "Deleting…" : "Delete"}
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="mt-3 flex flex-wrap gap-2">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setDestForm({
                                              id: dest.id,
                                              label: dest.label,
                                              exchangeName: dest.exchange_name,
                                              assetNetwork: destAssetNetworkValue(dest),
                                              address: dest.address,
                                              memoOrTag: dest.memo_or_tag || "",
                                              isDefault: false,
                                              confirmed: true,
                                              accountType: dest.account_type || "other",
                                              personalExchangeAcknowledged: dest.account_type === "personal_exchange"
                                            })
                                            setDestSaveError(null)
                                            setDestModalOpen(true)
                                          }}
                                          className={pineTreeSecondaryActionButton}
                                        >
                                          Edit
                                        </button>
                                        {false && !dest.is_default && (
                                          <button
                                            type="button"
                                            onClick={() => setPreferredDestination(dest.id)}
                                            disabled={destSettingDefault === dest.id}
                                            className={pineTreeSecondaryActionButton}
                                          >
                                            {destSettingDefault === dest.id ? "Saving…" : "Set Preferred"}
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => setDestDeleteConfirmId(dest.id)}
                                          className={pineTreeDangerActionButton}
                                        >
                                          Delete
                                        </button>
                                        {false && <button
                                          type="button"
                                          onClick={() => setWithdrawReview(dest)}
                                          disabled={!isCompatible}
                                          title={!isCompatible && selectedWallet?.rail
                                            ? `This destination is for ${networkDisplayLabel(dest.network)} — connect a ${networkDisplayLabel(dest.network)} wallet to withdraw`
                                            : undefined}
                                          className={cx(
                                            pineTreeSecondaryActionButton,
                                            !isCompatible && "cursor-not-allowed opacity-40"
                                          )}
                                        >
                                          Withdraw
                                        </button>}
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}

                          <div className="mt-4 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const firstOption = destinationAssetOptions[0]
                                setDestForm({ ...emptyDestinationForm(), assetNetwork: firstOption?.value || "" })
                                setDestSaveError(null)
                                setDestModalOpen(true)
                              }}
                              className={pineTreePrimaryButton}
                            >
                              Add Address
                            </button>
                            <button
                              type="button"
                              onClick={MESH_CONNECT_ENABLED ? connectExchange : undefined}
                              disabled={!MESH_CONNECT_ENABLED || meshLinking}
                              title={MESH_CONNECT_ENABLED
                                ? "Connect an exchange to import deposit addresses automatically."
                                : "Set MESH_CLIENT_ID, MESH_CLIENT_SECRET, and NEXT_PUBLIC_MESH_CONNECT_ENABLED=true to enable."}
                              className={cx(pineTreeSecondaryActionButton, "disabled:cursor-not-allowed disabled:opacity-55")}
                            >
                              {meshLinking ? "Connecting..." : "Connect Exchange"}
                            </button>
                          </div>

                          {meshLinkError && (
                            <p className="mt-2 text-xs font-semibold text-red-700">{meshLinkError}</p>
                          )}
                          {MESH_CONNECT_ENABLED && meshImportStep === "connected" && meshConnection && (
                            <div className="mt-4 rounded-2xl border border-[#0052FF]/15 bg-[#0052FF]/5 p-4">
                              <p className="text-sm font-semibold text-gray-950">Import Exchange Addresses</p>
                              {meshConnection.institutionName && (
                                <p className="mt-0.5 text-xs text-gray-500">Connected to {meshConnection.institutionName}</p>
                              )}
                              <div className="mt-3 space-y-2">
                                {getMeshImportOptions(selectedWallet?.rail || "").map((opt) => {
                                  const key = `${opt.asset}|${opt.network}`
                                  return (
                                    <label key={key} className="flex cursor-pointer items-center gap-2">
                                      <input
                                        type="checkbox"
                                        checked={meshImportAssets.includes(key)}
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            setMeshImportAssets((prev) => [...prev, key])
                                          } else {
                                            setMeshImportAssets((prev) => prev.filter((k) => k !== key))
                                          }
                                        }}
                                        className="h-4 w-4 rounded border-gray-300"
                                      />
                                      <span className="text-sm font-semibold text-gray-800">{opt.label}</span>
                                    </label>
                                  )
                                })}
                              </div>
                              {meshImportError && (
                                <p className="mt-3 text-xs font-semibold text-red-700">{meshImportError}</p>
                              )}
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={importMeshAddresses}
                                  disabled={meshImporting || meshImportAssets.length === 0}
                                  className={cx(pineTreePrimaryButton, "disabled:cursor-not-allowed disabled:opacity-55")}
                                >
                                  {meshImporting ? "Importing..." : "Import Selected"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setMeshImportStep("idle"); setMeshConnection(null); setMeshImportError(null) }}
                                  disabled={meshImporting}
                                  className={pineTreeSecondaryActionButton}
                                >
                                  Cancel
                                </button>
                              </div>
                              <p className="mt-3 text-xs leading-5 text-gray-500">
                                Mesh imports exchange deposit addresses. PineTree Send still prepares transfers for wallet approval.
                              </p>
                            </div>
                          )}
                          {MESH_CONNECT_ENABLED && meshImportStep === "done" && meshImportResult && (
                            <div className="mt-4 rounded-2xl border border-[#0052FF]/15 bg-[#0052FF]/5 p-4">
                              <p className="text-sm font-semibold text-gray-950">Import Complete</p>
                              <p className="mt-1 text-sm leading-6 text-gray-600">
                                {meshImportResult.imported > 0 && `${meshImportResult.imported} address${meshImportResult.imported === 1 ? "" : "es"} imported. `}
                                {meshImportResult.updated > 0 && `${meshImportResult.updated} verified. `}
                                {meshImportResult.imported === 0 && meshImportResult.updated === 0 && "No new addresses found."}
                              </p>
                              <button
                                type="button"
                                onClick={() => { setMeshImportStep("idle"); setMeshConnection(null); setMeshImportResult(null) }}
                                className={cx(pineTreeSecondaryActionButton, "mt-3")}
                              >
                                Done
                              </button>
                            </div>
                          )}
                          <p className="mt-3 text-xs leading-5 text-gray-500">
                            {MESH_CONNECT_ENABLED
                              ? "Connect an exchange to import deposit addresses. Saved destinations do not change where customer payments are received."
                              : "Connect an exchange to import deposit addresses automatically. Saved destinations do not change where customer payments are received."}
                          </p>
                        </div>
                      </div>

                      {/* ── Exchange Connection ── */}
                      <div className="rounded-2xl border border-gray-100 bg-white p-3">
                        <button
                          type="button"
                          onClick={() => setSettlementAdvancedOpen((open) => !open)}
                          className="flex w-full items-center justify-between gap-3 text-left text-sm font-semibold text-gray-950"
                        >
                          <span>Advanced</span>
                          <span className="text-xs text-gray-400">{settlementAdvancedOpen ? "Hide" : "Show"}</span>
                        </button>
                      </div>

                      <div className={cx("rounded-2xl border border-gray-100 bg-gray-50/70 p-4", !settlementAdvancedOpen && "hidden")}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-950">Connect Exchange</p>
                            <p className="mt-1 text-sm leading-6 text-gray-600">
                              {MESH_CONNECT_ENABLED
                                ? "Connect an exchange to import deposit addresses automatically."
                                : "Mesh integration will let merchants import exchange deposit addresses automatically."}
                            </p>
                          </div>
                          <NetworkStatusPill
                            label={MESH_CONNECT_ENABLED ? "Configured" : "Not configured"}
                            tone={MESH_CONNECT_ENABLED ? "blue" : "slate"}
                            className="shrink-0"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={MESH_CONNECT_ENABLED ? connectExchange : undefined}
                          disabled={!MESH_CONNECT_ENABLED || meshLinking}
                          className={cx(MESH_CONNECT_ENABLED ? pineTreePrimaryButton : pineTreeDisabledButton, "mt-4")}
                        >
                          {meshLinking ? "Connecting..." : MESH_CONNECT_ENABLED ? "Connect Exchange" : "Not Configured"}
                        </button>
                        <p className="mt-3 text-xs leading-5 text-gray-500">
                          Mesh imports exchange deposit addresses. PineTree Send still prepares transfers for wallet approval.
                        </p>
                      </div>

                      {/* ── Address Book Mode (UI-only preference) ── */}
                      {false && <div className={cx("rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]", !settlementAdvancedOpen && "hidden")}>
                        <p className="text-sm font-semibold text-gray-950">Address Book Mode</p>
                        <p className="mt-1 text-xs leading-5 text-gray-500">
                          Choose how and when balances move to your exchange destination.
                        </p>
                        <div className="mt-3 space-y-2">
                          {([
                            { value: "manual" as const, label: "Manual withdrawals", detail: "Initiate each withdrawal yourself, on demand.", available: true },
                            { value: "end_of_day" as const, label: "End-of-day batch", detail: "PineTree prepares a daily batch for your approval.", available: false },
                            { value: "auto" as const, label: "Automatic settlement", detail: "Auto-settle after each payment. Requires wallet session support.", available: false }
                          ]).map((option) => (
                            <label
                              key={option.value}
                              className={cx(
                                "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition",
                                settlementMode === option.value
                                  ? "border-[#0052FF]/25 bg-[#0052FF]/5"
                                  : "border-gray-100 bg-gray-50/60",
                                !option.available && "cursor-not-allowed opacity-60"
                              )}
                            >
                              <input
                                type="radio"
                                name="settlement_mode"
                                value={option.value}
                                checked={settlementMode === option.value}
                                disabled={!option.available}
                                onChange={() => {
                                  if (!option.available) return
                                  setSettlementMode(option.value)
                                  saveSettlementPreference(option.value)
                                }}
                                className="mt-0.5 h-4 w-4 accent-[#0052FF]"
                              />
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-semibold text-gray-900">{option.label}</p>
                                  {!option.available && (
                                    <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold text-gray-400">
                                      Coming soon
                                    </span>
                                  )}
                                </div>
                                <p className="mt-0.5 text-xs leading-5 text-gray-500">{option.detail}</p>
                              </div>
                            </label>
                          ))}
                        </div>
                        <p className="mt-3 text-[11px] leading-5 text-gray-400">
                          {settlementPrefSaving ? "Saving preference…" : "Preference saved to your account."}
                        </p>
                      </div>}

                      {/* ── Settlement Activity ── */}
                      <div className="rounded-2xl border border-gray-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
                          <p className="text-sm font-semibold text-gray-950">Recent Activity</p>
                          {settlementSummary.thisMonthCount > 0 && (
                            <span className="rounded-full border border-[#0052FF]/20 bg-[#0052FF]/5 px-2.5 py-0.5 text-[11px] font-semibold text-[#0052FF]">
                              {settlementSummary.thisMonthCount} this month
                            </span>
                          )}
                        </div>
                        <div className="p-4">
                          {historyLoading ? (
                            <p className="text-center text-sm text-gray-500">Loading…</p>
                          ) : settlementHistory.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 px-4 py-6 text-center">
                              <p className="text-sm text-gray-500">No recent sends yet.</p>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {(settlementActivityExpanded ? settlementHistory : settlementHistory.slice(0, 5)).map((w) => {
                                const explorerUrl = w.tx_hash ? getExplorerTxUrl(w.network, w.tx_hash) : null
                                const isDirectManual = w.movement_type === "direct_send" && w.destination_kind === "manual_address"
                                const destinationDisplay = isDirectManual
                                  ? `Manual address · ${formatSettlementAddress(w.destination_address)}`
                                  : w.destination_label || formatSettlementAddress(w.destination_address)
                                const statusClass: Record<string, string> = {
                                  DRAFT:              "bg-gray-100 text-gray-500",
                                  PREPARED:           "bg-amber-100 text-amber-800",
                                  AWAITING_SIGNATURE: "bg-amber-100 text-amber-800",
                                  SUBMITTED:          "bg-blue-100 text-blue-700",
                                  CONFIRMED:          "bg-[#0052FF]/10 text-[#0052FF]",
                                  FAILED:             "bg-red-100 text-red-700",
                                  CANCELLED:          "bg-gray-100 text-gray-400"
                                }
                                const pill = statusClass[w.status] ?? "bg-gray-100 text-gray-500"
                                return (
                                  <div key={w.id} className="rounded-xl border border-gray-100 p-3">
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <p className="text-sm font-semibold text-gray-950">Sent {w.asset}</p>
                                        <p className="mt-0.5 truncate text-xs text-gray-500" title={w.destination_address}>
                                          {destinationDisplay}
                                        </p>
                                      </div>
                                      <span className={cx("shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold", pill)}>
                                        {w.status.replace(/_/g, " ")}
                                      </span>
                                    </div>
                                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
                                      <span className="font-semibold">{w.amount} {w.asset}</span>
                                      <span className="text-gray-300">·</span>
                                      <span>{networkDisplayLabel(w.network)}</span>
                                      <span className="text-gray-300">·</span>
                                      <span className="text-gray-400">{formatChicagoDateTime(w.created_at)}</span>
                                    </div>
                                    {w.tx_hash && (
                                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                        <span className="font-mono text-[10px] text-gray-400" title={w.tx_hash}>
                                          {formatSettlementAddress(w.tx_hash)}
                                        </span>
                                        {explorerUrl && (
                                          <a
                                            href={explorerUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-[10px] font-semibold text-blue-600 hover:underline"
                                          >
                                            View on Explorer ↗
                                          </a>
                                        )}
                                      </div>
                                    )}
                                    {w.submitted_at && (
                                      <p className="mt-1 text-[10px] text-gray-400">
                                        Submitted: {formatChicagoDateTime(w.submitted_at)}
                                      </p>
                                    )}
                                    {w.failure_reason && (
                                      <p className="mt-1 text-xs leading-5 text-red-600">{w.failure_reason}</p>
                                    )}
                                    {w.status === "SUBMITTED" && (
                                      <div className="mt-2 flex flex-wrap items-center gap-2">
                                        <button
                                          type="button"
                                          onClick={() => checkWithdrawalStatus(w.id)}
                                          disabled={checkingStatusId === w.id}
                                          className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 shadow-sm transition hover:border-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          {checkingStatusId === w.id ? "Checking…" : "Check status"}
                                        </button>
                                        {checkedPendingIds.includes(w.id) && (
                                          <span className="text-[11px] text-gray-500">
                                            Still waiting for network confirmation.
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                              {settlementHistory.length > 5 && (
                                <button
                                  type="button"
                                  onClick={() => setSettlementActivityExpanded((open) => !open)}
                                  className={pineTreeSecondaryActionButton}
                                >
                                  {settlementActivityExpanded ? "Show Less" : "View All Activity"}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {activeTab === "lightning_wallet" && selectedWallet.isLightning && (
                <div className={walletDetailPanelClass}>
                  <div className="rounded-2xl border border-[#0052FF]/15 bg-[#0052FF]/5 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-950">Speed Lightning</p>
                        <p className="mt-1 text-sm leading-6 text-gray-600">
                          Use Speed for Lightning invoices, auto-swap, and settlement settings.
                        </p>
                      </div>
                      <NetworkStatusPill label="Managed in TrySpeed" tone="blue" className="shrink-0" />
                    </div>
                    <p className="mt-3 text-xs leading-5 text-gray-600">
                      Auto-swap and payout controls are managed in your TrySpeed account. PineTree uses your Speed setup to create invoices and track Lightning payments.
                    </p>
                    {lightningSpeedLinks.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {lightningSpeedLinks.map((link) => (
                          <a key={link.key} href={link.url} target="_blank" rel="noopener noreferrer" className={pineTreeSecondaryActionButton}>
                            {link.label}
                          </a>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-gray-500">Speed dashboard links are not configured yet.</p>
                    )}
                  </div>

                  <div className="rounded-2xl border border-gray-100 bg-white p-3">
                    <button
                      type="button"
                      onClick={() => setNwcAdvancedOpen((open) => !open)}
                      className="flex w-full items-center justify-between gap-3 text-left text-sm font-semibold text-gray-950"
                    >
                      <span>Advanced NWC Wallet</span>
                      <span className="text-xs text-gray-400">{nwcAdvancedOpen ? "Hide" : "Show"}</span>
                    </button>
                    <p className="mt-1 px-0.5 text-xs leading-5 text-gray-500">
                      Connect a direct Lightning wallet only if you manage your own NWC connection.
                    </p>
                  </div>

                  <div className={cx("space-y-4", !nwcAdvancedOpen && "hidden")}>
                  {nwcStatus?.connected ? (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                          Advanced — Direct Lightning Wallet (NWC)
                        </span>
                      </div>

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
                            placeholder="NWC connection string"
                            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 font-mono text-xs text-gray-800 outline-none focus:border-[#0052FF] focus:ring-4 focus:ring-blue-100"
                          />
                          <input
                            type="text"
                            value={nwcWalletLabel}
                            onChange={(e) => setNwcWalletLabel(e.target.value)}
                            placeholder="Wallet label"
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
                            {false && <button type="button" onClick={testNwcUri} disabled={nwcTestLoading || !nwcUri.trim()} className={cx(pineTreeSecondaryActionButton, "flex-1 justify-center disabled:cursor-not-allowed disabled:opacity-55")}>
                              {nwcTestLoading ? "Testing..." : "Test Connection"}
                            </button>}
                            <button type="button" onClick={connectNwcWallet} disabled={nwcConnectLoading || !nwcUri.trim()} className={cx(pineTreePrimaryButton, "flex-1 disabled:cursor-not-allowed disabled:opacity-55")}>
                              {nwcConnectLoading ? "Saving..." : "Connect NWC Wallet"}
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
                      {/* Recommended: Speed Lightning */}
                      {false && <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4">
                        <div className="mb-2">
                          <span className="rounded-full bg-blue-600 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                            Recommended
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-gray-950">Recommended: Speed Lightning</p>
                        <p className="mt-1 text-sm leading-6 text-gray-600">
                          Use Speed for Lightning invoices, fee split, and merchant settlement.
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <a
                            href="https://tryspeed.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className={pineTreeSecondaryActionButton}
                          >
                            Open Speed Dashboard
                          </a>
                          <a
                            href="/dashboard/providers"
                            className={pineTreeSecondaryActionButton}
                          >
                            Manage Speed Setup
                          </a>
                        </div>
                        <p className="mt-3 text-xs text-gray-500">
                          Speed payout controls will appear after Speed settlement support is connected.
                        </p>
                      </div>}

                      {/* Advanced: Direct Lightning Wallet (NWC) */}
                      <div className="flex items-center gap-2">
                        <span className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                          Advanced — Direct Lightning Wallet (NWC)
                        </span>
                      </div>

                      <div className="rounded-2xl border border-gray-100 bg-white p-3">
                        <button
                          type="button"
                          onClick={() => setNwcAdvancedOpen((open) => !open)}
                          className="flex w-full items-center justify-between gap-3 text-left text-sm font-semibold text-gray-950"
                        >
                          <span>Advanced NWC setup</span>
                          <span className="text-xs text-gray-400">{nwcAdvancedOpen ? "Hide" : "Show"}</span>
                        </button>
                      </div>

                      <div className={cx("space-y-4 rounded-2xl border border-gray-100 bg-gray-50/70 p-4", !nwcAdvancedOpen && "hidden")}>
                        <div>
                          <p className="text-sm font-semibold text-gray-950">Advanced NWC Wallet</p>
                          <p className="mt-1 text-xs leading-5 text-gray-600">
                            Connect a direct Lightning wallet only if you manage your own NWC connection.
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
                            placeholder="NWC connection string"
                            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 font-mono text-xs text-gray-800 outline-none focus:border-[#0052FF] focus:ring-4 focus:ring-blue-100"
                          />
                          <input
                            type="text"
                            value={nwcWalletLabel}
                            onChange={(e) => setNwcWalletLabel(e.target.value)}
                            placeholder="Wallet label"
                            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 outline-none focus:border-[#0052FF] focus:ring-4 focus:ring-blue-100"
                          />
                        </div>

                        <div className="flex gap-2">
                          {false && <button
                            type="button"
                            onClick={testNwcUri}
                            disabled={nwcTestLoading || !nwcUri.trim()}
                            className={cx(pineTreeSecondaryActionButton, "flex-1 justify-center disabled:cursor-not-allowed disabled:opacity-55")}
                          >
                            {nwcTestLoading ? "Testing..." : "Test Connection"}
                          </button>}
                          <button
                            type="button"
                            onClick={connectNwcWallet}
                            disabled={nwcConnectLoading || !nwcUri.trim()}
                            className={cx(pineTreePrimaryButton, "flex-1 disabled:cursor-not-allowed disabled:opacity-55")}
                          >
                            {nwcConnectLoading ? "Saving..." : "Connect NWC Wallet"}
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

                  </div>

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
                  {!selectedWallet.isLightning ? (
                    <div className="rounded-2xl border border-gray-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
                        <p className="text-sm font-semibold text-gray-950">Recent Activity</p>
                        <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-[11px] font-semibold text-gray-600">
                          Recent 5
                        </span>
                      </div>
                      <div className="p-4">
                        {historyLoading ? (
                          <p className="text-center text-sm text-gray-500">Loading...</p>
                        ) : settlementHistory.length === 0 ? (
                          <p className="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 px-4 py-5 text-center text-sm text-gray-500">
                            No recent sends yet.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {settlementHistory.slice(0, 5).map((w) => {
                              const explorerUrl = w.tx_hash ? getExplorerTxUrl(w.network, w.tx_hash) : null
                              const isDirectManual = w.movement_type === "direct_send" && w.destination_kind === "manual_address"
                              const destinationDisplay = isDirectManual
                                ? `Manual address · ${formatSettlementAddress(w.destination_address)}`
                                : w.destination_label || formatSettlementAddress(w.destination_address)
                              const statusClass: Record<string, string> = {
                                DRAFT: "bg-gray-100 text-gray-500",
                                PREPARED: "bg-amber-100 text-amber-800",
                                AWAITING_SIGNATURE: "bg-amber-100 text-amber-800",
                                SUBMITTED: "bg-blue-100 text-blue-700",
                                CONFIRMED: "bg-[#0052FF]/10 text-[#0052FF]",
                                FAILED: "bg-red-100 text-red-700",
                                CANCELLED: "bg-gray-100 text-gray-400"
                              }
                              return (
                                <div key={w.id} className="rounded-xl border border-gray-100 p-3">
                                  <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="text-sm font-semibold text-gray-950">{w.amount} {w.asset}</p>
                                      <p className="mt-0.5 truncate text-xs text-gray-500" title={w.destination_address}>
                                        {destinationDisplay}
                                      </p>
                                    </div>
                                    <span className={cx("shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold", statusClass[w.status] ?? "bg-gray-100 text-gray-500")}>
                                      {w.status.replace(/_/g, " ")}
                                    </span>
                                  </div>
                                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                                    <span>{formatChicagoDateTime(w.created_at)}</span>
                                    {explorerUrl && (
                                      <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-600 hover:underline">
                                        Explorer
                                      </a>
                                    )}
                                    {w.status === "SUBMITTED" && (
                                      <button
                                        type="button"
                                        onClick={() => checkWithdrawalStatus(w.id)}
                                        disabled={checkingStatusId === w.id}
                                        className="font-semibold text-blue-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        {checkingStatusId === w.id ? "Checking..." : "Check Status"}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : selectedWallet.isLightning && lightningActivity.length > 0 ? (
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
                    <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">Payment Receiving Wallet</p>
                    <p className="mt-2 text-sm text-gray-600">Customer payments continue to use your connected merchant wallet.</p>
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
                      <NetworkStatusPill label="Manual approval required" tone="slate" />
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
