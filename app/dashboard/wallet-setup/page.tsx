"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useDynamicContext, useUserWallets } from "@dynamic-labs/sdk-react-core"
import { AlertTriangle, CheckCircle2, Copy, RefreshCw, X } from "lucide-react"
import { supabase } from "@/lib/supabaseClient"
import {
  extractDynamicWalletAddresses,
  type DynamicAddressMetadata,
  type DynamicWalletAddressSource,
  type NetworkId,
  networkForWallet,
  shortAddress,
} from "@/lib/wallets/sparkDetection"
import {
  DashboardSection,
  ProviderStatusPill,
  dashboardPageTitleClass,
} from "@/components/dashboard/DashboardPrimitives"
import { usePineTreeWalletInfrastructureStatus } from "@/components/providers/PineTreeDynamicProvider"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WalletTab = "overview" | "balances" | "receive" | "withdraw" | "activity"
type AddressEntry = { id: string; address: string; detail?: string }
type WithdrawalRail = "base" | "solana" | "bitcoin"
type WithdrawalAsset = "ETH" | "USDC" | "SOL" | "BTC"

type WithdrawalReviewResponse = {
  request: {
    id: string
    status: "draft" | "review_required" | "blocked" | "pending" | "processing" | "confirmed" | "failed" | "canceled"
    provider_reference: string | null
    tx_hash: string | null
    error_message: string | null
  }
  review: {
    rail: WithdrawalRail
    asset: WithdrawalAsset
    destinationAddress: string
    amountDecimal: string
    estimatedStatus: "Withdrawal review available" | "Pending review" | "Processing"
    message: string
  }
  canSubmit: boolean
}

type WithdrawalSubmitResponse = {
  request: WithdrawalReviewResponse["request"]
  merchantStatus: "Pending review" | "Processing" | "Withdrawal failed"
  message: string
}

type PineTreeWalletProfile = {
  id: string
  dynamic_user_id: string | null
  base_address: string | null
  solana_address: string | null
  bitcoin_lightning_address: string | null
  bitcoin_onchain_address: string | null
  bitcoin_lightning_status: "not_configured" | "pending" | "ready" | "needs_attention"
  bitcoin_lightning_provider: string | null
  bitcoin_lightning_account_id: string | null
  btc_address: string | null
  btc_address_type: "taproot" | "native_segwit" | "legacy" | "nested_segwit" | "unknown" | null
  btc_wallet_provider: string | null
  btc_payout_enabled: boolean
  btc_payout_verified_at: string | null
  status: "not_created" | "needs_attention" | "ready"
}

type MerchantLightningProfile = {
  id: string
  merchant_id: string
  provider: "speed"
  status: "not_configured" | "pending" | "ready" | "needs_attention"
  speed_connected_account_id: string | null
  speed_connected_account_status: string | null
  setup_source: "pinetree_managed"
}

type ProfileState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "loaded"; profile: PineTreeWalletProfile }
  | { kind: "error" }

type LightningProfileState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "loaded"; profile: MerchantLightningProfile }
  | { kind: "error" }

type EnabledRailState = {
  base: boolean
  solana: boolean
  bitcoin: boolean
}

type ProvidersDashboardResponse = {
  providers?: Array<{
    provider: string
    status?: string
    enabled?: boolean
  }>
}

type WalletCreationStep =
  | "idle"
  | "opening_dynamic"
  | "waiting_for_dynamic_auth"
  | "dynamic_authenticated"
  | "waiting_for_embedded_wallets"
  | "wallets_detected"
  | "extracting_addresses"
  | "syncing_pinetree_profile"
  | "profile_synced"
  | "failed"
  | "timeout"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const walletTabs: Array<{ id: WalletTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "balances", label: "Balances" },
  { id: "receive", label: "Receive" },
  { id: "withdraw", label: "Withdraw" },
  { id: "activity", label: "Activity" },
]

const defaultEnabledRails: EnabledRailState = { base: false, solana: false, bitcoin: false }
const withdrawalAssetsByRail: Record<WithdrawalRail, WithdrawalAsset[]> = {
  base: ["ETH", "USDC"],
  solana: ["SOL", "USDC"],
  bitcoin: ["BTC"],
}
const walletCreationTimeoutMs = 30_000
const walletCreationDebugEnabled =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_PINE_TREE_WALLET_DEBUG === "true"

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function WalletProfileShell({
  status,
  tone,
  message,
}: {
  status: "Needs attention" | "Loading"
  tone: "amber" | "blue"
  message: string
}) {
  return (
    <article className="rounded-2xl border border-gray-200/80 bg-white/90 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.07)] backdrop-blur sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-950">PineTree Wallet</h2>
          <p className="mt-1 text-sm leading-5 text-gray-600">{message}</p>
        </div>
        <ProviderStatusPill label={status} tone={tone} />
      </div>
    </article>
  )
}

function WalletSetupUnavailable({ kind }: { kind: "missing-env" | "sdk" }) {
  return (
    <WalletProfileShell
      status="Needs attention"
      tone="amber"
      message={
        kind === "missing-env"
          ? "PineTree Wallet setup is not configured for this deployment."
          : "PineTree Wallet setup could not load. Refresh the page and try again."
      }
    />
  )
}

function EmptyWalletPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/70 px-4 py-8 text-center">
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      <p className="mt-1 text-xs leading-5 text-gray-500">{detail}</p>
    </div>
  )
}

function walletCreationStepMessage(step: WalletCreationStep) {
  if (step === "opening_dynamic") return "Creating wallet..."
  if (step === "waiting_for_dynamic_auth") return "Waiting for wallet login..."
  if (step === "dynamic_authenticated") return "Wallet login complete..."
  if (step === "waiting_for_embedded_wallets") return "Waiting for wallet addresses..."
  if (step === "wallets_detected" || step === "extracting_addresses") return "Preparing wallet addresses..."
  if (step === "syncing_pinetree_profile") return "Syncing PineTree Wallet..."
  if (step === "profile_synced") return ""
  if (step === "timeout") return "Wallet setup is taking longer than expected. Please try again."
  if (step === "failed") return "Wallet setup could not finish. Please try again."
  return ""
}

function safeWalletSetupDiagnostics({
  userExists,
  wallets,
  sdkNetworkGroups,
  profileSyncRequestSent,
  profileSyncResponseStatus,
}: {
  userExists: boolean
  wallets: ReturnType<typeof useUserWallets>
  sdkNetworkGroups: Record<NetworkId, AddressEntry[]>
  profileSyncRequestSent?: boolean
  profileSyncResponseStatus?: number
}) {
  return {
    dynamic_user_exists: userExists,
    wallet_count: wallets.length,
    wallet_connector_keys: wallets.map((wallet) =>
      String((wallet.connector as unknown as Record<string, unknown>)["key"] ?? "")
    ),
    wallet_connector_names: wallets.map((wallet) => String(wallet.connector.name || "")),
    wallet_chain_names: wallets.map((wallet) => String(wallet.chain || "")),
    wallet_addresses_present: wallets.map((wallet) => Boolean(wallet.address)),
    base_address_present: sdkNetworkGroups.base.length > 0,
    solana_address_present: sdkNetworkGroups.solana.length > 0,
    bitcoin_address_present: sdkNetworkGroups.bitcoin.length > 0,
    profile_sync_request_sent: profileSyncRequestSent,
    profile_sync_response_status: profileSyncResponseStatus,
  }
}

// ---------------------------------------------------------------------------
// Dev diagnostics (hidden in production)
// ---------------------------------------------------------------------------

function WalletDiagnosticsPanel({
  wallets,
  sdkNetworkGroups,
}: {
  wallets: ReturnType<typeof useUserWallets>
  sdkNetworkGroups: Record<NetworkId, AddressEntry[]>
}) {
  function sanitizeAdditionalAddress(extra: DynamicAddressMetadata, index: number) {
    const address = typeof extra.address === "string" ? extra.address : ""
    return {
      index,
      hasAddress: Boolean(address),
      addressPrefix: address ? shortAddress(address) : "none",
      addressType: extra.addressType ? String(extra.addressType) : "",
      type: extra.type ? String(extra.type) : "",
      chain: extra.chain ? String(extra.chain) : "",
      network: extra.network ? String(extra.network) : "",
      label: extra.label ? String(extra.label) : "",
      name: extra.name ? String(extra.name) : "",
      key: extra.key ? String(extra.key) : "",
    }
  }

  const rows = wallets.map((w) => ({
    walletId: w.id,
    key: w.key,
    connectorName: w.connector.name,
    connectorKey: String((w.connector as unknown as Record<string, unknown>)["key"] ?? ""),
    chain: w.chain,
    detectedNetwork: networkForWallet(
      w.chain,
      w.key,
      w.connector.name,
      String((w.connector as unknown as Record<string, unknown>)["key"] ?? "")
    ),
    hasAddress: Boolean(w.address),
    addressPrefix: w.address ? `${w.address.slice(0, 6)}…` : "—",
    extraAddressCount: (w.additionalAddresses ?? []).length,
    additionalAddresses: (w.additionalAddresses ?? []).map((extra, index) =>
      sanitizeAdditionalAddress(extra as DynamicAddressMetadata, index)
    ),
  }))

  useEffect(() => {
    console.debug("[pinetree-wallets] sdk diagnostics", {
      walletCount: wallets.length,
      wallets: rows,
      sdkSummary: {
        base: sdkNetworkGroups.base.length,
        solana: sdkNetworkGroups.solana.length,
        lightning: sdkNetworkGroups.lightning.length,
        bitcoin: sdkNetworkGroups.bitcoin.length,
      },
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets])

  return (
    <div className="rounded-xl border border-dashed border-yellow-300 bg-yellow-50/60 px-4 py-3 text-[11px] font-mono">
      <p className="mb-2 font-sans text-xs font-semibold text-yellow-700">DEV — wallet SDK diagnostics (hidden in production)</p>
      {rows.length === 0 ? (
        <p className="text-yellow-700">No wallet objects returned by useUserWallets() yet</p>
      ) : (
        <div className="space-y-1 text-yellow-900">
          {rows.map((row, idx) => (
            <div key={idx} className="flex flex-wrap gap-x-3 rounded bg-yellow-100/70 px-2 py-1">
              <span><span className="text-yellow-600">net:</span> {row.detectedNetwork ?? "undetected"}</span>
              <span><span className="text-yellow-600">id:</span> {row.walletId}</span>
              <span><span className="text-yellow-600">key:</span> {row.key}</span>
              <span><span className="text-yellow-600">chain:</span> {row.chain}</span>
              <span><span className="text-yellow-600">connector:</span> {row.connectorName}{row.connectorKey ? ` [${row.connectorKey}]` : ""}</span>
              <span><span className="text-yellow-600">addr:</span> {row.addressPrefix}</span>
              {row.extraAddressCount > 0 ? (
                <span>
                  <span className="text-yellow-600">+extra:</span>{" "}
                  {row.additionalAddresses.map((extra) => (
                    <span key={extra.index}>
                      #{extra.index} {extra.addressPrefix}
                      {extra.addressType ? ` addressType=${extra.addressType}` : ""}
                      {extra.type ? ` type=${extra.type}` : ""}
                      {extra.chain ? ` chain=${extra.chain}` : ""}
                      {extra.network ? ` network=${extra.network}` : ""}
                      {extra.label ? ` label=${extra.label}` : ""}
                      {extra.name ? ` name=${extra.name}` : ""}
                      {extra.key ? ` key=${extra.key}` : ""}
                    </span>
                  ))}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-3 text-yellow-700">
        <span>lightning: {sdkNetworkGroups.lightning.length}</span>
        <span>base: {sdkNetworkGroups.base.length}</span>
        <span>solana: {sdkNetworkGroups.solana.length}</span>
        <span>btc: {sdkNetworkGroups.bitcoin.length}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Receive row (inside modal)
// ---------------------------------------------------------------------------

function ReceiveRow({
  label,
  entries,
  copiedAddress,
  onCopy,
}: {
  label: string
  entries: AddressEntry[]
  copiedAddress: string
  onCopy: (address: string) => void
}) {
  const isConnected = entries.length > 0
  return (
    <div className="rounded-2xl border border-gray-200/80 bg-white px-4 py-4 shadow-[0_8px_24px_rgba(15,23,42,0.05)] sm:px-5 sm:py-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-gray-800">{label}</p>
        <ProviderStatusPill label={isConnected ? "Connected" : "Not connected"} tone="blue" />
      </div>
      {isConnected ? (
        <div className="mt-3 space-y-3">
          {entries.map((entry) => (
            <div key={entry.id} className="flex min-w-0 items-center gap-2">
              <div className="min-w-0 flex-1">
                {entry.detail ? (
                  <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">{entry.detail}</p>
                ) : null}
                <p className="truncate font-mono text-xs text-gray-800" title={entry.address}>
                  {entry.address}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onCopy(entry.address)}
                aria-label={`Copy ${label}`}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition hover:text-blue-700"
              >
                {copiedAddress === entry.address ? <CheckCircle2 size={15} /> : <Copy size={15} />}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function WithdrawalFormShell({
  rail,
  asset,
  destinationAddress,
  amountDecimal,
  review,
  error,
  reviewing,
  submitting,
  submitResult,
  onRailChange,
  onAssetChange,
  onDestinationChange,
  onAmountChange,
  onReview,
  onSubmit,
}: {
  rail: WithdrawalRail
  asset: WithdrawalAsset
  destinationAddress: string
  amountDecimal: string
  review: WithdrawalReviewResponse | null
  error: string
  reviewing: boolean
  submitting: boolean
  submitResult: WithdrawalSubmitResponse | null
  onRailChange: (rail: WithdrawalRail) => void
  onAssetChange: (asset: WithdrawalAsset) => void
  onDestinationChange: (value: string) => void
  onAmountChange: (value: string) => void
  onReview: () => void
  onSubmit: () => void
}) {
  const availableAssets = withdrawalAssetsByRail[rail]
  const invalidAmount = amountDecimal.trim().length > 0 && !(Number(amountDecimal) > 0)
  const missingDestination = destinationAddress.trim().length === 0
  const reviewDisabled = reviewing || missingDestination || invalidAmount

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3">
        <p className="text-sm font-semibold text-blue-900">Withdrawal review available</p>
        <p className="mt-1 text-xs leading-5 text-blue-700">
          Prepare a withdrawal request for PineTree review and processing.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-gray-700">Rail</span>
          <select
            value={rail}
            onChange={(event) => onRailChange(event.target.value as WithdrawalRail)}
            aria-label="Select withdrawal rail"
            className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
          >
            <option value="base">Base</option>
            <option value="solana">Solana</option>
            <option value="bitcoin">Bitcoin</option>
          </select>
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-gray-700">Asset</span>
          <select
            value={asset}
            onChange={(event) => onAssetChange(event.target.value as WithdrawalAsset)}
            aria-label="Select withdrawal asset"
            className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
          >
            {availableAssets.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs font-semibold text-gray-700">Destination address</span>
        <input
          value={destinationAddress}
          onChange={(event) => onDestinationChange(event.target.value)}
          aria-label="Destination address"
          placeholder="Paste destination address"
          className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 font-mono text-sm text-gray-900 outline-none transition placeholder:font-sans placeholder:text-gray-400 focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs font-semibold text-gray-700">Amount</span>
        <input
          value={amountDecimal}
          onChange={(event) => onAmountChange(event.target.value)}
          inputMode="decimal"
          aria-label="Withdrawal amount"
          placeholder="0.00"
          className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
        />
      </label>

      {(error || invalidAmount || missingDestination) ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800">
          {error || (invalidAmount ? "Enter a positive withdrawal amount." : "Enter a destination address to review.")}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={onReview}
          disabled={reviewDisabled}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 disabled:shadow-none"
        >
          {reviewing ? "Reviewing..." : "Review withdrawal"}
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!review || submitting}
          className="inline-flex h-10 items-center justify-center rounded-lg border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-blue-200 hover:text-blue-700 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 disabled:shadow-none"
        >
          {submitting ? "Submitting..." : "Submit withdrawal request"}
        </button>
      </div>

      {submitResult ? (
        <div className={`rounded-2xl border px-4 py-3 ${
          submitResult.merchantStatus === "Withdrawal failed"
            ? "border-red-200 bg-red-50"
            : submitResult.merchantStatus === "Processing"
              ? "border-blue-200 bg-blue-50"
              : "border-amber-200 bg-amber-50"
        }`}>
          <p className={`text-sm font-semibold ${
            submitResult.merchantStatus === "Withdrawal failed"
              ? "text-red-800"
              : submitResult.merchantStatus === "Processing"
                ? "text-blue-900"
                : "text-amber-900"
          }`}>
            {submitResult.merchantStatus === "Processing" ? "Withdrawal submitted" : submitResult.merchantStatus === "Withdrawal failed" ? "Withdrawal failed" : "Withdrawal request submitted"}
          </p>
          <p className="mt-1 text-xs leading-5 text-gray-700">Status: {submitResult.merchantStatus}</p>
          {submitResult.merchantStatus === "Pending review" ? (
            <p className="mt-1 text-xs leading-5 text-gray-700">We&apos;ll review this withdrawal before processing.</p>
          ) : null}
          {submitResult.request.provider_reference || submitResult.request.tx_hash ? (
            <p className="mt-1 break-all text-xs leading-5 text-gray-700">
              Transaction reference: {submitResult.request.tx_hash || submitResult.request.provider_reference}
            </p>
          ) : null}
          {submitResult.merchantStatus === "Withdrawal failed" && submitResult.request.error_message ? (
            <p className="mt-1 text-xs leading-5 text-red-700">{submitResult.request.error_message}</p>
          ) : null}
        </div>
      ) : null}

      {review ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-950">Review withdrawal</p>
              <p className="mt-1 text-xs leading-5 text-gray-500">{review.review.message}</p>
            </div>
            <ProviderStatusPill label={review.canSubmit ? "Connected" : "Not connected"} tone="blue" />
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold text-gray-500">Rail</dt>
              <dd className="mt-1 font-semibold text-gray-950">{review.review.rail === "base" ? "Base" : review.review.rail === "solana" ? "Solana" : "Bitcoin"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-gray-500">Asset</dt>
              <dd className="mt-1 font-semibold text-gray-950">{review.review.asset}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-gray-500">Amount</dt>
              <dd className="mt-1 font-semibold text-gray-950">{review.review.amountDecimal}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-gray-500">Estimated status</dt>
              <dd className="mt-1 font-semibold text-gray-950">{review.review.estimatedStatus}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold text-gray-500">Destination address</dt>
              <dd className="mt-1 break-all font-mono text-xs text-gray-800">{review.review.destinationAddress}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  )
}

function WalletOverviewSummary({
  rows,
}: {
  rows: Array<{ label: "Base" | "Solana" | "Bitcoin"; enabled: boolean }>
}) {
  const visibleRows = rows.filter((row) => row.enabled)
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-gray-200 bg-white px-4 py-5 shadow-sm sm:px-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total balance</p>
        <p className="mt-1 text-3xl font-semibold text-gray-950">$0.00</p>
        <p className="mt-2 text-xs leading-5 text-gray-500">Balances will update as wallet activity is indexed.</p>
      </div>
      {visibleRows.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="divide-y divide-gray-100">
            {visibleRows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-4 px-4 py-3 sm:px-5">
                <div>
                  <p className="text-sm font-semibold text-gray-800">{row.label}</p>
                  <ProviderStatusPill label="Connected" tone="green" className="mt-1" />
                </div>
                <span className="text-sm font-semibold text-gray-950">$0.00</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-500">
          Manage rails in Providers
        </div>
      )}
    </div>
  )
}

function BalanceRows({
  rows,
}: {
  rows: Array<{ label: string; enabled: boolean }>
}) {
  const visibleRows = rows.filter((row) => row.enabled)
  return (
    <div className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-sm">
      {(visibleRows.length > 0 ? visibleRows : [{ label: "Total balance", enabled: true }]).map((row) => (
        <div key={row.label} className="flex items-center justify-between gap-4 px-4 py-5 text-sm sm:px-5">
          <span className="font-semibold text-gray-800">{row.label}</span>
          <span className="font-semibold text-gray-950">$0.00</span>
        </div>
      ))}
    </div>
  )
}

function EnabledRailChips({
  rows,
}: {
  rows: Array<{ label: "Base" | "Solana" | "Bitcoin"; enabled: boolean }>
}) {
  const enabledRows = rows.filter((row) => row.enabled)
  if (enabledRows.length === 0) {
    return <p className="text-xs font-semibold text-gray-500">Manage rails in Providers</p>
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5" aria-label="Enabled payment rails">
      {enabledRows.map((rail) => (
        <span
          key={rail.label}
          className="inline-flex items-center rounded-full border border-blue-100 bg-blue-50/80 px-2.5 py-1 text-xs font-semibold text-blue-700 shadow-[0_1px_0_rgba(37,99,235,0.06)]"
        >
          {rail.label}
        </span>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main runtime component
// ---------------------------------------------------------------------------

function PineTreeWalletRuntime() {
  // --- Supabase session & DB profiles ---
  const [profileState, setProfileState] = useState<ProfileState>({ kind: "loading" })
  const [lightningProfileState, setLightningProfileState] = useState<LightningProfileState>({ kind: "loading" })
  const accessTokenRef = useRef<string | null>(null)

  // --- Dynamic SDK ---
  const { user, sdkHasLoaded, setShowAuthFlow, handleLogOut } = useDynamicContext()
  const wallets = useUserWallets()

  // --- UI state ---
  const [sdkTimedOut, setSdkTimedOut] = useState(false)
  const [walletOpen, setWalletOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<WalletTab>("overview")
  // pendingSync: merchant explicitly clicked "Create PineTree Wallet"
  const [pendingSync, setPendingSync] = useState(false)
  const [walletCreationStep, setWalletCreationStep] = useState<WalletCreationStep>("idle")
  // logoutPending: waiting for Dynamic logout to complete before opening auth flow
  const [logoutPending, setLogoutPending] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [copiedAddress, setCopiedAddress] = useState("")
  const [enabledRails, setEnabledRails] = useState<EnabledRailState>(defaultEnabledRails)
  const [withdrawalRail, setWithdrawalRail] = useState<WithdrawalRail>("base")
  const [withdrawalAsset, setWithdrawalAsset] = useState<WithdrawalAsset>("ETH")
  const [withdrawalDestination, setWithdrawalDestination] = useState("")
  const [withdrawalAmount, setWithdrawalAmount] = useState("")
  const [withdrawalReview, setWithdrawalReview] = useState<WithdrawalReviewResponse | null>(null)
  const [withdrawalSubmitResult, setWithdrawalSubmitResult] = useState<WithdrawalSubmitResponse | null>(null)
  const [withdrawalError, setWithdrawalError] = useState("")
  const [reviewingWithdrawal, setReviewingWithdrawal] = useState(false)
  const [submittingWithdrawal, setSubmittingWithdrawal] = useState(false)

  // --- SDK load timeout ---
  useEffect(() => {
    if (sdkHasLoaded) return
    const timer = window.setTimeout(() => setSdkTimedOut(true), 12000)
    return () => window.clearTimeout(timer)
  }, [sdkHasLoaded])

  // --- Escape key closes modal ---
  useEffect(() => {
    if (!walletOpen) return
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setWalletOpen(false)
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [walletOpen])

  const fetchProviderRailState = useCallback(async (token: string) => {
    try {
      const res = await fetch("/api/providers", {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
        cache: "no-store",
      })
      if (!res.ok) {
        setEnabledRails(defaultEnabledRails)
        return
      }
      const json = (await res.json()) as ProvidersDashboardResponse
      const providerRows = json.providers || []
      const providerEnabled = (provider: string) => {
        const row = providerRows.find((item) => item.provider === provider)
        const status = String(row?.status || "").toLowerCase().trim()
        return Boolean(row?.enabled === true && (status === "connected" || status === "active"))
      }
      setEnabledRails({
        base: providerEnabled("base"),
        solana: providerEnabled("solana"),
        bitcoin: providerEnabled("lightning_speed"),
      })
    } catch {
      setEnabledRails(defaultEnabledRails)
    }
  }, [])

  // --- Load profiles and provider rail enablement from DB on mount ---
  const fetchAllProfiles = useCallback(async () => {
    setProfileState({ kind: "loading" })
    setLightningProfileState({ kind: "loading" })
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) {
        setProfileState({ kind: "none" })
        setLightningProfileState({ kind: "none" })
        return
      }
      accessTokenRef.current = token

      const [walletRes, lightningRes] = await Promise.all([
        fetch("/api/wallets/pinetree-profile", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch("/api/wallets/lightning/pinetree-managed", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ])
      void fetchProviderRailState(token)

      if (!walletRes.ok) {
        setProfileState({ kind: "error" })
      } else {
        const json = (await walletRes.json()) as { profile: PineTreeWalletProfile | null }
        setProfileState(json.profile ? { kind: "loaded", profile: json.profile } : { kind: "none" })
      }

      // Lightning profile is non-critical; don't block wallet display on failure
      if (lightningRes.ok) {
        const json = (await lightningRes.json()) as { profile: MerchantLightningProfile | null }
        setLightningProfileState(json.profile ? { kind: "loaded", profile: json.profile } : { kind: "none" })
      } else {
        setLightningProfileState({ kind: "none" })
      }
    } catch {
      setProfileState({ kind: "error" })
      setLightningProfileState({ kind: "none" })
    }
  }, [fetchProviderRailState])

  useEffect(() => {
    void fetchAllProfiles()
  }, [fetchAllProfiles])

  // --- Live Dynamic wallet addresses — used only for sync, never for display ---
  const dynamicNetworkAddresses = useMemo(() => {
    return extractDynamicWalletAddresses(wallets as DynamicWalletAddressSource[])
  }, [wallets])

  const logWalletCreationStep = useCallback((step: WalletCreationStep, extra?: Record<string, unknown>) => {
    setWalletCreationStep(step)
    if (!walletCreationDebugEnabled) return
    console.debug("[pinetree-wallets] wallet_creation_step", {
      step,
      ...safeWalletSetupDiagnostics({
        userExists: Boolean(user),
        wallets,
        sdkNetworkGroups: dynamicNetworkAddresses,
      }),
      ...(extra || {}),
    })
  }, [user, wallets, dynamicNetworkAddresses])

  const syncPineTreeManagedLightning = useCallback(async () => {
    const token = accessTokenRef.current
    if (!token) return null
    try {
      const res = await fetch("/api/wallets/lightning/pinetree-managed", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      if (!res.ok) return null
      const json = (await res.json()) as { profile: MerchantLightningProfile }
      setLightningProfileState({ kind: "loaded", profile: json.profile })
      return json.profile
    } finally {
    }
  }, [])

  // --- Sync Dynamic wallet addresses (Base/Solana) to the merchant profile DB record ---
  const syncProfileFromDynamic = useCallback(async (options?: { autoEnableLightning?: boolean }) => {
    const token = accessTokenRef.current
    if (!token || !user) {
      logWalletCreationStep("failed", { reason: "missing_auth_context" })
      return null
    }
    if (
      dynamicNetworkAddresses.base.length === 0 &&
      dynamicNetworkAddresses.solana.length === 0 &&
      dynamicNetworkAddresses.bitcoin.length === 0
    ) {
      logWalletCreationStep("waiting_for_embedded_wallets", { reason: "no_wallet_addresses_detected" })
      return null
    }

    setSyncing(true)
    logWalletCreationStep("extracting_addresses")
    try {
      const bitcoinAddress = dynamicNetworkAddresses.bitcoin[0]?.address ?? null
      // Only include btc_address when Dynamic actually returned a Bitcoin wallet.
      // Omitting the field preserves a previously saved btc_address — a partial sync
      // (base/solana returned, bitcoin not yet provisioned) must not clear payout config.
      const body: Record<string, unknown> = {
        dynamic_user_id: user.userId,
        base_address: dynamicNetworkAddresses.base[0]?.address ?? null,
        solana_address: dynamicNetworkAddresses.solana[0]?.address ?? null,
        bitcoin_lightning_address: dynamicNetworkAddresses.lightning[0]?.address ?? null,
        ...(bitcoinAddress !== null && {
          bitcoin_onchain_address: bitcoinAddress,
          btc_address: bitcoinAddress,
        }),
      }
      logWalletCreationStep("syncing_pinetree_profile", {
        profile_sync_request_sent: true,
      })
      const res = await fetch("/api/wallets/pinetree-profile", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      })
      if (walletCreationDebugEnabled) {
        console.debug("[pinetree-wallets] profile_sync_response", {
          ...safeWalletSetupDiagnostics({
            userExists: Boolean(user),
            wallets,
            sdkNetworkGroups: dynamicNetworkAddresses,
            profileSyncRequestSent: true,
            profileSyncResponseStatus: res.status,
          }),
        })
      }
      if (res.ok) {
        const json = (await res.json()) as { profile: PineTreeWalletProfile }
        setProfileState({ kind: "loaded", profile: json.profile })
        logWalletCreationStep("profile_synced", {
          profile_sync_response_status: res.status,
          profile_has_base: Boolean(json.profile.base_address),
          profile_has_solana: Boolean(json.profile.solana_address),
          profile_has_btc: Boolean(json.profile.btc_address),
        })
        if (options?.autoEnableLightning && json.profile.base_address && json.profile.solana_address) {
          setPendingSync(false)
          await syncPineTreeManagedLightning()
        }
        // Fire rail sync in the background so merchant_wallets stays in sync with
        // the PineTree Wallet profile without blocking the UI response.
        void fetch("/api/wallets/pinetree-wallet/rail-sync", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }).then(() => fetchProviderRailState(token)).catch(() => undefined)
        return json.profile
      }
      logWalletCreationStep("failed", { profile_sync_response_status: res.status })
      return null
    } finally {
      setSyncing(false)
      setPendingSync(false)
    }
  }, [user, wallets, dynamicNetworkAddresses, syncPineTreeManagedLightning, logWalletCreationStep, fetchProviderRailState])

  // --- After wallet creation: auto-sync addresses to DB ---
  useEffect(() => {
    if (!pendingSync) return
    if (!sdkHasLoaded) {
      logWalletCreationStep("opening_dynamic", { reason: "sdk_not_loaded" })
      return
    }
    if (!user) {
      logWalletCreationStep("waiting_for_dynamic_auth")
      return
    }
    logWalletCreationStep("dynamic_authenticated")
    if (wallets.length === 0) {
      logWalletCreationStep("waiting_for_embedded_wallets")
      return
    }
    logWalletCreationStep("wallets_detected")
    void syncProfileFromDynamic({ autoEnableLightning: true })
  }, [pendingSync, sdkHasLoaded, user, wallets, syncProfileFromDynamic, logWalletCreationStep])

  useEffect(() => {
    if (!pendingSync) return
    const timer = window.setTimeout(() => {
      setPendingSync(false)
      setSyncing(false)
      setWalletCreationStep("timeout")
      if (walletCreationDebugEnabled) {
        console.debug("[pinetree-wallets] wallet_creation_step", {
          step: "timeout",
          timeout_ms: walletCreationTimeoutMs,
        })
      }
    }, walletCreationTimeoutMs)
    return () => window.clearTimeout(timer)
  }, [pendingSync])

  // --- After Dynamic logout: open auth flow for the new merchant's wallet creation ---
  useEffect(() => {
    if (!logoutPending) return
    if (user !== null) return // still waiting for logout to clear the user
    setLogoutPending(false)
    logWalletCreationStep("waiting_for_dynamic_auth", { reason: "reopening_after_logout" })
    setPendingSync(true)
    setShowAuthFlow(true)
  }, [logoutPending, user, setShowAuthFlow, logWalletCreationStep])

  // ---------------------------------------------------------------------------
  // Derived state — wallet profile (Base/Solana from Dynamic, DB-backed)
  // ---------------------------------------------------------------------------

  const profile = profileState.kind === "loaded" ? profileState.profile : null

  const profileAddresses = useMemo((): Record<"base" | "solana" | "bitcoin", AddressEntry[]> => {
    if (!profile) return { base: [], solana: [], bitcoin: [] }
    return {
      base: profile.base_address ? [{ id: "base", address: profile.base_address }] : [],
      solana: profile.solana_address ? [{ id: "solana", address: profile.solana_address }] : [],
      bitcoin: profile.bitcoin_onchain_address ? [{ id: "bitcoin-onchain", address: profile.bitcoin_onchain_address }] : [],
    }
  }, [profile])

  const baseReady = profileAddresses.base.length > 0
  const solanaReady = profileAddresses.solana.length > 0

  // ---------------------------------------------------------------------------
  // Derived state — Lightning (PineTree-managed backend, NOT Dynamic Spark)
  // ---------------------------------------------------------------------------

  const btcPayoutReady = Boolean(profile?.btc_address && profile.btc_payout_enabled)
  const bitcoinPayoutEntries: AddressEntry[] = profile?.btc_address
    ? [{
        id: "btc-payout",
        address: profile.btc_address,
      }]
    : []

  const bitcoinReady = bitcoinPayoutEntries.length > 0
  const allPrimaryRailsConnected = baseReady && solanaReady && bitcoinReady

  // Wallet exists once a PineTree embedded wallet address is available.
  const hasWallet = profileState.kind === "loaded" && (baseReady || solanaReady || btcPayoutReady || bitcoinReady)

  const walletStatus = allPrimaryRailsConnected ? "Connected" : "Not connected"

  const walletRailRows = [
    { label: "Base" as const, balanceLabel: "Base balance", configured: baseReady, enabled: baseReady && enabledRails.base },
    { label: "Solana" as const, balanceLabel: "Solana balance", configured: solanaReady, enabled: solanaReady && enabledRails.solana },
    { label: "Bitcoin" as const, balanceLabel: "Bitcoin balance", configured: bitcoinReady, enabled: bitcoinReady && enabledRails.bitcoin },
  ]

  // ---------------------------------------------------------------------------
  // Dynamic session mismatch guard
  // ---------------------------------------------------------------------------
  const dynamicSessionMatchesProfile =
    !profile?.dynamic_user_id ||
    !user ||
    profile.dynamic_user_id === user.userId

  const hasStaleDynamicSession =
    user !== null &&
    profileState.kind === "none"

  const canRefresh = sdkHasLoaded && dynamicSessionMatchesProfile && user !== null && hasWallet
  const walletCreationMessage = walletCreationStepMessage(walletCreationStep)
  const walletCreationInProgress =
    walletCreationStep !== "idle" &&
    walletCreationStep !== "profile_synced" &&
    walletCreationStep !== "failed" &&
    walletCreationStep !== "timeout"

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function copyAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address)
      setCopiedAddress(address)
      window.setTimeout(() => setCopiedAddress(""), 1800)
    } catch {
      setCopiedAddress("")
    }
  }

  function handleOpenWallet() {
    setActiveTab("overview")
    setWalletOpen(true)
  }

  function handleCreateWallet() {
    if (hasStaleDynamicSession && user) {
      logWalletCreationStep("opening_dynamic", { reason: "stale_dynamic_session_logout" })
      setLogoutPending(true)
      void handleLogOut?.()
      return
    }
    logWalletCreationStep("opening_dynamic")
    setPendingSync(true)
    setShowAuthFlow(true)
  }

  function handleRetryWalletSetup() {
    setPendingSync(false)
    setLogoutPending(false)
    setSyncing(false)
    setShowAuthFlow(false)
    logWalletCreationStep("opening_dynamic", { retry: true })
    window.setTimeout(() => {
      setPendingSync(true)
      setShowAuthFlow(true)
    }, 0)
  }

  async function handleRefreshAddresses() {
    if (!canRefresh) return
    setRefreshing(true)
    try {
      await syncProfileFromDynamic()
    } finally {
      setRefreshing(false)
    }
  }

  function handleWithdrawalRailChange(nextRail: WithdrawalRail) {
    setWithdrawalRail(nextRail)
    setWithdrawalAsset(withdrawalAssetsByRail[nextRail][0])
    setWithdrawalReview(null)
    setWithdrawalSubmitResult(null)
    setWithdrawalError("")
  }

  async function handleReviewWithdrawal() {
    const token = accessTokenRef.current
    const destination = withdrawalDestination.trim()
    const amount = withdrawalAmount.trim()

    setWithdrawalReview(null)
    setWithdrawalSubmitResult(null)
    if (!token) {
      setWithdrawalError("Wallet session is not available. Refresh the page and try again.")
      return
    }
    if (!destination) {
      setWithdrawalError("Enter a destination address to review.")
      return
    }
    if (!(Number(amount) > 0)) {
      setWithdrawalError("Enter a positive withdrawal amount.")
      return
    }
    if (!withdrawalAssetsByRail[withdrawalRail].includes(withdrawalAsset)) {
      setWithdrawalError("Unsupported rail/asset combination.")
      return
    }

    setReviewingWithdrawal(true)
    setWithdrawalError("")
    try {
      const res = await fetch("/api/wallets/pinetree-wallet/withdrawals", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rail: withdrawalRail,
          asset: withdrawalAsset,
          destination_address: destination,
          amount_decimal: amount,
        }),
      })
      const json = (await res.json()) as WithdrawalReviewResponse | { error?: string }
      if (!res.ok) {
        setWithdrawalError("error" in json && json.error ? json.error : "Could not prepare withdrawal review.")
        return
      }
      setWithdrawalReview(json as WithdrawalReviewResponse)
    } catch {
      setWithdrawalError("Could not prepare withdrawal review.")
    } finally {
      setReviewingWithdrawal(false)
    }
  }

  async function handleSubmitWithdrawal() {
    const token = accessTokenRef.current
    const withdrawalId = withdrawalReview?.request.id
    if (!token || !withdrawalId) return

    setSubmittingWithdrawal(true)
    setWithdrawalError("")
    setWithdrawalSubmitResult(null)
    try {
      const res = await fetch("/api/wallets/pinetree-wallet/withdrawals", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "submit",
          withdrawal_id: withdrawalId,
        }),
      })
      const json = (await res.json()) as WithdrawalSubmitResponse | { error?: string }
      if (!res.ok) {
        setWithdrawalError("error" in json && json.error ? json.error : "Could not submit withdrawal request.")
        return
      }
      setWithdrawalSubmitResult(json as WithdrawalSubmitResponse)
    } catch {
      setWithdrawalError("Could not submit withdrawal request.")
    } finally {
      setSubmittingWithdrawal(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Early returns
  // ---------------------------------------------------------------------------

  if (sdkTimedOut && !sdkHasLoaded) return <WalletSetupUnavailable kind="sdk" />

  if (profileState.kind === "loading" || lightningProfileState.kind === "loading" || (!sdkHasLoaded && profileState.kind !== "error")) {
    return (
      <WalletProfileShell
        status="Loading"
        tone="blue"
        message="Loading this merchant's PineTree Wallet profile."
      />
    )
  }

  if (profileState.kind === "error") {
    return (
      <WalletProfileShell
        status="Needs attention"
        tone="amber"
        message="Could not load the wallet profile. Refresh the page and try again."
      />
    )
  }

  // ---------------------------------------------------------------------------
  // Main card
  // ---------------------------------------------------------------------------

  return (
    <>
      <article className="min-h-[230px] rounded-[1.35rem] border border-blue-200/70 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.13),transparent_38%),linear-gradient(135deg,rgba(255,255,255,0.98),rgba(247,251,255,0.96))] p-6 shadow-[0_20px_55px_rgba(37,99,235,0.12)] backdrop-blur sm:p-8">
        <div className="flex h-full flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 max-w-2xl flex-1 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-base font-semibold text-gray-950">PineTree Wallet</h2>
              <ProviderStatusPill
                label={syncing ? "Saving…" : walletStatus}
                tone="blue"
                className="ml-auto"
              />
            </div>
            <p className="text-sm leading-6 text-gray-600">
              One merchant wallet for receiving funds and managing PineTree&apos;s supported payment rails.
            </p>
            <EnabledRailChips rows={walletRailRows} />

            {!dynamicSessionMatchesProfile ? (
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2.5">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" />
                <p className="text-xs leading-5 text-amber-800">
                  PineTree Wallet session not active for this account. Click &ldquo;Open PineTree Wallet&rdquo; to reconnect.
                </p>
              </div>
            ) : null}

            {walletCreationMessage ? (
              <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 ${
                walletCreationStep === "failed" || walletCreationStep === "timeout"
                  ? "border-amber-200 bg-amber-50/80"
                  : "border-blue-100 bg-blue-50/70"
              }`}>
                <p className={`text-xs font-semibold leading-5 ${
                  walletCreationStep === "failed" || walletCreationStep === "timeout"
                    ? "text-amber-800"
                    : "text-blue-800"
                }`}>
                  {walletCreationMessage}
                </p>
                {(walletCreationStep === "failed" || walletCreationStep === "timeout") ? (
                  <button
                    type="button"
                    onClick={handleRetryWalletSetup}
                    className="inline-flex h-8 items-center justify-center rounded-lg border border-amber-200 bg-white px-3 text-xs font-semibold text-amber-800 shadow-sm transition hover:bg-amber-50"
                  >
                    Try again
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex flex-col items-start gap-2 sm:items-end">
            {hasWallet ? (
              <button
                type="button"
                onClick={handleOpenWallet}
                disabled={syncing}
                className="h-10 rounded-lg bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
              >
                Open PineTree Wallet
              </button>
            ) : (
              <button
                type="button"
                onClick={handleCreateWallet}
                disabled={syncing || logoutPending || walletCreationInProgress}
                className="h-10 rounded-lg bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
              >
                {logoutPending || walletCreationInProgress ? "Preparing..." : "Create PineTree Wallet"}
              </button>
            )}

          </div>
        </div>
      </article>

      {process.env.NODE_ENV !== "production" ? (
        <WalletDiagnosticsPanel wallets={wallets} sdkNetworkGroups={dynamicNetworkAddresses} />
      ) : null}

      {walletOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-sm sm:p-5"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setWalletOpen(false)
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="pinetree-wallet-modal-title"
            className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-[1.5rem] border border-white/70 bg-white/95 shadow-[0_32px_100px_rgba(15,23,42,0.30)] backdrop-blur-xl"
          >
            <header className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-5 sm:px-7 sm:py-6">
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <h2 id="pinetree-wallet-modal-title" className="text-lg font-semibold text-gray-950">PineTree Wallet</h2>
                  <ProviderStatusPill
                    label={walletStatus}
                    tone="blue"
                    className="ml-auto"
                  />
                </div>
                <p className="mt-1 text-xs text-gray-500">One merchant wallet profile</p>
              </div>
              <button
                type="button"
                onClick={() => setWalletOpen(false)}
                aria-label="Close PineTree Wallet"
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500 shadow-sm transition hover:text-gray-900"
              >
                <X size={17} />
              </button>
            </header>

            <nav
              className="grid shrink-0 grid-cols-3 gap-1.5 border-b border-gray-100 px-4 py-3 sm:flex sm:overflow-x-auto sm:px-6"
              aria-label="PineTree Wallet sections"
            >
              {walletTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`min-w-0 shrink-0 rounded-xl px-2.5 py-2.5 text-xs font-semibold transition sm:px-4 ${
                    activeTab === tab.id
                      ? "bg-[#0052FF] text-white"
                      : "text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7 sm:py-7">

              {activeTab === "overview" ? (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-950">Wallet summary</p>
                    <p className="mt-1 text-xs leading-5 text-gray-500">
                      Enabled payment rails are shown here with placeholder balances.
                    </p>
                  </div>
                  <WalletOverviewSummary rows={walletRailRows} />
                </div>
              ) : null}

              {activeTab === "balances" ? (
                <BalanceRows rows={walletRailRows.map((row) => ({ label: row.balanceLabel, enabled: row.enabled }))} />
              ) : null}

              {activeTab === "receive" ? (
                <div className="space-y-3">
                  <ReceiveRow label="Base wallet" entries={profileAddresses.base} copiedAddress={copiedAddress} onCopy={(a) => void copyAddress(a)} />
                  <ReceiveRow label="Solana wallet" entries={profileAddresses.solana} copiedAddress={copiedAddress} onCopy={(a) => void copyAddress(a)} />
                  <ReceiveRow label="Bitcoin wallet" entries={bitcoinPayoutEntries} copiedAddress={copiedAddress} onCopy={(a) => void copyAddress(a)} />

                  {canRefresh ? (
                    <button
                      type="button"
                      onClick={() => void handleRefreshAddresses()}
                      disabled={refreshing}
                      aria-label="Refresh wallet addresses"
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-600 shadow-sm transition hover:text-blue-700 disabled:opacity-50"
                    >
                      <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
                      Refresh wallet addresses
                    </button>
                  ) : null}
                </div>
              ) : null}

              {activeTab === "withdraw" ? (
                <WithdrawalFormShell
                  rail={withdrawalRail}
                  asset={withdrawalAsset}
                  destinationAddress={withdrawalDestination}
                  amountDecimal={withdrawalAmount}
                  review={withdrawalReview}
                  error={withdrawalError}
                  reviewing={reviewingWithdrawal}
                  submitting={submittingWithdrawal}
                  submitResult={withdrawalSubmitResult}
                  onRailChange={handleWithdrawalRailChange}
                  onAssetChange={(nextAsset) => {
                    setWithdrawalAsset(nextAsset)
                    setWithdrawalReview(null)
                    setWithdrawalSubmitResult(null)
                    setWithdrawalError("")
                  }}
                  onDestinationChange={(value) => {
                    setWithdrawalDestination(value)
                    setWithdrawalReview(null)
                    setWithdrawalSubmitResult(null)
                    setWithdrawalError("")
                  }}
                  onAmountChange={(value) => {
                    setWithdrawalAmount(value)
                    setWithdrawalReview(null)
                    setWithdrawalSubmitResult(null)
                    setWithdrawalError("")
                  }}
                  onReview={() => void handleReviewWithdrawal()}
                  onSubmit={() => void handleSubmitWithdrawal()}
                />
              ) : null}

              {activeTab === "activity" ? (
                <EmptyWalletPanel
                  title="Wallet activity will appear here."
                  detail="Wallet activity syncing is not enabled yet."
                />
              ) : null}

            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PineTreeWalletPage() {
  const infrastructure = usePineTreeWalletInfrastructureStatus()

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0052FF]">Merchant wallet</p>
        <h1 className={`${dashboardPageTitleClass} mt-1`}>PineTree Wallet</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
          Create and open one merchant wallet for Base, Solana, and Bitcoin.
        </p>
      </div>

      <DashboardSection title="Wallet setup" titleTone="blue">
        {!infrastructure.configured ? (
          <WalletSetupUnavailable kind="missing-env" />
        ) : infrastructure.sdkUnavailable ? (
          <WalletSetupUnavailable kind="sdk" />
        ) : (
          <PineTreeWalletRuntime />
        )}
      </DashboardSection>
    </div>
  )
}
