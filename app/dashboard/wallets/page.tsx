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
  speedSetupStatus?: SpeedSetupStatus
}

type SpeedSetupStatus = {
  connected: boolean
  speedAccountId: string | null
  balanceAvailable: boolean
  cryptoPayoutsEnabled: false
  bankPayoutsEnabled: boolean
  bankPayoutCapabilityVerified: boolean
  bankPayoutDestinationConfigured: boolean
  bankPayoutSetupRequiredReason: string
  dashboardUrlConfigured: boolean
  dashboardUrl: string | null
  bankSetupUrlConfigured: boolean
  bankSetupUrl: string | null
  providerSubmissionEnabled: false
  notes: string[]
}

type WalletOperationSummary = {
  id: string
  provider: "speed"
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
  recentSpeedOperations?: WalletOperationSummary[]
  totalUsd?: number
  lastRun?: string | null
  error?: string
}

type DetailTab = "overview" | "send" | "cash_out" | "speed_setup" | "activity" | "settings"
type ActivityFilter = "all" | "completed" | "failed" | "drafts"
type BankSettlementState =
  | "ready"
  | "awaiting_verification"
  | "merchant_confirmed"
  | "direct_setup"
  | "dashboard_setup"
  | "not_configured"
type BankSettlementDisplay = {
  title: "Bank Settlement"
  status: "Ready" | "Awaiting Verification" | "Merchant Confirmed" | "Needs Setup" | "Not Configured"
  helper: string
  action: "Cash Out Funds" | "Refresh Status" | "Set Up Bank Settlement" | "Open Speed Dashboard" | "Contact Support"
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
  speedSetupStatus?: SpeedSetupStatus
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

type SpeedWithdrawalDestinationType = "lightning_invoice" | "bitcoin_address" | "provider_bank_payout"

type SpeedWithdrawalDraftResponse = {
  success?: boolean
  operation?: {
    id: string
    provider: "speed"
    operationType: "WITHDRAWAL_DRAFT"
    asset: "BTC"
    network: "bitcoin_lightning"
    amount: number
    destinationType: SpeedWithdrawalDestinationType
    destinationValue: string | null
    status: string
    errorCode: string | null
    errorMessage: string | null
    providerOperationId: null
    providerStatus: null
    createdAt: string
  }
  eventType?: string
  message?: string
  providerCallsEnabled?: boolean
  fundMovementEnabled?: boolean
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

function formatSpeedDestinationType(value: string) {
  if (value === "lightning_invoice") return "Lightning invoice"
  if (value === "bitcoin_address") return "Bitcoin address"
  if (value === "provider_bank_payout") return "Bank payout"
  return value.replace(/_/g, " ")
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

function getBankSettlementKey(status?: SpeedSetupStatus | null) {
  return status?.speedAccountId ? `speed:${status.speedAccountId}` : null
}

function getBankSettlementState(
  status?: SpeedSetupStatus | null,
  merchantConfirmed = false
): BankSettlementState {
  if (status?.bankPayoutsEnabled || (status?.bankPayoutCapabilityVerified && status?.bankPayoutDestinationConfigured)) {
    return "ready"
  }
  if (status?.bankPayoutDestinationConfigured || status?.bankPayoutCapabilityVerified) return "awaiting_verification"
  if (merchantConfirmed) return "merchant_confirmed"
  if (status?.bankSetupUrlConfigured && status.bankSetupUrl) return "direct_setup"
  if (status?.dashboardUrlConfigured && status.dashboardUrl) return "dashboard_setup"
  return "not_configured"
}

function getBankSettlementDisplay(state: BankSettlementState): BankSettlementDisplay {
  if (state === "ready") {
    return {
      title: "Bank Settlement",
      status: "Ready",
      helper: "Bank account withdrawals are available.",
      action: "Cash Out Funds"
    }
  }
  if (state === "awaiting_verification") {
    return {
      title: "Bank Settlement",
      status: "Awaiting Verification",
      helper: "We are waiting to verify that bank settlement is available.",
      action: "Refresh Status"
    }
  }
  if (state === "merchant_confirmed") {
    return {
      title: "Bank Settlement",
      status: "Merchant Confirmed",
      helper: "Setup completed in Speed. PineTree is still waiting for provider verification before bank withdrawals can be marked ready.",
      action: "Refresh Status"
    }
  }
  if (state === "direct_setup") {
    return {
      title: "Bank Settlement",
      status: "Needs Setup",
      helper: "To enable bank withdrawals, open Speed Bank Setup, add a bank account, complete provider verification, return to PineTree, and refresh status.",
      action: "Set Up Bank Settlement"
    }
  }
  if (state === "dashboard_setup") {
    return {
      title: "Bank Settlement",
      status: "Needs Setup",
      helper: "To enable bank withdrawals, open Speed Dashboard, navigate to Banking or Payout Settings, add a bank account, complete provider verification, return to PineTree, and refresh status.",
      action: "Open Speed Dashboard"
    }
  }
  return {
    title: "Bank Settlement",
    status: "Not Configured",
    helper: "PineTree does not currently have a configured provider setup path.",
    action: "Contact Support"
  }
}

function getBankSettlementSetupHeading(state: BankSettlementState) {
  if (state === "not_configured") return "Setup Path Not Configured"
  return getBankSettlementDisplay(state).status
}

function getBankSettlementHelper(state: BankSettlementState) {
  return getBankSettlementDisplay(state).helper
}

function getLightningNextAction(input: {
  bankSettlementState: BankSettlementState
  hasBalance?: boolean
  hasActivity?: boolean
}) {
  if (input.bankSettlementState === "direct_setup") {
    return {
      title: "Set Up Bank Settlement",
      description: "Connect payout settings to enable bank withdrawals.",
      action: "Set Up Bank Settlement" as const
    }
  }

  if (input.bankSettlementState === "dashboard_setup") {
    return {
      title: "Open Speed Dashboard",
      description: "Go to payout or bank settings inside Speed to finish setup.",
      action: "Open Speed Dashboard" as const
    }
  }

  if (input.bankSettlementState === "awaiting_verification" || input.bankSettlementState === "merchant_confirmed") {
    return {
      title: "Refresh Status",
      description: "PineTree will check whether bank settlement is available from the provider state it can read.",
      action: "Refresh Status" as const
    }
  }

  if (input.bankSettlementState === "not_configured") {
    return {
      title: "Contact Support",
      description: "PineTree does not currently have a configured provider setup path for bank settlement.",
      action: "Contact Support" as const
    }
  }

  if (input.bankSettlementState === "ready" || input.hasBalance) {
    return {
      title: "Cash Out Funds",
      description: "Move available Bitcoin Lightning funds to a Lightning invoice or Bitcoin address.",
      action: "Cash Out Funds" as const
    }
  }

  return {
    title: input.hasActivity ? "Refresh Balance" : "Configure Auto Convert Later",
    description: input.hasActivity
      ? "Refresh the wallet to make sure PineTree is showing the latest Lightning balance."
      : "Auto Convert is a future treasury workflow. This wallet is ready for Lightning activity today.",
    action: "Refresh Balance" as const
  }
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

function BankSettlementChecklist({
  state,
  providerSetupAvailable,
  merchantConfirmed,
  providerVerified
}: {
  state: BankSettlementState
  providerSetupAvailable: boolean
  merchantConfirmed: boolean
  providerVerified: boolean
}) {
  const verificationLabel = providerVerified ? "Provider Verified" : "Setup Completed In Speed"
  const items = [
    {
      label: "Open Provider Setup",
      done: providerSetupAvailable || merchantConfirmed || providerVerified || state === "ready"
    },
    {
      label: "Add Bank Account",
      done: merchantConfirmed || providerVerified || state === "ready"
    },
    {
      label: verificationLabel,
      done: merchantConfirmed || providerVerified || state === "ready"
    },
    {
      label: "Refresh Status",
      done: providerVerified || state === "ready"
    }
  ]

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-[0_6px_18px_rgba(15,23,42,0.035)]">
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <span
              className={cx(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs",
                item.done ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-gray-50 text-gray-400 ring-1 ring-gray-200"
              )}
              aria-hidden="true"
            >
              {item.done ? "✓" : "○"}
            </span>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function BankSettlementStepList({ state }: { state: BankSettlementState }) {
  if (state === "direct_setup") {
    return (
      <ol className="mt-3 list-decimal space-y-1 pl-4 text-sm leading-6 text-gray-700">
        <li>Open Speed Bank Setup</li>
        <li>Add bank account</li>
        <li>Complete provider verification</li>
        <li>Return to PineTree</li>
        <li>Refresh Status</li>
      </ol>
    )
  }

  if (state === "dashboard_setup") {
    return (
      <ol className="mt-3 list-decimal space-y-1 pl-4 text-sm leading-6 text-gray-700">
        <li>Open Speed Dashboard</li>
        <li>Navigate to Banking or Payout Settings</li>
        <li>Add bank account</li>
        <li>Complete provider verification</li>
        <li>Return to PineTree</li>
        <li>Refresh Status</li>
      </ol>
    )
  }

  if (state === "merchant_confirmed") {
    return (
      <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
        ✓ Setup Completed In Speed
        <p className="mt-1 text-sm font-medium leading-6 text-emerald-900/75">
          PineTree is still waiting for provider verification. Merchant confirmation does not enable bank withdrawals.
        </p>
      </div>
    )
  }

  return null
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
  const [recentSpeedOperations, setRecentSpeedOperations] = useState<WalletOperationSummary[]>([])
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
  const [speedWithdrawalAmount, setSpeedWithdrawalAmount] = useState("")
  const [speedWithdrawalDestinationType, setSpeedWithdrawalDestinationType] =
    useState<SpeedWithdrawalDestinationType>("lightning_invoice")
  const [speedWithdrawalDestinationValue, setSpeedWithdrawalDestinationValue] = useState("")
  const [speedWithdrawalMemo, setSpeedWithdrawalMemo] = useState("")
  const [speedWithdrawalDraft, setSpeedWithdrawalDraft] = useState<SpeedWithdrawalDraftResponse["operation"] | null>(null)
  const [speedWithdrawalMessage, setSpeedWithdrawalMessage] = useState<string | null>(null)
  const [speedWithdrawalError, setSpeedWithdrawalError] = useState<string | null>(null)
  const [speedWithdrawalLoading, setSpeedWithdrawalLoading] = useState(false)
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all")
  const [merchantOpenedBankSettlementSetup, setMerchantOpenedBankSettlementSetup] = useState<Record<string, boolean>>({})
  const [merchantConfirmedBankSettlement, setMerchantConfirmedBankSettlement] = useState<Record<string, boolean>>({})

  useEffect(() => {
    try {
      const opened = window.localStorage.getItem("pinetree.speed.bankSettlementOpened")
      if (opened) {
        const parsed = JSON.parse(opened) as Record<string, boolean>
        setMerchantOpenedBankSettlementSetup(parsed && typeof parsed === "object" ? parsed : {})
      }
      const stored = window.localStorage.getItem("pinetree.speed.bankSettlementConfirmed")
      if (stored) {
        const parsed = JSON.parse(stored) as Record<string, boolean>
        setMerchantConfirmedBankSettlement(parsed && typeof parsed === "object" ? parsed : {})
      }
    } catch {
      setMerchantOpenedBankSettlementSetup({})
      setMerchantConfirmedBankSettlement({})
    }
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
    setSpeedWithdrawalAmount("")
    setSpeedWithdrawalDestinationType("lightning_invoice")
    setSpeedWithdrawalDestinationValue("")
    setSpeedWithdrawalMemo("")
    setSpeedWithdrawalDraft(null)
    setSpeedWithdrawalMessage(null)
    setSpeedWithdrawalError(null)
    setSpeedWithdrawalLoading(false)
    setActivityFilter("all")
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
      setRecentSpeedOperations(payload?.recentSpeedOperations || [])
      setTotalBalance(Number(payload?.totalUsd ?? 0) || 0)
      setLastRefreshAt(payload?.lastRun || null)
      setSelectedWallet((current) => {
        if (!current?.isLightning) return current
        const nextRail = (payload?.paymentRails || []).find((rail) => rail.id === current.id)
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

  async function createSpeedWithdrawalDraft() {
    if (!selectedWallet?.isLightning) return

    const amount = Number(speedWithdrawalAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setSpeedWithdrawalError("Enter a withdrawal amount greater than zero.")
      return
    }

    if (!speedWithdrawalDestinationValue.trim()) {
      setSpeedWithdrawalError("Enter a destination or invoice.")
      return
    }

    setSpeedWithdrawalLoading(true)
    setSpeedWithdrawalError(null)
    setSpeedWithdrawalMessage(null)
    setSpeedWithdrawalDraft(null)

    try {
      const token = await getMerchantToken()
      const res = await fetch("/api/wallets/speed/withdrawals/draft", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
          walletId: selectedWallet.id,
          amount,
          destinationType: speedWithdrawalDestinationType,
          destinationValue: speedWithdrawalDestinationValue.trim(),
          memo: speedWithdrawalMemo.trim() || null
        })
      })
      const payload = (await res.json().catch(() => null)) as SpeedWithdrawalDraftResponse | null

      if (!res.ok || !payload?.success || !payload.operation) {
        throw new Error(payload?.error || "Cash-out request could not be saved.")
      }

      setSpeedWithdrawalDraft(payload.operation)
      setSpeedWithdrawalMessage(
        "Your cash-out request has been saved for review."
      )
      await loadOverview(false)
    } catch (err) {
      setSpeedWithdrawalError(err instanceof Error ? err.message : "Cash-out preview failed")
    } finally {
      setSpeedWithdrawalLoading(false)
    }
  }

  async function openSpeedDashboard() {
    if (!selectedWallet?.speedSetupStatus?.dashboardUrl) return

    try {
      const token = await getMerchantToken()
      const res = await fetch("/api/wallets/speed/dashboard", {
        headers: {
          Authorization: `Bearer ${token}`
        },
        credentials: "include",
        cache: "no-store",
        redirect: "manual"
      })

      if (!res.ok && res.type !== "opaqueredirect") {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error || "Speed dashboard is not available.")
      }

      markSpeedBankSetupOpened()
      window.open(selectedWallet.speedSetupStatus.dashboardUrl, "_blank", "noopener,noreferrer")
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : "Speed dashboard is not available.")
    }
  }

  function openSpeedBankSetup() {
    const bankSetupUrl = selectedWallet?.speedSetupStatus?.bankSetupUrl
    if (bankSetupUrl) {
      markSpeedBankSetupOpened()
      window.open(bankSetupUrl, "_blank", "noopener,noreferrer")
    }
  }

  function markSpeedBankSetupOpened() {
    const key = getBankSettlementKey(selectedWallet?.speedSetupStatus)
    if (!key) return

    setMerchantOpenedBankSettlementSetup((current) => {
      const next = { ...current, [key]: true }
      try {
        window.localStorage.setItem("pinetree.speed.bankSettlementOpened", JSON.stringify(next))
      } catch {
        // Local storage can be unavailable in private or restricted browser contexts.
      }
      return next
    })
  }

  function markSpeedBankSetupCompleted() {
    const key = getBankSettlementKey(selectedWallet?.speedSetupStatus)
    if (!key) return

    markSpeedBankSetupOpened()
    setMerchantConfirmedBankSettlement((current) => {
      const next = { ...current, [key]: true }
      try {
        window.localStorage.setItem("pinetree.speed.bankSettlementConfirmed", JSON.stringify(next))
      } catch {
        // Local storage can be unavailable in private or restricted browser contexts.
      }
      return next
    })
  }

  function openSupportTicket() {
    window.location.href = "/dashboard/help#support-ticket"
  }

  function buildLightningWallet(rail: PaymentRailItem): SelectedWallet {
    return {
      id: rail.id,
      displayName: "Bitcoin Lightning",
      rail: "bitcoin_lightning",
      provider: "Speed",
      networkLabel: "Bitcoin Lightning",
      reference: formatSpeedAccountId(rail.speedAccountId),
      referenceTitle: rail.speedAccountId,
      referenceLabel: "Account Reference",
      assetSymbol: "BTC",
      nativeBalance: rail.nativeBalance,
      usdValue: rail.usdValue,
      decimals: 8,
      isLightning: true,
      speedSetupStatus: rail.speedSetupStatus
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
  const speedSetupStatus = selectedWallet?.speedSetupStatus || null
  const speedActivity = recentSpeedOperations.filter((operation) => operation.provider === "speed")
  const latestSpeedActivity = speedActivity[0] || null
  const bankSettlementKey = getBankSettlementKey(speedSetupStatus)
  const bankSettlementSetupOpened = Boolean(bankSettlementKey && merchantOpenedBankSettlementSetup[bankSettlementKey])
  const bankSettlementMerchantConfirmed = Boolean(bankSettlementKey && merchantConfirmedBankSettlement[bankSettlementKey])
  const bankSettlementProviderVerified = Boolean(
    speedSetupStatus?.bankPayoutsEnabled ||
    (speedSetupStatus?.bankPayoutCapabilityVerified && speedSetupStatus?.bankPayoutDestinationConfigured)
  )
  const bankSettlementState = getBankSettlementState(speedSetupStatus, bankSettlementMerchantConfirmed)
  const bankSettlementDisplay = {
    ...getBankSettlementDisplay(bankSettlementState),
    helper: getBankSettlementHelper(bankSettlementState)
  }
  const lightningNextAction = getLightningNextAction({
    bankSettlementState,
    hasBalance: Number(selectedWallet?.nativeBalance || 0) > 0,
    hasActivity: Boolean(latestSpeedActivity)
  })
  const filteredSpeedActivity = speedActivity.filter((operation) => {
    if (activityFilter === "completed") return operation.status === "COMPLETED"
    if (activityFilter === "failed") return operation.status === "FAILED" || operation.status === "VALIDATION_FAILED"
    if (activityFilter === "drafts") return operation.status === "DRAFT"
    return true
  })
  const activityGroups = filteredSpeedActivity.reduce(
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
      { id: "cash_out", label: "Cash Out" },
      { id: "speed_setup", label: "Provider Setup" },
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
                      <div className="rounded-2xl border border-[#0052FF]/15 bg-[#0052FF]/5 p-4 shadow-[0_8px_24px_rgba(0,82,255,0.06)] sm:p-5">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0052FF]">Bitcoin Lightning</p>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <p className="text-lg font-semibold text-gray-950 sm:text-xl">Connected</p>
                              <NetworkStatusPill label="Ready" tone="blue" />
                            </div>
                            <p className="mt-1 text-sm leading-6 text-gray-700 sm:mt-2">
                              PineTree is tracking this Lightning balance and the cash-out paths available today.
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 sm:gap-3">
                        <StatTile
                          label="Balance"
                          value={`${Number(selectedWallet.nativeBalance ?? 0).toFixed(selectedWallet.decimals)} ${selectedWallet.assetSymbol}`}
                          helper={`$${Number(selectedWallet.usdValue ?? 0).toFixed(2)} USD`}
                          tone="blue"
                        />
                        <StatTile
                          label="Cash Out"
                          value="Available"
                          helper="Invoice or Bitcoin address"
                          tone="blue"
                        />
                        <StatTile
                          label="Bank Settlement"
                          value={bankSettlementDisplay.status}
                          helper={bankSettlementDisplay.helper}
                          tone={bankSettlementState === "ready" ? "blue" : bankSettlementState === "not_configured" ? "amber" : "slate"}
                        />
                        <StatTile
                          label="Last Sync"
                          value={lastRefreshAt ? formatChicagoDateTime(lastRefreshAt) : "Not available"}
                          helper={speedSetupStatus?.balanceAvailable ? "Sync active" : "Refresh to check"}
                          tone={speedSetupStatus?.balanceAvailable ? "blue" : "amber"}
                        />
                        <StatTile
                          label="Last Activity"
                          value={latestSpeedActivity ? formatOperationStatusForMerchant(latestSpeedActivity.status) : "None"}
                          helper={latestSpeedActivity ? formatChicagoDateTime(latestSpeedActivity.createdAt) : "No activity yet"}
                          tone="slate"
                        />
                      </div>

                      <div className="rounded-2xl border border-[#0052FF]/15 bg-white p-4 shadow-[0_10px_30px_rgba(0,82,255,0.08)] sm:p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-[#0052FF]">Next Action</p>
                            <p className="mt-1 text-base font-semibold text-gray-950">{lightningNextAction.title}</p>
                            <p className="mt-1 text-sm leading-5 text-gray-600 sm:leading-6">{lightningNextAction.description}</p>
                          </div>
                          <NetworkStatusPill
                            label={bankSettlementDisplay.status}
                            tone={bankSettlementState === "ready" ? "blue" : bankSettlementState === "not_configured" ? "amber" : "slate"}
                          />
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 sm:flex-row">
                        {lightningNextAction.action === "Set Up Bank Settlement" ? (
                          <button
                            type="button"
                            onClick={openSpeedBankSetup}
                            className={cx(pineTreePrimaryButton, "w-full sm:w-fit")}
                          >
                            Set Up Bank Settlement
                          </button>
                        ) : lightningNextAction.action === "Open Speed Dashboard" ? (
                          <button
                            type="button"
                            onClick={openSpeedDashboard}
                            className={cx(pineTreePrimaryButton, "w-full sm:w-fit")}
                          >
                            Open Speed Dashboard
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              if (lightningNextAction.action === "Refresh Balance" || lightningNextAction.action === "Refresh Status") {
                                void loadOverview(true)
                                return
                              }
                              if (lightningNextAction.action === "Contact Support") {
                                openSupportTicket()
                                return
                              }
                              setActiveTab("cash_out")
                            }}
                            disabled={isRefreshing && (lightningNextAction.action === "Refresh Balance" || lightningNextAction.action === "Refresh Status")}
                            className={cx(pineTreePrimaryButton, "w-full sm:w-fit")}
                          >
                            {lightningNextAction.action === "Refresh Balance" || lightningNextAction.action === "Refresh Status"
                              ? (isRefreshing ? "Refreshing..." : lightningNextAction.action)
                              : lightningNextAction.action === "Contact Support"
                                ? "Contact Support"
                                : "Cash Out Funds"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setActiveTab("speed_setup")}
                          disabled={isRefreshing}
                          className={cx(pineTreeSecondaryActionButton, "w-full sm:w-fit")}
                        >
                          View Setup
                        </button>
                      </div>

                      <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-gray-950">Account Management</p>
                            <p className="mt-1 text-sm leading-6 text-gray-600">
                              Provider details and connection controls for this Lightning account.
                            </p>
                          </div>
                          <NetworkStatusPill label="Speed" tone="slate" />
                        </div>
                        <div className="mt-3 flex items-center gap-2 rounded-xl border border-gray-100 bg-white/80 p-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">
                              Account Reference
                            </p>
                            <p className="mt-1 truncate font-mono text-sm text-gray-700" title={selectedWallet.referenceTitle}>
                              {selectedWallet.reference}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(selectedWallet.referenceTitle)}
                            className="inline-flex min-h-9 shrink-0 items-center rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-600 shadow-sm transition hover:border-gray-300 hover:bg-gray-50"
                          >
                            {copiedRef ? "Copied" : "Copy"}
                          </button>
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
                    <>
                      <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4 shadow-[0_8px_24px_rgba(0,82,255,0.07)]">
                        <p className="text-base font-semibold text-blue-950">Cash Out</p>
                        <p className="mt-2 text-sm leading-6 text-blue-900/75">
                          Send funds from your Bitcoin Lightning balance to a Lightning invoice or Bitcoin address.
                        </p>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3">
                        <CapabilityCard
                          title="Lightning Invoice Withdrawals"
                          status="Available"
                          description="Use an invoice from another Lightning wallet."
                          tone="blue"
                        />
                        <CapabilityCard
                          title="Bitcoin Address Withdrawals"
                          status="Available"
                          description="Use a compatible Bitcoin address."
                          tone="blue"
                        />
                        <CapabilityCard
                          title="Bank Account Withdrawals"
                          status={bankSettlementDisplay.status}
                          description={bankSettlementDisplay.helper}
                          tone={bankSettlementState === "ready" ? "blue" : bankSettlementState === "not_configured" ? "amber" : "slate"}
                        />
                      </div>

                      {bankSettlementState !== "ready" && (
                        <div className="rounded-xl border border-[#0052FF]/10 bg-[#0052FF]/5 p-3 text-sm leading-6 text-gray-700">
                          {bankSettlementDisplay.status}: {bankSettlementDisplay.helper}
                          <button
                            type="button"
                            onClick={() => setActiveTab("speed_setup")}
                            className="ml-1 font-semibold text-[#0052FF] underline-offset-2 hover:underline"
                          >
                            Review setup
                          </button>
                        </div>
                      )}

                      <div className="grid gap-3">
                        <label className="block rounded-xl border border-gray-100 bg-gray-50/70 p-3.5">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">
                            Destination Type
                          </span>
                          <select
                            value={speedWithdrawalDestinationType}
                            onChange={(event) => {
                              setSpeedWithdrawalDestinationType(event.target.value as SpeedWithdrawalDestinationType)
                              setSpeedWithdrawalDraft(null)
                              setSpeedWithdrawalError(null)
                              setSpeedWithdrawalMessage(null)
                            }}
                            className="mt-2 w-full border-0 bg-transparent p-0 text-sm font-semibold text-gray-800 outline-none"
                          >
                            <option value="lightning_invoice">Lightning invoice</option>
                            <option value="bitcoin_address">Bitcoin address</option>
                          </select>
                        </label>
                        <label className="block rounded-xl border border-gray-100 bg-gray-50/70 p-3.5">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">
                            Amount
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="0.00000001"
                            value={speedWithdrawalAmount}
                            onChange={(event) => {
                              setSpeedWithdrawalAmount(event.target.value)
                              setSpeedWithdrawalDraft(null)
                              setSpeedWithdrawalError(null)
                              setSpeedWithdrawalMessage(null)
                            }}
                            placeholder="0.00000000 BTC"
                            className="mt-2 w-full border-0 bg-transparent p-0 text-sm font-semibold text-gray-800 outline-none placeholder:text-gray-400"
                          />
                        </label>
                        <label className="block rounded-xl border border-gray-100 bg-gray-50/70 p-3.5">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">
                            Destination
                          </span>
                          <input
                            value={speedWithdrawalDestinationValue}
                            onChange={(event) => {
                              setSpeedWithdrawalDestinationValue(event.target.value)
                              setSpeedWithdrawalDraft(null)
                              setSpeedWithdrawalError(null)
                              setSpeedWithdrawalMessage(null)
                            }}
                            placeholder="Lightning invoice or Bitcoin address"
                            className="mt-2 w-full border-0 bg-transparent p-0 text-sm font-semibold text-gray-800 outline-none placeholder:text-gray-400"
                          />
                        </label>
                        <label className="block rounded-xl border border-gray-100 bg-gray-50/70 p-3.5">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">
                            Reference / Memo
                          </span>
                          <input
                            value={speedWithdrawalMemo}
                            onChange={(event) => {
                              setSpeedWithdrawalMemo(event.target.value)
                              setSpeedWithdrawalDraft(null)
                              setSpeedWithdrawalError(null)
                              setSpeedWithdrawalMessage(null)
                            }}
                            placeholder="Optional internal note"
                            className="mt-2 w-full border-0 bg-transparent p-0 text-sm font-semibold text-gray-800 outline-none placeholder:text-gray-400"
                          />
                        </label>
                      </div>

                      {speedWithdrawalError && (
                        <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm leading-6 text-red-700">
                          {speedWithdrawalError}
                        </p>
                      )}

                      {speedWithdrawalDraft && (
                        <div className="rounded-2xl border border-[#0052FF]/15 bg-[#0052FF]/5 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-gray-950">Cash Out Request Saved</p>
                            <NetworkStatusPill label={formatOperationStatusForMerchant(speedWithdrawalDraft.status)} tone="blue" />
                          </div>
                          <div className="mt-3 grid gap-2 text-sm text-gray-600 sm:grid-cols-2">
                            <p>Amount: {speedWithdrawalDraft.amount} BTC</p>
                            <p>Destination type: {formatSpeedDestinationType(speedWithdrawalDraft.destinationType)}</p>
                          </div>
                          {speedWithdrawalMessage && (
                            <p className="mt-3 text-xs leading-5 text-gray-500">
                              {speedWithdrawalMessage}
                            </p>
                          )}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={createSpeedWithdrawalDraft}
                        disabled={speedWithdrawalLoading}
                        className={pineTreePrimaryButton}
                      >
                        {speedWithdrawalLoading ? "Saving..." : "Create Cash Out Request"}
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

              {activeTab === "speed_setup" && selectedWallet.isLightning && (
                <div className={walletDetailPanelClass}>
                  <div className="rounded-2xl border border-[#0052FF]/15 bg-[#0052FF]/5 p-4 shadow-[0_8px_24px_rgba(0,82,255,0.06)] sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-[#0052FF]">Provider Health</p>
                        <p className="mt-1 text-base font-semibold text-gray-950">Connected</p>
                        <p className="mt-1 text-sm leading-6 text-gray-700">
                          What PineTree can do with this Bitcoin Lightning wallet today.
                        </p>
                      </div>
                      <NetworkStatusPill
                        label={speedSetupStatus?.connected ? "Connected" : "Not connected"}
                        tone={speedSetupStatus?.connected ? "blue" : "slate"}
                      />
                    </div>
                  </div>

                  <div className={cx(
                    "rounded-2xl border p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-5",
                    bankSettlementState === "ready"
                      ? "border-emerald-200 bg-emerald-50/70"
                      : bankSettlementState === "not_configured"
                        ? "border-amber-200 bg-amber-50/70"
                        : "border-[#0052FF]/15 bg-white"
                  )}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-500">
                          {bankSettlementDisplay.title}
                        </p>
                        <p className="mt-2 text-lg font-semibold text-gray-950">
                          {getBankSettlementSetupHeading(bankSettlementState)}
                        </p>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-700">{bankSettlementDisplay.helper}</p>
                        <BankSettlementStepList state={bankSettlementState} />
                      </div>
                      <NetworkStatusPill
                        label={bankSettlementDisplay.status}
                        tone={bankSettlementState === "ready" ? "blue" : bankSettlementState === "not_configured" ? "amber" : "slate"}
                      />
                    </div>

                    <div className="mt-4">
                      <BankSettlementChecklist
                        state={bankSettlementState}
                        providerSetupAvailable={bankSettlementSetupOpened}
                        merchantConfirmed={bankSettlementMerchantConfirmed}
                        providerVerified={bankSettlementProviderVerified}
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {bankSettlementDisplay.action === "Set Up Bank Settlement" && (
                      <button type="button" onClick={openSpeedBankSetup} className={pineTreePrimaryButton}>
                        Set Up Bank Settlement
                      </button>
                    )}
                    {bankSettlementDisplay.action === "Open Speed Dashboard" && (
                      <button type="button" onClick={openSpeedDashboard} className={pineTreePrimaryButton}>
                        Open Speed Dashboard
                      </button>
                    )}
                    {bankSettlementDisplay.action === "Refresh Status" && (
                      <button
                        type="button"
                        onClick={() => loadOverview(true)}
                        disabled={isRefreshing}
                        className={pineTreePrimaryButton}
                      >
                        {isRefreshing ? "Refreshing..." : "Refresh Status"}
                      </button>
                    )}
                    {bankSettlementDisplay.action === "Cash Out Funds" && (
                      <button type="button" onClick={() => setActiveTab("cash_out")} className={pineTreePrimaryButton}>
                        Cash Out Funds
                      </button>
                    )}
                    {bankSettlementDisplay.action === "Contact Support" && (
                      <button type="button" onClick={openSupportTicket} className={pineTreePrimaryButton}>
                        Contact Support
                      </button>
                    )}

                    {(bankSettlementState === "direct_setup" || bankSettlementState === "dashboard_setup") && (
                      <button
                        type="button"
                        onClick={markSpeedBankSetupCompleted}
                        className={pineTreeSecondaryActionButton}
                      >
                        I completed provider setup
                      </button>
                    )}

                    {bankSettlementDisplay.action !== "Refresh Status" && (
                      <button
                        type="button"
                        onClick={() => loadOverview(true)}
                        disabled={isRefreshing}
                        className={pineTreeSecondaryActionButton}
                      >
                        {isRefreshing ? "Refreshing..." : "Refresh Status"}
                      </button>
                    )}
                  </div>

                  <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-3 text-sm leading-6 text-gray-600">
                    Speed does not currently expose a PineTree-verified bank payout capability here. Merchant confirmation only records that setup was completed in Speed; it does not enable withdrawals.
                  </div>
                </div>
              )}

              {activeTab === "activity" && (
                <div className={walletDetailPanelClass}>
                  {selectedWallet.isLightning && speedActivity.length > 0 ? (
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

                      {filteredSpeedActivity.length === 0 ? (
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
                                          {operation.operationType === "WITHDRAWAL_DRAFT" ? "Cash out" : operation.operationType.replace(/_/g, " ")}
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
                                    <div className="mt-3 rounded-xl border border-white/80 bg-white/70 px-3 py-2 text-xs text-gray-500">
                                      Destination: {formatSpeedDestinationType(operation.destinationType)}
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
