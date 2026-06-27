"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useDynamicContext, useUserWallets } from "@dynamic-labs/sdk-react-core"
import { Transaction } from "@solana/web3.js"
import { AlertTriangle, CheckCircle2, ChevronDown, Copy, X } from "lucide-react"
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

type WalletTab = "overview" | "balances" | "withdraw"
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
    review_payload?: Record<string, unknown>
  }
  review: {
    rail: WithdrawalRail
    asset: WithdrawalAsset
    destinationAddress: string
    amountDecimal: string
    estimatedStatus: "Withdrawal review available" | "Pending review" | "Processing"
    approvalMethod?: "dynamic_browser" | "manual_review"
    message: string
    diagnostics?: WithdrawalDiagnostics
  }
  canSubmit: boolean
}

type WithdrawalSubmitResponse = {
  request: WithdrawalReviewResponse["request"]
  merchantStatus: "Pending review" | "Processing" | "Withdrawal failed"
  message: string
}

type WithdrawalPrepareResponse = {
  request: WithdrawalReviewResponse["request"]
  approvalMethod: "dynamic_browser"
  provider: "dynamic"
  rail: WithdrawalRail
  asset: WithdrawalAsset
  sourceAddress: string
  payload:
    | {
        kind: "evm_transaction"
        chainId: 8453
        from: string
        to: string
        value: `0x${string}`
        data: `0x${string}`
      }
    | {
        kind: "solana_transaction"
        from: string
        transactionBase64: string
      }
    | {
        kind: "bitcoin_psbt"
        network: "mainnet" | "testnet"
        from: string
        psbtBase64: string
        signInputs: Array<{ address: string; index: number }>
      }
}

type SyncedBalanceAsset = {
  key: string
  rail: "base" | "solana" | "bitcoin"
  asset: "ETH" | "USDC" | "SOL" | "BTC"
  balance: number | null
  usdValue: number | null
  lastSyncedAt: string | null
  status: "synced" | "pending_sync"
}

type PineTreeWalletSyncResponse = {
  readiness: {
    base: boolean
    solana: boolean
    bitcoin: boolean
  }
  balances: {
    base: SyncedBalanceAsset[]
    solana: SyncedBalanceAsset[]
    bitcoin: SyncedBalanceAsset[]
  }
  totalUsd: number | null
  lastSyncedAt: string | null
  recentActivity: Array<{
    id: string
    label: string
    status: string
    createdAt: string
  }>
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

type WalletRailRow = {
  rail: WithdrawalRail
  label: "Base" | "Solana" | "Bitcoin"
  enabled: boolean
  configured: boolean
}

type WithdrawalDiagnostics = {
  rail: WithdrawalRail
  asset: WithdrawalAsset
  railEnabled: boolean
  walletConnected: boolean
  walletAddressExists: boolean
  walletProfileAddressPresent: boolean
  savedSourceAddress: string | null
  matchingDynamicWallet: boolean
  browserWalletAddresses: string[]
  dynamicMethodAvailable: boolean
  addressMismatch: boolean
  btcBroadcastEnabled: boolean
  btcProviderConfigured: boolean
  speedPayoutAvailable: boolean
  fallbackReason: string | null
}

type WithdrawalAssetOption = {
  rail: WithdrawalRail
  asset: WithdrawalAsset
  balance: SyncedBalanceAsset | null
}

type AssetDropdownOption = {
  key: string
  asset: string
  railLabel: string
  balanceLabel: string
  usdLabel: string | null
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
  { id: "withdraw", label: "Withdraw" },
]

const defaultEnabledRails: EnabledRailState = { base: false, solana: false, bitcoin: false }
const defaultWalletSyncState: PineTreeWalletSyncResponse = {
  readiness: { base: false, solana: false, bitcoin: false },
  balances: {
    base: [
      { key: "BASE_ETH", rail: "base", asset: "ETH", balance: null, usdValue: null, lastSyncedAt: null, status: "pending_sync" },
      { key: "BASE_USDC", rail: "base", asset: "USDC", balance: null, usdValue: null, lastSyncedAt: null, status: "pending_sync" },
    ],
    solana: [
      { key: "SOLANA_SOL", rail: "solana", asset: "SOL", balance: null, usdValue: null, lastSyncedAt: null, status: "pending_sync" },
      { key: "SOLANA_USDC", rail: "solana", asset: "USDC", balance: null, usdValue: null, lastSyncedAt: null, status: "pending_sync" },
    ],
    bitcoin: [
      { key: "BTC", rail: "bitcoin", asset: "BTC", balance: null, usdValue: null, lastSyncedAt: null, status: "pending_sync" },
    ],
  },
  totalUsd: null,
  lastSyncedAt: null,
  recentActivity: [],
}

type DynamicWalletLike = {
  address?: string
  chain?: string
  additionalAddresses?: Array<{ address?: string | null }>
  signAndSendTransaction?: (transaction: Transaction, options?: unknown) => Promise<string>
  signPsbt?: (request: { unsignedPsbtBase64: string }) => Promise<{ signedPsbt?: string } | undefined>
  connector?: {
    getWalletClient?: (chainId?: string | number) => unknown | Promise<unknown>
    signAndSendTransaction?: (transaction: Transaction, options?: unknown) => Promise<string>
    signPsbt?: (request: { unsignedPsbtBase64: string }) => Promise<{ signedPsbt?: string } | undefined>
  }
  getWalletClient?: (chainId?: string | number) => unknown | Promise<unknown>
}

type DynamicEvmWalletClient = {
  sendTransaction?: (args: {
    account?: `0x${string}`
    to: `0x${string}`
    value?: bigint
    data?: `0x${string}`
  }) => Promise<`0x${string}` | string>
}

function findDynamicWalletForSource(
  candidates: unknown[],
  primaryWallet: unknown,
  sourceAddress: string
): DynamicWalletLike | null {
  const normalizedSource = sourceAddress.toLowerCase()
  const walletsToSearch = [...candidates, primaryWallet].filter(Boolean) as DynamicWalletLike[]
  return walletsToSearch.find((wallet) =>
    getDynamicWalletAddresses(wallet).some((address) => address.toLowerCase() === normalizedSource)
  ) || null
}

function getDynamicWalletAddresses(wallet: DynamicWalletLike) {
  return [
    wallet.address,
    ...(wallet.additionalAddresses ?? []).map((entry) => entry.address),
  ].flatMap((address) => {
    const normalized = String(address || "").trim()
    return normalized ? [normalized] : []
  })
}

function dynamicWalletSupportsRail(wallet: DynamicWalletLike, rail: WithdrawalRail) {
  if (rail === "base") return Boolean(wallet.getWalletClient || wallet.connector?.getWalletClient)
  if (rail === "solana") return Boolean(wallet.signAndSendTransaction || wallet.connector?.signAndSendTransaction)
  return Boolean(wallet.signPsbt || wallet.connector?.signPsbt)
}

function findDynamicApprovalWalletForSource(
  candidates: unknown[],
  primaryWallet: unknown,
  rail: WithdrawalRail,
  sourceAddress: string | null | undefined
) {
  if (!sourceAddress) return null
  const wallet = findDynamicWalletForSource(candidates, primaryWallet, sourceAddress)
  return wallet && dynamicWalletSupportsRail(wallet, rail) ? wallet : null
}

function getWithdrawalSourceAddress(
  profile: PineTreeWalletProfile | null,
  rail: WithdrawalRail
) {
  if (!profile) return null
  if (rail === "base") return profile.base_address
  if (rail === "solana") return profile.solana_address
  return profile.btc_address || profile.bitcoin_onchain_address
}

async function sendDynamicPreparedWithdrawal(
  prepared: WithdrawalPrepareResponse,
  wallets: unknown[],
  primaryWallet: unknown
): Promise<{ txHash?: string; signedPsbtBase64?: string; providerReference?: string }> {
  const wallet = findDynamicWalletForSource(wallets, primaryWallet, prepared.sourceAddress)
  if (!wallet) {
    throw new Error("Open PineTree Wallet to approve this withdrawal.")
  }

  if (prepared.payload.kind === "evm_transaction") {
    const getWalletClient = wallet.getWalletClient || wallet.connector?.getWalletClient
    const client = await getWalletClient?.(prepared.payload.chainId) as DynamicEvmWalletClient | undefined
    if (!client?.sendTransaction) {
      throw new Error("Open PineTree Wallet to approve this withdrawal.")
    }
    const txHash = await client.sendTransaction({
      account: prepared.payload.from as `0x${string}`,
      to: prepared.payload.to as `0x${string}`,
      value: BigInt(prepared.payload.value),
      data: prepared.payload.data,
    })
    return { txHash: String(txHash), providerReference: String(txHash) }
  }

  if (prepared.payload.kind === "bitcoin_psbt") {
    const signPsbt = wallet.signPsbt || wallet.connector?.signPsbt
    if (!signPsbt) {
      throw new Error("Open PineTree Wallet to approve this withdrawal.")
    }
    const signed = await signPsbt({ unsignedPsbtBase64: prepared.payload.psbtBase64 })
    if (!signed?.signedPsbt) {
      throw new Error("Open PineTree Wallet to approve this withdrawal.")
    }
    return { signedPsbtBase64: signed.signedPsbt, providerReference: "dynamic:bitcoin-psbt" }
  }

  const signAndSendTransaction = wallet.signAndSendTransaction || wallet.connector?.signAndSendTransaction
  if (!signAndSendTransaction) {
    throw new Error("Open PineTree Wallet to approve this withdrawal.")
  }
  const transaction = Transaction.from(base64ToBytes(prepared.payload.transactionBase64))
  const txHash = await signAndSendTransaction(transaction)
  return { txHash, providerReference: txHash }
}

function base64ToBytes(value: string) {
  const binary = window.atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}
const withdrawalAssetsByRail: Record<WithdrawalRail, WithdrawalAsset[]> = {
  base: ["ETH", "USDC"],
  solana: ["SOL", "USDC"],
  bitcoin: ["BTC"],
}

function findWithdrawalBalance(
  sync: PineTreeWalletSyncResponse | null,
  rail: WithdrawalRail,
  asset: WithdrawalAsset
) {
  return (sync?.balances[rail] ?? []).find((row) => row.asset === asset) ?? null
}

function isNativeWithdrawalAsset(asset: WithdrawalAsset) {
  return asset === "ETH" || asset === "SOL" || asset === "BTC"
}

function formatCryptoAmount(value: number | null, asset: string) {
  if (value === null) return null
  const decimals = asset === "USDC" ? 6 : asset === "BTC" ? 8 : 9
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(value)
}

function railDisplayName(rail: WithdrawalRail) {
  if (rail === "base") return "Base"
  if (rail === "solana") return "Solana"
  return "Bitcoin"
}

function assetOptionKey(option: Pick<WithdrawalAssetOption, "rail" | "asset">) {
  return `${option.rail}:${option.asset}`
}

function formatBalanceLabel(balance: SyncedBalanceAsset | null, asset: WithdrawalAsset) {
  if (!balance || balance.status !== "synced" || balance.balance === null) return "Balance indexing pending"
  return `${formatCryptoAmount(balance.balance, asset)} ${asset}`
}

function formatUsdEstimate(balance: SyncedBalanceAsset | null) {
  if (!balance || balance.status !== "synced") return "Balance will be verified before processing"
  if (balance.usdValue === null || balance.usdValue === undefined) return "USD value pending"
  return `~ ${formatUsd(balance.usdValue)}`
}

function getWithdrawalFallbackReason(input: WithdrawalDiagnostics) {
  if (!input.railEnabled) return "rail_disabled"
  if (!input.walletConnected) return "wallet_not_connected"
  if (!input.walletProfileAddressPresent) return "source_wallet_missing"
  if (input.addressMismatch) return "address_mismatch"
  if (!input.matchingDynamicWallet) return "dynamic_wallet_unavailable"
  if (!input.dynamicMethodAvailable) return "dynamic_method_unavailable"
  if (input.rail === "bitcoin" && !input.btcProviderConfigured) return "btc_provider_missing"
  if (input.rail === "bitcoin" && !input.btcBroadcastEnabled) return "btc_broadcast_disabled"
  return null
}

function sanitizeWithdrawalErrorForMerchant(message: string | undefined) {
  const raw = String(message || "").trim()
  if (!raw) return "We couldn't create this withdrawal request. Please try again."
  if (
    /schema cache|column|wallet_withdrawal_requests|amount_decimal|failed to create wallet withdrawal request/i.test(raw)
  ) {
    console.error("[pinetree-wallets] withdrawal request error", raw)
    return "We couldn't create this withdrawal request. Please try again."
  }
  return raw
}

function sanitizeWithdrawalSubmitErrorForMerchant(message: string | undefined) {
  const raw = String(message || "").trim()
  if (!raw) return "We couldn't submit this withdrawal request. Please try again."
  const hiddenSignerPhrases = [
    ["provider", "signer"].join(" "),
    ["cannot", "sign"].join(" "),
    ["signing", "not enabled"].join(" "),
  ]
  if (
    /schema cache|column|wallet_withdrawal_requests|amount_decimal|private key|secret|api key|token|signer/i.test(raw) ||
    hiddenSignerPhrases.some((phrase) => raw.toLowerCase().includes(phrase))
  ) {
    console.error("[pinetree-wallets] withdrawal submit error", raw)
    return "We couldn't submit this withdrawal request. Please try again."
  }
  return raw
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

function WithdrawalFormShell({
  rail,
  asset,
  assetOptions,
  destinationAddress,
  amountDecimal,
  review,
  error,
  reviewing,
  submitting,
  submitResult,
  dynamicApprovalAvailable,
  selectedBalance,
  diagnostics,
  onAssetSelect,
  onDestinationChange,
  onAmountChange,
  onMaxAmount,
  onReview,
  onSubmit,
}: {
  rail: WithdrawalRail
  asset: WithdrawalAsset
  assetOptions: WithdrawalAssetOption[]
  destinationAddress: string
  amountDecimal: string
  review: WithdrawalReviewResponse | null
  error: string
  reviewing: boolean
  submitting: boolean
  submitResult: WithdrawalSubmitResponse | null
  dynamicApprovalAvailable: boolean
  selectedBalance: SyncedBalanceAsset | null
  diagnostics: WithdrawalDiagnostics
  onAssetSelect: (rail: WithdrawalRail, asset: WithdrawalAsset) => void
  onDestinationChange: (value: string) => void
  onAmountChange: (value: string) => void
  onMaxAmount: () => void
  onReview: () => void
  onSubmit: () => void
}) {
  const amountTrimmed = amountDecimal.trim()
  const selectedBalanceAmount = selectedBalance?.balance ?? null
  const selectedBalanceKnown = selectedBalanceAmount !== null && selectedBalance?.status === "synced"
  const selectedBalanceZero = selectedBalanceKnown && selectedBalanceAmount <= 0
  const amountValue = Number(amountTrimmed)
  const missingAmount = amountTrimmed.length === 0
  const invalidAmount = amountDecimal.trim().length > 0 && !(Number(amountDecimal) > 0)
  const amountExceedsBalance = selectedBalanceKnown && amountValue > selectedBalanceAmount
  const missingDestination = destinationAddress.trim().length === 0
  const noWithdrawableAssets = assetOptions.length === 0
  const reviewDisabled = reviewing || noWithdrawableAssets || missingDestination || missingAmount || invalidAmount || selectedBalanceZero || amountExceedsBalance
  const formattedAvailable = formatCryptoAmount(selectedBalanceAmount, asset)
  const maxDisabled = !selectedBalanceKnown || selectedBalanceZero
  const nativeMaxNote = isNativeWithdrawalAsset(asset) && selectedBalanceKnown && !selectedBalanceZero
  const hasSubmitted = Boolean(submitResult && submitResult.merchantStatus !== "Withdrawal failed")
  const canResumeDynamicApproval = Boolean(review?.canSubmit && review.review.approvalMethod === "dynamic_browser" && dynamicApprovalAvailable)
  const primaryActionLabel = submitResult
    ? submitResult.merchantStatus === "Processing"
      ? "Processing"
      : submitResult.merchantStatus === "Pending review"
        ? "Pending review"
        : dynamicApprovalAvailable
          ? "Approve with PineTree Wallet"
          : "Submit withdrawal request"
    : submitting
      ? dynamicApprovalAvailable
        ? "Approving..."
        : "Submitting..."
      : reviewing
        ? "Reviewing..."
        : review
          ? canResumeDynamicApproval
            ? review.request.status === "review_required"
              ? "Continue approval"
              : "Approve with PineTree Wallet"
            : "Submit withdrawal request"
          : "Review withdrawal"
  const primaryActionDisabled = hasSubmitted || submitting || (review ? false : reviewDisabled)
  const primaryAction = review ? onSubmit : onReview

  return (
    <div className="space-y-4">
      <div className="rounded-[1.2rem] border border-blue-100/80 bg-blue-50/40 px-4 py-3">
        <p className="text-base font-semibold text-gray-950">Send</p>
        <p className="mt-1 text-xs leading-5 text-gray-500">Choose an enabled PineTree Wallet asset, then review before approval.</p>
      </div>
      {assetOptions.length > 0 ? (
        <AssetSelectDropdown
          label="Asset"
          options={assetOptions.map((option) => ({
            key: assetOptionKey(option),
            asset: option.asset,
            railLabel: railDisplayName(option.rail),
            balanceLabel: formatBalanceLabel(option.balance, option.asset),
            usdLabel:
              option.balance?.status === "synced" && option.balance.usdValue !== null
                ? `≈ ${formatUsd(option.balance.usdValue)}`
                : null,
          }))}
          selectedKey={assetOptionKey({ rail, asset })}
          onSelect={(key) => {
            const [r, a] = key.split(":")
            onAssetSelect(r as WithdrawalRail, a as WithdrawalAsset)
          }}
        />
      ) : (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-500">
          Connect and enable a PineTree Wallet rail in Providers before withdrawing.
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase text-gray-500">Send to</p>
        <input
          value={destinationAddress}
          onChange={(event) => onDestinationChange(event.target.value)}
          aria-label="Destination address"
          placeholder="Paste destination address"
          className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 font-mono text-sm text-gray-900 outline-none transition placeholder:font-sans placeholder:text-gray-400 focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
        />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase text-gray-500">Amount</p>
        <div className="rounded-[1.1rem] border border-blue-100/80 bg-[linear-gradient(135deg,rgba(239,246,255,0.72),rgba(255,255,255,0.96))] px-3 py-2.5 shadow-[0_10px_24px_rgba(37,99,235,0.06)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase text-gray-500">Available</span>
            {selectedBalanceKnown ? (
              <span className="text-sm font-semibold text-gray-950">
                {formattedAvailable} {asset}
              </span>
            ) : (
              <span className="text-sm font-semibold text-gray-500">Balance indexing pending</span>
            )}
          </div>
          {selectedBalanceKnown ? (
            <p className="mt-0.5 text-xs leading-5 text-gray-500">
              {selectedBalance?.usdValue !== null && selectedBalance?.usdValue !== undefined
                ? `≈ ${formatUsd(selectedBalance.usdValue)}`
                : "USD value pending"}
            </p>
          ) : (
            <p className="mt-0.5 text-xs leading-5 text-gray-500">Balance will be verified before processing.</p>
          )}
          {nativeMaxNote ? (
            <p className="mt-0.5 text-xs leading-5 text-gray-500">Network fees may reduce the final withdrawable amount.</p>
          ) : null}
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-gray-700">Amount</span>
          <div className="flex gap-2">
            <input
              value={amountDecimal}
              onChange={(event) => onAmountChange(event.target.value)}
              inputMode="decimal"
              aria-label="Withdrawal amount"
              placeholder="0.00"
              className="h-11 min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
            />
            <button
              type="button"
              onClick={onMaxAmount}
              disabled={maxDisabled}
              className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-blue-200 hover:text-blue-700 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 disabled:shadow-none"
            >
              Max
            </button>
          </div>
        </label>
      </div>

      {(error || invalidAmount || missingDestination || missingAmount || selectedBalanceZero || amountExceedsBalance || noWithdrawableAssets) ? (
        <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2 text-xs font-semibold leading-5 text-blue-800">
          {error ||
            (missingDestination
              ? "Enter a destination address to review."
              : missingAmount
                ? "Enter an amount to review."
                : invalidAmount
                  ? "Enter a positive withdrawal amount."
                  : selectedBalanceZero
                    ? "No available balance for this asset."
                    : noWithdrawableAssets
                      ? "No enabled connected withdrawal assets are available."
                      : "Amount exceeds available balance.")}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={primaryAction}
          disabled={primaryActionDisabled}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 disabled:shadow-none"
        >
          {primaryActionLabel}
        </button>
      </div>

      {submitResult ? (
        <div className={`rounded-2xl border px-4 py-3 ${
          submitResult.merchantStatus === "Withdrawal failed"
            ? "border-red-200 bg-red-50"
          : submitResult.merchantStatus === "Processing"
              ? "border-blue-200 bg-blue-50"
              : "border-gray-200 bg-gray-50"
        }`}>
          <p className={`text-sm font-semibold ${
            submitResult.merchantStatus === "Withdrawal failed"
              ? "text-red-800"
              : submitResult.merchantStatus === "Processing"
                ? "text-blue-900"
                : "text-gray-800"
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

      {review && !submitResult ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-950">Review withdrawal</p>
              <p className="mt-1 text-xs leading-5 text-gray-500">{review.review.message}</p>
            </div>
            <ProviderStatusPill label={canResumeDynamicApproval ? "Wallet approval" : "Pending review"} tone="blue" />
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold text-gray-500">Rail</dt>
              <dd className="mt-1 font-semibold text-gray-950">{railDisplayName(review.review.rail)}</dd>
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

      {process.env.NODE_ENV !== "production" ? (
        <details className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-500">
          <summary className="cursor-pointer font-semibold text-gray-600">Withdrawal diagnostics</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(diagnostics, null, 2)}</pre>
        </details>
      ) : null}
    </div>
  )
}

function formatUsd(value: number | null) {
  if (value === null) return "—"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatBalance(value: number | null, asset: string) {
  if (value === null) return "Pending sync"
  const decimals = asset === "USDC" ? 2 : asset === "BTC" ? 8 : 6
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: value === 0 ? 0 : 0,
    maximumFractionDigits: decimals,
  }).format(value)} ${asset}`
}

function formatLastSynced(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function WalletOverviewSummary({
  rows,
  sync,
  syncing,
}: {
  rows: WalletRailRow[]
  sync: PineTreeWalletSyncResponse | null
  syncing: boolean
}) {
  const visibleRows = rows
  const lastSynced = formatLastSynced(sync?.lastSyncedAt ?? null)
  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-[1.35rem] border border-blue-200/70 bg-[radial-gradient(circle_at_90%_8%,rgba(0,82,255,0.20),transparent_34%),linear-gradient(135deg,rgba(239,246,255,0.98),rgba(255,255,255,0.96))] px-5 py-5 shadow-[0_22px_50px_rgba(37,99,235,0.13)] sm:px-6 sm:py-6">
        <div className="absolute -right-10 -top-12 h-32 w-32 rounded-full bg-blue-300/20 blur-2xl" />
        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">TOTAL BALANCE</p>
          <p className="mt-2 text-[2.35rem] font-semibold leading-none tracking-normal text-gray-950 sm:text-5xl">{formatUsd(sync?.totalUsd ?? null)}</p>
          <p className="mt-3 text-xs leading-5 text-blue-700/80">
          {syncing ? "Syncing..." : lastSynced ? `Last synced ${lastSynced}` : "Pending sync"}
          </p>
        </div>
      </div>
      {visibleRows.length > 0 ? (
        <div className="overflow-hidden rounded-[1.35rem] border border-blue-200/60 bg-white shadow-[0_18px_42px_rgba(15,23,42,0.07)]">
          <div className="border-b border-blue-100/70 bg-blue-50/55 px-4 py-3 sm:px-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">WALLET SUMMARY</p>
          </div>
          <div className="divide-y divide-blue-50">
            {visibleRows.map((row) => {
              const railUsd = row.label === "Base"
                ? sync?.balances.base.reduce((sum, item) => sum + Number(item.usdValue ?? 0), 0) ?? null
                : row.label === "Solana"
                  ? sync?.balances.solana.reduce((sum, item) => sum + Number(item.usdValue ?? 0), 0) ?? null
                  : sync?.balances.bitcoin.reduce((sum, item) => sum + Number(item.usdValue ?? 0), 0) ?? null
              const connected = row.configured && row.enabled
              return (
                <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_8.75rem_minmax(4.5rem,auto)] items-center gap-3 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_9.5rem_minmax(5.75rem,auto)] sm:px-5">
                  <p className="min-w-0 text-sm font-semibold text-gray-900">{row.label}</p>
                  <span className="flex justify-center">
                    <ProviderStatusPill
                      label={connected ? "Connected" : "Not connected"}
                      tone={connected ? "blue" : "default"}
                      className="w-full justify-center"
                    />
                  </span>
                  <span className="min-w-[72px] text-right text-sm font-semibold tabular-nums text-gray-950 sm:min-w-[92px]">{formatUsd(railUsd)}</span>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-500">
          Manage rails in Providers
        </div>
      )}
      {sync?.recentActivity && sync.recentActivity.length > 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4 shadow-sm sm:px-5">
          <p className="text-sm font-semibold text-gray-950">Recent activity</p>
          <div className="mt-3 divide-y divide-gray-100">
            {sync.recentActivity.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate text-gray-800">{item.label}</span>
                <span className="shrink-0 text-xs font-semibold text-gray-500">{item.status}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Asset dropdown (shared by Balances and Withdraw tabs)
// ---------------------------------------------------------------------------

function AssetSelectDropdown({
  label,
  options,
  selectedKey,
  onSelect,
}: {
  label: string
  options: AssetDropdownOption[]
  selectedKey: string
  onSelect: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const selected = options.find((o) => o.key === selectedKey) ?? options[0] ?? null

  useEffect(() => {
    if (!open) return
    function closeOnOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", closeOnOutside)
    return () => document.removeEventListener("mousedown", closeOnOutside)
  }, [open])

  if (options.length === 0) return null

  return (
    <div ref={containerRef} className="relative">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-blue-700">{label}</p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 rounded-[1.1rem] border border-blue-200/70 bg-[linear-gradient(135deg,rgba(239,246,255,0.82),rgba(255,255,255,0.98))] px-4 py-3.5 text-left shadow-[0_12px_30px_rgba(37,99,235,0.08)] transition hover:border-blue-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-100"
      >
        {selected ? (
          <span className="flex flex-1 items-start justify-between gap-3">
            <span>
              <span className="block text-sm font-semibold text-gray-950">{selected.asset}</span>
              <span className="mt-0.5 block text-xs font-semibold text-blue-700/75">{selected.railLabel}</span>
            </span>
            <span className="text-right">
              <span className="block text-sm font-semibold text-gray-950">{selected.balanceLabel}</span>
              {selected.usdLabel ? (
                <span className="mt-0.5 block text-xs text-blue-700/70">{selected.usdLabel}</span>
              ) : null}
            </span>
          </span>
        ) : null}
        <ChevronDown
          size={15}
          className={`shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-blue-100 bg-white shadow-[0_20px_48px_rgba(15,23,42,0.16)]">
          {options.map((option) => {
            const isSelected = option.key === selectedKey
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => { onSelect(option.key); setOpen(false) }}
                className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition ${
                  isSelected ? "bg-blue-50" : "hover:bg-blue-50/50"
                }`}
              >
                <span>
                  <span className={`block text-sm font-semibold ${isSelected ? "text-blue-900" : "text-gray-950"}`}>
                    {option.asset}
                  </span>
                  <span className="block text-xs text-blue-700/70">{option.railLabel}</span>
                </span>
                <span className="text-right">
                  <span className={`block text-sm font-semibold ${isSelected ? "text-blue-900" : "text-gray-950"}`}>
                    {option.balanceLabel}
                  </span>
                  {option.usdLabel ? (
                    <span className="block text-xs text-blue-700/70">{option.usdLabel}</span>
                  ) : null}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function BalanceRows({
  sync,
  syncing,
  profileAddresses,
  bitcoinPayoutEntries,
  copiedAddress,
  onCopy,
}: {
  sync: PineTreeWalletSyncResponse | null
  syncing: boolean
  profileAddresses: Record<"base" | "solana" | "bitcoin", AddressEntry[]>
  bitcoinPayoutEntries: AddressEntry[]
  copiedAddress: string
  onCopy: (address: string) => void
}) {
  const allAssets: SyncedBalanceAsset[] = [
    ...(sync?.balances.base ?? defaultWalletSyncState.balances.base),
    ...(sync?.balances.solana ?? defaultWalletSyncState.balances.solana),
    ...(sync?.balances.bitcoin ?? defaultWalletSyncState.balances.bitcoin),
  ]
  const [selectedKey, setSelectedKey] = useState(allAssets[0]?.key ?? "BASE_ETH")
  const selectedAsset = allAssets.find((row) => row.key === selectedKey) ?? allAssets[0] ?? null
  const assetRailLabel = (rail: SyncedBalanceAsset["rail"]) =>
    rail === "base" ? "Base" : rail === "solana" ? "Solana" : "Bitcoin"
  const lastSynced = formatLastSynced(sync?.lastSyncedAt ?? null)

  const dropdownOptions: AssetDropdownOption[] = allAssets.map((row) => ({
    key: row.key,
    asset: row.asset,
    railLabel: assetRailLabel(row.rail),
    balanceLabel: formatBalance(row.balance, row.asset),
    usdLabel: row.usdValue !== null && row.status === "synced" ? `≈ ${formatUsd(row.usdValue)}` : null,
  }))

  const walletAddress = selectedAsset
    ? selectedAsset.rail === "base"
      ? profileAddresses.base[0]?.address ?? null
      : selectedAsset.rail === "solana"
        ? profileAddresses.solana[0]?.address ?? null
        : bitcoinPayoutEntries[0]?.address ?? null
    : null

  return (
    <div className="space-y-4">
      <AssetSelectDropdown
        label="Asset"
        options={dropdownOptions}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
      />

      {selectedAsset ? (
        <div className="rounded-[1.35rem] border border-blue-200/60 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.12),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.98),rgba(248,251,255,0.96))] px-5 py-5 shadow-[0_18px_42px_rgba(15,23,42,0.07)]">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">Available balance</p>
          <p className="mt-1 text-2xl font-semibold text-gray-950">
            {formatBalance(selectedAsset.balance, selectedAsset.asset)}
          </p>
          {selectedAsset.usdValue !== null && selectedAsset.status === "synced" ? (
            <p className="mt-0.5 text-sm text-blue-700/75">≈ {formatUsd(selectedAsset.usdValue)}</p>
          ) : null}
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-xl border border-blue-100/70 bg-white/70 px-3 py-2.5">
              <dt className="text-xs font-semibold text-gray-500">Network</dt>
              <dd className="mt-1 font-semibold text-gray-950">{assetRailLabel(selectedAsset.rail)}</dd>
            </div>
            <div className="rounded-xl border border-blue-100/70 bg-white/70 px-3 py-2.5">
              <dt className="text-xs font-semibold text-gray-500">Asset</dt>
              <dd className="mt-1 font-semibold text-gray-950">{selectedAsset.asset}</dd>
            </div>
            <div className="rounded-xl border border-blue-100/70 bg-white/70 px-3 py-2.5">
              <dt className="text-xs font-semibold text-gray-500">Last synced</dt>
              <dd className="mt-1 font-semibold text-gray-950">
                {syncing ? "Syncing..." : lastSynced ?? "Pending sync"}
              </dd>
            </div>
          </dl>
          {walletAddress !== null ? (
            <div className="mt-3 rounded-xl border border-blue-100/70 bg-white/75 px-3 py-3">
              <p className="text-xs font-semibold text-gray-500">Wallet address</p>
              <div className="mt-1 flex min-w-0 items-center gap-2">
                <p className="min-w-0 flex-1 truncate font-mono text-xs text-gray-800" title={walletAddress}>
                  {walletAddress}
                </p>
                <button
                  type="button"
                  onClick={() => onCopy(walletAddress)}
                  aria-label="Copy wallet address"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition hover:text-blue-700"
                >
                  {copiedAddress === walletAddress ? <CheckCircle2 size={15} /> : <Copy size={15} />}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function EnabledRailChips({
  rows,
}: {
  rows: WalletRailRow[]
}) {
  const enabledRows = rows.filter((row) => row.enabled && row.configured)

  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-gray-500">Connected rails</p>
      {enabledRows.length === 0 ? (
        <p className="text-xs text-gray-400">None connected yet</p>
      ) : (
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
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Wallet tab — dropdown-driven wallet view
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Main runtime component
// ---------------------------------------------------------------------------

function PineTreeWalletRuntime() {
  // --- Supabase session & DB profiles ---
  const [profileState, setProfileState] = useState<ProfileState>({ kind: "loading" })
  const [lightningProfileState, setLightningProfileState] = useState<LightningProfileState>({ kind: "loading" })
  const accessTokenRef = useRef<string | null>(null)

  // --- Dynamic SDK ---
  const { user, sdkHasLoaded, setShowAuthFlow, handleLogOut, primaryWallet } = useDynamicContext()
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
  const [copiedAddress, setCopiedAddress] = useState("")
  const [enabledRails, setEnabledRails] = useState<EnabledRailState>(defaultEnabledRails)
  const [walletSync, setWalletSync] = useState<PineTreeWalletSyncResponse>(defaultWalletSyncState)
  const [walletSyncing, setWalletSyncing] = useState(false)
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

  const syncPineTreeWallet = useCallback(async () => {
    const token = accessTokenRef.current
    if (!token) return
    setWalletSyncing(true)
    try {
      const res = await fetch("/api/wallets/pinetree/sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
        cache: "no-store",
      })
      if (!res.ok) return
      const json = (await res.json()) as PineTreeWalletSyncResponse
      setWalletSync({
        ...defaultWalletSyncState,
        ...json,
        balances: {
          base: json.balances?.base?.length ? json.balances.base : defaultWalletSyncState.balances.base,
          solana: json.balances?.solana?.length ? json.balances.solana : defaultWalletSyncState.balances.solana,
          bitcoin: json.balances?.bitcoin?.length ? json.balances.bitcoin : defaultWalletSyncState.balances.bitcoin,
        },
        recentActivity: json.recentActivity || [],
      })
    } finally {
      setWalletSyncing(false)
    }
  }, [])

  useEffect(() => {
    if (!walletOpen) return
    void syncPineTreeWallet()
  }, [walletOpen, syncPineTreeWallet])

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

  const walletRailRows = useMemo<WalletRailRow[]>(() => [
    { rail: "base", label: "Base" as const, configured: baseReady, enabled: enabledRails.base },
    { rail: "solana", label: "Solana" as const, configured: solanaReady, enabled: enabledRails.solana },
    { rail: "bitcoin", label: "Bitcoin" as const, configured: bitcoinReady, enabled: enabledRails.bitcoin },
  ], [baseReady, bitcoinReady, enabledRails.base, enabledRails.bitcoin, enabledRails.solana, solanaReady])

  const withdrawableAssetOptions = useMemo((): WithdrawalAssetOption[] => {
    return walletRailRows
      .filter((row) => row.configured && row.enabled)
      .flatMap((row) =>
        withdrawalAssetsByRail[row.rail].map((item) => ({
          rail: row.rail,
          asset: item,
          balance: findWithdrawalBalance(walletSync, row.rail, item),
        }))
      )
  }, [walletRailRows, walletSync])

  useEffect(() => {
    if (withdrawableAssetOptions.some((option) => option.rail === withdrawalRail && option.asset === withdrawalAsset)) {
      return
    }
    const first = withdrawableAssetOptions[0]
    if (!first) return
    setWithdrawalRail(first.rail)
    setWithdrawalAsset(first.asset)
    setWithdrawalReview(null)
    setWithdrawalSubmitResult(null)
    setWithdrawalError("")
  }, [withdrawableAssetOptions, withdrawalAsset, withdrawalRail])

  const selectedWithdrawalBalance = useMemo(
    () => findWithdrawalBalance(walletSync, withdrawalRail, withdrawalAsset),
    [walletSync, withdrawalAsset, withdrawalRail]
  )

  const dynamicApprovalAvailableForWithdrawal = useMemo(() => {
    if (
      !withdrawalReview?.canSubmit ||
      withdrawalReview.review.approvalMethod !== "dynamic_browser"
    ) {
      return false
    }
    const sourceAddress = getWithdrawalSourceAddress(profile, withdrawalReview.review.rail)
    return Boolean(
      findDynamicApprovalWalletForSource(
        wallets as unknown[],
        primaryWallet,
        withdrawalReview.review.rail,
        sourceAddress
      )
    )
  }, [primaryWallet, profile, wallets, withdrawalReview])

  const withdrawalDiagnostics = useMemo((): WithdrawalDiagnostics => {
    const railState = walletRailRows.find((row) => row.rail === withdrawalRail)
    const sourceAddress = getWithdrawalSourceAddress(profile, withdrawalRail)
    const browserWalletAddresses = [
      ...(wallets as unknown[]),
      primaryWallet,
    ].filter(Boolean).flatMap((wallet) => getDynamicWalletAddresses(wallet as DynamicWalletLike))
    const matchingWallet = findDynamicWalletForSource(wallets as unknown[], primaryWallet, sourceAddress || "")
    const dynamicMethodAvailable = matchingWallet ? dynamicWalletSupportsRail(matchingWallet, withdrawalRail) : false
    const addressMismatch = Boolean(
      sourceAddress &&
      browserWalletAddresses.length > 0 &&
      !browserWalletAddresses.some((address) => address.toLowerCase() === sourceAddress.toLowerCase())
    )
    const baseDiagnostics: WithdrawalDiagnostics = {
      rail: withdrawalRail,
      asset: withdrawalAsset,
      railEnabled: Boolean(railState?.enabled),
      walletConnected: Boolean(railState?.configured),
      walletAddressExists: Boolean(sourceAddress),
      walletProfileAddressPresent: Boolean(sourceAddress),
      savedSourceAddress: sourceAddress,
      matchingDynamicWallet: Boolean(matchingWallet),
      browserWalletAddresses,
      dynamicMethodAvailable,
      addressMismatch,
      btcBroadcastEnabled: false,
      btcProviderConfigured: false,
      speedPayoutAvailable: lightningProfileState.kind === "loaded" && lightningProfileState.profile.status === "ready",
      fallbackReason: null,
    }
    return {
      ...baseDiagnostics,
      fallbackReason: getWithdrawalFallbackReason(baseDiagnostics),
    }
  }, [lightningProfileState, primaryWallet, profile, walletRailRows, wallets, withdrawalAsset, withdrawalRail])

  useEffect(() => {
    if (!withdrawalReview) return
    console.debug("[pinetree-wallets] withdrawal approval availability", {
      rail: withdrawalReview.review.rail,
      asset: withdrawalReview.review.asset,
      server_dynamic_ready:
        withdrawalReview.canSubmit &&
        withdrawalReview.review.approvalMethod === "dynamic_browser",
      browser_dynamic_ready: dynamicApprovalAvailableForWithdrawal,
      fallbackReason: withdrawalDiagnostics.fallbackReason,
      diagnostics: withdrawalDiagnostics,
    })
  }, [dynamicApprovalAvailableForWithdrawal, withdrawalDiagnostics, withdrawalReview])

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

  function handleWithdrawalAssetSelect(nextRail: WithdrawalRail, nextAsset: WithdrawalAsset) {
    setWithdrawalRail(nextRail)
    setWithdrawalAsset(nextAsset)
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
    if (!amount) {
      setWithdrawalError("Enter an amount to review.")
      return
    }
    const amountNumber = Number(amount)
    if (!(amountNumber > 0)) {
      setWithdrawalError("Enter a positive withdrawal amount.")
      return
    }
    if (selectedWithdrawalBalance?.status === "synced" && selectedWithdrawalBalance.balance !== null) {
      if (selectedWithdrawalBalance.balance <= 0) {
        setWithdrawalError("No available balance for this asset.")
        return
      }
      if (amountNumber > selectedWithdrawalBalance.balance) {
        setWithdrawalError("Amount exceeds available balance.")
        return
      }
    }
    if (!withdrawalAssetsByRail[withdrawalRail].includes(withdrawalAsset)) {
      setWithdrawalError("Unsupported rail/asset combination.")
      return
    }
    if (!withdrawableAssetOptions.some((option) => option.rail === withdrawalRail && option.asset === withdrawalAsset)) {
      setWithdrawalError("No enabled connected withdrawal assets are available.")
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
        setWithdrawalError(sanitizeWithdrawalErrorForMerchant("error" in json ? json.error : undefined))
        return
      }
      setWithdrawalReview(json as WithdrawalReviewResponse)
    } catch {
      setWithdrawalError("We couldn't create this withdrawal request. Please try again.")
    } finally {
      setReviewingWithdrawal(false)
    }
  }

  function handleMaxWithdrawalAmount() {
    if (
      selectedWithdrawalBalance?.status !== "synced" ||
      selectedWithdrawalBalance.balance === null ||
      selectedWithdrawalBalance.balance <= 0
    ) {
      return
    }
    setWithdrawalAmount(String(selectedWithdrawalBalance.balance))
    setWithdrawalReview(null)
    setWithdrawalSubmitResult(null)
    setWithdrawalError("")
  }

  async function pollWithdrawalRequest(withdrawalId: string, initial: WithdrawalSubmitResponse) {
    const token = accessTokenRef.current
    if (!token) return
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1600))
      try {
        const res = await fetch(`/api/wallets/pinetree-wallet/withdrawals/${encodeURIComponent(withdrawalId)}`, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: "include",
          cache: "no-store",
        })
        if (!res.ok) continue
        const json = (await res.json()) as { request?: WithdrawalReviewResponse["request"] }
        if (!json.request) continue
        const nextStatus =
          json.request.status === "processing"
            ? "Processing"
            : json.request.status === "failed"
              ? "Withdrawal failed"
              : initial.merchantStatus
        setWithdrawalSubmitResult({
          ...initial,
          request: json.request,
          merchantStatus: nextStatus,
        })
        if (json.request.status === "processing" || json.request.status === "failed") return
      } catch {
        return
      }
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
      if (dynamicApprovalAvailableForWithdrawal) {
        const prepareRes = await fetch(`/api/wallets/pinetree-wallet/withdrawals/${encodeURIComponent(withdrawalId)}/prepare`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        })
        const prepared = (await prepareRes.json()) as WithdrawalPrepareResponse | { error?: string }
        if (!prepareRes.ok) {
          setWithdrawalError(sanitizeWithdrawalSubmitErrorForMerchant("error" in prepared ? prepared.error : undefined))
          return
        }

        const dynamicSubmission = await sendDynamicPreparedWithdrawal(prepared as WithdrawalPrepareResponse, wallets as unknown[], primaryWallet)
        const submitRes = await fetch(`/api/wallets/pinetree-wallet/withdrawals/${encodeURIComponent(withdrawalId)}/submit`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tx_hash: dynamicSubmission.txHash || "",
            provider_reference: dynamicSubmission.providerReference || dynamicSubmission.txHash || "",
            signed_psbt: dynamicSubmission.signedPsbtBase64 || undefined,
            signed_payload: {
              dynamic_wallet_address: (prepared as WithdrawalPrepareResponse).sourceAddress,
              ...(dynamicSubmission.signedPsbtBase64 ? { signedPsbt: dynamicSubmission.signedPsbtBase64 } : {}),
            },
          }),
        })
        const submitted = (await submitRes.json()) as WithdrawalSubmitResponse | { error?: string }
        if (!submitRes.ok) {
          setWithdrawalError(sanitizeWithdrawalSubmitErrorForMerchant("error" in submitted ? submitted.error : undefined))
          return
        }
        setWithdrawalSubmitResult(submitted as WithdrawalSubmitResponse)
        void pollWithdrawalRequest(withdrawalId, submitted as WithdrawalSubmitResponse)
        return
      }

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
        setWithdrawalError(sanitizeWithdrawalSubmitErrorForMerchant("error" in json ? json.error : undefined))
        return
      }
      setWithdrawalSubmitResult(json as WithdrawalSubmitResponse)
      void pollWithdrawalRequest(withdrawalId, json as WithdrawalSubmitResponse)
    } catch (error) {
      setWithdrawalError(sanitizeWithdrawalSubmitErrorForMerchant(error instanceof Error ? error.message : undefined))
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
      <article className="max-w-2xl rounded-[1.35rem] border border-blue-200/70 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.13),transparent_38%),linear-gradient(135deg,rgba(255,255,255,0.98),rgba(247,251,255,0.96))] p-5 shadow-[0_20px_55px_rgba(37,99,235,0.12)] backdrop-blur sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 className="min-w-0 text-base font-semibold text-gray-950">PineTree Wallet</h2>
          <ProviderStatusPill
            label={syncing ? "Saving..." : walletStatus}
            tone="blue"
            className="shrink-0"
          />
        </div>
        <div className="mt-3 max-w-xl">
          <p className="text-sm leading-6 text-gray-600">
            One merchant wallet for receiving funds and managing PineTree&apos;s supported payment rails.
          </p>
          <div className="mt-4">
            <EnabledRailChips rows={walletRailRows} />
          </div>
        </div>

        {!dynamicSessionMatchesProfile ? (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2.5">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" />
            <p className="text-xs leading-5 text-amber-800">
              PineTree Wallet session not active for this account. Click &ldquo;Open PineTree Wallet&rdquo; to reconnect.
            </p>
          </div>
        ) : null}

        {walletCreationMessage ? (
          <div className={`mt-4 flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 ${
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

        <div className="mt-6 flex justify-start">
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
            className="flex max-h-[92dvh] w-full max-w-[42rem] flex-col overflow-hidden rounded-[1.5rem] border border-white/70 bg-white/95 shadow-[0_32px_100px_rgba(15,23,42,0.30)] backdrop-blur-xl"
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
              className="grid shrink-0 grid-cols-3 gap-1.5 border-b border-gray-100 px-4 py-3 sm:px-6"
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

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 sm:py-6">

              {activeTab === "overview" ? (
                <WalletOverviewSummary rows={walletRailRows} sync={walletSync} syncing={walletSyncing} />
              ) : null}

              {activeTab === "balances" ? (
                <div className="space-y-4">
                  <BalanceRows
                    sync={walletSync}
                    syncing={walletSyncing}
                    profileAddresses={profileAddresses}
                    bitcoinPayoutEntries={bitcoinPayoutEntries}
                    copiedAddress={copiedAddress}
                    onCopy={(a) => void copyAddress(a)}
                  />
                </div>
              ) : null}

              {activeTab === "withdraw" ? (
                <WithdrawalFormShell
                  rail={withdrawalRail}
                  asset={withdrawalAsset}
                  assetOptions={withdrawableAssetOptions}
                  destinationAddress={withdrawalDestination}
                  amountDecimal={withdrawalAmount}
                  review={withdrawalReview}
                  error={withdrawalError}
                  reviewing={reviewingWithdrawal}
                  submitting={submittingWithdrawal}
                  submitResult={withdrawalSubmitResult}
                  dynamicApprovalAvailable={dynamicApprovalAvailableForWithdrawal}
                  selectedBalance={selectedWithdrawalBalance}
                  diagnostics={withdrawalDiagnostics}
                  onAssetSelect={handleWithdrawalAssetSelect}
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
                  onMaxAmount={handleMaxWithdrawalAmount}
                  onReview={() => void handleReviewWithdrawal()}
                  onSubmit={() => void handleSubmitWithdrawal()}
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
