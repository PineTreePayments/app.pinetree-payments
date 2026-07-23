"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ChainEnum, useDynamicContext, useDynamicEvents, useDynamicWaas, useEmbeddedWallet, useExternalAuth, useRefreshUser, useSwitchWallet, useUserWallets } from "@dynamic-labs/sdk-react-core"
import { Transaction, VersionedTransaction } from "@solana/web3.js"
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Copy, Loader2, X } from "lucide-react"
import Link from "next/link"
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
  assertDynamicWalletChain,
  classifyDynamicWalletChain,
  dynamicWalletAddressesMatch,
  dynamicWalletSupportsRail,
  findDynamicApprovalWalletForSource,
  findDynamicApprovalWalletForSourceAsync,
  findDynamicWalletForSource,
  getDynamicWalletAddressesAsync,
  getDynamicWalletAddresses,
  getDynamicWalletConnectorInfo,
  getDynamicWalletSearchList,
  inferredSignerRailForWallet,
  resolveDynamicSolanaSignAndSendCapability,
  signDynamicSolanaTransactionWithActiveAccount,
  type DynamicSignerRail,
  type DynamicWalletLike,
} from "@/lib/wallets/dynamicSignerLookup"
import {
  PineTreeInsightsCard,
  ProviderStatusPill,
  dashboardPageTitleClass,
  dashboardSectionLabelClass,
} from "@/components/dashboard/DashboardPrimitives"
import { getPaymentDisplayStatus } from "@/lib/utils/paymentStatus"
import BusinessProfileRequirementBanner from "@/components/dashboard/BusinessProfileRequirementBanner"
import { presentWithdrawalError as presentWithdrawalErrorClient } from "@/engine/withdrawals/withdrawalErrorPresentation"
import type { WalletApiErrorCode } from "@/engine/wallet/walletErrors"
import AddressBookTab from "@/components/dashboard/AddressBookTab"
import { SegmentedButtons } from "@/components/ui/SegmentedButtons"
import StatusBadge from "@/components/ui/StatusBadge"
import { modalCloseButtonClass } from "@/components/ui/ModalCloseButton"
import { usePineTreeWalletInfrastructureStatus } from "@/components/providers/PineTreeDynamicProvider"
import type { PineTreeRailReadinessMap } from "@/lib/pinetreeRailReadiness"
import {
  getPineTreeDynamicAuthConfig,
  assertCanOpenDynamicEmailFallbackAuth,
  pineTreeDynamicConfigurationErrorMessage,
  pineTreeDynamicEmailFallbackMisconfiguredWarning,
  analyzePineTreeDynamicExternalJwtContract,
  requestPineTreeDynamicExternalJwtAuth,
  shouldOpenDynamicEmailFallbackAuth,
  type PineTreeDynamicExternalJwtClaimsDiagnostics,
} from "@/lib/pinetreeDynamicAuth"
import {
  resolveNativeAuthResumeAction,
  shouldRerunSpeedOnNativeAuthResume,
  walletProvisioningTimeoutSuppressionReason,
} from "@/lib/pinetreeWalletSetupResume"
import { dynamicSessionBoundToMerchant, getDynamicExternalUserId } from "@/lib/wallets/dynamicExternalIdentity"
import {
  resolveDynamicWalletOwnership,
  type DynamicWalletOwnershipResolution,
} from "@/lib/wallets/dynamicWalletOwnership"
import { formatWalletTotalBalance } from "@/lib/pinetreeWalletDisplay"
import {
  classifyWaasWalletChain,
  computeRequiredChainState,
  needsExplicitBaseCreate,
  needsExplicitSolanaCreate,
} from "@/lib/wallets/dynamicChainClassification"
import { classifyDynamicWalletCreationError } from "@/lib/wallets/dynamicWalletCreationError"
import { runWithBoundedTimeout, type BoundedProviderCallSettlement } from "@/lib/wallets/boundedProviderCall"

// Legacy compatibility route exists server-side but is not called by PineTree Wallet:
// "/api/merchant/business-owner-profile"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WalletSecondaryView = "withdraw" | "activity" | "address-book" | "settings" | "base-details" | "solana-details" | "bitcoin-details"
type WalletWorkflowView = "withdraw" | "activity" | "address-book" | "settings" | "none"
type AddressEntry = { id: string; address: string; detail?: string }
type WithdrawalRail = "base" | "solana" | "bitcoin"
type WithdrawalAsset = "ETH" | "USDC" | "SOL" | "BTC"
type WithdrawalScreen = "form" | "review" | "approving" | "submitted" | "failed"

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
    estimatedStatus: "Ready to submit" | "Signer unavailable" | "Processing"
    approvalMethod?: "dynamic_browser" | "manual_review"
    message: string
    diagnostics?: WithdrawalDiagnostics
  }
  canSubmit: boolean
}

type WithdrawalSubmitResponse = {
  request: WithdrawalReviewResponse["request"]
  merchantStatus: "Processing" | "Confirmed" | "Withdrawal failed"
  message: string
}

type WalletWithdrawalResponse = {
  ok: boolean
  data?: {
    operation?: {
      id: string
      status: string
      txHash?: string | null
    }
  }
  error?: { message?: string; code?: string }
}

type WithdrawalPrepareResponse = {
  request: WithdrawalReviewResponse["request"]
  approvalMethod: "dynamic_browser"
  provider: "dynamic"
  rail: WithdrawalRail
  asset: WithdrawalAsset
  sourceAddress: string
  destinationAddress?: string
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
        network: "solana"
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
  network: "base" | "solana" | "bitcoin_lightning"
  provider: "dynamic" | "speed"
  totalBalance: string | null
  availableToWithdraw: string | null
  reservedFee: string
  decimals: number
  source: "chain_rpc" | "speed_balances" | "database_snapshot" | "none"
  balance: number | string | null
  usdValue: number | null
  lastSyncedAt: string | null
  status: "synced" | "cached" | "pending_sync" | "config_missing" | "unavailable" | "stale"
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
  canonicalBalances: SyncedBalanceAsset[]
  totalUsd: number | null
  lastSyncedAt: string | null
  recentActivity: Array<{
    id: string
    label: string
    rail: "base" | "solana" | "bitcoin"
    status: string
    createdAt: string
    source?: "manual" | "saved_address" | "automatic_sweep"
    amountLabel?: string | null
    amountDecimal?: string | null
    asset?: WithdrawalAsset | null
    feeLabel?: string | null
    destinationLabel?: string | null
    destinationAddress?: string | null
    provider?: string | null
    network?: string | null
    submittedAt?: string | null
    completedAt?: string | null
    txHash?: string | null
    explorerUrl?: string | null
    providerReference?: string | null
    withdrawalId?: string | null
    instantSendId?: string | null
    rawProviderStatus?: string | null
  }>
}

type WalletActivityItem = PineTreeWalletSyncResponse["recentActivity"][number]

type WalletActivityDetail = {
  id: string
  status: string
  amount: string
  fee: string
  destinationLabel: string
  destinationAddress: string | null
  provider: string
  network: string
  rail: WithdrawalRail
  submittedAt: string | null
  completedAt: string | null
  txHash: string | null
  explorerUrl: string | null
  providerReference: string | null
  withdrawalId: string
  instantSendId: string | null
  rawProviderStatus: string | null
}

type PineTreeWalletProfile = {
  id: string
  dynamic_user_id: string | null
  dynamic_email: string | null
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
  status: "not_configured" | "pending" | "ready" | "needs_attention"
  rail?: "bitcoin"
  display_name?: "Bitcoin"
  connected?: boolean
  speed_connected_account_id?: string | null
  speed_connected_account_status?: string | null
  setup_source: "pinetree_managed"
  // Canned, merchant-safe copy for a needs_attention profile - never Speed's
  // raw provider message.
  provider_error_message?: string | null
}

type ManagedLightningRail = {
  rail: "bitcoin"
  display_name: "Bitcoin"
  status: "not_configured" | "pending" | "ready" | "needs_attention" | "failed" | "incomplete"
  connected: boolean
  withdrawal_available: boolean
  balance: {
    asset: "BTC"
    amount: string | null
    usd_value: string | null
    status: "synced" | "pending_sync" | "config_missing" | "unavailable" | "stale"
  }
  message: string | null
}

type ManagedLightningResponse = {
  profile: MerchantLightningProfile | null
  rail?: ManagedLightningRail
  setup_status?: "not_configured" | "pending" | "ready" | "needs_attention" | "failed" | "incomplete"
  status?: "not_configured" | "pending" | "ready" | "needs_attention" | "failed" | "incomplete"
  merchantMessage?: string | null
}

type ProfileState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "loaded"; profile: PineTreeWalletProfile }
  | { kind: "error" }

type BusinessProfileReadinessState =
  | { kind: "loading" }
  | { kind: "loaded"; complete: boolean; status: "incomplete" | "complete" | "needs_attention" }
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
  // Set only for Bitcoin when the Lightning/Speed profile is needs_attention -
  // canned, merchant-safe copy, never Speed's raw provider message.
  needsAttentionMessage?: string | null
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
  // Signer identity for the currently-selected rail, used only by the ?walletDebug=1
  // review-screen panel - never shown to merchants by default.
  signerRail: DynamicSignerRail | "unknown"
  signerWalletAddressLast4: string | null
  signerWalletAddressLast6: string | null
  signerConnectorKey: string | null
  signerConnectorName: string | null
  signerChain: string | null
  primaryWalletChain: string | null
  willOpenDynamicModal: boolean
}

type ProviderSheetGateOptions = {
  selectedRail?: WithdrawalRail | null
  explicitUserAction?: boolean
  signatureRequired?: boolean
}

type ProviderSheetGateState = {
  walletReady: boolean
  profileReady: boolean
  baseReady: boolean
  solanaReady: boolean
  bitcoinReady: boolean
}

type WithdrawalAssetOption = {
  rail: WithdrawalRail
  asset: WithdrawalAsset
  balance: SyncedBalanceAsset | null
}

type BitcoinTransferType = "onchain" | "lightning"

type SavedWithdrawalDestination = {
  id: string
  rail: WithdrawalRail
  asset: WithdrawalAsset
  method: BitcoinTransferType | null
  destination_address: string
  label: string
  is_default: boolean
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
  railReadiness?: PineTreeRailReadinessMap
}

type WalletCreationStep =
  | "idle"
  | "repairing_profile"
  | "opening_dynamic"
  | "verification_required"
  | "waiting_for_dynamic_auth"
  | "dynamic_authenticated"
  | "provisioning_wallet"
  | "waiting_for_embedded_wallets"
  | "wallets_detected"
  | "extracting_addresses"
  | "syncing_pinetree_profile"
  | "profile_synced"
  | "failed"
  | "timeout"

type WalletSetupProgressStage =
  | "preparing"
  | "connections"
  | "finalizing"
  | "opening"

// Priority-ordered: exactly one of these drives the setup card at a time, highest first.
type WalletSetupPrimaryState =
  | "ready"
  | "create_wallet"
  | "reconnect_needed"
  | "email_mismatch"
  | "email_unverified"
  | "save_needed"
  | "rail_sync_needed"
  | "provisioning"
  | "failed"
  | "idle"

type WalletSetupStage =
  | "idle"
  | "pine_tree_authenticated"
  | "dynamic_auth_opened"
  | "dynamic_auth_completed"
  | "dynamic_identity_verified"
  | "dynamic_identity_mismatch"
  | "dynamic_identity_unverified"
  | "waiting_for_dynamic_wallets"
  | "base_address_found"
  | "solana_address_found"
  | "waiting_for_signers"
  | "base_signer_found"
  | "solana_signer_found"
  | "syncing_profile"
  | "profile_synced"
  | "syncing_providers"
  | "ready"
  | "failed"

type WalletSetupFailureReason =
  | "pine_tree_auth_missing"
  | "merchant_email_missing"
  | "merchant_resolution_failed"
  | "dynamic_auth_config_invalid"
  | "dynamic_auth_cancelled"
  | "dynamic_auth_missing"
  | "dynamic_user_missing"
  | "dynamic_email_missing"
  | "dynamic_email_mismatch"
  | "dynamic_email_unverified"
  | "dynamic_external_jwt_failed"
  | "dynamic_external_jwt_rejected"
  | "dynamic_email_fallback_blocked"
  | "no_dynamic_wallets"
  | "base_address_missing"
  | "solana_address_missing"
  | "base_signer_missing"
  | "solana_signer_missing"
  | "profile_sync_failed"
  | "provider_sync_failed"
  | "wallet_address_conflict"
  | "business_profile_required"
  | "provisioning_timeout_unknown"
  | "dynamic_required_chains_incomplete"
  | "dynamic_hydration_timeout"
  | "dynamic_base_creation_failed"
  | "dynamic_solana_creation_failed"

type ProfileSyncDiagnosticsState = {
  externalJwtEnabled?: boolean
  externalJwtIssuerConfigured?: boolean
  externalJwtAudienceConfigured?: boolean
  externalJwtKidConfigured?: boolean
  externalJwtSigningKeyConfigured?: boolean
  externalJwtJwksDerivedFromSigningKey?: boolean
  externalJwtEndpointStatus?: number | null
  externalJwtErrorCode?: string | null
  lastWalletAuthAttemptState?: string | null
  signInWithExternalJwtCalled?: boolean
  signInWithExternalJwtSucceeded?: boolean
  dynamicEmailFallbackBlocked?: boolean
  dynamicExternalAuthAttempted?: boolean
  dynamicExternalAuthSucceeded?: boolean
  dynamicUserId: string | null
  dynamicEmail?: string | null
  merchantEmail?: string | null
  dynamicEmailSource?: string | null
  mismatchCheckRan?: boolean
  mismatchBlocked?: boolean
  timeoutReason?: string | null
  extractedBaseAddress: string | null
  extractedSolanaAddress: string | null
  baseSignerFound: boolean
  solanaSignerFound: boolean
  didCallProfileEndpoint: boolean
  profileEndpointStatus: number | null
  profileEndpointResponse: unknown
  providerSyncStatus?: string | null
  skippedReason: string | null
  dynamicAuthenticated: boolean
  dynamicWalletRuntimeCount: number
  waasRuntimeWalletCount: number
  waasCredentialWalletSourceCount: number
  waasCredentialSignerWalletCount: number
  updatedAt: string | null
}

type IdentityMismatchError = {
  dynamicEmail: string | null
  merchantEmail: string | null
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const walletWorkflowOptions: Array<{ value: WalletWorkflowView; label: string }> = [
  { value: "withdraw", label: "Withdraw" },
  { value: "activity", label: "Activity" },
  { value: "address-book", label: "Address Book" },
  { value: "settings", label: "Settings" },
]

const defaultEnabledRails: EnabledRailState = { base: false, solana: false, bitcoin: false }
const pendingBalance = (
  key: SyncedBalanceAsset["key"],
  rail: SyncedBalanceAsset["rail"],
  asset: SyncedBalanceAsset["asset"],
  network: SyncedBalanceAsset["network"],
  provider: SyncedBalanceAsset["provider"],
  decimals: number
): SyncedBalanceAsset => ({
  key,
  rail,
  asset,
  network,
  provider,
  totalBalance: null,
  availableToWithdraw: null,
  reservedFee: "0",
  decimals,
  source: "none",
  balance: null,
  usdValue: null,
  lastSyncedAt: null,
  status: "pending_sync",
})
const defaultWalletSyncState: PineTreeWalletSyncResponse = {
  readiness: { base: false, solana: false, bitcoin: false },
  balances: {
    base: [
      pendingBalance("BASE_ETH", "base", "ETH", "base", "dynamic", 18),
      pendingBalance("BASE_USDC", "base", "USDC", "base", "dynamic", 6),
    ],
    solana: [
      pendingBalance("SOLANA_SOL", "solana", "SOL", "solana", "dynamic", 9),
      pendingBalance("SOLANA_USDC", "solana", "USDC", "solana", "dynamic", 6),
    ],
    bitcoin: [
      pendingBalance("BTC", "bitcoin", "BTC", "bitcoin_lightning", "speed", 8),
    ],
  },
  canonicalBalances: [],
  totalUsd: null,
  lastSyncedAt: null,
  recentActivity: [],
}

type DynamicEvmWalletClient = {
  sendTransaction?: (args: {
    account?: `0x${string}`
    to: `0x${string}`
    value?: bigint
    data?: `0x${string}`
  }) => Promise<`0x${string}` | string>
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

function expectedWithdrawalPayloadKindForRail(rail: WithdrawalRail): WithdrawalPrepareResponse["payload"]["kind"] {
  if (rail === "base") return "evm_transaction"
  if (rail === "solana") return "solana_transaction"
  return "bitcoin_psbt"
}

function expectedWithdrawalPayloadNetworkLabel(rail: WithdrawalRail): string {
  const byRail: Record<WithdrawalRail, string> = { base: "8453", solana: "solana", bitcoin: "bitcoin" }
  return byRail[rail]
}

function assertPreparedWithdrawalSignerMatchesRail(
  prepared: Pick<WithdrawalPrepareResponse, "rail" | "asset" | "sourceAddress" | "payload">,
  wallet: DynamicWalletLike
) {
  const expectedPayloadKind = expectedWithdrawalPayloadKindForRail(prepared.rail)
  if (prepared.payload.kind !== expectedPayloadKind) {
    console.warn("[pinetree-withdrawals] prepared_payload_rail_mismatch", {
      requestedRail: prepared.rail,
      requestedAsset: prepared.asset,
      payloadKind: prepared.payload.kind,
      expectedPayloadKind,
      sourceAddressPresent: Boolean(prepared.sourceAddress),
    })
    throw new Error(withdrawalSignerRailMismatchMessage)
  }

  // Belt and suspenders: the server types chainId as the literal 8453, but nothing
  // stops a runtime response from disagreeing with its own declared type.
  if (prepared.payload.kind === "evm_transaction" && prepared.payload.chainId !== 8453) {
    console.warn("[pinetree-withdrawals] prepared_payload_chain_id_mismatch", {
      requestedRail: prepared.rail,
      requestedAsset: prepared.asset,
      chainId: prepared.payload.chainId,
      expectedChainId: 8453,
    })
    throw new Error(withdrawalSignerRailMismatchMessage)
  }

  try {
    assertDynamicWalletChain(wallet, prepared.rail)
  } catch (error) {
    console.warn("[pinetree-withdrawals] signer_rail_mismatch", {
      requestedRail: prepared.rail,
      requestedAsset: prepared.asset,
      payloadKind: prepared.payload.kind,
      selectedWalletChainClassification: classifyDynamicWalletChain(wallet),
      sourceAddressPresent: Boolean(prepared.sourceAddress),
      error: error instanceof Error ? error.message : "unknown",
    })
    throw new Error(withdrawalSignerRailMismatchMessage)
  }

  if (!dynamicWalletSupportsRail(wallet, prepared.rail)) {
    console.warn("[pinetree-withdrawals] signer_method_mismatch", {
      requestedRail: prepared.rail,
      requestedAsset: prepared.asset,
      payloadKind: prepared.payload.kind,
      selectedWalletChainClassification: classifyDynamicWalletChain(wallet),
      sourceAddressPresent: Boolean(prepared.sourceAddress),
    })
    throw new Error(withdrawalSignerRailMismatchMessage)
  }
}

type DynamicSigningPreflightContext = {
  selectedRail: WithdrawalRail
  selectedAsset: WithdrawalAsset
  destinationAddress: string
  pineTreeProfileSolanaAddress: string | null
  primaryWallet: unknown
  switchDynamicWallet?: (walletId: string) => Promise<void>
  requestId?: string
  correlationId?: string | null
  emitDynamicStage?: (event: string, details?: WalletSetupDebugDetails) => void
}

type DynamicWalletRuntimeFailureCode =
  | "DYNAMIC_SDK_NOT_READY"
  | "DYNAMIC_NOT_AUTHENTICATED"
  | "DYNAMIC_USER_NOT_FOUND"
  | "DYNAMIC_WALLETS_HYDRATING"
  | "DYNAMIC_WALLETS_MISSING"
  | "DYNAMIC_IDENTITY_MISMATCH"
  | "DYNAMIC_ENVIRONMENT_MISMATCH"
  | "WALLET_NOT_CONNECTED"

type DynamicWalletRuntimeSnapshot = {
  authenticated: boolean
  dynamicUserId: string | null
  sdkLoaded: boolean
  wallets: DynamicWalletLike[]
  primaryWallet: unknown
  walletCount: number
  matchingBaseWallet: DynamicWalletLike | null
  matchingSolanaWallet: DynamicWalletLike | null
  identityMatches: boolean
  environmentIdSuffix: string | null
  failureCode: DynamicWalletRuntimeFailureCode | null
  ownership: DynamicWalletOwnershipResolution
}

function dynamicWalletConnectorValue(wallet: DynamicWalletLike, key: "key" | "name") {
  return wallet.connector?.[key] ?? wallet.walletConnector?.[key] ?? null
}

function dynamicWalletNetworkHint(wallet: DynamicWalletLike) {
  return wallet.network ?? wallet.connector?.chain ?? wallet.connector?.chainName ?? wallet.connector?.connectedChain ?? wallet.connectedChain ?? null
}

function dynamicWalletId(wallet: DynamicWalletLike) {
  const id = wallet.id ?? wallet.key
  return typeof id === "string" ? id : null
}

function dynamicWalletPrimaryAddress(wallet: DynamicWalletLike | null | undefined) {
  return wallet ? (getDynamicWalletAddresses(wallet)[0] ?? null) : null
}

function stringContainsSolanaHint(value: unknown) {
  if (typeof value === "string") return /\b(solana|svm|sol)\b/i.test(value)
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return [
    record.chain,
    record.chainName,
    record.connectedChain,
    record.network,
    record.key,
    record.name,
    record.overrideKey,
    record.namespace,
    record.blockchain,
  ].some(stringContainsSolanaHint)
}

function dynamicWalletConnectorIsSolanaCompatible(wallet: DynamicWalletLike) {
  return [
    wallet.chain,
    wallet.chainName,
    wallet.connectedChain,
    wallet.network,
    wallet.connector,
    wallet.walletConnector,
    ...(wallet.accounts ?? []),
    ...(wallet.additionalAddresses ?? []),
  ].some(stringContainsSolanaHint)
}

function buildDynamicModalDebugPayload(
  prepared: Pick<WithdrawalPrepareResponse, "rail" | "asset" | "sourceAddress" | "payload">,
  wallet: DynamicWalletLike,
  context: DynamicSigningPreflightContext,
  inferredSignerRail: DynamicSignerRail | "unknown",
  willOpenDynamicModal: boolean,
) {
  const primaryWalletLike = context.primaryWallet as DynamicWalletLike | null
  return {
    selectedAsset: context.selectedAsset,
    selectedRail: context.selectedRail,
    preparedRail: prepared.rail,
    preparedAsset: prepared.asset,
    preparedPayloadKind: prepared.payload.kind,
    preparedPayloadNetwork: "network" in prepared.payload ? prepared.payload.network : null,
    preparedSourceAddress: prepared.sourceAddress,
    pineTreeProfileSolanaAddress: context.pineTreeProfileSolanaAddress,
    dynamicPrimaryWalletChain: primaryWalletLike ? classifyDynamicWalletChain(primaryWalletLike) : "unknown",
    dynamicPrimaryWalletAddress: dynamicWalletPrimaryAddress(primaryWalletLike),
    selectedDynamicWalletChain: classifyDynamicWalletChain(wallet),
    selectedDynamicWalletAddress: dynamicWalletPrimaryAddress(wallet),
    selectedDynamicWalletConnectorKey: dynamicWalletConnectorValue(wallet, "key"),
    selectedDynamicWalletConnectorName: dynamicWalletConnectorValue(wallet, "name"),
    selectedDynamicWalletNetwork: dynamicWalletNetworkHint(wallet),
    selectedDynamicWalletId: dynamicWalletId(wallet),
    inferredSignerRail,
    expectedSignerRail: prepared.rail,
    willOpenDynamicModal,
  }
}

function logDynamicSigningPreflight(
  prepared: Pick<WithdrawalPrepareResponse, "rail" | "asset" | "sourceAddress" | "payload">,
  wallet: DynamicWalletLike,
  context: DynamicSigningPreflightContext,
  inferredSignerRail: DynamicSignerRail | "unknown",
  willOpenDynamicModal: boolean
) {
  console.info("[pinetree-wallets] dynamic_signing_preflight", buildDynamicModalDebugPayload(
    prepared,
    wallet,
    context,
    inferredSignerRail,
    willOpenDynamicModal
  ))
}

function logAboutToOpenDynamicModal(
  prepared: Pick<WithdrawalPrepareResponse, "rail" | "asset" | "sourceAddress" | "payload">,
  wallet: DynamicWalletLike,
  context: DynamicSigningPreflightContext,
  inferredSignerRail: DynamicSignerRail | "unknown"
) {
  console.error("[pinetree-withdrawals] ABOUT_TO_OPEN_DYNAMIC_MODAL", buildDynamicModalDebugPayload(
    prepared,
    wallet,
    context,
    inferredSignerRail,
    true
  ))
}

async function assertSolanaWithdrawalModalPreflight(
  prepared: WithdrawalPrepareResponse,
  wallet: DynamicWalletLike,
  context: DynamicSigningPreflightContext
) {
  if (prepared.rail !== "solana" && context.selectedRail !== "solana") return

  const fail = (reason: string, extra?: Record<string, unknown>): never => {
    console.warn("[pinetree-withdrawals] solana_dynamic_modal_blocked", {
      reason,
      selectedRail: context.selectedRail,
      selectedAsset: context.selectedAsset,
      preparedRail: prepared.rail,
      preparedAsset: prepared.asset,
      preparedPayloadKind: prepared.payload.kind,
      preparedPayloadNetwork: "network" in prepared.payload ? prepared.payload.network : null,
      preparedSourceAddressPresent: Boolean(prepared.sourceAddress),
      selectedDynamicWalletChain: classifyDynamicWalletChain(wallet),
      selectedDynamicWalletConnectorKey: dynamicWalletConnectorValue(wallet, "key"),
      selectedDynamicWalletConnectorName: dynamicWalletConnectorValue(wallet, "name"),
      primaryWalletChain: context.primaryWallet ? classifyDynamicWalletChain(context.primaryWallet as DynamicWalletLike) : "unknown",
      ...extra,
    })
    throw new Error(solanaWithdrawalReconnectMessage)
  }

  if (context.selectedRail !== "solana") fail("selected_rail_not_solana")
  if (prepared.rail !== "solana") fail("prepared_rail_not_solana")
  if (context.selectedAsset !== "SOL" && context.selectedAsset !== "USDC") fail("selected_asset_not_solana_supported")
  if (prepared.asset !== "SOL" && prepared.asset !== "USDC") fail("prepared_asset_not_solana_supported")
  const solanaPayload = prepared.payload.kind === "solana_transaction"
    ? prepared.payload
    : fail("payload_kind_not_solana")
  if (solanaPayload.network !== "solana") fail("payload_network_not_solana")
  if (classifyDynamicWalletChain(wallet) !== "solana") fail("selected_wallet_not_solana")
  if (!dynamicWalletConnectorIsSolanaCompatible(wallet)) fail("connector_not_solana_compatible")
  if (!dynamicWalletSupportsRail(wallet, "solana")) fail("selected_wallet_missing_solana_signer")

  const primaryWalletLike = context.primaryWallet as DynamicWalletLike | null
  const primaryWalletIsBitcoin = Boolean(primaryWalletLike && classifyDynamicWalletChain(primaryWalletLike) === "bitcoin")
  if (primaryWalletIsBitcoin && wallet === primaryWalletLike) fail("bitcoin_primary_selected_for_solana")

  const addresses = await getDynamicWalletAddressesAsync(wallet)
  const sourceMatches = addresses.some((address) => dynamicWalletAddressesMatch(address, prepared.sourceAddress, "solana"))
  const profileMatches = context.pineTreeProfileSolanaAddress
    ? addresses.some((address) => dynamicWalletAddressesMatch(address, context.pineTreeProfileSolanaAddress, "solana"))
    : false
  if (!sourceMatches && !profileMatches) {
    fail("selected_wallet_address_mismatch", {
      selectedWalletAddressCount: addresses.length,
      profileSolanaAddressPresent: Boolean(context.pineTreeProfileSolanaAddress),
    })
  }

  if (primaryWalletIsBitcoin) {
    const selectedWalletId = dynamicWalletId(wallet) || fail("cannot_activate_solana_wallet_before_signing")
    const switchDynamicWallet = context.switchDynamicWallet || fail("cannot_activate_solana_wallet_before_signing")
    try {
      await switchDynamicWallet(selectedWalletId)
    } catch (error) {
      fail("switch_solana_wallet_failed", { error: error instanceof Error ? error.message : "unknown" })
    }
  }
}

function maskDiagnosticValue(value: string | null | undefined) {
  const normalized = String(value || "").trim()
  if (!normalized) return null
  return normalized.length <= 14 ? normalized : `${normalized.slice(0, 7)}...${normalized.slice(-7)}`
}

function dynamicWalletDiagnosticList(values: string[]) {
  return values.length > 0 ? values.join(",") : null
}

function safeDynamicErrorName(error: unknown) {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name?: unknown }).name || "") : ""
  return name.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 60) || "Error"
}

function safeDynamicErrorCode(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code || "") : ""
  return code.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 60) || null
}

function safeDynamicErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || "")
  const trimmed = raw.trim()
  if (!trimmed) return "Dynamic signing failed."
  return trimmed
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/[A-Za-z0-9+/=]{120,}/g, "[redacted-payload]")
    .slice(0, 180)
}

function dynamicPreparedPayloadType(prepared: WithdrawalPrepareResponse) {
  if (prepared.payload.kind !== "solana_transaction") return prepared.payload.kind
  const payload = prepared.payload as typeof prepared.payload & Record<string, unknown>
  if (typeof payload.transactionBase64 === "string") return "base64"
  if (Array.isArray(payload.transactionBytes)) return "byte_array"
  if (Array.isArray(payload.transaction)) return "byte_array"
  return "unknown"
}

function emitDynamicPostPrepareStage(
  context: DynamicSigningPreflightContext,
  event: string,
  details: WalletSetupDebugDetails = {}
) {
  context.emitDynamicStage?.(event, {
    correlationId: context.correlationId || "none",
    requestId: context.requestId || "none",
    rail: context.selectedRail,
    asset: context.selectedAsset,
    stage: event,
    ...details,
  })
}

function makeDynamicPostPrepareError(message: string, code: string) {
  return Object.assign(new Error(message), { code })
}

function solanaTransactionBytesFromPrepared(prepared: WithdrawalPrepareResponse) {
  if (prepared.payload.kind !== "solana_transaction") {
    throw makeDynamicPostPrepareError("Prepared Solana transaction could not be deserialized.", "PREPARED_TRANSACTION_INVALID")
  }
  const payload = prepared.payload as typeof prepared.payload & Record<string, unknown>
  if (typeof payload.transactionBase64 === "string" && payload.transactionBase64.trim()) {
    return base64ToBytes(payload.transactionBase64)
  }
  const candidate = payload.transactionBytes ?? payload.transaction
  if (Array.isArray(candidate) && candidate.every((value) => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 255)) {
    return new Uint8Array(candidate as number[])
  }
  throw makeDynamicPostPrepareError("Prepared Solana transaction could not be deserialized.", "PREPARED_TRANSACTION_INVALID")
}

function deserializePreparedSolanaTransaction(prepared: WithdrawalPrepareResponse) {
  const bytes = solanaTransactionBytesFromPrepared(prepared)
  try {
    return VersionedTransaction.deserialize(bytes)
  } catch {
    try {
      return Transaction.from(bytes)
    } catch {
      throw makeDynamicPostPrepareError(
        "Prepared Solana transaction could not be deserialized.",
        "PREPARED_TRANSACTION_INVALID"
      )
    }
  }
}

function preparedSolanaFeePayer(transaction: Transaction | VersionedTransaction) {
  if (transaction instanceof Transaction) return transaction.feePayer?.toBase58() ?? null
  const staticAccountKeys = transaction.message.staticAccountKeys
  return staticAccountKeys[0]?.toBase58() ?? null
}

function validatePreparedSolanaTransaction(
  prepared: WithdrawalPrepareResponse,
  transaction: Transaction | VersionedTransaction,
  context: DynamicSigningPreflightContext
) {
  if (prepared.payload.kind !== "solana_transaction" || prepared.payload.network !== "solana") {
    throw makeDynamicPostPrepareError("Dynamic rejected the prepared transaction format.", "PREPARED_TRANSACTION_INVALID")
  }
  if (context.selectedRail !== "solana" || prepared.rail !== "solana") {
    throw makeDynamicPostPrepareError("Dynamic rejected the prepared transaction format.", "RAIL_MISMATCH")
  }
  if (prepared.asset !== context.selectedAsset) {
    throw makeDynamicPostPrepareError("Dynamic rejected the prepared transaction format.", "ASSET_MISMATCH")
  }
  if (prepared.payload.from !== prepared.sourceAddress) {
    throw makeDynamicPostPrepareError("Prepared Solana transaction source did not match the reviewed source address.", "SOURCE_ADDRESS_MISMATCH")
  }
  const feePayer = preparedSolanaFeePayer(transaction)
  if (!dynamicWalletAddressesMatch(feePayer, prepared.sourceAddress, "solana")) {
    throw makeDynamicPostPrepareError("Prepared Solana transaction source did not match the reviewed source address.", "SOURCE_ADDRESS_MISMATCH")
  }
  if (prepared.destinationAddress && prepared.destinationAddress !== context.destinationAddress) {
    throw makeDynamicPostPrepareError("Prepared Solana transaction destination did not match the reviewed destination.", "DESTINATION_MISMATCH")
  }
}

async function sendDynamicPreparedWithdrawal(
  prepared: WithdrawalPrepareResponse,
  wallets: unknown[],
  primaryWallet: unknown,
  context: DynamicSigningPreflightContext
): Promise<{ txHash?: string; signedPsbtBase64?: string; providerReference?: string }> {
  let substage = "DYNAMIC_PREPARE_RESPONSE_PARSED"
  let matchingWalletFound = false
  const failWithStage = (error: unknown): never => {
    const dynamicErrorCode = safeDynamicErrorCode(error) || "UNKNOWN_DYNAMIC_ERROR"
    if (substage === "DYNAMIC_SIGNING_STARTED" || substage === "DYNAMIC_SIGNING_RETURNED") {
      emitDynamicPostPrepareStage(context, "DYNAMIC_SIGNING_FAILED", {
        substage,
        errorName: safeDynamicErrorName(error),
        errorCode: dynamicErrorCode,
        errorMessage: safeDynamicErrorMessage(error),
        walletCount: wallets.length,
        matchingWalletFound,
      })
    }
    emitDynamicPostPrepareStage(context, "DYNAMIC_POST_PREPARE_FAILED", {
      substage,
      errorName: safeDynamicErrorName(error),
      errorCode: dynamicErrorCode,
      errorMessage: safeDynamicErrorMessage(error),
      walletCount: wallets.length,
      matchingWalletFound,
      sourceAddress: maskDiagnosticValue(prepared.sourceAddress),
      preparedPayloadType: dynamicPreparedPayloadType(prepared),
    })
    throw error
  }
  try {
    emitDynamicPostPrepareStage(context, "DYNAMIC_PREPARE_RESPONSE_PARSED", {
      substage,
      preparedPayloadType: dynamicPreparedPayloadType(prepared),
      sourceAddress: maskDiagnosticValue(prepared.sourceAddress),
    })
    substage = "DYNAMIC_SOURCE_ADDRESS_RESOLVED"
    emitDynamicPostPrepareStage(context, "DYNAMIC_SOURCE_ADDRESS_RESOLVED", {
      substage,
      sourceAddress: maskDiagnosticValue(prepared.sourceAddress),
    })
  const walletsToCheck = getDynamicWalletSearchList(wallets as unknown[], primaryWallet, prepared.rail)

  if (walletCreationDebugEnabled) {
    const allWalletCandidates = getDynamicWalletSearchList(wallets as unknown[], primaryWallet)
    const primaryWalletChain = primaryWallet
      ? classifyDynamicWalletChain(primaryWallet as DynamicWalletLike)
      : "unknown"
    console.info("[pinetree-withdrawals] signer_lookup", {
      requestedRail: prepared.rail,
      requestedAsset: prepared.asset,
      payloadKind: prepared.payload.kind,
      preparedSourceAddress: prepared.sourceAddress,
      sourceAddressPresent: Boolean(prepared.sourceAddress),
      sourceAddressPrefix: prepared.sourceAddress?.slice(0, 8) ?? null,
      dynamicWalletCount: wallets.length,
      hasPrimaryWallet: Boolean(primaryWallet),
      candidateWallets: allWalletCandidates.map((w) => ({
        addresses: getDynamicWalletAddresses(w),
        chainClassification: classifyDynamicWalletChain(w),
        connectorKey: w.connector?.key ?? w.walletConnector?.key ?? null,
        connectorName: w.connector?.name ?? w.walletConnector?.name ?? null,
        includedForRequestedRail: walletsToCheck.includes(w),
      })),
      primaryWalletExcludedReason:
        primaryWallet && !walletsToCheck.includes(primaryWallet as DynamicWalletLike)
          ? `classified_${primaryWalletChain}_for_${prepared.rail}`
          : null,
    })
  }

  substage = "DYNAMIC_WALLET_MATCH_STARTED"
  emitDynamicPostPrepareStage(context, "DYNAMIC_WALLET_MATCH_STARTED", {
    substage,
    walletCount: wallets.length,
    matchingWalletFound: false,
    sourceAddress: maskDiagnosticValue(prepared.sourceAddress),
  })
  const wallet = findDynamicWalletForSource(wallets, primaryWallet, prepared.sourceAddress, prepared.rail)

  if (walletCreationDebugEnabled && wallet) {
    const walletLike = wallet as DynamicWalletLike
    console.info("[pinetree-withdrawals] signer_ready", {
      payloadKind: prepared.payload.kind,
      selectedWalletChainClassification: classifyDynamicWalletChain(walletLike),
      selectedConnectorKey: walletLike.connector?.key ?? walletLike.walletConnector?.key ?? null,
      selectedConnectorName: walletLike.connector?.name ?? walletLike.walletConnector?.name ?? null,
      hasSolanaSigner: resolveDynamicSolanaSignAndSendCapability(walletLike).hasSignAndSendTransaction,
      hasEvmClient: Boolean(
        walletLike.getWalletClient || walletLike.connector?.getWalletClient
      ),
      hasBtcSigner: Boolean(walletLike.signPsbt || walletLike.connector?.signPsbt),
    })
  }

  if (!wallet) {
    const hasAnyDynamicWallet = walletsToCheck.length > 0
    const missingWalletMessage = prepared.rail === "solana"
      ? "No Dynamic Solana wallet matched the prepared source address."
      : prepared.rail === "base"
        ? "No Dynamic Base wallet matched the prepared source address."
        : "No Dynamic wallet matched the prepared source address."
    console.info("[pinetree-withdrawals] signer_not_found", {
      payloadKind: prepared.payload.kind,
      sourceAddressPresent: Boolean(prepared.sourceAddress),
      dynamicWalletCount: (wallets as unknown[]).length,
      matchingWalletFound: false,
      hasAnyDynamicWallet,
    })
    // No wallet classified for this rail at all - do not fall back to primaryWallet or
    // any other chain's signer. Solana gets its own explicit copy per rail; Base/Bitcoin
    // fall back to the existing generic reconnect copy.
    if (hasAnyDynamicWallet) {
      // Wallets are loaded but none match the saved DB address - different account/session.
      throw makeDynamicPostPrepareError(missingWalletMessage, "WALLET_NOT_CONNECTED")
    }
    // No Dynamic wallets present at all - session expired or SDK not yet loaded.
    throw makeDynamicPostPrepareError(missingWalletMessage, "WALLET_NOT_CONNECTED")
  }
  const solanaCapability = prepared.rail === "solana" ? resolveDynamicSolanaSignAndSendCapability(wallet) : null
  matchingWalletFound = true
  substage = "DYNAMIC_WALLET_MATCHED"
  emitDynamicPostPrepareStage(context, "DYNAMIC_WALLET_MATCHED", {
    substage,
    walletCount: wallets.length,
    matchingWalletFound: true,
    sourceAddress: maskDiagnosticValue(prepared.sourceAddress),
    connectorKey: solanaCapability?.connectorKey ?? wallet.connector?.key ?? wallet.walletConnector?.key ?? null,
    connectorType: solanaCapability?.connectorType ?? wallet.connector?.name ?? wallet.walletConnector?.name ?? null,
    hasSignAndSendTransaction: solanaCapability?.hasSignAndSendTransaction ?? null,
  })

  assertPreparedWithdrawalSignerMatchesRail(prepared, wallet)

  // Final checkpoint immediately before any Dynamic signing call can run. Logged
  // unconditionally, and hard-fails on any expected-vs-inferred rail disagreement -
  // this is the very last line of defense before the Dynamic approval modal opens.
  const inferredSignerRail = inferredSignerRailForWallet(wallet)
  const expectedRail = prepared.rail
  const willOpenDynamicModal = expectedRail === inferredSignerRail
  logDynamicSigningPreflight(prepared, wallet, context, inferredSignerRail, willOpenDynamicModal)
  if (expectedRail !== inferredSignerRail) {
    throw new Error(withdrawalSignerRailMismatchMessage)
  }
  await assertSolanaWithdrawalModalPreflight(prepared, wallet, context)

  if (prepared.payload.kind === "evm_transaction") {
    assertDynamicWalletChain(wallet, "base")
    // Call getWalletClient through the object (not extracted) to preserve 'this' binding.
    const chainIdStr = String(prepared.payload.chainId)
    const rawClient = await wallet.getWalletClient?.(chainIdStr)
      ?? await wallet.connector?.getWalletClient?.(chainIdStr)
    const client = rawClient as DynamicEvmWalletClient | undefined
    if (!client?.sendTransaction) {
      throw new Error("Unable to sign this withdrawal. Please try again.")
    }
    logAboutToOpenDynamicModal(prepared, wallet, context, inferredSignerRail)
    const txHash = await client.sendTransaction({
      account: prepared.payload.from as `0x${string}`,
      to: prepared.payload.to as `0x${string}`,
      value: BigInt(prepared.payload.value),
      data: prepared.payload.data,
    })
    return { txHash: String(txHash), providerReference: String(txHash) }
  }

  if (prepared.payload.kind === "bitcoin_psbt") {
    assertDynamicWalletChain(wallet, "bitcoin")
    // Call signPsbt through the object to preserve 'this' binding.
    const psbtRequest = { unsignedPsbtBase64: prepared.payload.psbtBase64 }
    logAboutToOpenDynamicModal(prepared, wallet, context, inferredSignerRail)
    const signed = await wallet.signPsbt?.(psbtRequest)
      ?? await wallet.connector?.signPsbt?.(psbtRequest)
    if (!signed?.signedPsbt) {
      throw new Error("Unable to sign this withdrawal. Please try again.")
    }
    return { signedPsbtBase64: signed.signedPsbt, providerReference: "dynamic:bitcoin-psbt" }
  }

  // Solana transaction. Resolve and activate the signer account before calling Dynamic.
  substage = "DYNAMIC_TRANSACTION_DESERIALIZE_STARTED"
  emitDynamicPostPrepareStage(context, "DYNAMIC_TRANSACTION_DESERIALIZE_STARTED", {
    substage,
    preparedPayloadType: dynamicPreparedPayloadType(prepared),
  })
  const transaction = deserializePreparedSolanaTransaction(prepared)
  validatePreparedSolanaTransaction(prepared, transaction, context)
  substage = "DYNAMIC_TRANSACTION_DESERIALIZED"
  emitDynamicPostPrepareStage(context, "DYNAMIC_TRANSACTION_DESERIALIZED", {
    substage,
    preparedPayloadType: transaction instanceof VersionedTransaction ? "versioned_transaction" : "legacy_transaction",
    sourceAddress: maskDiagnosticValue(prepared.sourceAddress),
  })
  substage = "DYNAMIC_SIGNING_STARTED"
  emitDynamicPostPrepareStage(context, "DYNAMIC_SIGNING_STARTED", {
    substage,
    connectorKey: solanaCapability?.connectorKey ?? null,
    connectorType: solanaCapability?.connectorType ?? null,
    hasSignAndSendTransaction: solanaCapability?.hasSignAndSendTransaction ?? false,
  })
  const result = await signDynamicSolanaTransactionWithActiveAccount(
    wallet,
    transaction,
    prepared.sourceAddress,
    (diagnostics) => {
      if (!walletCreationDebugEnabled) return
      console.info("[pinetree-withdrawals] solana_active_account_lookup", diagnostics)
    },
    () => {
      logAboutToOpenDynamicModal(prepared, wallet, context, inferredSignerRail)
    }
  )
  substage = "DYNAMIC_SIGNING_RETURNED"
  emitDynamicPostPrepareStage(context, "DYNAMIC_SIGNING_RETURNED", {
    substage,
    hasSignAndSendTransaction: true,
  })
  if (!result.txHash) {
    throw makeDynamicPostPrepareError("Dynamic returned no transaction signature.", "SIGNATURE_MISSING")
  }
  substage = "DYNAMIC_SIGNATURE_NORMALIZED"
  emitDynamicPostPrepareStage(context, "DYNAMIC_SIGNATURE_NORMALIZED", {
    substage,
    signature: maskDiagnosticValue(result.txHash),
  })
  substage = "DYNAMIC_SIGNATURE_RECEIVED"
  emitDynamicPostPrepareStage(context, "DYNAMIC_SIGNATURE_RECEIVED", {
    substage,
    signature: maskDiagnosticValue(result.txHash),
    providerReference: maskDiagnosticValue(result.providerReference),
  })
  return result
  } catch (error) {
    return failWithStage(error)
  }
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
const dynamicSignerWithdrawalRails: WithdrawalRail[] = ["base", "solana"]

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

function formatCryptoAmount(value: number | string | null, asset: string) {
  if (value === null) return null
  if (asset === "BTC" && typeof value === "string") return value
  const numericValue = typeof value === "string" ? Number(value) : value
  const decimals = asset === "USDC" ? 6 : asset === "BTC" ? 8 : 9
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(numericValue)
}

function btcDecimalToSats(value: string): string | null {
  const normalized = value.trim()
  if (!/^\d+(?:\.\d{1,8})?$/.test(normalized)) return null
  const [whole, fraction = ""] = normalized.split(".")
  return (BigInt(whole) * BigInt(100_000_000) + BigInt(fraction.padEnd(8, "0"))).toString()
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
  const available = balance?.availableToWithdraw ?? (balance?.balance != null ? String(balance.balance) : null)
  if (!balance || available === null) {
    return balance?.status === "unavailable" ? "Balance temporarily unavailable" : "Balance indexing pending"
  }
  const suffix = balance.status === "stale" ? " (stale)" : balance.status === "cached" ? " (cached)" : ""
  return `${formatCryptoAmount(available, asset)} ${asset}${suffix}`
}

function formatUsdEstimate(balance: SyncedBalanceAsset | null) {
  if (!balance || !["synced", "cached", "stale"].includes(balance.status)) return "Balance will be verified before processing"
  if (balance.usdValue === null || balance.usdValue === undefined) return "USD value pending"
  return `~ ${formatUsd(balance.usdValue)}`
}

function getWithdrawalFallbackReason(input: WithdrawalDiagnostics) {
  if (!input.walletConnected) return "wallet_not_connected"
  if (!input.walletProfileAddressPresent) return "source_wallet_missing"
  if (input.addressMismatch) return "address_mismatch"
  if (!input.matchingDynamicWallet) return "dynamic_wallet_unavailable"
  if (!input.dynamicMethodAvailable) return "dynamic_method_unavailable"
  if (input.rail === "bitcoin" && !input.btcProviderConfigured) return "btc_provider_missing"
  if (input.rail === "bitcoin" && !input.btcBroadcastEnabled) return "btc_broadcast_disabled"
  return null
}

// code is the server's normalized error_code (engine/withdrawals/withdrawalErrorPresentation.ts)
// when present - used as the fallback for anything not already covered by a
// known, specific, tested message below, rather than the old generic string.
function sanitizeWithdrawalErrorForMerchant(message: string | undefined, code?: string) {
  const raw = String(message || "").trim()
  if (
    raw &&
    !/schema cache|column|wallet_withdrawal_requests|amount_decimal|failed to create wallet withdrawal request/i.test(raw)
  ) {
    return raw
  }
  if (raw) console.error("[pinetree-wallets] withdrawal request error", raw)
  return presentWithdrawalErrorClient({ code: code as WalletApiErrorCode | undefined, rawMessage: raw }).message
}

function sanitizeWithdrawalSubmitErrorForMerchant(message: string | undefined, code?: string) {
  const raw = String(message || "").trim()
  // Pass through session-specific reconnect errors so merchants get actionable guidance.
  if (raw.includes("PineTree Wallet is not active in this browser session")) return pineTreeSignerReconnectMessage
  if (raw.includes("different PineTree Wallet session")) return raw
  if (raw === pineTreeSignerReconnectMessage) return raw
  if (raw === withdrawalSignerRailMismatchMessage) return raw
  if (raw === solanaWithdrawalReconnectMessage) return raw
  if (/user rejected|user denied|rejected by user|approval rejected|request rejected|denied transaction/i.test(raw)) {
    return "Withdrawal authorization was canceled. No funds were sent."
  }
  if (raw === "Withdrawal approval is still pending. Check your wallet activity before trying again.") return raw
  const hiddenSignerPhrases = [
    ["provider", "signer"].join(" "),
    ["cannot", "sign"].join(" "),
    ["signing", "not enabled"].join(" "),
  ]
  const leaksInternals =
    /schema cache|column|wallet_withdrawal_requests|amount_decimal|private key|secret|api key|token|signer/i.test(raw) ||
    hiddenSignerPhrases.some((phrase) => raw.toLowerCase().includes(phrase))
  if (raw && !leaksInternals) return raw
  if (leaksInternals) console.error("[pinetree-wallets] withdrawal submit error", raw)
  return presentWithdrawalErrorClient({ code: code as WalletApiErrorCode | undefined, rawMessage: raw }).message
}
// Explicit fallback for createWalletAccount when Dynamic's needsAutoCreateWalletChains
// comes back empty for a brand new user (SDK hasn't caught up yet) but no wallet or
// WaaS credential exists either - PineTree Wallet always needs both of these chains.
const REQUIRED_WAAS_WALLET_CHAINS = [{ chain: "EVM" }, { chain: "SOL" }]
// Bounded timeout for a single Dynamic hydration/refresh attempt. Production logs showed
// the same normal_hydration promise being reused (inFlightReused: true) for nearly a
// minute because nothing ever gave up on it - once an attempt is older than this, the
// next caller evicts it and starts a fresh one instead of awaiting it forever.
const dynamicHydrationSingleFlightTimeoutMs = 12_000
// Bounded timeout for an explicit single-chain create (createWalletAccount([{chain}])).
// Guards the per-chain dedupe refs below so a hung Base or Solana creation call can't
// permanently block that chain from ever being retried.
const dynamicChainCreateTimeoutMs = 25_000
// Bounded window for the hydration re-check that follows a chain create, before the
// overall deadline gives up.
const walletCoreSetupPostCreateHydrationMs = 12_000
// Stage-aware overall core-setup deadline: a flat 20s+5s budget could (and in
// production did) fire while a legitimate Base or Solana create was still within its
// own allowed window. Size the total budget to the sum of the realistic staged
// durations instead - one hydration attempt, up to two sequential explicit chain
// creates (Base then Solana), and one post-create hydration re-check - landing in the
// suggested 75-90s total core-setup cap.
const walletCreationTimeoutMs =
  dynamicHydrationSingleFlightTimeoutMs +
  dynamicChainCreateTimeoutMs * 2 +
  walletCoreSetupPostCreateHydrationMs // 12 + 25 + 25 + 12 = 74_000
const walletProvisioningRetryIntervalMs = 1_800
const walletProvisioningFinalRefreshGraceMs = 15_000 // total cap: 74_000 + 15_000 = 89_000
const walletSetupStoragePrefix = "pinetree_wallet_setup_in_progress:"
// Set when the merchant explicitly cancels/logs out of the Dynamic wallet-setup sheet
// mid-attempt. Distinct from walletSetupStoragePrefix: that marker means "resume this
// on reload" and stays even through an interrupted setup; this one means "the merchant
// walked away on purpose - do not auto-resume until they click Create again."
const walletSetupCancelledStoragePrefix = "pinetree_wallet_setup_cancelled:"
// How long Dynamic's own auth sheet may report itself open before PineTree treats that
// state as stale for timeout-suppression purposes only (Dynamic's UI itself is never
// force-closed by this - only our own bounded setup deadline stops waiting on it).
const dynamicAuthSheetStaleMs = 90_000
const walletCreationDebugEnabled =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_PINE_TREE_WALLET_DEBUG === "true" ||
  process.env.NEXT_PUBLIC_PINETREE_WALLET_DEBUG === "true"
const withdrawalSignerRailMismatchMessage = "Selected wallet network does not match this withdrawal asset."
const solanaWithdrawalReconnectMessage = "Reconnect your Solana wallet session before approving this withdrawal."
const pineTreeSignerReconnectMessage = "Reconnect PineTree Wallet to verify secure signing access."
// The provider's outcome is unknown (e.g. a submit request timed out mid-flight) - this is
// distinct from a real failure: the withdrawal must never be treated as abandonable or
// resubmittable from scratch while this is showing.
const withdrawalStatusUnknownMessage = "Withdrawal outcome is being verified. Do not retry this withdrawal while PineTree reviews the provider result."

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
  const statusClasses = tone === "amber" ? "bg-amber-100 text-amber-800" : "bg-blue-50 text-blue-700"
  return (
    <article className="rounded-2xl border border-gray-200/80 bg-white/90 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.07)] backdrop-blur sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-950">PineTree Wallet</h2>
          <p className="mt-1 text-sm leading-5 text-gray-600">{message}</p>
        </div>
        <StatusBadge label={status} classes={statusClasses} showIcon={false} />
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
  if (
    step === "repairing_profile" ||
    step === "opening_dynamic" ||
    step === "waiting_for_dynamic_auth" ||
    step === "dynamic_authenticated" ||
    step === "provisioning_wallet" ||
    step === "waiting_for_embedded_wallets" ||
    step === "wallets_detected" ||
    step === "extracting_addresses" ||
    step === "syncing_pinetree_profile"
  ) return "Creating PineTree Wallet..."
  if (step === "verification_required") return "Verification required"
  if (step === "profile_synced") return ""
  if (step === "timeout") return ""
  if (step === "failed") return ""
  return ""
}

const walletSetupProgressSubtitleRotationMs = 5_000
const walletSetupOpeningDelayMs = 800

const walletSetupProgressStages: Record<WalletSetupProgressStage, {
  label: string
  subtitle: string
  rotatingSubtitles: string[]
  dotIndex: number
}> = {
  preparing: {
    label: "Preparing secure wallet",
    subtitle: "Initializing your secure merchant wallet.",
    rotatingSubtitles: [
      "Initializing your secure merchant wallet.",
      "Securing your wallet setup.",
      "Preparing your wallet environment.",
      "This may take a few moments.",
    ],
    dotIndex: 0,
  },
  connections: {
    label: "Setting up wallet connections",
    subtitle: "Connecting your supported payment networks.",
    rotatingSubtitles: [
      "Connecting your supported payment networks.",
      "Verifying wallet connections.",
      "Establishing secure payment access.",
      "Still working on your wallet connections.",
    ],
    dotIndex: 1,
  },
  finalizing: {
    label: "Finalizing wallet",
    subtitle: "Syncing your wallet and payment configuration.",
    rotatingSubtitles: [
      "Syncing your wallet and payment configuration.",
      "Verifying your wallet setup.",
      "Applying final wallet settings.",
      "Almost finished.",
    ],
    dotIndex: 2,
  },
  opening: {
    label: "Opening PineTree Wallet",
    subtitle: "Your wallet is ready.",
    rotatingSubtitles: [
      "Your wallet is ready.",
      "Opening your PineTree Wallet.",
    ],
    dotIndex: 3,
  },
}

function walletSetupProgressStageForStep(input: {
  walletCreationStep: WalletCreationStep
  walletSetupPrimaryState: WalletSetupPrimaryState
  walletSetupOpeningAfterCreate: boolean
}) : WalletSetupProgressStage {
  if (input.walletSetupOpeningAfterCreate) return "opening"
  if (
    input.walletCreationStep === "syncing_pinetree_profile" ||
    input.walletCreationStep === "profile_synced"
  ) return "finalizing"
  if (
    input.walletCreationStep === "dynamic_authenticated" ||
    input.walletCreationStep === "provisioning_wallet" ||
    input.walletCreationStep === "waiting_for_embedded_wallets" ||
    input.walletCreationStep === "wallets_detected" ||
    input.walletCreationStep === "extracting_addresses" ||
    input.walletCreationStep === "repairing_profile"
  ) return "connections"
  return "preparing"
}

function WalletSetupProgress({
  stage,
  active,
}: {
  stage: WalletSetupProgressStage
  active: boolean
}) {
  const config = walletSetupProgressStages[stage]
  const [subtitleIndex, setSubtitleIndex] = useState(0)

  useEffect(() => {
    if (!active || config.rotatingSubtitles.length <= 1) return
    const subtitleRotationTimer = window.setInterval(() => {
      setSubtitleIndex((current) => (current + 1) % config.rotatingSubtitles.length)
    }, walletSetupProgressSubtitleRotationMs)
    return () => window.clearInterval(subtitleRotationTimer)
  }, [active, stage, config.rotatingSubtitles.length])

  const subtitle = config.rotatingSubtitles[
    subtitleIndex % config.rotatingSubtitles.length
  ] || config.subtitle

  return (
    <div className="mt-5 w-full max-w-xl overflow-hidden rounded-xl border border-blue-100/80 bg-blue-50/80 px-4 py-4 shadow-[0_12px_32px_rgba(0,82,255,0.08)] sm:px-5 sm:py-5" data-wallet-setup-progress>
      <div className="flex min-w-0 items-center gap-3.5" aria-label="PineTree Wallet setup progress">
        {(["preparing", "connections", "finalizing", "opening"] as WalletSetupProgressStage[]).map((item) => {
          const dot = walletSetupProgressStages[item]
          const completedOrActive = dot.dotIndex <= config.dotIndex
          const isActive = item === stage && active
          return (
            <span
              key={item}
              aria-hidden="true"
              className={`h-3 w-3 shrink-0 rounded-full transition-all duration-300 motion-reduce:transition-none ${
                completedOrActive ? "bg-[#0052FF]" : "border border-blue-200 bg-white/80"
              } ${isActive ? "motion-safe:animate-pulse shadow-[0_0_0_5px_rgba(0,82,255,0.14),0_0_20px_rgba(0,82,255,0.18)]" : ""}`}
            />
          )
        })}
      </div>
      <div className="mt-4 flex min-w-0 items-start gap-3">
        {active ? (
          <Loader2
            size={16}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-[#0052FF] drop-shadow-[0_0_8px_rgba(0,82,255,0.22)] motion-safe:animate-spin motion-reduce:animate-none"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold leading-5 text-blue-950">{config.label}</p>
          <p
            key={`${stage}-${subtitleIndex}`}
            className="mt-1 break-words text-xs leading-5 text-blue-800 transition-opacity duration-300 motion-reduce:transition-none"
          >
            {subtitle}
          </p>
        </div>
      </div>
    </div>
  )
}

function walletSetupFailureMessage(reason: WalletSetupFailureReason | null) {
  if (
    reason === "dynamic_email_mismatch" ||
    reason === "dynamic_email_missing" ||
    reason === "dynamic_email_unverified"
  ) return "We could not verify wallet access. Please try again."
  if (reason === "dynamic_external_jwt_rejected") {
    return "PineTree could not verify wallet access with our wallet provider. Your account is fine - this is a configuration issue on our side. Please try again shortly or contact support (code: external_jwt_rejected)."
  }
  if (
    reason === "dynamic_required_chains_incomplete" ||
    reason === "dynamic_hydration_timeout" ||
    reason === "dynamic_base_creation_failed" ||
    reason === "dynamic_solana_creation_failed"
  ) {
    return "PineTree Wallet setup could not finish creating the required wallet networks. Please try again."
  }
  return "Wallet setup is taking longer than expected. Please try again."
}

function walletSetupFailureRecoveryLabel(_reason: WalletSetupFailureReason | null) {
  return "Try Again"
}

function walletSetupNoticeCopy(state: WalletSetupPrimaryState, reason: WalletSetupFailureReason | null) {
  if (state === "reconnect_needed") return "Verify wallet access to continue using secure PineTree Wallet signing."
  if (state === "email_mismatch" || state === "email_unverified") return "We could not verify wallet access. Please try again."
  if (state === "save_needed" || state === "rail_sync_needed") return "Wallet setup needs another attempt. Please try again."
  if (state === "failed") return walletSetupFailureMessage(reason || "provisioning_timeout_unknown")
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

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

function safeString(value: unknown) {
  return typeof value === "string" ? value : value === undefined || value === null ? null : String(value)
}

function createWalletSetupAttemptId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `wallet_setup_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function normalizeIdentityEmail(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null
}

type DynamicEmailExtraction = { email: string | null; source: string | null }

// Dynamic's email-OTP credentials expose `email` directly, but social/OAuth
// credentials (Google, etc.) only populate `oauthEmails`/`publicIdentifier` -
// missing those left OAuth sign-ins with a null email that read as "unverified"
// instead of the real mismatch.
function extractDynamicUserEmail(dynamicUser: unknown): DynamicEmailExtraction {
  const row = toRecord(dynamicUser)
  const directEmail = normalizeIdentityEmail(row.email)
  if (directEmail) return { email: directEmail, source: "user.email" }

  const verifiedCredentials = Array.isArray(row.verifiedCredentials)
    ? row.verifiedCredentials
    : []

  for (const credential of verifiedCredentials) {
    const credentialEmail = normalizeIdentityEmail(toRecord(credential).email)
    if (credentialEmail) return { email: credentialEmail, source: "verifiedCredentials.email" }
  }

  for (const credential of verifiedCredentials) {
    const oauthEmails = toRecord(credential).oauthEmails
    const emails = Array.isArray(oauthEmails) ? oauthEmails : []
    for (const oauthEmail of emails) {
      const normalized = normalizeIdentityEmail(oauthEmail)
      if (normalized) return { email: normalized, source: "verifiedCredentials.oauthEmails" }
    }
  }

  for (const credential of verifiedCredentials) {
    const publicIdentifier = toRecord(credential).publicIdentifier
    if (typeof publicIdentifier === "string" && publicIdentifier.includes("@")) {
      const normalized = normalizeIdentityEmail(publicIdentifier)
      if (normalized) return { email: normalized, source: "verifiedCredentials.publicIdentifier" }
    }
  }

  const oauthAccounts = Array.isArray(row.oauthAccounts) ? row.oauthAccounts : []
  for (const account of oauthAccounts) {
    const accountEmail = normalizeIdentityEmail(toRecord(account).email)
    if (accountEmail) return { email: accountEmail, source: "oauthAccounts.email" }
  }

  return { email: null, source: null }
}

function walletSetupStorageKeyForMerchant(merchantId: string | null | undefined) {
  return merchantId ? `${walletSetupStoragePrefix}${merchantId}` : null
}

function walletSetupCancelledStorageKeyForMerchant(merchantId: string | null | undefined) {
  return merchantId ? `${walletSetupCancelledStoragePrefix}${merchantId}` : null
}

function getDynamicEmailMismatchResponse(value: unknown): IdentityMismatchError | null {
  const row = toRecord(value)
  if (row.error !== "dynamic_email_mismatch") return null
  return {
    merchantEmail: normalizeIdentityEmail(row.merchantEmail),
    dynamicEmail: normalizeIdentityEmail(row.dynamicEmail),
  }
}

function isWalletIdentityUnavailableResponse(value: unknown) {
  return toRecord(value).error === "wallet_identity_unavailable"
}

function isWalletAddressConflictResponse(value: unknown) {
  const error = toRecord(value).error
  return (
    error === "wallet_address_conflict" ||
    error === "base_owned_by_other_merchant" ||
    error === "solana_owned_by_other_merchant" ||
    error === "protected_existing_profile"
  )
}

const stalePineTreeWalletSetupMessage =
  "PineTree found an older wallet setup for this account. Please retry after the previous test wallet is cleared."

function getProviderSyncStatus(value: unknown) {
  const providerSync = toRecord(value).providerSync
  if (!Array.isArray(providerSync)) return providerSync ? "returned" : null
  const hasSkippedRequiredProvider = providerSync.some((item) => {
    const row = toRecord(item)
    return (row.provider === "base" || row.provider === "solana") && row.status !== "upserted"
  })
  return hasSkippedRequiredProvider ? "failed" : "synced"
}

function safeBooleanCall(fn: unknown) {
  if (typeof fn !== "function") return null
  try {
    return Boolean((fn as () => unknown)())
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Server-visible wallet setup diagnostics (temporary beacon)
// ---------------------------------------------------------------------------

type WalletSetupDebugDetailValue = boolean | number | string | null
type WalletSetupDebugDetails = Record<string, WalletSetupDebugDetailValue>
type WalletSetupDebugEventLogEntry = {
  event: string
  details: WalletSetupDebugDetails
  at: string
}
type WithdrawalSubmitContext = {
  irreversibleAckChecked?: boolean
}
type WalletSetupStageDiagnosticEvent =
  | "wallet_create_dynamic_auth_complete"
  | "wallet_create_runtime_hydration_started"
  | "wallet_create_runtime_hydration_complete"
  | "wallet_create_addresses_detected"
  | "wallet_create_profile_sync_started"
  | "wallet_create_profile_sync_complete"
  | "wallet_create_rail_sync_started"
  | "wallet_create_rail_sync_complete"
  | "wallet_create_modal_opened"
  | "wallet_create_resume_detected"
  | "wallet_create_resume_profile_sync_started"
  | "wallet_create_resume_complete"

function isWalletDebugEventsEnabled() {
  if (process.env.NEXT_PUBLIC_WALLET_DEBUG_EVENTS === "true") return true
  if (typeof window === "undefined") return false
  try {
    const params = new URLSearchParams(window.location.search)
    return params.get("walletDebug") === "1" || params.get("walletDebug") === "true"
  } catch {
    return false
  }
}

const PRODUCTION_WALLET_WITHDRAWAL_DEBUG_EVENTS = new Set([
  "wallet_withdrawal_approve_clicked",
  "wallet_withdrawal_submit_entered",
  "wallet_withdrawal_submit_blocked",
  "wallet_withdrawal_submit_unhandled_error",
  "wallet_withdrawal_prepare_requested",
  "DYNAMIC_PREPARE_RESPONSE_PARSED",
  "DYNAMIC_SOURCE_ADDRESS_RESOLVED",
  "DYNAMIC_WALLET_MATCH_STARTED",
  "DYNAMIC_WALLET_MATCHED",
  "DYNAMIC_TRANSACTION_DESERIALIZE_STARTED",
  "DYNAMIC_TRANSACTION_DESERIALIZED",
  "DYNAMIC_SIGNING_STARTED",
  "DYNAMIC_SIGNING_RETURNED",
  "DYNAMIC_SIGNING_FAILED",
  "DYNAMIC_SIGNATURE_NORMALIZED",
  "DYNAMIC_SIGNATURE_RECEIVED",
  "DYNAMIC_SUBMIT_REQUESTED",
  "DYNAMIC_SUBMIT_ACCEPTED",
  "DYNAMIC_SUBMIT_COMPLETED",
  "DYNAMIC_UI_REFRESH_COMPLETED",
  "DYNAMIC_POST_PREPARE_FAILED",
  "WALLET_BALANCE_REFRESH_COMPLETED",
  "BALANCE_UI_REFRESH_COMPLETED",
  "DYNAMIC_AUTH_CHECK_STARTED",
  "DYNAMIC_AUTH_RESTORED",
  "DYNAMIC_USER_RESOLVED",
  "DYNAMIC_IDENTITY_MATCHED",
  "DYNAMIC_IDENTITY_MISMATCH",
  "DYNAMIC_WALLETS_HYDRATION_STARTED",
  "DYNAMIC_WALLETS_HYDRATED",
  "DYNAMIC_MATCHING_WALLET_FOUND",
])

function isProductionWalletWithdrawalDebugEvent(event: string) {
  return PRODUCTION_WALLET_WITHDRAWAL_DEBUG_EVENTS.has(event)
}

function safeClientBuildId(value: string) {
  const normalized = String(value || "").trim()
  if (!normalized) return "unavailable"
  return normalized.length > 12 ? normalized.slice(0, 12) : normalized
}

// Safe enum hints for a thrown signInWithExternalJwt error. Order matters - first
// match wins, so more specific patterns (e.g. "kid") are checked before generic
// ones. Never derived from raw error.message in the emitted event - only this
// classified hint, plus a short error name/code, ever leaves the browser.
const DYNAMIC_SIGNIN_MESSAGE_HINTS: Array<{ pattern: RegExp; hint: string }> = [
  { pattern: /\bkid\b/, hint: "invalid_kid" },
  { pattern: /jwks.*(key not found|no matching key)|key not found/, hint: "jwks_key_not_found" },
  { pattern: /jwks.*(fetch|fail|unreachable|timeout|unavailable)/, hint: "jwks_fetch_failed" },
  { pattern: /\baudience\b|\baud\b/, hint: "invalid_audience" },
  { pattern: /\bissuer\b|\biss\b/, hint: "invalid_issuer" },
  { pattern: /verif(y|ication).*(fail|invalid)|signature.*(invalid|fail)/, hint: "jwt_verification_failed" },
  { pattern: /invalid[_ ]?jwt|malformed jwt|jwt.*(malformed|invalid)/, hint: "invalid_jwt" },
  { pattern: /project.*(environment|mismatch)/, hint: "project_environment_mismatch" },
  { pattern: /environment.*(mismatch|not found|invalid)/, hint: "environment_mismatch" },
  { pattern: /external ?auth.*(not enabled|disabled)|byoa.*(not enabled|disabled)/, hint: "external_auth_not_enabled" },
  { pattern: /external ?user ?id/, hint: "missing_external_user_id" },
  { pattern: /invalid (argument|parameter|params|payload shape)/, hint: "invalid_argument_shape" },
  { pattern: /storage|quota|denied|securityerror|private browsing|indexeddb|keychain/, hint: "popup_or_storage_blocked" },
  { pattern: /popup|window.*(closed|blocked)/, hint: "popup_or_storage_blocked" },
  { pattern: /not ready|not initialized|sdk.*(not ready|not loaded)|client not found/, hint: "sdk_not_ready" },
  { pattern: /network|fetch failed|failed to fetch|econnrefused|enotfound/, hint: "network_error" },
]

type ClassifiedDynamicSignInError = {
  reason: "dynamic_signin_threw"
  errorName?: string
  errorCode?: string
  status?: number
  httpStatus?: number
  providerCode?: string
  safeProviderMessage?: string
  messageHint: string
}

const SAFE_DYNAMIC_PROVIDER_MESSAGES = [
  "Audience (aud) does not match",
  "Issuer (iss) does not match",
  "Signature verification failed",
  "Subject does not match external user ID",
  "Invalid external authentication",
] as const

function errorCauseChain(error: unknown) {
  const chain: Array<Record<string, unknown>> = []
  let cursor = error
  for (let depth = 0; depth < 5; depth += 1) {
    if (!cursor || typeof cursor !== "object") break
    const row = cursor as Record<string, unknown>
    chain.push(row)
    cursor = row.cause
  }
  return chain
}

function readFirstString(rows: Array<Record<string, unknown>>, keys: string[]) {
  for (const row of rows) {
    for (const key of keys) {
      const value = row[key]
      if (typeof value === "string" && value.trim()) return value.trim()
    }
  }
  return undefined
}

function readFirstNumber(rows: Array<Record<string, unknown>>, keys: string[]) {
  for (const row of rows) {
    for (const key of keys) {
      const value = row[key]
      if (typeof value === "number" && Number.isFinite(value)) return value
    }
  }
  return undefined
}

function safeDynamicProviderMessage(rows: Array<Record<string, unknown>>) {
  const combined = rows
    .map((row) => [row.message, row.error, row.error_description, row.description].filter((value): value is string => typeof value === "string").join(" "))
    .join(" ")
    .toLowerCase()
  const match = SAFE_DYNAMIC_PROVIDER_MESSAGES.find((message) => combined.includes(message.toLowerCase()))
  return match ?? undefined
}

/**
 * Classifies a thrown signInWithExternalJwt error into a safe enum reason for the
 * server-visible beacon. Never returns the raw error.message or stack - only a
 * short error name/code (standard JS error identifiers, not user content) and the
 * matched hint enum.
 */
function classifyDynamicSignInError(error: unknown): ClassifiedDynamicSignInError {
  const chain = errorCauseChain(error)
  const row = typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {}
  const errorName = error instanceof Error
    ? error.name
    : readFirstString(chain, ["name"])
  const rawMessage = error instanceof Error
    ? error.message
    : readFirstString(chain, ["message"]) ?? ""
  const message = `${rawMessage} ${chain.map((entry) => typeof entry.message === "string" ? entry.message : "").join(" ")}`.toLowerCase()
  const status = readFirstNumber(chain, ["status", "statusCode", "httpStatus"])
  const httpStatus = readFirstNumber(chain, ["httpStatus", "status", "statusCode"])
  const errorCode = readFirstString(chain, ["code", "errorCode"])
  const providerCode = readFirstString(chain, ["providerCode", "code", "error", "error_code"])
  const safeProviderMessage = safeDynamicProviderMessage(chain)

  let messageHint = "unknown_dynamic_signin_throw"
  if (errorName === "QuotaExceededError" || errorName === "SecurityError") {
    messageHint = "popup_or_storage_blocked"
  } else if (errorName === "TypeError" && /fetch/.test(message)) {
    messageHint = "network_error"
  } else if (errorName === "InvalidExternalAuthError" || errorCode === "invalid_external_auth_error" || errorCode === "invalid_external_auth") {
    // Dynamic's backend reached and rejected the sign-in (see clientErrorMapper in
    // the installed SDK: APIError with code "invalid_external_auth" is converted to
    // InvalidExternalAuthError / "invalid_external_auth_error"). Dynamic does not
    // expose which validation step failed, so this is as specific as the SDK gets -
    // check issuer/audience/kid/JWKS/BYOA-enablement server-side from here.
    messageHint = "external_auth_rejected"
  } else if (/invalid external ?auth/.test(message)) {
    messageHint = "external_auth_rejected"
  } else {
    for (const { pattern, hint } of DYNAMIC_SIGNIN_MESSAGE_HINTS) {
      if (pattern.test(message)) {
        messageHint = hint
        break
      }
    }
  }

  return {
    reason: "dynamic_signin_threw",
    errorName: errorName ? errorName.slice(0, 40) : undefined,
    errorCode: errorCode ? errorCode.slice(0, 40) : undefined,
    status,
    httpStatus,
    providerCode: providerCode ? providerCode.slice(0, 40) : undefined,
    safeProviderMessage,
    messageHint,
  }
}

// Lightweight classifier for an error that escapes refreshDynamicWalletRuntime
// (e.g. the intermittent TypeError seen when two SDK hydration calls raced each
// other). Only name/code - never the raw error, message, or wallet data - so
// this is always safe to log server-side via emitWalletSetupDebugEvent.
function classifyDynamicRefreshError(error: unknown): { errorName: string | null; errorCode: string | null } {
  const chain = errorCauseChain(error)
  const errorName = error instanceof Error ? error.name : readFirstString(chain, ["name"])
  const errorCode = readFirstString(chain, ["code", "errorCode", "error_code"])
  return {
    errorName: errorName ? errorName.slice(0, 40) : null,
    errorCode: errorCode ? errorCode.slice(0, 40) : null,
  }
}

// A thrown signInWithExternalJwt is retried once for hints that plausibly describe
// a transient condition (blocked storage/keychain access, SDK still initializing, a
// dropped network request) rather than a hard configuration error that a retry
// cannot fix.
const DYNAMIC_SIGNIN_RETRYABLE_HINTS = new Set([
  "popup_or_storage_blocked",
  "sdk_not_ready",
  "network_error",
])

function walletConnectorRecord(wallet: unknown) {
  return toRecord(toRecord(wallet).connector)
}

function walletAddresses(wallet: unknown) {
  const row = toRecord(wallet)
  const primaryAddress = safeString(row.address)
  const additional = Array.isArray(row.additionalAddresses)
    ? row.additionalAddresses.flatMap((entry) => {
        const address = safeString(toRecord(entry).address)
        return address ? [address] : []
      })
    : []
  return [primaryAddress, ...additional].flatMap((address) => address ? [address] : [])
}

function walletSigningCapabilities(wallet: unknown) {
  const row = toRecord(wallet)
  const connector = walletConnectorRecord(wallet)
  const hasEvmClient = typeof row.getWalletClient === "function" || typeof connector.getWalletClient === "function"
  const hasSolanaSigner =
    typeof row.signAndSendTransaction === "function" ||
    typeof connector.signAndSendTransaction === "function"
  const hasBitcoinSigner = typeof row.signPsbt === "function" || typeof connector.signPsbt === "function"
  const hasMessageSigner = typeof row.signMessage === "function" || typeof connector.signMessage === "function"
  return {
    canSign: hasEvmClient || hasSolanaSigner || hasBitcoinSigner || hasMessageSigner,
    hasEvmClient,
    hasSolanaSigner,
    hasBitcoinSigner,
    hasMessageSigner,
  }
}

function dynamicWalletInventoryEntry(wallet: unknown, source: "useUserWallets" | "primaryWallet" | "waas") {
  const row = toRecord(wallet)
  const connector = walletConnectorRecord(wallet)
  const addresses = walletAddresses(wallet)
  const capabilities = walletSigningCapabilities(wallet)
  return {
    source,
    id: safeString(row.id),
    key: safeString(row.key),
    chain: safeString(row.chain),
    address: safeString(row.address),
    addresses,
    addressCount: addresses.length,
    additionalAddressCount: Array.isArray(row.additionalAddresses) ? row.additionalAddresses.length : 0,
    connector: {
      key: safeString(connector.key),
      name: safeString(connector.name),
      connectedChain: safeString(connector.connectedChain),
      isEmbeddedWallet: Boolean(connector.isEmbeddedWallet),
      isWalletConnect: Boolean(connector.isWalletConnect),
      isInstalledOnBrowser: safeBooleanCall(connector.isInstalledOnBrowser),
      isInitialized: typeof connector.isInitialized === "boolean" ? connector.isInitialized : null,
      supportedChains: Array.isArray(connector.supportedChains) ? connector.supportedChains.map(safeString) : [],
    },
    embeddedOrExternal: connector.isEmbeddedWallet ? "embedded" : "external",
    signing: capabilities,
  }
}

function inferDynamicInventoryDiagnosis(input: {
  dynamicWaasIsEnabled: boolean
  shouldInitializeWaas: boolean
  needsAutoCreateWalletChains: unknown[]
  embeddedWalletSessionActive: boolean
  legacyUserHasEmbeddedWallet: boolean
  waasCredentialCount: number
  embeddedWallets: Array<ReturnType<typeof dynamicWalletInventoryEntry>>
  allWallets: Array<ReturnType<typeof dynamicWalletInventoryEntry>>
}) {
  const hasEmbeddedEvmWallet = input.embeddedWallets.some((wallet) =>
    wallet.signing.hasEvmClient ||
    wallet.chain === "EVM" ||
    wallet.connector.connectedChain === "EVM" ||
    wallet.addresses.some((address) => /^0x[a-fA-F0-9]{40}$/.test(address))
  )
  const hasEmbeddedSolanaWallet = input.embeddedWallets.some((wallet) =>
    wallet.signing.hasSolanaSigner ||
    wallet.chain === "SOL" ||
    wallet.connector.connectedChain === "SOL" ||
    wallet.addresses.some((address) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))
  )
  const solanaFilteredOut = !hasEmbeddedSolanaWallet && input.allWallets.some((wallet) =>
    wallet.chain === "SOL" ||
    wallet.connector.connectedChain === "SOL" ||
    wallet.signing.hasSolanaSigner ||
    wallet.addresses.some((address) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))
  )
  const noEmbeddedWalletReason = input.embeddedWallets.length > 0
    ? null
    : input.dynamicWaasIsEnabled
      ? input.shouldInitializeWaas
        ? "waas_not_initialized"
        : input.needsAutoCreateWalletChains.length > 0
          ? "waas_wallet_accounts_not_created"
          : input.waasCredentialCount === 0
            ? "dynamic_project_or_auth_did_not_issue_embedded_wallet_credentials"
            : "waas_credentials_exist_but_no_runtime_wallets_restored"
      : input.legacyUserHasEmbeddedWallet
        ? input.embeddedWalletSessionActive
          ? "legacy_embedded_session_active_but_no_wallets_returned"
          : "legacy_embedded_wallet_exists_but_session_not_restored"
        : "legacy_embedded_wallet_not_created_for_user"

  return {
    hasEmbeddedEvmWallet,
    hasEmbeddedSolanaWallet,
    solanaFilteredOut,
    noEmbeddedWalletReason,
    restorationFailure:
      input.embeddedWallets.length === 0 &&
      (input.waasCredentialCount > 0 || input.legacyUserHasEmbeddedWallet)
        ? noEmbeddedWalletReason
        : null,
    missingProjectOrRuntime:
      input.embeddedWallets.length === 0 &&
      !input.shouldInitializeWaas &&
      input.needsAutoCreateWalletChains.length === 0 &&
      input.waasCredentialCount === 0 &&
      !input.legacyUserHasEmbeddedWallet
        ? "project_configuration_or_auth_policy_did_not_provision_embedded_wallets"
        : null,
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
    addressPrefix: w.address ? `${w.address.slice(0, 6)}...` : "-",
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
      <p className="mb-2 font-sans text-xs font-semibold text-yellow-700">DEV - wallet SDK diagnostics (hidden in production)</p>
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
  bitcoinTransferType,
  onBitcoinTransferTypeChange,
  destinationAddress,
  selectedDestinationId,
  amountDecimal,
  screen,
  review,
  error,
  approvalError,
  reviewing,
  submitting,
  submitResult,
  selectedBalance,
  diagnostics,
  debugEnabled,
  accessToken,
  maxEstimating,
  maxWarning,
  onAssetSelect,
  onDestinationChange,
  onSelectDestination,
  onAmountChange,
  onMaxAmount,
  onEdit,
  onDone,
  onCancel,
  onReview,
  onSubmit,
  onOpenWallet,
  onOpenAddressBook,
  onFinishSetup,
}: {
  rail: WithdrawalRail
  asset: WithdrawalAsset
  assetOptions: WithdrawalAssetOption[]
  bitcoinTransferType: BitcoinTransferType
  onBitcoinTransferTypeChange: (value: BitcoinTransferType) => void
  destinationAddress: string
  selectedDestinationId: string | null
  amountDecimal: string
  screen: WithdrawalScreen
  review: WithdrawalReviewResponse | null
  error: string
  approvalError: string
  reviewing: boolean
  submitting: boolean
  submitResult: WithdrawalSubmitResponse | null
  selectedBalance: SyncedBalanceAsset | null
  diagnostics: WithdrawalDiagnostics
  debugEnabled?: boolean
  accessToken: string | null
  maxEstimating?: boolean
  maxWarning?: string
  onAssetSelect: (rail: WithdrawalRail, asset: WithdrawalAsset) => void
  onDestinationChange: (value: string) => void
  onSelectDestination: (destination: SavedWithdrawalDestination | null) => void
  onAmountChange: (value: string) => void
  onMaxAmount: () => void
  onEdit: () => void
  onDone: () => void
  onCancel: () => void
  onReview: () => void
  onSubmit: (context?: WithdrawalSubmitContext) => void
  onOpenWallet?: () => void
  onOpenAddressBook?: () => void
  onFinishSetup?: () => void
}) {
  const [savedDestinations, setSavedDestinations] = useState<SavedWithdrawalDestination[]>([])
  const [saveThisDestination, setSaveThisDestination] = useState(false)
  const [saveDestinationLabel, setSaveDestinationLabel] = useState("")
  const [savingDestination, setSavingDestination] = useState(false)
  const [saveDestinationError, setSaveDestinationError] = useState("")
  const [irreversibleAckChecked, setIrreversibleAckChecked] = useState(false)

  // Reset the irreversibility acknowledgment whenever a new review appears -
  // it must be re-confirmed per withdrawal, never carried over.
  useEffect(() => {
    setIrreversibleAckChecked(false)
  }, [review?.request.id])

  const savedDestinationsMethod = rail === "bitcoin" ? bitcoinTransferType : undefined

  const fetchSavedDestinations = useCallback(async () => {
    if (!accessToken) return
    const params = new URLSearchParams({ rail, asset })
    if (savedDestinationsMethod) params.set("method", savedDestinationsMethod)
    try {
      const res = await fetch(`/api/wallets/pinetree-wallet/withdrawal-destinations?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: "include",
        cache: "no-store",
      })
      if (!res.ok) return
      const json = (await res.json()) as { destinations?: SavedWithdrawalDestination[] }
      setSavedDestinations(json.destinations || [])
    } catch {
      // Saved destinations are a convenience layer - a fetch failure just
      // means the quick-pick list is empty; manual entry always still works.
    }
  }, [accessToken, rail, asset, savedDestinationsMethod])

  useEffect(() => {
    void fetchSavedDestinations()
  }, [fetchSavedDestinations])

  async function handleSaveDestination() {
    const trimmedDestination = destinationAddress.trim()
    if (!accessToken || !trimmedDestination) return
    setSavingDestination(true)
    setSaveDestinationError("")
    try {
      const res = await fetch("/api/wallets/pinetree-wallet/withdrawal-destinations", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          rail,
          asset,
          destination_address: trimmedDestination,
          label: saveDestinationLabel.trim(),
        }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) {
        setSaveDestinationError(json.error || "Couldn't save this destination.")
        return
      }
      setSaveThisDestination(false)
      setSaveDestinationLabel("")
      void fetchSavedDestinations()
    } catch {
      setSaveDestinationError("Couldn't save this destination.")
    } finally {
      setSavingDestination(false)
    }
  }

  const amountTrimmed = amountDecimal.trim()
  const selectedBalanceAmount = selectedBalance?.availableToWithdraw ?? (selectedBalance?.balance != null ? String(selectedBalance.balance) : null)
  const selectedBalanceKnown = selectedBalanceAmount !== null && selectedBalance?.status === "synced"
  const selectedBalanceNumeric = selectedBalanceAmount === null ? null : Number(selectedBalanceAmount)
  const selectedBalanceZero = selectedBalanceKnown && selectedBalanceNumeric !== null && selectedBalanceNumeric <= 0
  const amountValue = Number(amountTrimmed)
  const missingAmount = amountTrimmed.length === 0
  const amountParseError = amountTrimmed.length > 0 && !Number.isFinite(amountValue)
  const invalidAmount = amountTrimmed.length > 0 && Number.isFinite(amountValue) && !(amountValue > 0)
  const amountExceedsBalance = selectedBalanceKnown && selectedBalanceNumeric !== null && amountValue > selectedBalanceNumeric
  const missingDestination = destinationAddress.trim().length === 0
  const noWithdrawableAssets = assetOptions.length === 0
  const bitcoinBalanceUnavailable = rail === "bitcoin" && !selectedBalanceKnown
  const reviewBlockedByInput = reviewing || noWithdrawableAssets || missingDestination || missingAmount || amountParseError || invalidAmount || selectedBalanceZero || amountExceedsBalance || bitcoinBalanceUnavailable
  const reviewDisabled = reviewBlockedByInput
  const formattedAvailable = formatCryptoAmount(selectedBalanceAmount, asset)
  const maxDisabled = !selectedBalanceKnown || selectedBalanceZero
  const nativeMaxNote = isNativeWithdrawalAsset(asset) && selectedBalanceKnown && !selectedBalanceZero
  const reviewActionLabel = review?.review.approvalMethod === "dynamic_browser" ? "Approve withdrawal" : "Submit withdrawal request"
  const blockingMessage =
    error ||
    (missingDestination
      ? "Enter a destination address to review."
      : missingAmount
        ? "Enter an amount to review."
        : amountParseError
          ? "Enter a valid withdrawal amount."
          : invalidAmount
            ? "Enter an amount greater than 0."
              : bitcoinBalanceUnavailable
                ? "Balance temporarily unavailable. Refresh before withdrawing."
              : selectedBalanceZero
                ? "No available balance for this asset."
                : noWithdrawableAssets
                  ? "Withdrawals are being finalized. Receiving funds is available now."
                  : amountExceedsBalance
                    ? "Amount exceeds available balance."
                    : "")

  if (screen === "review" && review) {
    return (
      <div className="space-y-4">
        <div className="rounded-[1.35rem] border border-blue-200/70 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.10),transparent_45%),linear-gradient(135deg,rgba(255,255,255,0.98),rgba(247,251,255,0.97))] px-4 py-4 shadow-[0_18px_42px_rgba(37,99,235,0.10)] sm:px-5 sm:py-5">
          <p className="text-base font-semibold text-gray-950">Review withdrawal</p>
          <p className="mt-1 text-xs leading-5 text-gray-500">Confirm the withdrawal details before approving.</p>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-xl border border-blue-100/70 bg-white/80 px-3 py-2.5">
              <dt className="text-xs font-semibold text-gray-500">Asset</dt>
              <dd className="mt-1 font-semibold text-gray-950">{review.review.asset}</dd>
            </div>
            <div className="rounded-xl border border-blue-100/70 bg-white/80 px-3 py-2.5">
              <dt className="text-xs font-semibold text-gray-500">Network</dt>
              <dd className="mt-1 font-semibold text-gray-950">{railDisplayName(review.review.rail)}</dd>
            </div>
            <div className="rounded-xl border border-blue-100/70 bg-white/80 px-3 py-2.5">
              <dt className="text-xs font-semibold text-gray-500">Amount</dt>
              <dd className="mt-1 font-semibold text-gray-950">{review.review.amountDecimal} {review.review.asset}</dd>
            </div>
            <div className="rounded-xl border border-blue-100/70 bg-white/80 px-3 py-2.5">
              <dt className="text-xs font-semibold text-gray-500">Estimated network fee</dt>
              <dd className="mt-1 font-semibold text-gray-950">Network fee may apply</dd>
            </div>
            <div className="rounded-xl border border-blue-100/70 bg-white/80 px-3 py-2.5 sm:col-span-2">
              <dt className="text-xs font-semibold text-gray-500">Destination</dt>
              <dd className="mt-1 break-all font-mono text-xs text-gray-800">{review.review.destinationAddress}</dd>
            </div>
          </dl>
        </div>
        {debugEnabled ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-3 text-xs text-slate-700">
            <p className="font-semibold text-slate-900">Signer diagnostics (?walletDebug=1)</p>
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              <p>selectedRail: {rail}</p>
              <p>selectedAsset: {asset}</p>
              <p>preparedPayloadKind: {expectedWithdrawalPayloadKindForRail(rail)}</p>
              <p>preparedPayloadNetwork: {expectedWithdrawalPayloadNetworkLabel(rail)}</p>
              <p>preparedSourceAddressLast6: {diagnostics.savedSourceAddress ? `...${diagnostics.savedSourceAddress.slice(-6)}` : "none"}</p>
              <p>selectedDynamicWalletAddressLast6: {diagnostics.signerWalletAddressLast6 ? `...${diagnostics.signerWalletAddressLast6}` : "none"}</p>
              <p>selectedDynamicWalletConnector: {[diagnostics.signerConnectorName, diagnostics.signerConnectorKey].filter(Boolean).join(" / ") || "none"}</p>
              <p>selectedDynamicWalletChain: {diagnostics.signerChain || "none"}</p>
              <p>dynamicPrimaryWalletChain: {diagnostics.primaryWalletChain || "none"}</p>
              <p>inferredSignerRail: {diagnostics.signerRail}</p>
              <p>willOpenDynamicModal: {String(diagnostics.willOpenDynamicModal)}</p>
            </div>
          </div>
        ) : null}
        <label className="flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50/50 px-3 py-2.5">
          <input
            type="checkbox"
            checked={irreversibleAckChecked}
            onChange={(event) => setIrreversibleAckChecked(event.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300"
          />
          <span className="text-xs leading-5 text-blue-900">
            I verified that this destination supports the selected asset and network. Cryptocurrency transfers are irreversible, and PineTree cannot recover funds sent to an incorrect or unsupported destination.
          </span>
        </label>
        {!submitting && review.canSubmit ? (
          <p className="text-xs font-medium text-blue-700">
            {irreversibleAckChecked
              ? "Ready to approve withdrawal."
              : "Confirm the acknowledgment above to enable withdrawal approval."}
          </p>
        ) : null}
        {!submitting && !review.canSubmit ? (
          <p className="text-xs font-medium text-red-700">
            This withdrawal can&apos;t be approved right now. Go back and review it again.
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => onSubmit({ irreversibleAckChecked })}
            disabled={submitting || !review.canSubmit || !irreversibleAckChecked}
            className="inline-flex h-11 items-center justify-center rounded-lg bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 disabled:shadow-none sm:order-3"
          >
            {reviewActionLabel}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex h-11 items-center justify-center rounded-lg border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-600 shadow-sm transition hover:border-blue-200 hover:text-blue-700 sm:order-1"
          >
            Back
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="inline-flex h-11 items-center justify-center rounded-lg border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-600 shadow-sm transition hover:border-red-200 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 sm:order-2"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  if (screen === "approving") {
    return (
      <div className="rounded-[1.2rem] border border-blue-100/80 bg-blue-50/50 px-5 py-6 text-center">
        <p className="text-base font-semibold text-gray-950">Approving withdrawal</p>
        <p className="mt-2 text-sm leading-6 text-gray-600">Confirm this withdrawal in PineTree Wallet.</p>
      </div>
    )
  }

  if (screen === "submitted" && submitResult) {
    const isSolanaSolWithdrawal = review?.review.rail === "solana" && review.review.asset === "SOL"
    return (
      <div className="space-y-4">
        <div className="rounded-[1.2rem] border border-blue-200 bg-blue-50/70 px-5 py-5">
          <p className="text-base font-semibold text-blue-950">{isSolanaSolWithdrawal ? "Withdrawal sent" : "Withdrawal submitted"}</p>
          {isSolanaSolWithdrawal ? (
            <p className="mt-2 text-sm leading-6 text-blue-900">Your SOL withdrawal has been submitted.</p>
          ) : null}
        {submitResult.request.provider_reference || submitResult.request.tx_hash ? (
          <p className="mt-2 break-all text-xs leading-5 text-blue-900">
            Transaction reference: {submitResult.request.tx_hash || submitResult.request.provider_reference}
          </p>
        ) : null}
        </div>
        <button
          type="button"
          onClick={onDone}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
        >
          Done
        </button>
      </div>
    )
  }

  if (screen === "failed") {
    const isSignerSessionError =
      approvalError.includes("not active in this browser session") ||
      approvalError.includes("different PineTree Wallet session") ||
      approvalError === solanaWithdrawalReconnectMessage
    const withdrawalOutcomePending = approvalError === withdrawalStatusUnknownMessage
    return (
      <div className="space-y-4">
        <div className={withdrawalOutcomePending
          ? "rounded-[1.2rem] border border-amber-200 bg-amber-50 px-5 py-5"
          : "rounded-[1.2rem] border border-red-200 bg-red-50 px-5 py-5"}
        >
          <p className={withdrawalOutcomePending ? "text-base font-semibold text-amber-950" : "text-base font-semibold text-red-900"}>
            {withdrawalOutcomePending ? "Withdrawal outcome pending" : "Withdrawal failed"}
          </p>
          <p className={withdrawalOutcomePending ? "mt-1 text-sm leading-6 text-amber-900" : "mt-1 text-sm leading-6 text-red-800"}>
            {approvalError || error || submitResult?.request.error_message || "The withdrawal could not be completed. Review the details and try again."}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {isSignerSessionError && onOpenWallet ? (
            <button
              type="button"
              onClick={onOpenWallet}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              Open PineTree Wallet
            </button>
          ) : review && !withdrawalOutcomePending ? (
            <button
              type="button"
              onClick={() => onSubmit({ irreversibleAckChecked: true })}
              disabled={submitting}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 disabled:shadow-none"
            >
              {review.review.approvalMethod === "dynamic_browser" ? "Try approval again" : "Try Again"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-blue-200 hover:text-blue-700"
          >
            Edit withdrawal
          </button>
          {approvalError !== withdrawalStatusUnknownMessage ? (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-600 shadow-sm transition hover:border-red-200 hover:text-red-600"
            >
              Cancel
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
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
                ? `~ ${formatUsd(option.balance.usdValue)}`
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
          Withdrawals are being finalized. Receiving funds is available now.
        </div>
      )}

      {rail === "bitcoin" ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase text-gray-500">Transfer type</p>
          <SegmentedButtons
            ariaLabel="Bitcoin transfer type"
            value={bitcoinTransferType}
            onChange={onBitcoinTransferTypeChange}
            options={[
              { value: "onchain", label: "Bitcoin Network" },
              { value: "lightning", label: "Lightning" },
            ]}
          />
        </div>
      ) : null}

      {savedDestinations.length > 0 ? (
        <div className="space-y-2 rounded-[1.1rem] border border-blue-100 bg-blue-50/40 px-3 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Choose Saved Destination</p>
            {onOpenAddressBook ? (
              <button
                type="button"
                onClick={onOpenAddressBook}
                className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-blue-200 bg-white px-3 text-xs font-semibold text-blue-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
              >
                Open Address Book
              </button>
            ) : null}
          </div>
          <div className="relative bg-white">
            <select
              aria-label="Saved destination"
              value={selectedDestinationId || ""}
              onChange={(event) => {
                const id = event.target.value
                onSelectDestination(id ? savedDestinations.find((d) => d.id === id) || null : null)
              }}
              className="h-10 w-full appearance-none rounded-lg border border-gray-200 bg-white pl-3 pr-8 text-sm text-gray-800 outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
            >
              <option value="">Select a saved destination</option>
              {savedDestinations.map((saved) => (
                <option key={saved.id} value={saved.id}>
                  {saved.label || `${saved.destination_address.slice(0, 6)}...${saved.destination_address.slice(-4)}`}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase text-gray-500">Paste New Address</p>
        <input
          value={destinationAddress}
          onChange={(event) => onDestinationChange(event.target.value)}
          aria-label="Destination address"
          placeholder={
            rail === "bitcoin"
              ? bitcoinTransferType === "onchain"
                ? "Paste a Bitcoin address"
                : "Paste a Lightning Address or invoice"
              : "Paste destination address"
          }
          className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 font-mono text-sm text-gray-900 outline-none transition placeholder:font-sans placeholder:text-gray-400 focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
        />
        {destinationAddress.trim() ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={saveThisDestination}
                onChange={(event) => setSaveThisDestination(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300"
              />
              Save this destination
            </label>
            {saveThisDestination ? (
              <>
                <input
                  value={saveDestinationLabel}
                  onChange={(event) => setSaveDestinationLabel(event.target.value)}
                  placeholder="Label (optional)"
                  className="h-7 w-40 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-900 outline-none focus:border-blue-300"
                />
                <button
                  type="button"
                  onClick={() => void handleSaveDestination()}
                  disabled={savingDestination}
                  className="inline-flex h-7 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-xs font-semibold text-blue-700 disabled:opacity-50"
                >
                  {savingDestination ? "Saving..." : "Save"}
                </button>
              </>
            ) : null}
          </div>
        ) : null}
        {saveDestinationError ? <p className="text-xs text-red-600">{saveDestinationError}</p> : null}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase text-gray-500">Amount</p>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <input
              value={amountDecimal}
              onChange={(event) => onAmountChange(event.target.value)}
              inputMode="decimal"
              aria-label="Withdrawal amount"
              placeholder="0.00"
              className="h-11 w-full rounded-xl border border-gray-200 bg-white pl-3 pr-14 text-sm font-semibold text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-gray-400">
              {asset}
            </span>
          </div>
          <button
            type="button"
            onClick={onMaxAmount}
            disabled={maxDisabled || maxEstimating}
            className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-blue-200 hover:text-blue-700 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 disabled:shadow-none"
          >
            {maxEstimating ? "..." : "Max"}
          </button>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
          <span>
            {selectedBalanceKnown
              ? `Available: ${formattedAvailable} ${asset}`
              : "Balance indexing pending"}
            {selectedBalanceKnown && selectedBalance?.usdValue !== null && selectedBalance?.usdValue !== undefined
              ? ` - ~ ${formatUsd(selectedBalance.usdValue)}`
              : null}
          </span>
          {!selectedBalanceKnown ? <span>Balance will be verified before processing.</span> : nativeMaxNote ? <span>Network fee may apply.</span> : null}
        </div>
        {maxWarning ? (
          <p className="text-xs leading-5 text-blue-700">{maxWarning}</p>
        ) : (
          <p className="text-[11px] leading-4 text-gray-500">
            {rail === "bitcoin"
              ? bitcoinTransferType === "lightning"
                ? "Lightning sends settle instantly - the exact routing fee is set at send time."
                : "PineTree leaves a small buffer for the Bitcoin network fee, set at send time."
              : asset === "USDC" && rail === "base"
                ? "USDC transfers on Base require a small amount of ETH on Base for network fees."
                : asset === "USDC" && rail === "solana"
                  ? "USDC transfers on Solana require a small amount of SOL for network fees."
                  : "PineTree may reserve a small amount of the network's native asset to cover future transaction fees. Your maximum withdrawal may be slightly lower than your total balance."}
          </p>
        )}
      </div>

      {blockingMessage ? (
        <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2 text-xs font-semibold leading-5 text-blue-800">
          {blockingMessage}
        </div>
      ) : null}

      <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={onReview}
          disabled={reviewDisabled}
          className="inline-flex h-11 min-w-[12rem] items-center justify-center rounded-lg bg-[#0052FF] px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 disabled:shadow-none"
        >
          {reviewing ? "Reviewing..." : "Review withdrawal"}
        </button>
        {destinationAddress.trim() || amountTrimmed || selectedDestinationId ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={reviewing}
            className="inline-flex h-11 items-center justify-center rounded-lg border border-gray-200 bg-white px-6 text-sm font-semibold text-gray-600 shadow-sm transition hover:border-red-200 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
        ) : null}
      </div>

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
  if (value === null) return "\u2014"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatBalance(value: number | string | null, asset: string) {
  if (value === null) return "Pending sync"
  if (asset === "BTC" && typeof value === "string") return `${value} ${asset}`
  const numericValue = typeof value === "string" ? Number(value) : value
  const decimals = asset === "USDC" ? 2 : asset === "BTC" ? 8 : 6
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: numericValue === 0 ? 0 : 0,
    maximumFractionDigits: decimals,
  }).format(numericValue)} ${asset}`
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

function formatActivityTimestamp(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const datePart = date.toLocaleString(undefined, { month: "short", day: "numeric" })
  const timePart = date.toLocaleString(undefined, { hour: "numeric", minute: "2-digit" })
  return `${datePart} at ${timePart}`
}

function activityAmountLabel(item: WalletActivityItem) {
  if (item.amountLabel) return item.amountLabel
  if (item.amountDecimal && item.asset) return `${item.amountDecimal} ${item.asset}`
  return item.label.replace(/^Auto-swept\s+/i, "").replace(/^Sent\s+/i, "")
}

function activityDestinationLabel(item: WalletActivityItem) {
  if (item.destinationLabel) return item.destinationLabel
  if (item.destinationAddress) return shortAddress(item.destinationAddress)
  if (item.source === "saved_address") return "Saved destination"
  if (item.source === "automatic_sweep") return "Default destination"
  return "Manual destination"
}

function providerDisplayLabel(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase()
  if (!normalized) return "PineTree"
  if (normalized === "speed") return "Speed"
  if (normalized === "dynamic") return "Dynamic"
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

function networkDisplayLabel(value: string | null | undefined, rail?: WithdrawalRail | null) {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "base") return "Base"
  if (normalized === "solana") return "Solana"
  if (normalized === "bitcoin" || normalized === "bitcoin_lightning") return "Bitcoin"
  return rail ? railDisplayName(rail) : "PineTree Wallet"
}

function explorerUrlForActivity(detail: WalletActivityDetail) {
  if (detail.explorerUrl) return detail.explorerUrl
  if (!detail.txHash) return null
  if (detail.rail === "base") return `https://basescan.org/tx/${encodeURIComponent(detail.txHash)}`
  if (detail.rail === "solana") return `https://solscan.io/tx/${encodeURIComponent(detail.txHash)}`
  if (detail.rail === "bitcoin") return `https://mempool.space/tx/${encodeURIComponent(detail.txHash)}`
  return null
}

function txHashFromExplorerUrl(value: string | null) {
  if (!value) return null
  try {
    const url = new URL(value)
    const candidate = url.pathname.split("/").filter(Boolean).at(-1)
    return candidate ? decodeURIComponent(candidate) : null
  } catch {
    return null
  }
}

function walletRailDetailView(rail: WithdrawalRail): WalletSecondaryView {
  if (rail === "base") return "base-details"
  if (rail === "solana") return "solana-details"
  return "bitcoin-details"
}

function walletRailStatusClasses(tone: "blue" | "default" | "amber") {
  if (tone === "blue") return "bg-blue-50 text-blue-700"
  if (tone === "amber") return "bg-amber-100 text-amber-800"
  return "bg-gray-100 text-gray-700"
}

function computeWalletInsights(rows: WalletRailRow[], sync: PineTreeWalletSyncResponse | null): string[] {
  if (!sync) return []
  const insights: string[] = []

  const railTotals: Array<{ label: WalletRailRow["label"]; usd: number }> = [
    { label: "Base", usd: sync.balances.base.reduce((sum, item) => sum + Number(item.usdValue ?? 0), 0) },
    { label: "Solana", usd: sync.balances.solana.reduce((sum, item) => sum + Number(item.usdValue ?? 0), 0) },
    { label: "Bitcoin", usd: sync.balances.bitcoin.reduce((sum, item) => sum + Number(item.usdValue ?? 0), 0) },
  ]

  const totalUsd = sync.totalUsd ?? 0
  if (totalUsd > 0) {
    const largest = railTotals.reduce((best, rail) => (rail.usd > best.usd ? rail : best), railTotals[0])
    if (largest.usd > 0) {
      const share = Math.round((largest.usd / totalUsd) * 100)
      insights.push(`${largest.label} holds your largest balance at ${formatUsd(largest.usd)} (${share}% of total).`)
    }
  }

  const connectedRails = rows.filter((row) => row.configured && row.enabled)
  const zeroBalanceRail = connectedRails.find((row) => {
    const total = railTotals.find((rail) => rail.label === row.label)
    return total ? total.usd === 0 : false
  })
  if (zeroBalanceRail && insights.length < 3) {
    insights.push(`${zeroBalanceRail.label} is connected but currently has no balance.`)
  }

  const lastConfirmedWithdrawal = sync.recentActivity.find(
    (item) => getPaymentDisplayStatus(item.status).tone === "confirmed"
  )
  if (lastConfirmedWithdrawal && insights.length < 3) {
    const timestamp = formatActivityTimestamp(lastConfirmedWithdrawal.completedAt ?? lastConfirmedWithdrawal.createdAt)
    insights.push(
      timestamp
        ? `Last successful withdrawal: ${activityAmountLabel(lastConfirmedWithdrawal)} on ${timestamp}.`
        : `Last successful withdrawal: ${activityAmountLabel(lastConfirmedWithdrawal)}.`
    )
  }

  if (insights.length < 3 && rows.length > 0) {
    insights.push(`${connectedRails.length} of ${rows.length} wallet network${rows.length === 1 ? "" : "s"} connected.`)
  }

  return insights.slice(0, 3)
}

function WalletOverviewSummary({
  rows,
  sync,
  syncing,
  onSelectRail,
  onOpenWithdraw,
  onViewAllActivity,
  onOpenAddressBook,
  onOpenSettings,
}: {
  rows: WalletRailRow[]
  sync: PineTreeWalletSyncResponse | null
  syncing: boolean
  onSelectRail?: (rail: WithdrawalRail) => void
  onOpenWithdraw: () => void
  onViewAllActivity?: () => void
  onOpenAddressBook: () => void
  onOpenSettings: () => void
}) {
  const visibleRows = rows
  const lastSynced = formatLastSynced(sync?.lastSyncedAt ?? null)
  const recentItems = (sync?.recentActivity ?? []).slice(0, 3)
  const hasSyncedOnce = Boolean(sync?.lastSyncedAt)
  const walletInsights = hasSyncedOnce ? computeWalletInsights(rows, sync) : []
  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-[1.35rem] border border-blue-200/70 bg-[radial-gradient(circle_at_90%_8%,rgba(0,82,255,0.20),transparent_34%),linear-gradient(135deg,rgba(239,246,255,0.98),rgba(255,255,255,0.96))] px-5 py-5 shadow-[0_22px_50px_rgba(37,99,235,0.13)] sm:px-6 sm:py-6">
        <div className="relative">
          <p className={dashboardSectionLabelClass}>TOTAL BALANCE</p>
          <p className="mt-2 text-[2.35rem] font-semibold leading-none tracking-normal text-gray-950 sm:text-5xl">{formatWalletTotalBalance(sync?.totalUsd, syncing)}</p>
          <p className="mt-3 text-xs leading-5 text-gray-500">
          {syncing ? "Syncing..." : lastSynced ? `Last synced ${lastSynced}` : "Pending sync"}
          </p>
        </div>
      </div>
      <SegmentedButtons
        ariaLabel="Wallet workflows"
        className="grid grid-cols-4 gap-1.5"
        value="none"
        onChange={(value) => {
          if (value === "withdraw") onOpenWithdraw()
          if (value === "activity") onViewAllActivity?.()
          if (value === "address-book") onOpenAddressBook()
          if (value === "settings") onOpenSettings()
        }}
        options={walletWorkflowOptions}
        size="compact"
      />
      {visibleRows.length > 0 ? (
        <div className="overflow-hidden rounded-[1.35rem] border border-blue-200/60 bg-white shadow-[0_18px_42px_rgba(15,23,42,0.07)]">
          <div className="border-b border-blue-100/70 bg-blue-50/55 px-4 py-3 sm:px-5">
            <p className={dashboardSectionLabelClass}>WALLET SUMMARY</p>
          </div>
          <div className="divide-y divide-blue-50">
            {visibleRows.map((row) => {
              const railUsd = row.label === "Base"
                ? sync?.balances.base.reduce((sum, item) => sum + Number(item.usdValue ?? 0), 0) ?? null
                : row.label === "Solana"
                  ? sync?.balances.solana.reduce((sum, item) => sum + Number(item.usdValue ?? 0), 0) ?? null
                  : sync?.balances.bitcoin.reduce((sum, item) => sum + Number(item.usdValue ?? 0), 0) ?? null
              const connected = row.configured && row.enabled
              const needsAttention = Boolean(row.needsAttentionMessage)
              const statusLabel = needsAttention ? "Needs attention" : connected ? "Connected" : "Not connected"
              const statusTone = needsAttention ? "amber" : connected ? "blue" : "default"
              return (
                <div key={row.label} className="px-4 py-3.5 sm:px-5">
                  <button
                    type="button"
                    onClick={() => onSelectRail?.(row.rail)}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 rounded-xl px-2 py-1.5 text-left transition hover:bg-blue-50/45 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-100 sm:grid-cols-[minmax(0,1fr)_7.75rem_minmax(5.75rem,auto)_auto]"
                  >
                    <p className="min-w-0 text-sm font-semibold text-gray-900">{row.label}</p>
                    <span className="flex justify-center">
                      <ProviderStatusPill label={statusLabel} tone={statusTone} />
                    </span>
                    <span className="min-w-[72px] text-right text-sm font-semibold tabular-nums text-gray-950 sm:min-w-[92px]">{formatUsd(railUsd)}</span>
                    <ChevronRight size={15} className="text-gray-400" aria-hidden="true" />
                  </button>
                  {needsAttention ? (
                    <p className="mt-1.5 text-xs leading-4 text-amber-700">{row.needsAttentionMessage}</p>
                  ) : null}
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
      <PineTreeInsightsCard
        insights={walletInsights}
        emptyText={
          !hasSyncedOnce && syncing
            ? "Loading wallet insights..."
            : "Wallet insights will appear as your balances and activity grow."
        }
      />
      <div className="overflow-hidden rounded-[1.35rem] border border-blue-200/60 bg-white shadow-[0_18px_42px_rgba(15,23,42,0.07)]">
        <div className="flex items-center justify-between gap-3 border-b border-blue-100/70 bg-blue-50/55 px-4 py-3 sm:px-5">
          <p className={dashboardSectionLabelClass}>RECENT WITHDRAWALS</p>
          {recentItems.length > 0 ? (
            <button
              type="button"
              onClick={onViewAllActivity}
              className="shrink-0 text-xs font-semibold text-blue-700 transition hover:text-blue-900"
            >
              View All Withdrawals
            </button>
          ) : null}
        </div>
        {!hasSyncedOnce && syncing ? (
          <div className="flex items-center gap-1.5 px-4 py-5 sm:px-5">
            <Loader2 size={13} className="animate-spin text-blue-500" />
            <p className="text-sm text-gray-500">Loading recent withdrawals...</p>
          </div>
        ) : recentItems.length === 0 ? (
          <div className="px-4 py-5 sm:px-5">
            <p className="text-sm text-gray-500">No recent withdrawals yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-blue-50">
            {recentItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={onViewAllActivity}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition hover:bg-blue-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-100 sm:px-5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-950">{activityAmountLabel(item)}</p>
                  <p className="mt-0.5 truncate text-xs text-gray-500">
                    {activityDestinationLabel(item)} - {formatActivityTimestamp(item.createdAt) ?? item.createdAt}
                  </p>
                </div>
                <ActivityStatusPill status={item.status} />
              </button>
            ))}
          </div>
        )}
      </div>
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
  railFilter,
  profileAddresses,
  bitcoinReady,
  bitcoinPayoutEntries,
  copiedAddress,
  onCopy,
  onWithdrawAsset,
}: {
  sync: PineTreeWalletSyncResponse | null
  syncing: boolean
  railFilter?: WithdrawalRail
  profileAddresses: Record<"base" | "solana" | "bitcoin", AddressEntry[]>
  bitcoinReady: boolean
  bitcoinPayoutEntries: AddressEntry[]
  copiedAddress: string
  onCopy: (address: string) => void
  onWithdrawAsset: (rail: WithdrawalRail, asset: WithdrawalAsset) => void
}) {
  const assetRailLabel = (rail: SyncedBalanceAsset["rail"]) =>
    rail === "base" ? "Base" : rail === "solana" ? "Solana" : "Bitcoin"
  const balanceOptions = useMemo(() => {
    const rows: SyncedBalanceAsset[] = []
    if (profileAddresses.base.length > 0) rows.push(...(sync?.balances.base ?? []))
    if (profileAddresses.solana.length > 0) rows.push(...(sync?.balances.solana ?? []))
    if (bitcoinReady) rows.push(...(sync?.balances.bitcoin ?? []))
    const visible = rows.filter((row) => {
      if (railFilter && row.rail !== railFilter) return false
      if (row.rail === "bitcoin") return bitcoinReady
      if (row.rail === "base" && profileAddresses.base.length === 0) return false
      if (row.rail === "solana" && profileAddresses.solana.length === 0) return false
      return row.status === "synced" || row.balance !== null || row.usdValue !== null
    })
    return Array.from(new Map(visible.map((row) => [row.key, row])).values())
  }, [bitcoinReady, profileAddresses.base.length, profileAddresses.solana.length, railFilter, sync?.balances])

  function walletAddressForAsset(row: SyncedBalanceAsset) {
    if (row.rail === "base") return profileAddresses.base[0]?.address ?? null
    if (row.rail === "solana") return profileAddresses.solana[0]?.address ?? null
    return bitcoinPayoutEntries[0]?.address ?? null
  }

  if (balanceOptions.length === 0) {
    const hasSyncedOnce = Boolean(sync?.lastSyncedAt)
    if (!hasSyncedOnce && syncing) {
      return (
        <div className="flex items-center gap-1.5 rounded-[1.1rem] border border-dashed border-gray-200 bg-gray-50 px-4 py-5">
          <Loader2 size={13} className="animate-spin text-blue-500" />
          <p className="text-sm text-gray-500">Loading balances...</p>
        </div>
      )
    }
    return (
      <div className="rounded-[1.1rem] border border-dashed border-gray-200 bg-gray-50 px-4 py-5">
        <p className="text-sm font-semibold text-gray-950">No balances yet</p>
        <p className="mt-1 text-xs leading-5 text-gray-500">Received funds will appear here after payments settle.</p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {balanceOptions.map((row) => {
        const walletAddress = walletAddressForAsset(row)
        const rowLastSynced = formatLastSynced(row.lastSyncedAt ?? sync?.lastSyncedAt ?? null)
        const usdLabel = ["synced", "cached", "stale"].includes(row.status) && row.usdValue !== null
          ? formatUsd(row.usdValue)
          : row.status === "unavailable" ? "Balance temporarily unavailable" : "Pending value"

        return (
        <article key={row.key} className="min-w-0 rounded-[1.25rem] border border-blue-200/70 bg-white px-4 py-4 shadow-[0_14px_36px_rgba(15,23,42,0.07)] sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className={dashboardSectionLabelClass}>{row.asset} • {assetRailLabel(row.rail)}</p>
              <p className="mt-2 text-2xl font-semibold leading-tight text-gray-950">{formatBalance(row.balance, row.asset)}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              {row.status === "unavailable" || row.status === "stale" ? (
                <StatusBadge
                  label={row.status === "stale" ? "Stale" : "Unavailable"}
                  classes={walletRailStatusClasses(row.status === "stale" ? "amber" : "default")}
                  showIcon={false}
                />
              ) : null}
              <button
                type="button"
                onClick={() => onWithdrawAsset(row.rail, row.asset)}
                className="inline-flex h-8 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700 transition hover:border-blue-300 hover:bg-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-100"
              >
                Withdraw
              </button>
            </div>
          </div>
          <dl className="mt-4 divide-y divide-gray-100 text-sm">
            <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 py-2.5">
              <dt className="text-xs font-semibold text-gray-500">Balance</dt>
              <dd className="min-w-0 text-right font-semibold text-gray-950">{formatBalance(row.balance, row.asset)}</dd>
            </div>
            <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 py-2.5">
              <dt className="text-xs font-semibold text-gray-500">Estimated USD value</dt>
              <dd className="min-w-0 text-right font-semibold text-gray-950">
                {usdLabel}
              </dd>
            </div>
            <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 py-2.5">
              <dt className="text-xs font-semibold text-gray-500">Network</dt>
              <dd className="min-w-0 text-right font-semibold text-gray-950">{assetRailLabel(row.rail)}</dd>
            </div>
            <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 py-2.5">
              <dt className="text-xs font-semibold text-gray-500">Asset</dt>
              <dd className="min-w-0 text-right font-semibold text-gray-950">{row.asset}</dd>
            </div>
            <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 py-2.5">
              <dt className="text-xs font-semibold text-gray-500">Last synced</dt>
              <dd className="min-w-0 text-right font-semibold text-gray-950">
                {syncing ? "Syncing..." : rowLastSynced ?? "Pending sync"}
              </dd>
            </div>
          </dl>
          {walletAddress !== null ? (
            <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 border-t border-gray-100 py-2.5 text-sm">
              <p className="text-xs font-semibold text-gray-500">Wallet address</p>
              <div className="flex min-w-0 items-center justify-end gap-2">
                <p className="min-w-0 flex-1 truncate text-right font-mono text-xs text-gray-800" title={walletAddress}>
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
        </article>
        )
      })}
    </div>
  )
}

function WalletFloatingWorkspace({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <section
      aria-label={title}
      data-pinetree-floating-workspace="true"
      className="space-y-3"
    >
      <header className="flex items-start justify-between gap-4">
        <h2 className={`min-w-0 ${dashboardSectionLabelClass}`}>{title.toUpperCase()}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Return to Wallet Overview"
          className={modalCloseButtonClass}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      {children}
    </section>
  )
}

function WalletSettingsWorkspace() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="rounded-[1.25rem] border border-blue-200/70 bg-white px-4 py-4 shadow-[0_14px_36px_rgba(15,23,42,0.07)] sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={dashboardSectionLabelClass}>AUTO CONVERSION</p>
            <p className="mt-2 text-sm leading-5 text-gray-600">Automatically convert supported crypto proceeds when a settlement provider is available.</p>
          </div>
          <span className="shrink-0 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">Coming soon</span>
        </div>
        <fieldset disabled className="mt-4 space-y-3 opacity-65">
          <label className="block text-xs font-semibold text-gray-600">
            Auto conversion
            <select value="disabled" onChange={() => {}} className="mt-1 h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm font-normal text-gray-700">
              <option value="disabled">Disabled</option>
              <option value="enabled">Enabled</option>
            </select>
          </label>
          <label className="block text-xs font-semibold text-gray-600">
            Convert to
            <select value="usd" onChange={() => {}} className="mt-1 h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm font-normal text-gray-700">
              <option value="usd">USD</option>
            </select>
          </label>
          <label className="block text-xs font-semibold text-gray-600">
            Conversion timing
            <select value="provider_required" onChange={() => {}} className="mt-1 h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm font-normal text-gray-700">
              <option value="provider_required">Requires settlement provider</option>
            </select>
          </label>
        </fieldset>
      </section>

      <section className="rounded-[1.25rem] border border-blue-200/70 bg-white px-4 py-4 shadow-[0_14px_36px_rgba(15,23,42,0.07)] sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={dashboardSectionLabelClass}>WITHDRAW TO BANK</p>
            <p className="mt-2 text-sm leading-5 text-gray-600">Configure bank settlement preferences after supported bank withdrawal rails are available.</p>
          </div>
          <span className="shrink-0 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">Not yet available</span>
        </div>
        <fieldset disabled className="mt-4 space-y-3 opacity-65">
          <label className="block text-xs font-semibold text-gray-600">
            Connected bank account
            <input value="Requires Stripe Bridge" readOnly className="mt-1 h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm font-normal text-gray-700" />
          </label>
          <label className="block text-xs font-semibold text-gray-600">
            Settlement frequency
            <select value="unavailable" onChange={() => {}} className="mt-1 h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm font-normal text-gray-700">
              <option value="unavailable">Coming soon</option>
            </select>
          </label>
          <label className="block text-xs font-semibold text-gray-600">
            Minimum settlement threshold
            <input value="Not yet available" readOnly className="mt-1 h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm font-normal text-gray-700" />
          </label>
        </fieldset>
      </section>
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
    <div className="flex flex-col items-start text-left">
      <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-950">Connected Networks</p>
      {enabledRows.length === 0 ? (
        <p className="text-xs text-gray-400">None connected yet</p>
      ) : (
        <div className="flex flex-wrap items-center justify-start gap-2.5" aria-label="Enabled payment rails">
          {enabledRows.map((rail) => (
            <span
              key={rail.label}
              className="inline-flex items-center rounded-full border border-blue-100 bg-blue-50/80 px-3 py-1.5 text-xs font-semibold text-blue-700 shadow-[0_1px_0_rgba(37,99,235,0.06)]"
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
// Activity tab
// ---------------------------------------------------------------------------

function ActivityStatusPill({ status }: { status: string }) {
  return <StatusBadge status={status} />
}

function ActivityTab({
  sync,
  syncing,
  accessToken,
}: {
  sync: PineTreeWalletSyncResponse | null
  syncing: boolean
  accessToken: string | null
}) {
  const items = sync?.recentActivity ?? []
  const hasSyncedOnce = Boolean(sync?.lastSyncedAt)
  const [selectedItem, setSelectedItem] = useState<WalletActivityItem | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<WalletActivityDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState("")
  const [copiedDetailValue, setCopiedDetailValue] = useState("")

  function detailFromItem(item: WalletActivityItem): WalletActivityDetail {
    return {
      id: item.id,
      status: item.status,
      amount: activityAmountLabel(item),
      fee: item.feeLabel || "Network fee may apply",
      destinationLabel: activityDestinationLabel(item),
      destinationAddress: item.destinationAddress || null,
      provider: providerDisplayLabel(item.provider || (item.rail === "bitcoin" ? "speed" : "dynamic")),
      network: networkDisplayLabel(item.network, item.rail),
      rail: item.rail,
      submittedAt: item.submittedAt || item.createdAt,
      completedAt: item.completedAt || null,
      txHash: item.txHash || null,
      explorerUrl: item.explorerUrl || null,
      providerReference: item.providerReference || null,
      withdrawalId: item.withdrawalId || item.id,
      instantSendId: item.instantSendId || null,
      rawProviderStatus: item.rawProviderStatus || null,
    }
  }

  function detailFromWithdrawalRequest(item: WalletActivityItem, request: Record<string, unknown>): WalletActivityDetail {
    const destinationSnapshot = request.destination_snapshot
    const snapshot =
      typeof destinationSnapshot === "object" && destinationSnapshot !== null && !Array.isArray(destinationSnapshot)
        ? destinationSnapshot as Record<string, unknown>
        : {}
    const rail = String(request.rail || item.rail) as WithdrawalRail
    const asset = String(request.asset || item.asset || "").trim()
    const amount = String(request.amount_decimal || item.amountDecimal || "").trim()
    const feeAmount = request.fee_amount_decimal != null ? String(request.fee_amount_decimal) : ""
    const feeAsset = request.native_fee_asset != null ? String(request.native_fee_asset) : asset
    const txHash = request.tx_hash != null ? String(request.tx_hash) : item.txHash || null
    return {
      ...detailFromItem(item),
      status: mapActivityDetailStatus(String(request.status || item.status)),
      amount: amount && asset ? `${amount} ${asset}` : activityAmountLabel(item),
      fee: feeAmount ? `${feeAmount} ${feeAsset}` : item.feeLabel || "Network fee may apply",
      destinationLabel: String(snapshot.label || item.destinationLabel || activityDestinationLabel(item)),
      destinationAddress: request.destination_address != null ? String(request.destination_address) : item.destinationAddress || null,
      provider: providerDisplayLabel(request.provider != null ? String(request.provider) : item.provider || "dynamic"),
      network: networkDisplayLabel(request.chain_id != null ? String(request.chain_id) : null, rail),
      rail,
      submittedAt: request.submitted_at != null ? String(request.submitted_at) : item.submittedAt || String(request.created_at || item.createdAt),
      completedAt:
        request.confirmed_at != null
          ? String(request.confirmed_at)
          : item.completedAt || (String(request.status || "").toLowerCase() === "confirmed" ? String(request.updated_at || "") || null : null),
      txHash,
      providerReference: request.provider_reference != null ? String(request.provider_reference) : item.providerReference || null,
      withdrawalId: String(request.id || item.id),
      instantSendId: request.provider_request_id != null ? String(request.provider_request_id) : item.instantSendId || null,
    }
  }

  function detailFromWalletOperation(item: WalletActivityItem, operation: Record<string, unknown>): WalletActivityDetail {
    const network = operation.network != null ? String(operation.network) : item.network || null
    const rail: WithdrawalRail = network === "base" ? "base" : network === "solana" ? "solana" : "bitcoin"
    const amountBaseUnits = operation.amountBaseUnits != null ? String(operation.amountBaseUnits) : ""
    const feeBaseUnits = operation.feeBaseUnits != null ? String(operation.feeBaseUnits) : ""
    return {
      ...detailFromItem(item),
      status: String(operation.status || item.status),
      amount: item.amountLabel || (amountBaseUnits ? `${amountBaseUnits} base units` : activityAmountLabel(item)),
      fee: item.feeLabel || (feeBaseUnits ? `${feeBaseUnits} base units` : "Network fee may apply"),
      destinationLabel: item.destinationLabel || (operation.destinationSummary != null ? String(operation.destinationSummary) : activityDestinationLabel(item)),
      destinationAddress: item.destinationAddress || (operation.destinationSummary != null ? String(operation.destinationSummary) : null),
      provider: providerDisplayLabel(operation.provider != null ? String(operation.provider) : item.provider || "speed"),
      network: networkDisplayLabel(network, rail),
      rail,
      submittedAt: item.submittedAt || (operation.createdAt != null ? String(operation.createdAt) : item.createdAt),
      completedAt: operation.completedAt != null ? String(operation.completedAt) : item.completedAt || null,
      txHash: operation.txHash != null ? String(operation.txHash) : item.txHash || null,
      explorerUrl: operation.explorerUrl != null ? String(operation.explorerUrl) : item.explorerUrl || null,
      withdrawalId: String(operation.id || item.id),
    }
  }

  async function copyDetailValue(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedDetailValue(value)
      window.setTimeout(() => setCopiedDetailValue(""), 1600)
    } catch {
      setCopiedDetailValue("")
    }
  }

  async function openActivityDetail(item: WalletActivityItem) {
    setSelectedItem(item)
    setSelectedDetail(detailFromItem(item))
    setDetailError("")
    if (!accessToken) return
    setDetailLoading(true)
    try {
      const url = item.rail === "bitcoin"
        ? `/api/wallets/operations/${encodeURIComponent(item.id)}`
        : `/api/wallets/pinetree-wallet/withdrawals/${encodeURIComponent(item.id)}`
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: "include",
        cache: "no-store",
      })
      const json = await res.json()
      if (!res.ok) {
        setDetailError(json?.error || "Could not load withdrawal details.")
        return
      }
      if (item.rail === "bitcoin") {
        setSelectedDetail(detailFromWalletOperation(item, json.operation || json))
      } else {
        setSelectedDetail(detailFromWithdrawalRequest(item, json.request || json))
      }
    } catch {
      setDetailError("Could not load withdrawal details.")
    } finally {
      setDetailLoading(false)
    }
  }

  const explorerUrl = selectedDetail ? explorerUrlForActivity(selectedDetail) : null
  const displayTxHash = selectedDetail?.txHash || txHashFromExplorerUrl(explorerUrl)
  const completedTimeLabel = selectedDetail?.completedAt
    ? formatActivityTimestamp(selectedDetail.completedAt) ?? selectedDetail.completedAt
    : null
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-[1.35rem] border border-blue-200/60 bg-white shadow-[0_18px_42px_rgba(15,23,42,0.07)]">
        <div className="border-b border-blue-100/70 bg-blue-50/55 px-4 py-3 sm:px-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">
            {syncing ? "Syncing..." : "RECENT WITHDRAWALS"}
          </p>
        </div>
        {!hasSyncedOnce && syncing ? (
          <div className="flex items-center justify-center gap-1.5 px-4 py-6 text-center sm:px-5">
            <Loader2 size={13} className="animate-spin text-blue-500" />
            <p className="text-sm text-gray-500">Loading withdrawals...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-6 text-center sm:px-5">
            <p className="text-sm text-gray-500">No withdrawals yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-blue-50">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void openActivityDetail(item)}
                className="block w-full px-4 py-3.5 text-left transition hover:bg-blue-50/45 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-100 sm:px-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-sm font-semibold text-gray-900">{activityAmountLabel(item)}</p>
                      {item.source === "automatic_sweep" ? (
                        <span className="inline-flex shrink-0 items-center rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                          Automatic
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {activityDestinationLabel(item)} - {railDisplayName(item.rail)} - {formatActivityTimestamp(item.createdAt) ?? item.createdAt}
                    </p>
                  </div>
                  <ActivityStatusPill status={item.status} />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      {selectedItem && selectedDetail ? (
        <div
          data-pinetree-overlay="true"
          className="pinetree-modal-backdrop fixed inset-0 z-[90] flex items-end justify-center overflow-hidden p-0 sm:items-center sm:p-5"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setSelectedItem(null)
              setSelectedDetail(null)
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-withdrawal-detail-title"
            className="flex max-h-[86dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[1.35rem] border border-white/70 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.22)] sm:rounded-[1.35rem]"
          >
            <header className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-5">
              <div className="min-w-0">
                <h3 id="wallet-withdrawal-detail-title" className="text-base font-semibold text-gray-950">Withdrawal details</h3>
                {detailLoading ? (
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500"><Loader2 size={12} className="animate-spin" /> Loading latest details...</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedItem(null)
                  setSelectedDetail(null)
                }}
                aria-label="Close withdrawal details"
                className={modalCloseButtonClass}
              >
                <X size={18} />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
              {detailError ? (
                <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2 text-xs font-semibold leading-5 text-blue-800">
                  {detailError}
                </div>
              ) : null}
              <dl className="divide-y divide-gray-100 text-sm">
                <DetailRow label="Status"><ActivityStatusPill status={selectedDetail.status} /></DetailRow>
                <DetailRow label="Amount">{selectedDetail.amount}</DetailRow>
                <DetailRow label="Network Fee">{selectedDetail.fee}</DetailRow>
                <DetailRow label="Destination Label">{selectedDetail.destinationLabel}</DetailRow>
                <DetailRow label="Destination Address">
                  {selectedDetail.destinationAddress ? (
                    <CopyableDetailValue
                      value={selectedDetail.destinationAddress}
                      copied={copiedDetailValue === selectedDetail.destinationAddress}
                      onCopy={() => void copyDetailValue(selectedDetail.destinationAddress || "")}
                    />
                  ) : (
                    "Not available"
                  )}
                </DetailRow>
                <DetailRow label="Network">{selectedDetail.network}</DetailRow>
                <DetailRow label="Submitted Time">{formatActivityTimestamp(selectedDetail.submittedAt) ?? selectedDetail.submittedAt ?? "Not available"}</DetailRow>
                {completedTimeLabel ? (
                  <DetailRow label="Completed Time">{completedTimeLabel}</DetailRow>
                ) : null}
                {displayTxHash ? (
                  <DetailRow label="Transaction Hash">
                    <CopyableDetailValue
                      value={displayTxHash}
                      copied={copiedDetailValue === displayTxHash}
                      onCopy={() => void copyDetailValue(displayTxHash)}
                    />
                  </DetailRow>
                ) : null}
              </dl>
              {explorerUrl ? (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex h-10 items-center justify-center rounded-lg bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                >
                  View Explorer
                </a>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}

function mapActivityDetailStatus(status: string) {
  const normalized = status.toLowerCase()
  if (normalized === "confirmed") return "COMPLETED"
  if (normalized === "processing") return "PROCESSING"
  if (normalized === "failed") return "FAILED"
  if (normalized === "canceled") return "CANCELED"
  return status
}

function DetailRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 py-2.5">
      <dt className="text-xs font-semibold text-gray-500">{label}</dt>
      <dd className="min-w-0 text-right font-semibold text-gray-950">{children}</dd>
    </div>
  )
}

function CopyableDetailValue({
  value,
  copied,
  onCopy,
}: {
  value: string
  copied: boolean
  onCopy: () => void
}) {
  return (
    <span className="flex min-w-0 items-center justify-end gap-2">
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-800" title={value}>{value}</span>
      <button
        type="button"
        onClick={onCopy}
        aria-label="Copy value"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition hover:text-blue-700"
      >
        {copied ? <CheckCircle2 size={15} /> : <Copy size={15} />}
      </button>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Main runtime component
// ---------------------------------------------------------------------------

function PineTreeWalletRuntime() {
  // --- Supabase session & DB profiles ---
  const [profileState, setProfileState] = useState<ProfileState>({ kind: "loading" })
  const [businessProfileReadiness, setBusinessProfileReadiness] = useState<BusinessProfileReadinessState>({ kind: "loading" })
  const [lightningProfileState, setLightningProfileState] = useState<LightningProfileState>({ kind: "loading" })
  const accessTokenRef = useRef<string | null>(null)

  // --- Dynamic SDK ---
  const { user, sdkHasLoaded, showAuthFlow, setShowAuthFlow, setShowDynamicUserProfile, handleLogOut, primaryWallet } = useDynamicContext()
  const { signInWithExternalJwt } = useExternalAuth()
  const refreshDynamicUser = useRefreshUser()
  const switchDynamicWallet = useSwitchWallet()
  // Literal process.env.NEXT_PUBLIC_X reads are required here so webpack can
  // statically inline them into the client bundle - see PineTreeDynamicProvider.tsx.
  const dynamicAuthConfig = getPineTreeDynamicAuthConfig({
    NEXT_PUBLIC_PINETREE_DYNAMIC_AUTH_MODE: process.env.NEXT_PUBLIC_PINETREE_DYNAMIC_AUTH_MODE,
    NEXT_PUBLIC_PINETREE_DYNAMIC_EMAIL_FALLBACK: process.env.NEXT_PUBLIC_PINETREE_DYNAMIC_EMAIL_FALLBACK,
  })
  const pineTreeControlledDynamicAuthAvailable = dynamicAuthConfig.externalJwtConfigured
  const dynamicEmailFallbackAllowed = shouldOpenDynamicEmailFallbackAuth(dynamicAuthConfig)
  const {
    createWalletAccount,
    dynamicWaasIsEnabled,
    getWaasWalletConnector,
    getWaasWallets,
    getWaasWalletsByCredentials,
    initializeWaas,
    needsAutoCreateWalletChains,
    shouldInitializeWaas,
  } = useDynamicWaas()
  const {
    createEmbeddedWallet,
    createOrRestoreSession,
    isSessionActive: embeddedWalletSessionActive,
    shouldAutoCreateEmbeddedWallet,
    userHasEmbeddedWallet,
  } = useEmbeddedWallet()
  const wallets = useUserWallets()
  // Synchronously mirrors the latest render's wallets/primaryWallet so an
  // already-running async withdrawal handler can read the freshly hydrated
  // Dynamic wallet list right after `await refreshDynamicWalletRuntime(...)`
  // instead of the stale array captured when its closure was created. A
  // plain render-body assignment (not a useEffect) is required here - it
  // must be current before this same render's event handlers ever run, with
  // no effect-commit lag.
  const walletsRef = useRef<unknown[]>(wallets as unknown[])
  walletsRef.current = wallets as unknown[]
  const primaryWalletRef = useRef<unknown>(primaryWallet)
  primaryWalletRef.current = primaryWallet

  // --- UI state ---
  const [sdkTimedOut, setSdkTimedOut] = useState(false)
  const [walletOpen, setWalletOpen] = useState(false)
  const [walletOpening, setWalletOpening] = useState(false)
  const [walletSetupOpeningAfterCreate, setWalletSetupOpeningAfterCreate] = useState(false)
  const [openWalletReconnectNeeded, setOpenWalletReconnectNeeded] = useState(false)
  const [activeView, setActiveView] = useState<WalletSecondaryView | null>(null)
  const directWalletOpenAttemptedRef = useRef(false)
  const [merchantId, setMerchantId] = useState<string | null>(null)
  const [merchantEmail, setMerchantEmail] = useState<string | null>(null)
  const [walletSetupAttemptId, setWalletSetupAttemptId] = useState(createWalletSetupAttemptId)
  const [walletSetupStage, setWalletSetupStage] = useState<WalletSetupStage>("idle")
  const [walletSetupFailureReason, setWalletSetupFailureReason] = useState<WalletSetupFailureReason | null>(null)
  const [identityMismatchError, setIdentityMismatchError] = useState<IdentityMismatchError | null>(null)
  // Dynamic authenticated, but no email could be extracted from the session at all
  // (distinct from a confirmed mismatch, where both emails are known and differ).
  const [identityUnverified, setIdentityUnverified] = useState(false)
  const [walletIdentityError, setWalletIdentityError] = useState("")
  // pendingSync: merchant explicitly clicked "Create PineTree Wallet"
  const [pendingSync, setPendingSync] = useState(false)
  const [walletCreationStep, setWalletCreationStep] = useState<WalletCreationStep>("idle")
  // Granular progress text shown only while walletSetupPrimaryState === "provisioning" -
  // supplements (never replaces) walletCreationStepMessage, so the merchant sees which
  // stage core setup is in during the longer stage-aware deadline instead of a single
  // static "Creating PineTree Wallet..." line for up to ~90 seconds.
  const [coreSetupStageLabel, setCoreSetupStageLabel] = useState("")
  const [dynamicVerificationPromptReason, setDynamicVerificationPromptReason] = useState<string | null>(null)
  // logoutPending: waiting for Dynamic logout to complete before opening auth flow
  const [logoutPending, setLogoutPending] = useState(false)
  const [repairPendingAfterLogout, setRepairPendingAfterLogout] = useState(false)
  const [repairInProgress, setRepairInProgress] = useState(false)
  const [repairFailedIncomplete, setRepairFailedIncomplete] = useState(false)
  const [provisioningRetryExhausted, setProvisioningRetryExhausted] = useState(false)
  const [finalProvisioningRefreshAttempted, setFinalProvisioningRefreshAttempted] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [copiedAddress, setCopiedAddress] = useState("")
  const [enabledRails, setEnabledRails] = useState<EnabledRailState>(defaultEnabledRails)
  const [railReadiness, setRailReadiness] = useState<PineTreeRailReadinessMap | null>(null)
  const [walletSync, setWalletSync] = useState<PineTreeWalletSyncResponse>(defaultWalletSyncState)
  const [walletSyncing, setWalletSyncing] = useState(false)
  const [resettingWalletSetup, setResettingWalletSetup] = useState(false)
  const [dynamicWalletRuntimeRefreshNonce, setDynamicWalletRuntimeRefreshNonce] = useState(0)
  const [profileSyncDiagnostics, setProfileSyncDiagnostics] = useState<ProfileSyncDiagnosticsState>({
    externalJwtEnabled: pineTreeControlledDynamicAuthAvailable,
    externalJwtIssuerConfigured: false,
    externalJwtAudienceConfigured: false,
    externalJwtKidConfigured: false,
    externalJwtSigningKeyConfigured: false,
    externalJwtJwksDerivedFromSigningKey: false,
    externalJwtEndpointStatus: null,
    externalJwtErrorCode: null,
    lastWalletAuthAttemptState: null,
    signInWithExternalJwtCalled: false,
    signInWithExternalJwtSucceeded: false,
    dynamicEmailFallbackBlocked: false,
    dynamicExternalAuthAttempted: false,
    dynamicExternalAuthSucceeded: false,
    dynamicUserId: null,
    dynamicEmail: null,
    merchantEmail: null,
    extractedBaseAddress: null,
    extractedSolanaAddress: null,
    baseSignerFound: false,
    solanaSignerFound: false,
    didCallProfileEndpoint: false,
    profileEndpointStatus: null,
    profileEndpointResponse: null,
    providerSyncStatus: null,
    skippedReason: null,
    dynamicAuthenticated: false,
    dynamicWalletRuntimeCount: 0,
    waasRuntimeWalletCount: 0,
    waasCredentialWalletSourceCount: 0,
    waasCredentialSignerWalletCount: 0,
    updatedAt: null,
  })
  const [walletSyncDebugQueryEnabled, setWalletSyncDebugQueryEnabled] = useState(false)
  const [lastDebugEvents, setLastDebugEvents] = useState<WalletSetupDebugEventLogEntry[]>([])
  // True while core wallet setup is parked waiting on the merchant to complete the
  // Dynamic native auth fallback (external JWT was rejected by Dynamic's backend).
  const [coreSetupNeedsUserAuth, setCoreSetupNeedsUserAuth] = useState(false)
  const [withdrawalRail, setWithdrawalRail] = useState<WithdrawalRail>("base")
  const [withdrawalAsset, setWithdrawalAsset] = useState<WithdrawalAsset>("ETH")
  const [withdrawalBitcoinTransferType, setWithdrawalBitcoinTransferType] = useState<BitcoinTransferType>("onchain")
  const [withdrawalDestination, setWithdrawalDestination] = useState("")
  const [withdrawalSelectedDestinationId, setWithdrawalSelectedDestinationId] = useState<string | null>(null)
  const [withdrawalAmount, setWithdrawalAmount] = useState("")
  const [withdrawalScreen, setWithdrawalScreen] = useState<WithdrawalScreen>("form")
  const [withdrawalReview, setWithdrawalReview] = useState<WithdrawalReviewResponse | null>(null)
  const [withdrawalSubmitResult, setWithdrawalSubmitResult] = useState<WithdrawalSubmitResponse | null>(null)
  const [withdrawalError, setWithdrawalError] = useState("")
  const [withdrawalApprovalError, setWithdrawalApprovalError] = useState("")
  const [instantSendIdempotencyKey, setInstantSendIdempotencyKey] = useState<string | null>(null)
  // One correlation ID per withdrawal attempt, generated when review starts and
  // carried through prepare/sign/submit diagnostics (emitWalletSetupDebugEvent)
  // so a single attempt's stages can be joined together in server logs - not a
  // secret, never sent to a provider, only used for log correlation.
  const withdrawalCorrelationIdRef = useRef<string | null>(null)
  const [reviewingWithdrawal, setReviewingWithdrawal] = useState(false)
  const [submittingWithdrawal, setSubmittingWithdrawal] = useState(false)
  const [withdrawalAuthorizationRecoveryOpen, setWithdrawalAuthorizationRecoveryOpen] = useState(false)
  const [withdrawalReconnectPending, setWithdrawalReconnectPending] = useState(false)
  const [maxEstimating, setMaxEstimating] = useState(false)
  const [maxWarning, setMaxWarning] = useState("")
  const withdrawalReconnectSourceRef = useRef<string | null>(null)
  const dynamicHydrationAttemptRef = useRef<string | null>(null)
  const dynamicWalletRuntimeCountRef = useRef(0)
  const dynamicApprovalAvailableRef = useRef(false)
  const dynamicProfileReadyRef = useRef(false)
  const providerSheetGateStateRef = useRef<ProviderSheetGateState>({
    walletReady: false,
    profileReady: false,
    baseReady: false,
    solanaReady: false,
    bitcoinReady: false,
  })
  const lastWalletSetupPrimaryStateRef = useRef<WalletSetupPrimaryState | null>(null)
  const repairProfileIdRef = useRef<string | null>(null)
  const pendingWalletProvisionAttemptRef = useRef<string | null>(null)
  const pendingWalletProvisionStartedAtRef = useRef<number | null>(null)
  const pendingProfileSyncAttemptRef = useRef(false)
  const profilePostInFlightKeyRef = useRef<string | null>(null)
  const walletSetupStartInFlightRef = useRef<string | null>(null)
  const staleProfileAutoRepairAttemptRef = useRef<string | null>(null)
  const creatingEmbeddedWalletRef = useRef(false)
  const railSyncInFlightKeyRef = useRef<string | null>(null)
  const walletModalOpenedForAttemptRef = useRef(false)
  const walletSetupOpeningDelayRef = useRef<number | null>(null)
  const nativeFallbackPendingRef = useRef(false)
  // True while an explicit create/retry/native-auth-resume attempt is running, so a
  // successful core profile save opens the wallet instead of leaving the merchant on
  // the setup card. Never set by page-load auto-repair, which must not pop the modal.
  const autoOpenWalletAfterCreateRef = useRef(false)
  const speedProvisionInFlightRef = useRef(false)
  const lastCombinedReadinessRef = useRef<string | null>(null)
  // Single-flight guard for refreshDynamicWalletRuntime: only one Dynamic SDK
  // hydration/refresh operation runs at a time per compatible mode. Concurrent callers (the polling
  // interval, focus/visibility recheck, native-auth resume, final-refresh timer,
  // etc.) await the same in-flight promise for normal hydration, while approval
  // flows get their own stronger hydration promise instead of reusing a weaker one.
  const walletRuntimeRefreshInFlightRef = useRef<Record<"normal_hydration" | "approval_wallet_hydration", Promise<boolean> | null>>({
    normal_hydration: null,
    approval_wallet_hydration: null,
  })
  // Parallel metadata for the single-flight ref above: generation/attempt id + start
  // time per mode, so a caller can tell an actually-active in-flight promise apart
  // from a stale one that has outlived dynamicHydrationSingleFlightTimeoutMs, and so a
  // stale promise's own `finally` can detect it has been superseded and skip clearing
  // the newer attempt's record.
  const walletRuntimeRefreshMetaRef = useRef<Record<"normal_hydration" | "approval_wallet_hydration", { generation: number; startedAt: number; stage: string } | null>>({
    normal_hydration: null,
    approval_wallet_hydration: null,
  })
  const walletRuntimeRefreshGenerationRef = useRef(0)
  // Set once core wallet setup reaches a terminal success state (coreWalletProfileReady
  // flips true - Base + Solana detected and the profile POST landed with status "ready").
  // Captures the refresh generation active at that moment: any refresh work at or before
  // this generation belongs to the (now-superseded) creation attempt, so its late
  // resolve/reject must never be reported as a fresh setup failure - the exact production
  // bug where a 129s-old createWalletAccount call finally threw and logged
  // "wallet_dynamic_wallets_refresh_complete" with threw:true well after setup had
  // already succeeded. A later, explicitly user-initiated refresh still gets its own new
  // (higher) generation and is never affected by this.
  const walletCoreSetupTerminalGenerationRef = useRef<number | null>(null)
  // Per-chain dedupe guards for explicit single-chain creation (Part B). Track startedAt
  // rather than a plain boolean so a hung createWalletAccount([{chain}]) call can't
  // permanently block that one chain from ever being retried.
  const baseWalletCreateGuardRef = useRef<number | null>(null)
  const solanaWalletCreateGuardRef = useRef<number | null>(null)
  // True from the moment a chain create times out locally until the underlying
  // (uncancelled) Dynamic call actually settles. While true, no new explicit create is
  // started for that chain even though the dedupe guard above has expired - a fresh
  // hydration attempt still runs and rechecks credentials/runtime state in the meantime.
  const baseWalletCreateDetachedRef = useRef(false)
  const solanaWalletCreateDetachedRef = useRef(false)
  // Mirrors pendingSync but updated synchronously (refs, not state) so diagnostics
  // emitted in the same tick as a setPendingSync(true) call never read a stale
  // pre-render value. Fixes the "setupAttemptActive: false" reported immediately
  // after wallet_create_dynamic_auth_complete/native auth resume in production.
  const overallSetupActiveRef = useRef(false)
  const baseWalletCreateFailedRef = useRef(false)
  const solanaWalletCreateFailedRef = useRef(false)
  // Tracks Dynamic's own auth-sheet lifecycle via the SDK's authFlowOpen/authFlowClose
  // events (not just the showAuthFlow boolean, which production showed can remain true
  // indefinitely once Dynamic's own UI enters an internal error state like "Try again
  // or log out"). null means "not currently open" or "unknown."
  const dynamicAuthSheetOpenedAtRef = useRef<number | null>(null)
  const dynamicAuthSheetStaleClearedRef = useRef(false)

  // Whether Dynamic's auth sheet should still be treated as open for the purposes of
  // suppressing PineTree's own bounded provisioning timeout. Falls back to the raw
  // showAuthFlow boolean when we have no open-time signal yet (e.g. very first render
  // before any authFlowOpen event has fired), but once a sheet has been open longer
  // than dynamicAuthSheetStaleMs, it can no longer suppress the timeout - Dynamic's own
  // UI is left alone (never force-closed by this check alone).
  function isDynamicAuthSheetConsideredOpen(): boolean {
    if (!showAuthFlow) return false
    const openedAt = dynamicAuthSheetOpenedAtRef.current
    if (openedAt === null) return true
    const stale = Date.now() - openedAt > dynamicAuthSheetStaleMs
    if (stale && !dynamicAuthSheetStaleClearedRef.current) {
      dynamicAuthSheetStaleClearedRef.current = true
      console.info("[pinetree-wallets] wallet_dynamic_sheet_stale_state_cleared", { ageMs: Date.now() - openedAt })
      emitWalletSetupDebugEvent("wallet_dynamic_sheet_stale_state_cleared", { ageMs: Date.now() - openedAt })
    }
    return !stale
  }

  function chainCreateGuardActive(guardRef: { current: number | null }) {
    const startedAt = guardRef.current
    if (startedAt === null) return false
    if (Date.now() - startedAt > dynamicChainCreateTimeoutMs) {
      guardRef.current = null
      return false
    }
    return true
  }

  // Builds the safe wallet_dynamic_base_create_failed diagnostic: only sanitized
  // enum-like strings/bounded numbers, from classifyDynamicWalletCreationError plus
  // booleans already computed elsewhere in this render - never a raw error, message,
  // stack, address, email, JWT, or user/merchant id.
  function buildDynamicChainCreateFailureDiagnostic(params: {
    reason: string
    chain: "EVM" | "SOL"
    error: unknown
    runtimeWalletCount: number
    hasBaseCredential: boolean
    hasBaseRuntimeWallet: boolean
    hasSolanaCredential: boolean
    hasSolanaRuntimeWallet: boolean
  }) {
    const classified = classifyDynamicWalletCreationError(params.error)
    return {
      reason: params.reason,
      operation: "create_wallet_account",
      sdkMethod: "createWalletAccount",
      requestedChain: params.chain,
      requestedChainId: params.chain === "EVM" ? 8453 : null,
      errorName: classified.errorName,
      errorCode: classified.errorCode,
      errorType: classified.errorType,
      providerStatus: classified.providerStatus,
      safeReason: classified.safeReason,
      authSheetOpen: Boolean(showAuthFlow),
      dynamicUserPresent: Boolean(user),
      waasEnabled: dynamicWaasIsEnabled,
      // A dashboard/config-shaped rejection (chain not enabled at all) means Base was
      // never actually usable - anything else means the network is configured and this
      // failure is a transient/provider-side issue instead.
      baseNetworkEnabled: classified.safeReason !== "no_enabled_chains" && classified.safeReason !== "invalid_chains",
      runtimeWalletCount: params.runtimeWalletCount,
      hasBaseCredential: params.hasBaseCredential,
      hasBaseRuntimeWallet: params.hasBaseRuntimeWallet,
      hasSolanaCredential: params.hasSolanaCredential,
      hasSolanaRuntimeWallet: params.hasSolanaRuntimeWallet,
    }
  }

  // Debug-only (never runs in production unless walletCreationDebugEnabled): summarizes
  // how every runtime wallet in the broad search list classifies, without ever logging
  // an address or wallet id, so a "Base remains undetected" report can show whether an
  // EVM-compatible wallet already existed but was rejected by an overly narrow rule.
  function logDynamicWalletClassificationSummary(reason: string, candidateWallets: unknown[]) {
    const summary = candidateWallets.map((candidate) => {
      const wallet = candidate as DynamicWalletLike
      const { connectorKey } = getDynamicWalletConnectorInfo(wallet)
      const chainFamily = classifyDynamicWalletChain(wallet)
      const accepted = classifyWaasWalletChain(wallet)
      const acceptedAsBase = accepted === "EVM"
      const acceptedAsSolana = accepted === "SOL"
      const networkCount =
        (Array.isArray(wallet.accounts) ? wallet.accounts.length : 0) ||
        (Array.isArray(wallet.additionalAddresses) ? wallet.additionalAddresses.length : 0) + 1
      return {
        connectorKey,
        chainFamily,
        networkCount,
        supportsEvm: chainFamily === "evm",
        supportsBase: dynamicWalletSupportsRail(wallet, "base"),
        supportsSolana: dynamicWalletSupportsRail(wallet, "solana"),
        embedded: Boolean(
          connectorKey && ["dynamicwaas", "turnkey", "zerodev", "magiclink"].some((token) => String(connectorKey).toLowerCase().includes(token))
        ),
        acceptedAsBase,
        acceptedAsSolana,
        rejectionReason: acceptedAsBase || acceptedAsSolana
          ? null
          : chainFamily === "unknown"
            ? "no_recognized_chain_hint"
            : "chain_family_not_required",
      }
    })
    console.debug("[pinetree-wallets] wallet_dynamic_classification_summary", { reason, wallets: summary })
  }

  // Dedupes the background rail-sync call fired after a successful core profile
  // save: only one rail-sync fetch per unique (dynamic_user_id, base, solana)
  // address set, even if syncProfileFromDynamic resolves "ready" more than once.
  const railSyncFiredForProfileRef = useRef<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setWalletSyncDebugQueryEnabled(
      params.get("walletDebug") === "1" ||
        params.get("walletDebug") === "true" ||
      params.get("pinetree_wallet_debug") === "true" ||
        params.get("debugPineTreeWallet") === "true"
    )
  }, [])

  // Fires once per mount so a server-visible beacon exists even before Dynamic auth
  // or a DB profile fetch resolves - lets us confirm the page itself actually loaded
  // on a device where nothing further ever shows up in Vercel logs.
  useEffect(() => {
    emitWalletSetupDebugEvent("wallet_page_loaded", {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Dev-only wallet auth diagnostic. Never logs JWTs, signing keys, emails,
  // wallet addresses, or merchant IDs - only presence/mode booleans.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return
    console.debug("[pinetree-wallets] dynamic_auth_diagnostic", {
      authMode: dynamicAuthConfig.mode,
      emailFallbackEnabled: dynamicAuthConfig.emailFallbackEnabled,
      externalJwtEndpointConfigured: dynamicAuthConfig.externalJwtConfigured,
      merchantEmailPresent: Boolean(merchantEmail),
    })
  }, [dynamicAuthConfig.mode, dynamicAuthConfig.emailFallbackEnabled, dynamicAuthConfig.externalJwtConfigured, merchantEmail])

  // Dev-only: safe capability/config snapshot for diagnosing "wrong SDK API invoked"
  // reports - booleans only, never wallet/user identity.
  useEffect(() => {
    if (!walletCreationDebugEnabled || !sdkHasLoaded) return
    let configuredEvmNetworkPresent = false
    let configuredSolanaNetworkPresent = false
    try {
      configuredEvmNetworkPresent = Boolean(getWaasWalletConnector("EVM"))
    } catch {
      configuredEvmNetworkPresent = false
    }
    try {
      configuredSolanaNetworkPresent = Boolean(getWaasWalletConnector("SOL"))
    } catch {
      configuredSolanaNetworkPresent = false
    }
    console.debug("[pinetree-wallets] wallet_dynamic_wallet_creation_capabilities", {
      createWalletAccountAvailable: typeof createWalletAccount === "function",
      createEmbeddedWalletAvailable: typeof createEmbeddedWallet === "function",
      initializeWaasAvailable: typeof initializeWaas === "function",
      configuredEvmNetworkPresent,
      // Base has no distinct Dynamic ChainEnum value - it is served by the same
      // generic EVM embedded wallet/connector, so its configured-network signal is
      // the same as the generic EVM connector's presence.
      configuredBaseNetworkPresent: configuredEvmNetworkPresent,
      configuredSolanaNetworkPresent,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkHasLoaded, dynamicWaasIsEnabled])

  // --- SDK load timeout ---
  useEffect(() => {
    if (sdkHasLoaded) return
    const timer = window.setTimeout(() => setSdkTimedOut(true), 12000)
    return () => window.clearTimeout(timer)
  }, [sdkHasLoaded])

  useEffect(() => {
    if (sdkHasLoaded) {
      console.info("[pinetree-wallets] wallet_dynamic_sdk_loaded", {})
      emitWalletSetupDebugEvent("wallet_dynamic_sdk_loaded", {})
    }
  }, [sdkHasLoaded])

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
          base: json.balances?.base ?? [],
          solana: json.balances?.solana ?? [],
          bitcoin: json.balances?.bitcoin ?? [],
        },
        canonicalBalances: json.canonicalBalances ?? [
          ...(json.balances?.base ?? []),
          ...(json.balances?.solana ?? []),
          ...(json.balances?.bitcoin ?? []),
        ],
        recentActivity: json.recentActivity || [],
      })
      emitWalletSetupDebugEvent("WALLET_BALANCE_REFRESH_COMPLETED", {
        baseAssetCount: json.balances?.base?.length ?? 0,
        solanaAssetCount: json.balances?.solana?.length ?? 0,
        bitcoinAssetCount: json.balances?.bitcoin?.length ?? 0,
        lastSyncedAt: json.lastSyncedAt ?? null,
      })
      emitWalletSetupDebugEvent("BALANCE_UI_REFRESH_COMPLETED", {
        assetCount: json.canonicalBalances?.length ?? 0,
        lastSyncedAt: json.lastSyncedAt ?? null,
      })
      emitWalletSetupDebugEvent("DYNAMIC_UI_REFRESH_COMPLETED", {
        recentActivityCount: json.recentActivity?.length ?? 0,
        lastSyncedAt: json.lastSyncedAt ?? null,
      })
    } finally {
      setWalletSyncing(false)
    }
  }, [])


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
      setRailReadiness(json.railReadiness || null)
      const providerRows = json.providers || []
      const providerEnabled = (provider: string) => {
        const row = providerRows.find((item) => item.provider === provider)
        return Boolean(row?.enabled === true)
      }
      setEnabledRails({
        base: json.railReadiness?.base.enabled ?? providerEnabled("base"),
        solana: json.railReadiness?.solana.enabled ?? providerEnabled("solana"),
        bitcoin: json.railReadiness?.bitcoin_lightning.enabled ?? providerEnabled("lightning_speed"),
      })
    } catch {
      setRailReadiness(null)
      setEnabledRails(defaultEnabledRails)
    }
  }, [])

  // --- Load profiles and provider rail enablement from DB on mount ---
  const fetchAllProfiles = useCallback(async () => {
    setProfileState({ kind: "loading" })
    setLightningProfileState({ kind: "loading" })
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const session = sessionData.session
      const token = session?.access_token
      if (!session || !token) {
        setProfileState({ kind: "none" })
        setBusinessProfileReadiness({ kind: "error" })
        setLightningProfileState({ kind: "none" })
        setMerchantId(null)
        setMerchantEmail(null)
        return
      }
      accessTokenRef.current = token
      const sessionUser = session.user
      setMerchantId(sessionUser.id)
      const canonicalMerchantEmail = normalizeIdentityEmail(sessionUser.email)
      setMerchantEmail(canonicalMerchantEmail)

      const [walletRes, settingsRes, lightningRes] = await Promise.all([
        fetch("/api/wallets/pinetree-profile", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch("/api/settings", {
          headers: { Authorization: `Bearer ${token}` },
          credentials: "include",
          cache: "no-store",
        }),
        fetch("/api/wallets/lightning/pinetree-managed", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ])
      void fetchProviderRailState(token)

      let businessProfileCompleteForResume = false
      if (settingsRes.ok) {
        const json = (await settingsRes.json()) as { settings?: { profile_status?: "incomplete" | "complete" | "needs_attention" } }
        const status = json.settings?.profile_status || "incomplete"
        businessProfileCompleteForResume = status === "complete"
        setBusinessProfileReadiness({ kind: "loaded", status, complete: businessProfileCompleteForResume })
      } else {
        setBusinessProfileReadiness({ kind: "error" })
      }

      if (!walletRes.ok) {
        setProfileState({ kind: "error" })
      } else {
        const json = (await walletRes.json()) as { profile: PineTreeWalletProfile | null }
        setProfileState(json.profile ? { kind: "loaded", profile: json.profile } : { kind: "none" })
        if (typeof window !== "undefined") {
          const setupKey = walletSetupStorageKeyForMerchant(sessionUser.id)
          if (setupKey) {
            const cancelledKey = walletSetupCancelledStorageKeyForMerchant(sessionUser.id)
            // A page reload after a merely-interrupted setup may resume; a page reload
            // after the merchant explicitly cancelled/logged out of the Dynamic sheet
            // must not, until they click Create again (Part G).
            const explicitlyCancelled = Boolean(cancelledKey && window.localStorage.getItem(cancelledKey) === "true")
            const storedSetupStarted = window.localStorage.getItem(setupKey) === "true" && !explicitlyCancelled
            const setupStarted = storedSetupStarted && businessProfileCompleteForResume
            if (storedSetupStarted && !businessProfileCompleteForResume) {
              window.localStorage.removeItem(setupKey)
              emitWalletSetupDebugEvent("wallet_create_resume_blocked_business_profile_required", {})
            }
            if (!json.profile) {
              if (setupStarted) {
                emitWalletSetupStageDiagnostic("wallet_create_resume_detected", "resume_missing_profile")
                setPendingSync(true)
                setProvisioningRetryExhausted(false)
                setFinalProvisioningRefreshAttempted(false)
                setWalletCreationStep("provisioning_wallet")
                pendingProfileSyncAttemptRef.current = false
                pendingWalletProvisionAttemptRef.current = null
                pendingWalletProvisionStartedAtRef.current = null
              } else {
                setPendingSync(false)
                setProvisioningRetryExhausted(false)
                setFinalProvisioningRefreshAttempted(false)
                setWalletCreationStep("idle")
              }
              setDynamicVerificationPromptReason(null)
              console.info("[pinetree-wallets] wallet_profile_load_state", {
                profileExists: false,
                setupFlagPresent: setupStarted,
                staleSetupCleared: false,
                status: setupStarted ? "resume_missing_profile" : "new_wallet_required",
              })
            } else if (setupStarted && json.profile.status !== "ready") {
              emitWalletSetupStageDiagnostic("wallet_create_resume_detected", "resume_incomplete_profile")
              setPendingSync(true)
              setProvisioningRetryExhausted(false)
              setFinalProvisioningRefreshAttempted(false)
              setWalletCreationStep("provisioning_wallet")
              console.info("[pinetree-wallets] wallet_profile_load_state", {
                profileExists: true,
                setupFlagPresent: true,
                staleSetupCleared: false,
                status: json.profile.status,
              })
            }
            if (json.profile?.status === "ready") {
              window.localStorage.removeItem(setupKey)
              console.info("[pinetree-wallets] wallet_profile_load_state", {
                profileExists: true,
                setupFlagPresent: setupStarted,
                staleSetupCleared: setupStarted,
                status: json.profile.status,
              })
              if (setupStarted) {
                setPendingSync(false)
                setProvisioningRetryExhausted(false)
                setFinalProvisioningRefreshAttempted(false)
                setWalletCreationStep("profile_synced")
                emitWalletSetupStageDiagnostic("wallet_create_resume_complete", "resume_ready_profile")
                openPineTreeWalletModalOnce("resume_ready_profile")
              }
            }
          }
        }
      }

      // Lightning profile is non-critical; don't block wallet display on failure
      if (lightningRes.ok) {
        const json = (await lightningRes.json()) as ManagedLightningResponse
        const normalizedProfile = json.profile
          ? {
              ...json.profile,
              status: json.rail?.status === "failed" || json.rail?.status === "incomplete"
                ? json.profile.status
                : json.rail?.status ?? json.profile.status,
              rail: json.rail?.rail,
              display_name: json.rail?.display_name,
              connected: json.rail?.connected,
              provider_error_message: json.rail?.message ?? json.merchantMessage ?? json.profile.provider_error_message,
            }
          : null
        setLightningProfileState(normalizedProfile ? { kind: "loaded", profile: normalizedProfile } : { kind: "none" })
      } else {
        setLightningProfileState({ kind: "none" })
      }
    } catch {
      setProfileState({ kind: "error" })
      setBusinessProfileReadiness({ kind: "error" })
      setLightningProfileState({ kind: "none" })
    }
  }, [fetchProviderRailState])

  useEffect(() => {
    void fetchAllProfiles()
  }, [fetchAllProfiles])

  useEffect(() => {
    function refreshWalletReadinessOnReturn() {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return
      void fetchAllProfiles()
    }

    window.addEventListener("focus", refreshWalletReadinessOnReturn)
    document.addEventListener("visibilitychange", refreshWalletReadinessOnReturn)
    return () => {
      window.removeEventListener("focus", refreshWalletReadinessOnReturn)
      document.removeEventListener("visibilitychange", refreshWalletReadinessOnReturn)
    }
  }, [fetchAllProfiles])

  // --- Live Dynamic wallet addresses - used only for sync, never for display ---
  const waasRuntimeWallets = useMemo(() => {
    if (!dynamicWaasIsEnabled) return []
    try {
      return getWaasWallets() as unknown[]
    } catch {
      return []
    }
  }, [dynamicWaasIsEnabled, dynamicWalletRuntimeRefreshNonce, getWaasWallets, sdkHasLoaded, user, wallets])

  const waasCredentialWalletSources = useMemo(() => {
    if (!dynamicWaasIsEnabled) return []
    try {
      return getWaasWalletsByCredentials().map((credential) => {
        const row = credential as unknown as Record<string, unknown>
        return {
          id: row.id,
          key: row.walletName,
          walletName: row.walletName,
          walletProvider: row.walletProvider,
          chain: row.chain,
          address: row.address,
        } satisfies DynamicWalletAddressSource
      })
    } catch {
      return []
    }
  }, [dynamicWaasIsEnabled, dynamicWalletRuntimeRefreshNonce, getWaasWalletsByCredentials, sdkHasLoaded, user])

  const waasCredentialSignerWallets = useMemo(() => {
    if (!dynamicWaasIsEnabled) return []
    return waasCredentialWalletSources.flatMap((source) => {
      const chain = String(source.chain || "").toUpperCase()
      const connectorChain = chain === "EVM" || chain.includes("ETH") ? "EVM" : chain === "SOL" || chain === "SVM" ? "SOL" : null
      if (!connectorChain) return []
      try {
        const connector = getWaasWalletConnector(connectorChain)
        if (!connector) return []
        return [{
          id: safeString(source.id) ?? undefined,
          key: safeString(source.key) ?? undefined,
          chain: connectorChain,
          address: safeString(source.address) ?? undefined,
          connector: connector as unknown as DynamicWalletLike["connector"],
        } satisfies DynamicWalletLike]
      } catch {
        return []
      }
    })
  }, [dynamicWaasIsEnabled, getWaasWalletConnector, waasCredentialWalletSources])

  const dynamicWalletSearchList = useMemo(() => {
    return getDynamicWalletSearchList(
      [...(wallets as unknown[]), ...waasRuntimeWallets, ...waasCredentialSignerWallets],
      primaryWallet
    )
  }, [wallets, primaryWallet, waasRuntimeWallets, waasCredentialSignerWallets])

  const dynamicAddressSearchList = useMemo(() => {
    return [...dynamicWalletSearchList, ...waasCredentialWalletSources]
  }, [dynamicWalletSearchList, waasCredentialWalletSources])

  const dynamicWalletRuntimeCount = dynamicWalletSearchList.length

  const dynamicNetworkAddresses = useMemo(() => {
    return extractDynamicWalletAddresses(dynamicAddressSearchList as DynamicWalletAddressSource[])
  }, [dynamicAddressSearchList])

  const dynamicEmailExtraction = useMemo(() => extractDynamicUserEmail(user), [user])
  const dynamicUserEmail = dynamicEmailExtraction.email
  const dynamicEmailSource = dynamicEmailExtraction.source
  // Canonical identity binding for external-JWT sessions: Dynamic attaches an
  // "externalUser" verified credential whose public identifier is the PineTree
  // merchant_id (the JWT sub). A session bound this way is proven to belong to
  // this merchant regardless of what email Dynamic managed to surface - the
  // email-comparison gates below must never fail it.
  const dynamicSessionExternallyBound = useMemo(
    () => dynamicSessionBoundToMerchant(user, merchantId),
    [user, merchantId]
  )
  const dynamicExternalUserId = useMemo(() => getDynamicExternalUserId(user), [user])

  useEffect(() => {
    dynamicWalletRuntimeCountRef.current = dynamicWalletRuntimeCount
  }, [dynamicWalletRuntimeCount])

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return
    if (!sdkHasLoaded) return

    let waasRuntimeWallets: unknown[] = []
    let waasCredentials: unknown[] = []
    try {
      waasRuntimeWallets = dynamicWaasIsEnabled ? getWaasWallets() : []
      waasCredentials = dynamicWaasIsEnabled ? getWaasWalletsByCredentials() : []
    } catch (error) {
      console.warn("[pinetree-wallets] dynamic_wallet_inventory_read_failed", {
        dynamicUserId: user?.userId ?? null,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    const useUserWalletEntries = (wallets as unknown[]).map((wallet) =>
      dynamicWalletInventoryEntry(wallet, "useUserWallets")
    )
    const primaryWalletEntry = primaryWallet
      ? dynamicWalletInventoryEntry(primaryWallet, "primaryWallet")
      : null
    const waasWalletEntries = waasRuntimeWallets.map((wallet) =>
      dynamicWalletInventoryEntry(wallet, "waas")
    )
    const allEntries = [
      ...useUserWalletEntries,
      ...(primaryWalletEntry ? [primaryWalletEntry] : []),
      ...waasWalletEntries,
    ]
    const embeddedEntries = allEntries.filter((wallet) =>
      wallet.source === "waas" || wallet.connector.isEmbeddedWallet
    )
    const diagnosis = inferDynamicInventoryDiagnosis({
      dynamicWaasIsEnabled,
      shouldInitializeWaas,
      needsAutoCreateWalletChains,
      embeddedWalletSessionActive,
      legacyUserHasEmbeddedWallet: user ? userHasEmbeddedWallet() : false,
      waasCredentialCount: waasCredentials.length,
      embeddedWallets: embeddedEntries,
      allWallets: allEntries,
    })

    console.info("[pinetree-wallets] dynamic_authenticated_user_wallet_inventory", {
      dynamicUserId: user?.userId ?? null,
      sdkHasLoaded,
      dynamicWaas: {
        enabled: dynamicWaasIsEnabled,
        shouldInitializeWaas,
        needsAutoCreateWalletChains,
        waasCredentialCount: waasCredentials.length,
        waasRuntimeWalletCount: waasRuntimeWallets.length,
        waasCredentialWalletSourceCount: waasCredentialWalletSources.length,
        waasCredentialSignerWalletCount: waasCredentialSignerWallets.length,
        connectors: ["EVM", "SOL"].map((chain) => {
          try {
            const connector = getWaasWalletConnector(chain)
            return {
              chain,
              found: Boolean(connector),
              key: connector?.key ?? null,
              name: connector?.name ?? null,
              connectedChain: connector?.connectedChain ?? null,
              isEmbeddedWallet: Boolean(connector?.isEmbeddedWallet),
            }
          } catch (error) {
            return {
              chain,
              found: false,
              error: error instanceof Error ? error.message : String(error),
            }
          }
        }),
      },
      legacyEmbeddedWallet: {
        userHasEmbeddedWallet: user ? userHasEmbeddedWallet() : false,
        isSessionActive: embeddedWalletSessionActive,
      },
      primaryWallet: primaryWalletEntry,
      useUserWallets: useUserWalletEntries,
      waasWallets: waasWalletEntries,
      extractedAddressGroups: {
        base: dynamicNetworkAddresses.base.map((entry) => entry.address),
        solana: dynamicNetworkAddresses.solana.map((entry) => entry.address),
        bitcoin: dynamicNetworkAddresses.bitcoin.map((entry) => entry.address),
        lightning: dynamicNetworkAddresses.lightning.map((entry) => entry.address),
      },
      diagnosis,
      filterNote:
        "walletsFilter only filters Dynamic wallet options shown during auth; it does not remove wallets returned by useUserWallets(). See [pinetree-wallets] dynamic_wallet_filter for option filtering.",
    })
  }, [
    dynamicNetworkAddresses,
    dynamicWaasIsEnabled,
    embeddedWalletSessionActive,
    getWaasWalletConnector,
    getWaasWallets,
    getWaasWalletsByCredentials,
    needsAutoCreateWalletChains,
    primaryWallet,
    sdkHasLoaded,
    shouldInitializeWaas,
    user,
    userHasEmbeddedWallet,
    waasCredentialWalletSources.length,
    waasCredentialSignerWallets.length,
    wallets,
  ])

  const logWalletCreationStep = useCallback((step: WalletCreationStep, extra?: Record<string, unknown>) => {
    setWalletCreationStep(step)
    const nextStage: Partial<Record<WalletCreationStep, WalletSetupStage>> = {
      idle: "idle",
      opening_dynamic: "dynamic_auth_opened",
      verification_required: "dynamic_auth_opened",
      waiting_for_dynamic_auth: "dynamic_auth_opened",
      dynamic_authenticated: "dynamic_auth_completed",
      provisioning_wallet: "waiting_for_dynamic_wallets",
      waiting_for_embedded_wallets: "waiting_for_dynamic_wallets",
      wallets_detected: "waiting_for_signers",
      extracting_addresses: "waiting_for_signers",
      syncing_pinetree_profile: "syncing_profile",
      profile_synced: "profile_synced",
      repairing_profile: "waiting_for_dynamic_wallets",
      failed: "failed",
      timeout: "failed",
    }
    setWalletSetupStage(nextStage[step] ?? "idle")
    if (step !== "failed" && step !== "timeout") setWalletSetupFailureReason(null)
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

  const recordWalletSetupFailure = useCallback((
    failureReason: WalletSetupFailureReason,
    stage: WalletSetupStage = "failed",
    extra?: Record<string, unknown>
  ) => {
    clearScheduledWalletOpenAfterCreate()
    setWalletSetupFailureReason(failureReason)
    setWalletSetupStage(stage)
    const payload = {
      attemptId: walletSetupAttemptId,
      merchantId,
      stage,
      failureReason,
      dynamicAuthenticated: Boolean(user),
      dynamicUserIdPresent: Boolean(user?.userId),
      dynamicEmailPresent: Boolean(dynamicUserEmail),
      baseAddressPresent: dynamicNetworkAddresses.base.length > 0,
      solanaAddressPresent: dynamicNetworkAddresses.solana.length > 0,
      baseSignerFound: Boolean(
        dynamicNetworkAddresses.base[0]?.address &&
          findDynamicApprovalWalletForSource(wallets as unknown[], primaryWallet, "base", dynamicNetworkAddresses.base[0].address)
      ),
      solanaSignerFound: Boolean(
        dynamicNetworkAddresses.solana[0]?.address &&
          findDynamicApprovalWalletForSource(wallets as unknown[], primaryWallet, "solana", dynamicNetworkAddresses.solana[0].address)
      ),
      profileEndpointStatus: profileSyncDiagnostics.profileEndpointStatus,
      providerSyncStatus: profileSyncDiagnostics.providerSyncStatus ?? null,
      ...(extra || {}),
    }
    console.warn("[pinetree-wallets] setup_failed", payload)
  }, [
    walletSetupAttemptId,
    merchantId,
    user,
    dynamicUserEmail,
    dynamicNetworkAddresses,
    wallets,
    primaryWallet,
    profileSyncDiagnostics.profileEndpointStatus,
    profileSyncDiagnostics.providerSyncStatus,
  ])

  useDynamicEvents("authFlowCancelled", () => {
    if (!pendingSync && !dynamicVerificationPromptReason) return
    console.info("[pinetree-wallets] dynamic_auth_cancelled", {
      pendingSync,
      verificationPromptOpen: Boolean(dynamicVerificationPromptReason),
    })
    setDynamicVerificationPromptReason(null)
    setPendingSync(false)
    setSyncing(false)
    autoOpenWalletAfterCreateRef.current = false
    clearWalletSetupInProgress()
    recordWalletSetupFailure("dynamic_auth_cancelled", "failed", {
      reason: dynamicVerificationPromptReason || "dynamic_auth_cancelled",
    })
    logWalletCreationStep("failed", { reason: "dynamic_auth_cancelled" })
  })

  // Dynamic's own auth-sheet lifecycle (Part E). showAuthFlow alone was seen stuck true
  // in production because Dynamic's UI can enter an internal error state ("Try again or
  // log out") without ever firing authFlowClose - these events give a real open-time
  // signal for the staleness check above, independent of that boolean.
  useDynamicEvents("authFlowOpen", () => {
    dynamicAuthSheetOpenedAtRef.current = Date.now()
    dynamicAuthSheetStaleClearedRef.current = false
    console.info("[pinetree-wallets] wallet_dynamic_sheet_opened", {})
    emitWalletSetupDebugEvent("wallet_dynamic_sheet_opened", {})
  })

  useDynamicEvents("authFlowClose", () => {
    dynamicAuthSheetOpenedAtRef.current = null
    console.info("[pinetree-wallets] wallet_dynamic_sheet_closed", {})
    emitWalletSetupDebugEvent("wallet_dynamic_sheet_closed", {})
    // A Dynamic user session present at close time means the required information
    // capture actually completed (success), rather than the merchant dismissing an
    // incomplete/error sheet state.
    if (user) {
      console.info("[pinetree-wallets] wallet_dynamic_sheet_completed", {})
      emitWalletSetupDebugEvent("wallet_dynamic_sheet_completed", {})
    }
  })

  // Fires for both a PineTree-initiated handleLogOut() call and Dynamic's own internal
  // "Log out" control inside its auth sheet (e.g. after the "Try again or log out"
  // error state) - either way this is the Dynamic wallet-provider session ending, never
  // the separate PineTree/Supabase application session (Part F, Option A: cancel wallet
  // setup, keep the merchant signed into PineTree - never call the Supabase sign-out
  // function from here).
  useDynamicEvents("logout", () => {
    const setupWasActive = Boolean(pendingSync || overallSetupActiveRef.current || walletSetupStartInFlightRef.current)
    console.info("[pinetree-wallets] wallet_dynamic_logout_started", { setupWasActive })
    emitWalletSetupDebugEvent("wallet_dynamic_logout_started", { setupWasActive })
    try {
      dynamicAuthSheetOpenedAtRef.current = null
      setShowAuthFlow(false)
      setShowDynamicUserProfile(false)
      if (setupWasActive) {
        clearScheduledWalletOpenAfterCreate()
        overallSetupActiveRef.current = false
        setCoreSetupStageLabel("")
        setPendingSync(false)
        setSyncing(false)
        setWalletCreationStep("idle")
        setCoreSetupNeedsUserAuth(false)
        walletSetupStartInFlightRef.current = null
        pendingWalletProvisionAttemptRef.current = null
        pendingWalletProvisionStartedAtRef.current = null
        pendingProfileSyncAttemptRef.current = false
        nativeFallbackPendingRef.current = false
        autoOpenWalletAfterCreateRef.current = false
        // Clearing the in-progress marker alone is not enough (Part G): the merchant
        // walked away on purpose, so mark it cancelled too, distinctly from an
        // interrupted-but-still-wanted setup that a plain reload should still resume.
        clearWalletSetupInProgress()
        markWalletSetupCancelled()
        emitWalletSetupDebugEvent("wallet_setup_cancelled_from_dynamic", {})
      }
      console.info("[pinetree-wallets] wallet_dynamic_logout_complete", { setupWasActive })
      emitWalletSetupDebugEvent("wallet_dynamic_logout_complete", { setupWasActive })
    } catch {
      console.warn("[pinetree-wallets] wallet_dynamic_logout_failed", {})
      emitWalletSetupDebugEvent("wallet_dynamic_logout_failed", {})
    }
  })

  const blockDynamicEmailFallbackAuth = useCallback((reason: string) => {
    const failureReason: WalletSetupFailureReason = dynamicAuthConfig.configValid
      ? "dynamic_email_fallback_blocked"
      : "dynamic_auth_config_invalid"
    console.warn("[pinetree-wallets] dynamic_email_fallback_blocked", {
      reason,
      authMode: dynamicAuthConfig.mode,
      rawAuthModePresent: Boolean(dynamicAuthConfig.rawMode),
      rawEmailFallbackPresent: Boolean(dynamicAuthConfig.rawEmailFallback),
      emailFallbackEnabled: dynamicAuthConfig.emailFallbackEnabled,
      externalJwtConfigured: dynamicAuthConfig.externalJwtConfigured,
      emailFallbackMisconfigured: dynamicAuthConfig.emailFallbackMisconfigured,
      configValid: dynamicAuthConfig.configValid,
      invalidReason: dynamicAuthConfig.invalidReason,
    })
    if (failureReason === "dynamic_auth_config_invalid") {
      console.warn("[pinetree-wallets] dynamic_auth_config_invalid", {
        reason,
        authMode: dynamicAuthConfig.mode,
        rawAuthModePresent: Boolean(dynamicAuthConfig.rawMode),
        rawEmailFallbackPresent: Boolean(dynamicAuthConfig.rawEmailFallback),
        invalidReason: dynamicAuthConfig.invalidReason,
      })
    }
    setDynamicVerificationPromptReason(null)
    setWalletIdentityError(pineTreeDynamicConfigurationErrorMessage)
    setPendingSync(false)
    setSyncing(false)
    clearWalletSetupInProgress()
    recordWalletSetupFailure(failureReason, "failed", {
      reason,
      dynamicEmailFallbackBlocked: true,
      dynamicAuthInvalidReason: dynamicAuthConfig.invalidReason,
    })
    setProfileSyncDiagnostics((prev) => ({
      ...prev,
      externalJwtEnabled: dynamicAuthConfig.externalJwtConfigured,
      externalJwtEndpointStatus: prev.externalJwtEndpointStatus ?? null,
      externalJwtErrorCode: prev.externalJwtErrorCode ?? failureReason,
      lastWalletAuthAttemptState: failureReason,
      signInWithExternalJwtCalled: false,
      signInWithExternalJwtSucceeded: false,
      dynamicEmailFallbackBlocked: true,
      dynamicExternalAuthAttempted: prev.dynamicExternalAuthAttempted ?? false,
      dynamicExternalAuthSucceeded: false,
      skippedReason: failureReason,
      updatedAt: new Date().toISOString(),
    }))
    logWalletCreationStep("failed", { reason: failureReason })
    return false
  }, [
    dynamicAuthConfig.configValid,
    dynamicAuthConfig.emailFallbackEnabled,
    dynamicAuthConfig.emailFallbackMisconfigured,
    dynamicAuthConfig.externalJwtConfigured,
    dynamicAuthConfig.invalidReason,
    dynamicAuthConfig.mode,
    dynamicAuthConfig.rawEmailFallback,
    dynamicAuthConfig.rawMode,
    logWalletCreationStep,
    recordWalletSetupFailure,
  ])

  const providerSheetDiagnosticPayload = useCallback((reason: string, options?: ProviderSheetGateOptions) => {
    const readiness = providerSheetGateStateRef.current
    return {
      reason,
      selectedRail: options?.selectedRail ?? null,
      explicitUserAction: Boolean(options?.explicitUserAction),
      walletReady: readiness.walletReady,
      profileReady: readiness.profileReady,
      baseReady: readiness.baseReady,
      solanaReady: readiness.solanaReady,
      bitcoinReady: readiness.bitcoinReady,
      signatureRequired: Boolean(options?.signatureRequired),
      runtimeUserPresent: Boolean(user),
      runtimeWalletCount: dynamicWalletRuntimeCountRef.current,
    }
  }, [user])

  const logProviderSheetOpenRequested = useCallback((reason: string, options?: ProviderSheetGateOptions) => {
    const payload = providerSheetDiagnosticPayload(reason, options)
    console.info("[pinetree-wallets] wallet_provider_sheet_open_requested", payload)
    emitWalletSetupDebugEvent("wallet_provider_sheet_open_requested", payload)
    return payload
  }, [providerSheetDiagnosticPayload])

  const openDynamicEmailFallbackAuth = useCallback((reason: string, options?: ProviderSheetGateOptions) => {
    const gate = logProviderSheetOpenRequested(reason, options)
    if (gate.walletReady && !gate.signatureRequired) {
      const suppressed = {
        reason,
        walletReady: gate.walletReady,
        signatureRequired: gate.signatureRequired,
        explicitUserAction: gate.explicitUserAction,
      }
      console.info("[pinetree-wallets] wallet_provider_sheet_open_suppressed", suppressed)
      emitWalletSetupDebugEvent("wallet_provider_sheet_open_suppressed", suppressed)
      return false
    }
    setDynamicVerificationPromptReason(null)
    if (pineTreeControlledDynamicAuthAvailable) {
      const token = accessTokenRef.current
      setShowAuthFlow(false)
      setShowDynamicUserProfile(false)
      setWalletIdentityError("")
      setProfileSyncDiagnostics((prev) => ({
        ...prev,
        externalJwtEnabled: true,
        externalJwtEndpointStatus: null,
        externalJwtErrorCode: null,
        lastWalletAuthAttemptState: "external_jwt_request_started",
        signInWithExternalJwtCalled: false,
        signInWithExternalJwtSucceeded: false,
        dynamicEmailFallbackBlocked: false,
        dynamicExternalAuthAttempted: true,
        dynamicExternalAuthSucceeded: false,
        updatedAt: new Date().toISOString(),
      }))
      logWalletCreationStep("waiting_for_dynamic_auth", {
        reason,
        dynamic_external_auth_attempted: true,
      })

      if (!token) {
        console.info("[pinetree-dynamic-auth] external_jwt_client", {
          authMode: dynamicAuthConfig.mode,
          emailFallbackEnabled: dynamicAuthConfig.emailFallbackEnabled,
          externalJwtAttempted: true,
          endpointStatus: 401,
          endpointErrorCode: "missing_supabase_auth_token",
          signInWithExternalJwtCalled: false,
          signInWithExternalJwtSucceeded: false,
        })
        setWalletIdentityError(pineTreeDynamicConfigurationErrorMessage)
        setPendingSync(false)
        clearWalletSetupInProgress()
        recordWalletSetupFailure("pine_tree_auth_missing", "failed", {
          reason,
          externalJwtEnabled: true,
          externalJwtErrorCode: "missing_supabase_auth_token",
          dynamicExternalAuthAttempted: true,
          dynamicExternalAuthSucceeded: false,
        })
        setProfileSyncDiagnostics((prev) => ({
          ...prev,
          externalJwtEnabled: true,
            externalJwtEndpointStatus: 401,
            externalJwtErrorCode: "missing_supabase_auth_token",
            lastWalletAuthAttemptState: "external_jwt_route_failed",
            signInWithExternalJwtCalled: false,
            signInWithExternalJwtSucceeded: false,
            dynamicEmailFallbackBlocked: false,
            dynamicExternalAuthAttempted: true,
          dynamicExternalAuthSucceeded: false,
          skippedReason: "missing_supabase_auth_token",
          updatedAt: new Date().toISOString(),
        }))
        return false
      }

      void (async () => {
        let endpointStatus: number | null = null
        let endpointErrorCode: string | null = null
        let signInWithExternalJwtCalled = false
        let signInWithExternalJwtSucceeded = false
        let signinFailureReason = "unknown_dynamic_auth_failure"
        let signinErrorName: string | undefined
        let signinErrorCode: string | undefined
        let signinErrorStatus: number | undefined
        let signinHttpStatus: number | undefined
        let signinProviderCode: string | undefined
        let signinSafeProviderMessage: string | undefined
        let signinMessageHint: string | undefined
        let issuedClaims: PineTreeDynamicExternalJwtClaimsDiagnostics | null = null
        let jwtSelfVerificationPassed = false
        let jwtHeaderKidMatchesJwks = false
        let signingPublicKeyMatchesJwks = false
        let algorithmRs256 = false
        let emailClaimIncluded = true
        let clientExternalUserIdMatchesSubject = false
        let clientUsedRouteExternalUserId = false
        try {
          console.info("[pinetree-wallets] wallet_dynamic_jwt_requested", {})
          emitWalletSetupDebugEvent("wallet_dynamic_jwt_requested", {})
          emitWalletSetupDebugEvent("wallet_dynamic_jwt_auth_started", {})
          const payload = await requestPineTreeDynamicExternalJwtAuth(token, { walletDebug: walletSyncDebugQueryEnabled })
          issuedClaims = payload.claims ?? null
          endpointStatus = 200
          // TEMPORARY external-JWT contract diagnostic: decode the token locally
          // and compare kid/alg/iss/aud against the values Dynamic validates
          // (canonical issuer, client-bundle environment ID, same-origin JWKS
          // kid). Safe fields only - never the JWT, key material, or emails.
          try {
            const contractAnalysis = analyzePineTreeDynamicExternalJwtContract(payload.externalJwt, {
              NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID: process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID,
            }, payload.externalUserId)
            jwtSelfVerificationPassed = Boolean(payload.jwtVerification?.jwtSelfVerificationPassed)
            jwtHeaderKidMatchesJwks = Boolean(payload.jwtVerification?.jwtHeaderKidMatchesJwks)
            signingPublicKeyMatchesJwks = Boolean(payload.jwtVerification?.signingPublicKeyMatchesJwks)
            algorithmRs256 = Boolean(payload.jwtVerification?.algorithmRs256)
            emailClaimIncluded = contractAnalysis.emailClaimIncluded
            clientExternalUserIdMatchesSubject = contractAnalysis.externalUserIdMatchesSubject
            clientUsedRouteExternalUserId = true
            const jwksKid = await fetch("/.well-known/dynamic-jwks.json", { cache: "no-store" })
              .then(async (jwksRes) => {
                if (!jwksRes.ok) return null
                const jwks = (await jwksRes.json()) as { keys?: Array<{ kid?: string }> }
                return jwks.keys?.[0]?.kid ?? null
              })
              .catch(() => null)
            const contractDiagnostic = {
              headerKid: contractAnalysis.headerKid ?? "missing",
              jwksKid: jwksKid ?? "missing",
              kidMatch: Boolean(contractAnalysis.headerKid && jwksKid && contractAnalysis.headerKid === jwksKid),
              algorithm: contractAnalysis.algorithm ?? "missing",
              issuerMatch: contractAnalysis.issuerMatch,
              audienceMatch: contractAnalysis.audienceMatch,
              environmentIdMatch: contractAnalysis.environmentIdPresent && contractAnalysis.audienceMatch,
              environmentIdPresent: contractAnalysis.environmentIdPresent,
              subjectPresent: contractAnalysis.subjectPresent,
              emailClaimIncluded,
              jwtSelfVerificationPassed,
              signingPublicKeyMatchesJwks,
              algorithmRs256,
              clientExternalUserIdPresent: contractAnalysis.externalUserIdPresent,
              clientUsedRouteExternalUserId,
              clientExternalUserIdMatchesSubject,
            }
            console.info("[pinetree-wallets] wallet_dynamic_jwt_contract_diagnostic", contractDiagnostic)
            emitWalletSetupDebugEvent("wallet_dynamic_jwt_contract_diagnostic", contractDiagnostic)
          } catch {
            // Diagnostics never block sign-in.
          }
          emitWalletSetupDebugEvent("wallet_dynamic_jwt_response_received", {
            ok: true,
            tokenPresent: Boolean(payload.externalJwt),
            expiresAtPresent: Boolean(payload.expiresAt),
          })
          if (!payload.externalJwt || !payload.externalUserId) {
            signinFailureReason = "jwt_missing_token"
            throw Object.assign(new Error("dynamic_external_jwt_failed"), { status: 502 })
          }
          const subjectAnalysis = analyzePineTreeDynamicExternalJwtContract(payload.externalJwt, {
            NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID: process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID,
          }, payload.externalUserId)
          emailClaimIncluded = subjectAnalysis.emailClaimIncluded
          clientExternalUserIdMatchesSubject = subjectAnalysis.externalUserIdMatchesSubject
          clientUsedRouteExternalUserId = true
          if (!subjectAnalysis.externalUserIdPresent || !subjectAnalysis.externalUserIdMatchesSubject) {
            signinFailureReason = "external_user_id_subject_mismatch"
            throw Object.assign(new Error("dynamic_external_user_id_mismatch"), {
              status: 502,
              code: "dynamic_external_user_id_mismatch",
            })
          }
          setProfileSyncDiagnostics((prev) => ({
            ...prev,
            externalJwtEnabled: true,
            externalJwtIssuerConfigured: payload.diagnostics?.issuerConfigured ?? prev.externalJwtIssuerConfigured,
            externalJwtAudienceConfigured: payload.diagnostics?.audienceConfigured ?? prev.externalJwtAudienceConfigured,
            externalJwtKidConfigured: payload.diagnostics?.kidConfigured ?? prev.externalJwtKidConfigured,
            externalJwtSigningKeyConfigured: payload.diagnostics?.signingKeyConfigured ?? prev.externalJwtSigningKeyConfigured,
            externalJwtJwksDerivedFromSigningKey: payload.diagnostics?.jwksDerivedFromSigningKey ?? prev.externalJwtJwksDerivedFromSigningKey,
            externalJwtEndpointStatus: 200,
            externalJwtErrorCode: null,
            lastWalletAuthAttemptState: "external_jwt_route_succeeded",
            signInWithExternalJwtCalled: false,
            signInWithExternalJwtSucceeded: false,
            dynamicEmailFallbackBlocked: false,
            dynamicExternalAuthAttempted: true,
            dynamicExternalAuthSucceeded: false,
            updatedAt: new Date().toISOString(),
          }))
          if (typeof signInWithExternalJwt !== "function") {
            signinFailureReason = "dynamic_signin_function_missing"
            throw Object.assign(new Error("dynamic_external_jwt_failed"), { status: 502 })
          }

          signInWithExternalJwtCalled = true
          emitWalletSetupDebugEvent("wallet_dynamic_signin_started", {})
          let dynamicProfile: Awaited<ReturnType<typeof signInWithExternalJwt>>
          const maxSignInAttempts = 2
          let signInAttempt = 0
          while (true) {
            signInAttempt += 1
            try {
              dynamicProfile = await signInWithExternalJwt({
                externalJwt: payload.externalJwt,
                externalUserId: payload.externalUserId,
              })
              break
            } catch (signInError) {
              const classified = classifyDynamicSignInError(signInError)
              signinFailureReason = classified.reason
              signinErrorName = classified.errorName
              signinErrorCode = classified.errorCode
              signinErrorStatus = classified.status
              signinHttpStatus = classified.httpStatus
              signinProviderCode = classified.providerCode
              signinSafeProviderMessage = classified.safeProviderMessage
              signinMessageHint = classified.messageHint
              const canRetry = signInAttempt < maxSignInAttempts && DYNAMIC_SIGNIN_RETRYABLE_HINTS.has(classified.messageHint)
              if (!canRetry) {
                throw signInError
              }
              // Session-key generation/storage access can transiently fail (e.g. a
              // temporarily blocked keychain/IndexedDB write) - refresh Dynamic's auth
              // state and retry once before treating this as a hard failure.
              await refreshDynamicUser().catch(() => undefined)
              await new Promise((resolve) => window.setTimeout(resolve, 400))
            }
          }
          emitWalletSetupDebugEvent("wallet_dynamic_signin_returned", {
            profilePresent: Boolean(dynamicProfile),
            userPresent: Boolean(dynamicProfile),
          })

          if (!dynamicProfile) {
            // signInWithExternalJwt can resolve without an immediate profile while Dynamic
            // finishes initializing the session server-side - poll refreshDynamicUser for a
            // short bounded window instead of failing the whole flow immediately.
            signinFailureReason = "dynamic_signin_returned_no_profile"
            const pollStartedAt = Date.now()
            const pollTimeoutMs = 4000
            while (!dynamicProfile && Date.now() - pollStartedAt < pollTimeoutMs) {
              await new Promise((resolve) => window.setTimeout(resolve, 250))
              dynamicProfile = await refreshDynamicUser().catch(() => undefined)
            }
          }
          signInWithExternalJwtSucceeded = Boolean(dynamicProfile)
          if (signInWithExternalJwtSucceeded) {
            console.info("[pinetree-wallets] wallet_dynamic_jwt_authenticated", {})
            emitWalletSetupDebugEvent("wallet_dynamic_jwt_authenticated", {})
            emitWalletSetupDebugEvent("wallet_dynamic_jwt_auth_success", {
              issuerMatch: issuedClaims?.issuerMatch ?? false,
              audienceMatch: issuedClaims?.audienceMatch ?? false,
              subjectPresent: issuedClaims?.subjectPresent ?? false,
              environmentIdPresent: issuedClaims?.environmentIdPresent ?? false,
              emailClaimIncluded: issuedClaims?.emailClaimIncluded ?? emailClaimIncluded,
            })
          }
          setProfileSyncDiagnostics((prev) => ({
            ...prev,
            externalJwtEnabled: true,
            externalJwtIssuerConfigured: payload.diagnostics?.issuerConfigured ?? prev.externalJwtIssuerConfigured,
            externalJwtAudienceConfigured: payload.diagnostics?.audienceConfigured ?? prev.externalJwtAudienceConfigured,
            externalJwtKidConfigured: payload.diagnostics?.kidConfigured ?? prev.externalJwtKidConfigured,
            externalJwtSigningKeyConfigured: payload.diagnostics?.signingKeyConfigured ?? prev.externalJwtSigningKeyConfigured,
            externalJwtJwksDerivedFromSigningKey: payload.diagnostics?.jwksDerivedFromSigningKey ?? prev.externalJwtJwksDerivedFromSigningKey,
            externalJwtEndpointStatus: 200,
            externalJwtErrorCode: null,
            lastWalletAuthAttemptState: Boolean(dynamicProfile) ? "signInWithExternalJwt_succeeded" : "signInWithExternalJwt_rejected",
            signInWithExternalJwtCalled: true,
            signInWithExternalJwtSucceeded: Boolean(dynamicProfile),
            dynamicEmailFallbackBlocked: false,
            dynamicExternalAuthAttempted: true,
            dynamicExternalAuthSucceeded: Boolean(dynamicProfile),
            dynamicAuthenticated: Boolean(dynamicProfile),
            dynamicUserId: dynamicProfile?.userId ?? prev.dynamicUserId,
            updatedAt: new Date().toISOString(),
          }))
          if (!dynamicProfile) {
            signinFailureReason = "dynamic_user_not_available_after_signin"
            throw Object.assign(new Error("dynamic_external_auth_no_user"), { status: 502 })
          }
          overallSetupActiveRef.current = true
          setCoreSetupStageLabel("Preparing secure wallet")
          setPendingSync(true)
          markWalletSetupInProgress()
          setProvisioningRetryExhausted(false)
          setFinalProvisioningRefreshAttempted(false)
          pendingProfileSyncAttemptRef.current = false
          setWalletIdentityError("")
          logWalletCreationStep("dynamic_authenticated", {
            reason,
            dynamic_external_auth_succeeded: true,
          })
          emitWalletSetupStageDiagnostic("wallet_create_dynamic_auth_complete", "dynamic_auth_complete")
          console.info("[pinetree-dynamic-auth] external_jwt_client", {
            authMode: dynamicAuthConfig.mode,
            emailFallbackEnabled: dynamicAuthConfig.emailFallbackEnabled,
            externalJwtAttempted: true,
            endpointStatus,
            endpointErrorCode,
            signInWithExternalJwtCalled,
            signInWithExternalJwtSucceeded,
          })
          void refreshDynamicUser()
        } catch (error) {
          const status =
            typeof error === "object" && error !== null && "status" in error && typeof (error as { status?: unknown }).status === "number"
              ? (error as { status: number }).status
              : null
          const code =
            typeof error === "object" && error !== null && "code" in error && typeof (error as { code?: unknown }).code === "string"
              ? (error as { code: string }).code
              : error instanceof Error
                ? error.message
                : "dynamic_external_auth_failed"
          endpointStatus = endpointStatus ?? status
          endpointErrorCode = code
          const failureReason: WalletSetupFailureReason =
            status === 401
              ? "pine_tree_auth_missing"
              : status === 403
                ? "merchant_resolution_failed"
                : "dynamic_external_jwt_failed"
          // The JWT fetch itself never resolved (network error, non-200) - none of the
          // signinFailureReason branches above ran, so classify it here instead of
          // leaving the default "unknown" reason.
          if (signinFailureReason === "unknown_dynamic_auth_failure" && endpointStatus !== 200) {
            signinFailureReason = "jwt_response_not_ok"
          }
          emitWalletSetupDebugEvent("wallet_dynamic_signin_failed", {
            reason: signinFailureReason,
            ...(signinErrorName ? { errorName: signinErrorName } : {}),
            ...(signinErrorCode ? { errorCode: signinErrorCode } : {}),
            ...(signinErrorStatus !== undefined ? { status: signinErrorStatus } : {}),
            ...(signinHttpStatus !== undefined ? { httpStatus: signinHttpStatus } : {}),
            ...(signinProviderCode ? { providerCode: signinProviderCode } : {}),
            ...(signinSafeProviderMessage ? { safeProviderMessage: signinSafeProviderMessage } : {}),
            jwtSelfVerificationPassed,
            jwtHeaderKidMatchesJwks,
            signingPublicKeyMatchesJwks,
            algorithmRs256,
            emailClaimIncluded,
            clientExternalUserIdMatchesSubject,
            ...(signinMessageHint ? { messageHint: signinMessageHint } : {}),
          })
          // Contract diagnostics for the failed attempt: whether the token we
          // signed matched the verified Dynamic requirements (issuer = app origin,
          // audience = environment ID) and whether our JWKS is actually reachable
          // at the URL Dynamic's dashboard points at. Booleans only.
          const jwksLoaded = await fetch("/.well-known/dynamic-jwks.json", { cache: "no-store" })
            .then((jwksRes) => jwksRes.ok)
            .catch(() => false)
          emitWalletSetupDebugEvent("wallet_dynamic_jwt_auth_failed", {
            issuerMatch: issuedClaims?.issuerMatch ?? false,
            audienceMatch: issuedClaims?.audienceMatch ?? false,
            jwksLoaded,
            subjectPresent: issuedClaims?.subjectPresent ?? false,
            environmentIdPresent: issuedClaims?.environmentIdPresent ?? false,
            jwtSelfVerificationPassed,
            jwtHeaderKidMatchesJwks,
            signingPublicKeyMatchesJwks,
            algorithmRs256,
            emailClaimIncluded,
            clientExternalUserIdMatchesSubject,
            ...(signinMessageHint ? { messageHint: signinMessageHint } : {}),
          })
          console.info("[pinetree-dynamic-auth] external_jwt_client", {
            authMode: dynamicAuthConfig.mode,
            emailFallbackEnabled: dynamicAuthConfig.emailFallbackEnabled,
            externalJwtAttempted: true,
            endpointStatus,
            endpointErrorCode,
            signInWithExternalJwtCalled,
            signInWithExternalJwtSucceeded,
          })
          console.warn("[pinetree-wallets] dynamic_external_jwt_auth_failed", {
            reason,
            errorName: signinErrorName,
            errorCode: signinErrorCode || code,
            httpStatus: signinHttpStatus ?? status,
            providerCode: signinProviderCode,
            safeProviderMessage: signinSafeProviderMessage,
            jwtSelfVerificationPassed,
            jwtHeaderKidMatchesJwks,
            signingPublicKeyMatchesJwks,
            algorithmRs256,
            emailClaimIncluded,
            clientExternalUserIdMatchesSubject,
          })
          if (signinMessageHint === "external_auth_rejected") {
            emitWalletSetupDebugEvent("wallet_dynamic_external_jwt_rejected", {})
            const jwtContractValid = Boolean(
              issuedClaims?.issuerMatch &&
                issuedClaims?.audienceMatch &&
                issuedClaims?.environmentIdPresent &&
                jwtSelfVerificationPassed &&
                jwtHeaderKidMatchesJwks &&
                signingPublicKeyMatchesJwks &&
                algorithmRs256
            )
            const externalUserBindingValid = Boolean(clientExternalUserIdMatchesSubject)
            if (jwtContractValid && externalUserBindingValid) {
              emitWalletSetupDebugEvent("wallet_dynamic_external_identity_conflict_suspected", {
                jwtContractValid: true,
                emailClaimIncluded,
                externalUserBindingValid: true,
                dynamicRejected: true,
              })
            }
            emitWalletSetupDebugEvent("wallet_dynamic_native_fallback_suppressed", {
              reason: "external_jwt_rejected_external_identity_only",
              jwtContractValid,
              emailClaimIncluded,
              externalUserBindingValid,
            })
            setWalletIdentityError(walletSetupFailureMessage("dynamic_external_jwt_rejected"))
            setPendingSync(false)
            clearWalletSetupInProgress()
            recordWalletSetupFailure("dynamic_external_jwt_rejected", "failed", {
              reason,
              externalJwtEnabled: true,
              lastWalletAuthAttemptState: "external_jwt_rejected_no_fallback",
              signInWithExternalJwtCalled,
              signInWithExternalJwtSucceeded,
              dynamicExternalAuthAttempted: true,
              dynamicExternalAuthSucceeded: false,
            })
            setProfileSyncDiagnostics((prev) => ({
              ...prev,
              lastWalletAuthAttemptState: "external_jwt_rejected_no_fallback",
              updatedAt: new Date().toISOString(),
            }))
            logWalletCreationStep("failed", { reason: "dynamic_external_jwt_rejected" })
            return
          }
          setWalletIdentityError(
            status === 401
              ? "PineTree sign-in is required before creating a PineTree Wallet."
              : status === 403
                ? "PineTree could not verify this merchant account for wallet setup."
                : pineTreeDynamicConfigurationErrorMessage
          )
          setPendingSync(false)
          clearWalletSetupInProgress()
          recordWalletSetupFailure(failureReason, "failed", {
            reason,
            externalJwtEnabled: true,
            externalJwtEndpointStatus: status,
            externalJwtErrorCode: code,
            lastWalletAuthAttemptState: signInWithExternalJwtCalled ? "signInWithExternalJwt_rejected" : "external_jwt_route_failed",
            signInWithExternalJwtCalled,
            signInWithExternalJwtSucceeded,
            dynamicEmailFallbackBlocked: false,
            dynamicExternalAuthAttempted: true,
            dynamicExternalAuthSucceeded: false,
          })
          setProfileSyncDiagnostics((prev) => ({
            ...prev,
            externalJwtEnabled: true,
            externalJwtEndpointStatus: status,
            externalJwtErrorCode: code,
            lastWalletAuthAttemptState: signInWithExternalJwtCalled ? "signInWithExternalJwt_rejected" : "external_jwt_route_failed",
            signInWithExternalJwtCalled,
            signInWithExternalJwtSucceeded,
            dynamicEmailFallbackBlocked: false,
            dynamicExternalAuthAttempted: true,
            dynamicExternalAuthSucceeded: false,
            skippedReason: failureReason,
            updatedAt: new Date().toISOString(),
          }))
          logWalletCreationStep("failed", {
            reason: failureReason,
            externalJwtEndpointStatus: status,
            externalJwtErrorCode: code,
          })
        }
      })()
      return true
    }
    if (!shouldOpenDynamicEmailFallbackAuth(dynamicAuthConfig)) {
      return blockDynamicEmailFallbackAuth(reason)
    }
    try {
      assertCanOpenDynamicEmailFallbackAuth(dynamicAuthConfig)
    } catch {
      return blockDynamicEmailFallbackAuth(reason)
    }
    setProfileSyncDiagnostics((prev) => ({
      ...prev,
      lastWalletAuthAttemptState: "dynamic_email_fallback_opened",
      dynamicEmailFallbackBlocked: false,
      updatedAt: new Date().toISOString(),
    }))
    setShowAuthFlow(true)
    return true
  }, [
    blockDynamicEmailFallbackAuth,
    dynamicAuthConfig,
    logProviderSheetOpenRequested,
    logWalletCreationStep,
    pineTreeControlledDynamicAuthAvailable,
    recordWalletSetupFailure,
    refreshDynamicUser,
    setShowAuthFlow,
    setShowDynamicUserProfile,
    signInWithExternalJwt,
    walletSyncDebugQueryEnabled,
  ])

  const requestDynamicVerificationPrompt = useCallback((reason: string) => {
    if (!dynamicAuthConfig.configValid) {
      blockDynamicEmailFallbackAuth(reason)
      return
    }
    setPendingSync(false)
    setDynamicVerificationPromptReason(reason)
    logWalletCreationStep("verification_required", {
      reason,
      authMode: dynamicAuthConfig.mode,
      merchantEmailPresent: Boolean(merchantEmail),
    })
    console.info("[pinetree-wallets] dynamic_verification_required", {
      reason,
      authMode: dynamicAuthConfig.mode,
      externalJwtConfigured: pineTreeControlledDynamicAuthAvailable,
      emailFallbackEnabled: dynamicAuthConfig.emailFallbackEnabled,
      merchantEmailPresent: Boolean(merchantEmail),
    })
  }, [
    dynamicAuthConfig.emailFallbackEnabled,
    dynamicAuthConfig.configValid,
    dynamicAuthConfig.mode,
    blockDynamicEmailFallbackAuth,
    logWalletCreationStep,
    merchantEmail,
    pineTreeControlledDynamicAuthAvailable,
  ])

  const continueDynamicVerification = useCallback(() => {
    const reason = dynamicVerificationPromptReason || "create_pinetree_wallet"
    setDynamicVerificationPromptReason(null)
    setPendingSync(true)
    markWalletSetupInProgress()
    logWalletCreationStep("waiting_for_dynamic_auth", {
      reason,
      merchantEmailPresent: Boolean(merchantEmail),
    })
    openDynamicEmailFallbackAuth(reason, { explicitUserAction: true })
  }, [
    dynamicVerificationPromptReason,
    logWalletCreationStep,
    merchantEmail,
    openDynamicEmailFallbackAuth,
  ])

  const scheduleDynamicEmailFallbackAuth = useCallback((reason: string, options?: ProviderSheetGateOptions) => {
    window.setTimeout(() => {
      openDynamicEmailFallbackAuth(reason, options)
    }, 0)
  }, [openDynamicEmailFallbackAuth])

  const waitForDynamicWalletRuntime = useCallback(async (options?: { requireApprovalWallet?: boolean }) => {
    const startedAt = Date.now()
    const timeoutMs = 6000
    while (Date.now() - startedAt < timeoutMs) {
      if (options?.requireApprovalWallet ? dynamicApprovalAvailableRef.current : dynamicWalletRuntimeCountRef.current > 0) {
        return true
      }
      await new Promise((resolve) => window.setTimeout(resolve, 150))
    }
    return options?.requireApprovalWallet ? dynamicApprovalAvailableRef.current : dynamicWalletRuntimeCountRef.current > 0
  }, [])

  const waitForOpenWalletReadiness = useCallback(async () => {
    const startedAt = Date.now()
    const timeoutMs = 3000
    while (Date.now() - startedAt < timeoutMs) {
      if (dynamicProfileReadyRef.current) return true
      await new Promise((resolve) => window.setTimeout(resolve, 150))
    }
    return dynamicProfileReadyRef.current
  }, [])

  // True once this generation's create/hydration work is known to be superseded -
  // either a newer generation has already taken its place in walletRuntimeRefreshMetaRef,
  // or core wallet setup reached terminal success at or before this generation. Callers
  // use this to decide whether a create call is even worth starting.
  const isDynamicCreateGenerationSuperseded = useCallback((refreshMode: "normal_hydration" | "approval_wallet_hydration", generation: number) => {
    const pastTerminalSuccess =
      walletCoreSetupTerminalGenerationRef.current !== null &&
      generation <= walletCoreSetupTerminalGenerationRef.current
    const supersededByNewerGeneration =
      walletRuntimeRefreshMetaRef.current[refreshMode]?.generation !== generation
    return pastTerminalSuccess || supersededByNewerGeneration
  }, [])

  const logDynamicCreateLateResultIgnored = useCallback((params: {
    reason: string
    refreshMode: "normal_hydration" | "approval_wallet_hydration"
    label: string
    generation: number
    startedAt: number
    settlement: "timeout" | "resolve" | "reject"
  }) => {
    const currentGeneration = walletRuntimeRefreshGenerationRef.current
    const stillCurrentGeneration = walletRuntimeRefreshMetaRef.current[params.refreshMode]?.generation === params.generation
    const pastTerminalSuccess =
      walletCoreSetupTerminalGenerationRef.current !== null &&
      params.generation <= walletCoreSetupTerminalGenerationRef.current
    if (stillCurrentGeneration && !pastTerminalSuccess) return false

    const diagnostic = {
      merchantId,
      reason: params.reason,
      label: params.label,
      generation: params.generation,
      ageMs: Date.now() - params.startedAt,
      settlement: params.settlement,
      terminalStatus: pastTerminalSuccess ? "ready" : "not_terminal",
      currentGeneration,
    }
    console.info("[pinetree-wallets] wallet_dynamic_late_result_ignored", diagnostic)
    emitWalletSetupDebugEvent("wallet_dynamic_late_result_ignored", diagnostic)
    return true
  }, [merchantId])

  // Shared handler for a Dynamic chain-create call that only settles after this refresh
  // attempt already moved on (timed out locally, or the whole page navigated past it). A
  // fulfilled result still nudges the runtime hydration nonce so the real wallet appears
  // on screen only when the generation is still active; stale/superseded settlements are
  // reduced to one safe wallet_dynamic_late_result_ignored diagnostic.
  const logStaleDynamicCreateSettlement = useCallback((params: {
    reason: string
    refreshMode: "normal_hydration" | "approval_wallet_hydration"
    label: string
    generation: number
    startedAt: number
    settled: BoundedProviderCallSettlement<unknown>
  }) => {
    const { reason, refreshMode, label, generation, startedAt, settled } = params
    const stillCurrentGeneration = walletRuntimeRefreshMetaRef.current[refreshMode]?.generation === generation
    const diagnostic = {
      reason,
      label,
      generation,
      settledStatus: settled.status,
      stillCurrentGeneration,
    }
    if (logDynamicCreateLateResultIgnored({
      reason,
      refreshMode,
      label,
      generation,
      startedAt,
      settlement: settled.status === "fulfilled" ? "resolve" : "reject",
    })) {
      return
    }
    console.info("[pinetree-wallets] wallet_dynamic_chain_create_late_settlement_ignored", diagnostic)
    emitWalletSetupDebugEvent("wallet_dynamic_chain_create_late_settlement_ignored", diagnostic)
    if (settled.status === "fulfilled") {
      setDynamicWalletRuntimeRefreshNonce((value) => value + 1)
    }
  }, [logDynamicCreateLateResultIgnored])

  const refreshDynamicWalletRuntimeImpl = useCallback(async (reason: string, options?: { requireApprovalWallet?: boolean }, generation = 0) => {
    if (!sdkHasLoaded || !user) return false
    const refreshMode = options?.requireApprovalWallet ? "approval_wallet_hydration" : "normal_hydration"
    let refreshStage:
      | "read_runtime_wallets"
      | "read_waas_credentials"
      | "initialize_waas"
      | "create_wallet_account"
      | "create_embedded_wallet"
      | "hydrate_runtime"
      | "detect_addresses" = "read_runtime_wallets"
    console.info("[pinetree-wallets] wallet_dynamic_wallets_refresh_started", { reason, refreshMode })
    emitWalletSetupDebugEvent("wallet_dynamic_wallets_refresh_started", {
      reason,
      refreshMode,
      dynamicWaasIsEnabled,
      runtimeWalletCount: dynamicWalletRuntimeCountRef.current,
    })
    try {
      await refreshDynamicUser()
      if (dynamicWaasIsEnabled) {
        if (shouldInitializeWaas) {
          refreshStage = "initialize_waas"
          await initializeWaas({ forceClientRebuild: true })
        }
        // When WaaS wallets are absent after initialization, provision them.
        // createWalletAccount uses needsAutoCreateWalletChains - the SDK-populated list of chains
        // that require wallet creation for this user.
        refreshStage = "read_runtime_wallets"
        let runtimeWallets = getWaasWallets()
        refreshStage = "read_waas_credentials"
        const runtimeCredentials = getWaasWalletsByCredentials()

        // Credentials already exist server-side (a wallet was provisioned in an earlier
        // session) but the local runtime never restored them. Force a rebuild instead of
        // falling through to explicit creation, which would attempt to create a duplicate.
        if (runtimeWallets.length === 0 && runtimeCredentials.length > 0 && !shouldInitializeWaas) {
          console.info("[pinetree-wallets] wallet_dynamic_create_or_restore_started", { reason, path: "restore_existing" })
          emitWalletSetupDebugEvent("wallet_dynamic_create_or_restore_started", { reason, path: "restore_existing" })
          refreshStage = "initialize_waas"
          await initializeWaas({ forceClientRebuild: true })
          refreshStage = "read_runtime_wallets"
          runtimeWallets = getWaasWallets()
          console.info("[pinetree-wallets] wallet_dynamic_create_or_restore_complete", {
            reason,
            path: "restore_existing",
            walletsRestored: runtimeWallets.length > 0,
          })
          emitWalletSetupDebugEvent("wallet_dynamic_create_or_restore_complete", {
            reason,
            path: "restore_existing",
            walletsRestored: runtimeWallets.length > 0,
          })
        }

        if (runtimeWallets.length === 0) {
          // needsAutoCreateWalletChains is the SDK-populated list of chains that require
          // wallet creation for this user. It can legitimately come back empty for a brand
          // new user before the SDK has caught up — fall back to explicitly requesting the
          // two chains PineTree Wallet requires so creation is never silently skipped.
          const requiredChains = needsAutoCreateWalletChains.length > 0
            ? needsAutoCreateWalletChains
            : runtimeCredentials.length === 0
              ? (REQUIRED_WAAS_WALLET_CHAINS as unknown as typeof needsAutoCreateWalletChains)
              : []
          if (requiredChains.length > 0 && !creatingEmbeddedWalletRef.current && isDynamicCreateGenerationSuperseded(refreshMode, generation)) {
            // Core wallet setup already reached terminal success (or a newer
            // refresh generation has taken over) since this attempt started -
            // never start another createWalletAccount call for it.
            const diagnostic = { reason, generation, terminalSetupStatus: "ready" as const }
            console.info("[pinetree-wallets] wallet_dynamic_setup_cancelled_after_success", diagnostic)
            emitWalletSetupDebugEvent("wallet_dynamic_setup_cancelled_after_success", diagnostic)
          } else if (requiredChains.length > 0 && !creatingEmbeddedWalletRef.current) {
            creatingEmbeddedWalletRef.current = true
            try {
              if (walletCreationDebugEnabled) {
                console.info("[pinetree-wallets] provisioning_waas_wallet_accounts", {
                  reason,
                  dynamicUserId: user.userId,
                  needsAutoCreateWalletChainCount: needsAutoCreateWalletChains.length,
                  usedExplicitFallbackChains: needsAutoCreateWalletChains.length === 0,
                  shouldInitializeWaas,
                  useUserWalletsCountBefore: (wallets as unknown[]).length,
                  primaryWalletBefore: Boolean(primaryWallet),
                })
              }
              console.info("[pinetree-wallets] wallet_dynamic_create_embedded_wallet_started", {
                reason,
                usedExplicitFallbackChains: needsAutoCreateWalletChains.length === 0,
              })
              emitWalletSetupDebugEvent("wallet_dynamic_create_embedded_wallet_started", {
                reason,
                path: "waas_create",
                usedExplicitFallbackChains: needsAutoCreateWalletChains.length === 0,
              })
              refreshStage = "create_wallet_account"
              const initialCreateGeneration = generation
              // Bounded so this call can never leave refreshDynamicWalletRuntimeImpl
              // awaiting indefinitely - production showed this exact unbounded await
              // hang for 129+ seconds and finally throw well after setup had already
              // succeeded through a later attempt. A timeout here means the
              // underlying provider call is now detached (kept running in the
              // background, uncancelled); its eventual settlement is handled below.
              const initialCreateStartedAt = Date.now()
              const initialCreateCall = runWithBoundedTimeout(
                () => createWalletAccount(requiredChains),
                dynamicChainCreateTimeoutMs
              )
              const initialCreateOutcome = await initialCreateCall.result
              if (
                initialCreateOutcome.status !== "timeout" &&
                logDynamicCreateLateResultIgnored({
                  reason,
                  refreshMode,
                  label: "waas_create",
                  generation: initialCreateGeneration,
                  startedAt: initialCreateStartedAt,
                  settlement: initialCreateOutcome.status === "fulfilled" ? "resolve" : "reject",
                })
              ) {
                return true
              }
              if (initialCreateOutcome.status === "fulfilled") {
                console.info("[pinetree-wallets] wallet_dynamic_create_embedded_wallet_complete", { reason })
                emitWalletSetupDebugEvent("wallet_dynamic_create_embedded_wallet_complete", { reason, path: "waas_create" })
                setDynamicWalletRuntimeRefreshNonce((value) => value + 1)
              } else if (initialCreateOutcome.status === "rejected") {
                throw initialCreateOutcome.reason
              } else {
                if (logDynamicCreateLateResultIgnored({
                  reason,
                  refreshMode,
                  label: "waas_create",
                  generation: initialCreateGeneration,
                  startedAt: initialCreateStartedAt,
                  settlement: "timeout",
                })) {
                  return true
                }
                console.warn("[pinetree-wallets] wallet_dynamic_create_embedded_wallet_timed_out", {
                  reason,
                  timeoutMs: dynamicChainCreateTimeoutMs,
                  generation: initialCreateGeneration,
                })
                emitWalletSetupDebugEvent("wallet_dynamic_create_embedded_wallet_timed_out", {
                  reason,
                  timeoutMs: dynamicChainCreateTimeoutMs,
                  generation: initialCreateGeneration,
                })
                void initialCreateCall.settlement.then((settled) => {
                  logStaleDynamicCreateSettlement({
                    reason,
                    refreshMode,
                    label: "waas_create",
                    generation: initialCreateGeneration,
                    startedAt: initialCreateStartedAt,
                    settled,
                  })
                })
              }
            } finally {
              creatingEmbeddedWalletRef.current = false
            }
          } else if (requiredChains.length === 0) {
            // Neither needsAutoCreateWalletChains nor the explicit fallback applied, and a
            // WaaS credential already exists - the runtime restore above should have found
            // it. If we reach here with zero wallets, that restore silently failed.
            emitWalletSetupDebugEvent("wallet_dynamic_missing_required_addresses", {
              reason: "waas_credential_exists_but_restore_failed",
            })
          }
        } else {
          // At least one WaaS runtime wallet exists, but that never guaranteed both
          // required chains (Base + Solana) are present - Dynamic can return exactly
          // one wallet for one chain while the other was never created. The block
          // above only ever runs when the count is exactly zero, so a lone Base or
          // Solana wallet used to permanently block the missing chain from ever being
          // explicitly requested again - the production freeze this fixes.
          refreshStage = "read_waas_credentials"
          // Classify against the broader dynamicWalletSearchList, not just the narrow
          // getWaasWallets() result: an EVM signer wallet created as part of a smart
          // wallet (e.g. ZeroDev) can appear in userWallets keyed 'zerodev' rather than
          // 'dynamicwaas', so getWaasWallets() alone can under-count it and cause a
          // Base wallet that already exists to look "missing" forever.
          const broadRuntimeWallets = [...runtimeWallets, ...dynamicWalletSearchList]
          const requiredChainState = computeRequiredChainState({
            runtimeWallets: broadRuntimeWallets,
            runtimeCredentials,
            hasBaseAddress: dynamicNetworkAddresses.base.length > 0,
            hasSolanaAddress: dynamicNetworkAddresses.solana.length > 0,
          })
          if (walletCreationDebugEnabled) {
            logDynamicWalletClassificationSummary(reason, broadRuntimeWallets)
          }
          const {
            hasBaseCredential,
            hasSolanaCredential,
            hasBaseRuntimeWallet,
            hasSolanaRuntimeWallet,
          } = requiredChainState
          console.info("[pinetree-wallets] wallet_dynamic_required_chain_state", { reason, ...requiredChainState })
          emitWalletSetupDebugEvent("wallet_dynamic_required_chain_state", { reason, ...requiredChainState })

          // Also requires no already-detected address (broader search than
          // hasBaseRuntimeWallet/hasSolanaRuntimeWallet alone) - an EVM signer wallet
          // that already produced a valid Base address must never be recreated merely
          // because the narrower runtime-wallet check missed it.
          const missingBaseChain = needsExplicitBaseCreate(requiredChainState)
          const missingSolanaChain = needsExplicitSolanaCreate(requiredChainState)
          let attemptedBaseCreate = false
          let attemptedSolanaCreate = false

          if (
            missingBaseChain &&
            !chainCreateGuardActive(baseWalletCreateGuardRef) &&
            !baseWalletCreateDetachedRef.current &&
            !isDynamicCreateGenerationSuperseded(refreshMode, generation)
          ) {
            attemptedBaseCreate = true
            baseWalletCreateGuardRef.current = Date.now()
            const baseCreateGeneration = generation
            console.info("[pinetree-wallets] wallet_dynamic_base_create_started", { reason })
            emitWalletSetupDebugEvent("wallet_dynamic_base_create_started", { reason })
            setCoreSetupStageLabel("Creating Base wallet")
            refreshStage = "create_wallet_account"
            // Bounded so this call can never leave refreshDynamicWalletRuntimeImpl
            // awaiting indefinitely - Dynamic's createWalletAccount has no documented
            // AbortSignal support, so a timeout here means the underlying provider call
            // is now detached (kept running in the background, uncancelled).
            const baseCreateStartedAt = Date.now()
            const baseCreateCall = runWithBoundedTimeout(
              // ChainEnum.Evm ("EVM") is the exact value the installed
              // @dynamic-labs/sdk-react-core WalletCreationRequirement type expects -
              // verified against its .d.ts, no unchecked cast needed.
              () => createWalletAccount([{ chain: ChainEnum.Evm }]),
              dynamicChainCreateTimeoutMs
            )
            const baseCreateOutcome = await baseCreateCall.result
            baseWalletCreateGuardRef.current = null
            if (
              baseCreateOutcome.status !== "timeout" &&
              logDynamicCreateLateResultIgnored({
                reason,
                refreshMode,
                label: "base",
                generation: baseCreateGeneration,
                startedAt: baseCreateStartedAt,
                settlement: baseCreateOutcome.status === "fulfilled" ? "resolve" : "reject",
              })
            ) {
              return true
            }
            if (baseCreateOutcome.status === "fulfilled") {
              baseWalletCreateFailedRef.current = false
              console.info("[pinetree-wallets] wallet_dynamic_base_create_complete", { reason })
              emitWalletSetupDebugEvent("wallet_dynamic_base_create_complete", { reason })
              setDynamicWalletRuntimeRefreshNonce((value) => value + 1)
            } else if (baseCreateOutcome.status === "rejected") {
              baseWalletCreateFailedRef.current = true
              const diagnostic = buildDynamicChainCreateFailureDiagnostic({
                reason,
                chain: "EVM",
                error: baseCreateOutcome.reason,
                runtimeWalletCount: broadRuntimeWallets.length,
                hasBaseCredential,
                hasBaseRuntimeWallet,
                hasSolanaCredential,
                hasSolanaRuntimeWallet,
              })
              console.warn("[pinetree-wallets] wallet_dynamic_base_create_failed", diagnostic)
              emitWalletSetupDebugEvent("wallet_dynamic_base_create_failed", diagnostic)
            } else {
              if (logDynamicCreateLateResultIgnored({
                reason,
                refreshMode,
                label: "base",
                generation: baseCreateGeneration,
                startedAt: baseCreateStartedAt,
                settlement: "timeout",
              })) {
                return true
              }
              // Timed out locally. Do not start a duplicate create merely because this
              // local deadline expired - mark the chain detached so the next hydration
              // attempt inspects fresh credential/runtime state instead of creating
              // again, until the original call actually settles.
              baseWalletCreateDetachedRef.current = true
              console.warn("[pinetree-wallets] wallet_dynamic_base_create_timed_out", {
                reason,
                timeoutMs: dynamicChainCreateTimeoutMs,
                generation: baseCreateGeneration,
              })
              emitWalletSetupDebugEvent("wallet_dynamic_base_create_timed_out", {
                reason,
                timeoutMs: dynamicChainCreateTimeoutMs,
                generation: baseCreateGeneration,
              })
              void baseCreateCall.settlement.then((settled) => {
                baseWalletCreateDetachedRef.current = false
                // An older provider promise resolving later must never overwrite a
                // newer generation's state, or flip an already-succeeded wallet back
                // to failed, or trigger duplicate profile work.
                const pastTerminalSuccess =
                  walletCoreSetupTerminalGenerationRef.current !== null &&
                  baseCreateGeneration <= walletCoreSetupTerminalGenerationRef.current
                if (!pastTerminalSuccess) {
                  baseWalletCreateFailedRef.current = settled.status === "rejected"
                }
                logStaleDynamicCreateSettlement({
                  reason,
                  refreshMode,
                  label: "base",
                  generation: baseCreateGeneration,
                  startedAt: baseCreateStartedAt,
                  settled,
                })
              })
            }
          }

          if (
            missingSolanaChain &&
            !chainCreateGuardActive(solanaWalletCreateGuardRef) &&
            !solanaWalletCreateDetachedRef.current &&
            !isDynamicCreateGenerationSuperseded(refreshMode, generation)
          ) {
            attemptedSolanaCreate = true
            solanaWalletCreateGuardRef.current = Date.now()
            const solanaCreateGeneration = generation
            console.info("[pinetree-wallets] wallet_dynamic_solana_create_started", { reason })
            emitWalletSetupDebugEvent("wallet_dynamic_solana_create_started", { reason })
            setCoreSetupStageLabel("Creating Solana wallet")
            refreshStage = "create_wallet_account"
            const solanaCreateStartedAt = Date.now()
            const solanaCreateCall = runWithBoundedTimeout(
              () => createWalletAccount([{ chain: ChainEnum.Sol }]),
              dynamicChainCreateTimeoutMs
            )
            const solanaCreateOutcome = await solanaCreateCall.result
            solanaWalletCreateGuardRef.current = null
            if (
              solanaCreateOutcome.status !== "timeout" &&
              logDynamicCreateLateResultIgnored({
                reason,
                refreshMode,
                label: "solana",
                generation: solanaCreateGeneration,
                startedAt: solanaCreateStartedAt,
                settlement: solanaCreateOutcome.status === "fulfilled" ? "resolve" : "reject",
              })
            ) {
              return true
            }
            if (solanaCreateOutcome.status === "fulfilled") {
              solanaWalletCreateFailedRef.current = false
              console.info("[pinetree-wallets] wallet_dynamic_solana_create_complete", { reason })
              emitWalletSetupDebugEvent("wallet_dynamic_solana_create_complete", { reason })
              setDynamicWalletRuntimeRefreshNonce((value) => value + 1)
            } else if (solanaCreateOutcome.status === "rejected") {
              solanaWalletCreateFailedRef.current = true
              const classified = classifyDynamicRefreshError(solanaCreateOutcome.reason)
              console.warn("[pinetree-wallets] wallet_dynamic_solana_create_failed", {
                reason,
                errorName: classified.errorName ?? "unknown_error",
              })
              emitWalletSetupDebugEvent("wallet_dynamic_solana_create_failed", {
                reason,
                errorName: classified.errorName ?? "unknown_error",
              })
            } else {
              if (logDynamicCreateLateResultIgnored({
                reason,
                refreshMode,
                label: "solana",
                generation: solanaCreateGeneration,
                startedAt: solanaCreateStartedAt,
                settlement: "timeout",
              })) {
                return true
              }
              solanaWalletCreateDetachedRef.current = true
              console.warn("[pinetree-wallets] wallet_dynamic_solana_create_timed_out", {
                reason,
                timeoutMs: dynamicChainCreateTimeoutMs,
                generation: solanaCreateGeneration,
              })
              emitWalletSetupDebugEvent("wallet_dynamic_solana_create_timed_out", {
                reason,
                timeoutMs: dynamicChainCreateTimeoutMs,
                generation: solanaCreateGeneration,
              })
              void solanaCreateCall.settlement.then((settled) => {
                solanaWalletCreateDetachedRef.current = false
                const pastTerminalSuccess =
                  walletCoreSetupTerminalGenerationRef.current !== null &&
                  solanaCreateGeneration <= walletCoreSetupTerminalGenerationRef.current
                if (!pastTerminalSuccess) {
                  solanaWalletCreateFailedRef.current = settled.status === "rejected"
                }
                logStaleDynamicCreateSettlement({
                  reason,
                  refreshMode,
                  label: "solana",
                  generation: solanaCreateGeneration,
                  startedAt: solanaCreateStartedAt,
                  settled,
                })
              })
            }
          }

          // A chain with an existing credential but no runtime wallet needs a restore,
          // never a duplicate create - the same forceClientRebuild path used above when
          // the runtime wallet count was zero.
          if (
            (hasBaseCredential && !hasBaseRuntimeWallet) ||
            (hasSolanaCredential && !hasSolanaRuntimeWallet)
          ) {
            refreshStage = "initialize_waas"
            await initializeWaas({ forceClientRebuild: true })
            setDynamicWalletRuntimeRefreshNonce((value) => value + 1)
          }

          console.info("[pinetree-wallets] wallet_dynamic_required_chains_complete", {
            reason,
            ...requiredChainState,
            attemptedBaseCreate,
            attemptedSolanaCreate,
          })
          emitWalletSetupDebugEvent("wallet_dynamic_required_chains_complete", {
            reason,
            ...requiredChainState,
            attemptedBaseCreate,
            attemptedSolanaCreate,
          })
          setCoreSetupStageLabel("Syncing wallet networks")
        }
      } else {
        // shouldAutoCreateEmbeddedWallet is the SDK's own signal for this decision - trust
        // it over userHasEmbeddedWallet() alone, which has been seen to report a wallet
        // exists for a brand-new user and silently no-op createOrRestoreSession() instead
        // of ever calling createEmbeddedWallet().
        const sdkWantsAutoCreate = safeBooleanCall(shouldAutoCreateEmbeddedWallet) === true
        if (userHasEmbeddedWallet() && !sdkWantsAutoCreate) {
          console.info("[pinetree-wallets] wallet_dynamic_create_or_restore_started", { reason, path: "legacy_restore" })
          emitWalletSetupDebugEvent("wallet_dynamic_create_or_restore_started", { reason, path: "legacy_restore" })
          await createOrRestoreSession()
          console.info("[pinetree-wallets] wallet_dynamic_create_or_restore_complete", { reason, path: "legacy_restore" })
          emitWalletSetupDebugEvent("wallet_dynamic_create_or_restore_complete", { reason, path: "legacy_restore" })
          setDynamicWalletRuntimeRefreshNonce((value) => value + 1)
        } else if (!creatingEmbeddedWalletRef.current) {
          // No embedded wallet exists yet - create one using the legacy embedded wallet API.
          creatingEmbeddedWalletRef.current = true
          try {
            if (walletCreationDebugEnabled) {
              console.info("[pinetree-wallets] provisioning_embedded_wallet_first_time", {
                reason,
                dynamicUserId: user.userId,
                useUserWalletsCountBefore: (wallets as unknown[]).length,
              })
            }
            console.info("[pinetree-wallets] wallet_dynamic_create_embedded_wallet_started", { reason, path: "legacy_create" })
            emitWalletSetupDebugEvent("wallet_dynamic_create_embedded_wallet_started", { reason, path: "legacy_create" })
            refreshStage = "create_embedded_wallet"
            await createEmbeddedWallet()
            console.info("[pinetree-wallets] wallet_dynamic_create_embedded_wallet_complete", { reason, path: "legacy_create" })
            emitWalletSetupDebugEvent("wallet_dynamic_create_embedded_wallet_complete", { reason, path: "legacy_create" })
            setDynamicWalletRuntimeRefreshNonce((value) => value + 1)
          } finally {
            creatingEmbeddedWalletRef.current = false
          }
        }
      }
      await refreshDynamicUser()
      setDynamicWalletRuntimeRefreshNonce((value) => value + 1)
      refreshStage = "hydrate_runtime"
      const hydrated = await waitForDynamicWalletRuntime(options)
      refreshStage = "detect_addresses"
      console.info("[pinetree-wallets] wallet_dynamic_wallets_refresh_complete", { reason, refreshMode, hydrated })
      emitWalletSetupDebugEvent("wallet_dynamic_wallets_refresh_complete", {
        reason,
        refreshMode,
        hydrated,
        runtimeWalletCount: dynamicWalletRuntimeCountRef.current,
      })
      if (walletCreationDebugEnabled) {
        const primaryWalletLike = primaryWallet as DynamicWalletLike | null
        const waasCredentials = getWaasWalletsByCredentials()
        const waasRuntimeWallets = getWaasWallets()
        console.info("[pinetree-wallets] dynamic_wallet_runtime_refreshed", {
          reason,
          dynamicUserId: user.userId,
          hydrated,
          dynamicWaasIsEnabled,
          shouldInitializeWaas,
          embeddedWalletSessionActive,
          embeddedWalletCredentialCount: waasCredentials.length,
          embeddedRuntimeWalletCount: waasRuntimeWallets.length,
          solanaWalletFound: waasRuntimeWallets.some((w) => {
            const wl = w as unknown as DynamicWalletLike
            return wl.chain === "SOL" || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(wl.address ?? ""))
          }),
          baseWalletFound: waasRuntimeWallets.some((w) => {
            const wl = w as unknown as DynamicWalletLike
            return wl.chain === "EVM" || /^0x[a-fA-F0-9]{40}$/.test(String(wl.address ?? ""))
          }),
          signerLookupResult: waasRuntimeWallets.length > 0 || Boolean(primaryWallet),
          dynamicWalletCountBeforeRender: (wallets as unknown[]).length,
          hasPrimaryWalletBeforeRender: Boolean(primaryWallet),
          primaryWallet: primaryWalletLike ? {
            address: primaryWalletLike.address ?? null,
            chain: primaryWalletLike.chain ?? null,
            key: primaryWalletLike.connector ? primaryWalletLike.connector.constructor?.name : null,
          } : null,
          waasConnectors: ["EVM", "SOL"].map((chain) => {
            try {
              const connector = getWaasWalletConnector(chain)
              return {
                chain,
                found: Boolean(connector),
                key: connector?.key ?? null,
                name: connector?.name ?? null,
                connectedChain: connector?.connectedChain ?? null,
              }
            } catch (error) {
              return {
                chain,
                found: false,
                error: error instanceof Error ? error.message : String(error),
              }
            }
          }),
        })
      }
      return hydrated
    } catch (error) {
      creatingEmbeddedWalletRef.current = false
      const pastTerminalSuccess =
        walletCoreSetupTerminalGenerationRef.current !== null &&
        generation <= walletCoreSetupTerminalGenerationRef.current
      if (pastTerminalSuccess) {
        // Core wallet setup already reached terminal success (Base + Solana + a
        // saved "ready" profile) since this generation started - a late throw from
        // this attempt (e.g. an unbounded Dynamic SDK call finally settling) must
        // never be reported as a fresh setup failure.
        const diagnostic = {
          reason,
          refreshMode,
          stage: refreshStage,
          generation,
          terminalSetupStatus: "ready" as const,
          runtimeWalletCountBefore: dynamicWalletRuntimeCountRef.current,
          runtimeWalletCountAfter: dynamicWalletRuntimeCountRef.current,
        }
        console.info("[pinetree-wallets] wallet_dynamic_late_result_ignored", diagnostic)
        emitWalletSetupDebugEvent("wallet_dynamic_late_result_ignored", diagnostic)
        return true
      }
      const classified = classifyDynamicRefreshError(error)
      console.warn("[pinetree-wallets] dynamic_wallet_runtime_refresh_failed", {
        reason,
        refreshMode,
        stage: refreshStage,
        errorName: classified.errorName ?? "unknown_error",
        ...(classified.errorCode ? { errorCode: classified.errorCode } : {}),
      })
      // Surface the throw server-side too - this is the "createWalletAccount /
      // createEmbeddedWallet threw but was swallowed client-side" case that's
      // otherwise invisible in Vercel logs from a mobile browser. A transient
      // refresh failure never resets pendingSync/walletCreationStep - the
      // separate wallet-address-detection effect proceeds independently as soon
      // as Base/Solana addresses are present, regardless of this return value.
      emitWalletSetupDebugEvent("wallet_dynamic_wallets_refresh_complete", {
        reason,
        refreshMode,
        hydrated: false,
        threw: true,
        stage: refreshStage,
        sdkLoaded: sdkHasLoaded,
        dynamicUserPresent: Boolean(user),
        runtimeWalletCountBefore: dynamicWalletRuntimeCountRef.current,
        runtimeWalletCountAfter: dynamicWalletRuntimeCountRef.current,
        errorName: classified.errorName ?? "unknown_error",
        ...(classified.errorCode ? { errorCode: classified.errorCode } : {}),
      })
      return false
    }
  }, [
    createEmbeddedWallet,
    createOrRestoreSession,
    createWalletAccount,
    dynamicNetworkAddresses,
    dynamicWaasIsEnabled,
    dynamicWalletSearchList,
    embeddedWalletSessionActive,
    getWaasWalletConnector,
    getWaasWallets,
    getWaasWalletsByCredentials,
    initializeWaas,
    logDynamicCreateLateResultIgnored,
    needsAutoCreateWalletChains,
    primaryWallet,
    refreshDynamicUser,
    sdkHasLoaded,
    shouldAutoCreateEmbeddedWallet,
    shouldInitializeWaas,
    user,
    userHasEmbeddedWallet,
    waitForDynamicWalletRuntime,
    wallets,
  ])

  // Single-flight wrapper: only one refreshDynamicWalletRuntimeImpl call runs at
  // a time. A caller that arrives while one is already running awaits the same
  // promise instead of starting a second concurrent SDK hydration - the race
  // that produced the intermittent "hydrated: false, threw: true, errorName:
  // TypeError" freeze in production.
  const refreshDynamicWalletRuntime = useCallback((reason: string, options?: { requireApprovalWallet?: boolean }): Promise<boolean> => {
    const refreshMode = options?.requireApprovalWallet ? "approval_wallet_hydration" : "normal_hydration"
    const runtimeWalletCountBefore = dynamicWalletRuntimeCountRef.current
    const alreadyInFlight = walletRuntimeRefreshInFlightRef.current[refreshMode]
    if (alreadyInFlight) {
      const meta = walletRuntimeRefreshMetaRef.current[refreshMode]
      const ageMs = meta ? Date.now() - meta.startedAt : 0
      const stale = ageMs >= dynamicHydrationSingleFlightTimeoutMs
      if (!stale) {
        const diagnostic = {
          refreshReason: reason,
          refreshMode,
          inFlightReused: true,
          stage: meta?.stage ?? "hydrate_runtime",
          generation: meta?.generation ?? null,
          ageMs,
          stale: false,
          sdkLoaded: sdkHasLoaded,
          dynamicUserPresent: Boolean(user),
          runtimeWalletCountBefore,
          runtimeWalletCountAfter: runtimeWalletCountBefore,
          errorName: null,
          errorCode: null,
        }
        console.info("[pinetree-wallets] wallet_dynamic_wallets_refresh_diagnostic", diagnostic)
        emitWalletSetupDebugEvent("wallet_dynamic_wallets_refresh_diagnostic", diagnostic)
        console.info("[pinetree-wallets] wallet_dynamic_refresh_singleflight_reused", diagnostic)
        emitWalletSetupDebugEvent("wallet_dynamic_refresh_singleflight_reused", diagnostic)
        return alreadyInFlight
      }
      // Stale: this promise has been running longer than
      // dynamicHydrationSingleFlightTimeoutMs. Evict it so this caller starts a fresh
      // attempt instead of awaiting a hung Dynamic SDK call forever - production logs
      // showed the same normal_hydration promise reused (inFlightReused: true) for
      // nearly a minute. The stale promise keeps running in the background; its own
      // `finally` below checks the generation and no-ops once superseded (requirement 4).
      const timedOutDiagnostic = {
        refreshReason: reason,
        refreshMode,
        stage: meta?.stage ?? "hydrate_runtime",
        generation: meta?.generation ?? null,
        ageMs,
        stale: true,
        runtimeWalletCountBefore,
        runtimeWalletCountAfter: runtimeWalletCountBefore,
      }
      console.warn("[pinetree-wallets] wallet_dynamic_refresh_singleflight_timed_out", timedOutDiagnostic)
      emitWalletSetupDebugEvent("wallet_dynamic_refresh_singleflight_timed_out", timedOutDiagnostic)
      walletRuntimeRefreshInFlightRef.current[refreshMode] = null
      walletRuntimeRefreshMetaRef.current[refreshMode] = null
      console.info("[pinetree-wallets] wallet_dynamic_refresh_singleflight_replaced", timedOutDiagnostic)
      emitWalletSetupDebugEvent("wallet_dynamic_refresh_singleflight_replaced", timedOutDiagnostic)
    }

    const generation = ++walletRuntimeRefreshGenerationRef.current
    const startedAt = Date.now()
    walletRuntimeRefreshMetaRef.current[refreshMode] = { generation, startedAt, stage: "hydrate_runtime" }
    console.info("[pinetree-wallets] wallet_dynamic_refresh_singleflight_started", {
      refreshReason: reason,
      refreshMode,
      generation,
      ageMs: 0,
      stale: false,
      runtimeWalletCountBefore,
      runtimeWalletCountAfter: runtimeWalletCountBefore,
    })
    emitWalletSetupDebugEvent("wallet_dynamic_refresh_singleflight_started", {
      refreshReason: reason,
      refreshMode,
      generation,
      ageMs: 0,
      stale: false,
      runtimeWalletCountBefore,
      runtimeWalletCountAfter: runtimeWalletCountBefore,
    })

    const runPromise = (async () => {
      let errorName: string | null = null
      let errorCode: string | null = null
      try {
        emitWalletSetupStageDiagnostic("wallet_create_runtime_hydration_started", "runtime_hydration")
        return await refreshDynamicWalletRuntimeImpl(reason, options, generation)
      } catch (error) {
        // Defensive net only - refreshDynamicWalletRuntimeImpl already catches
        // its own errors and returns false. This guards against an error
        // escaping before that try block (or a future change) ever reaching
        // concurrent awaiters as an unhandled rejection.
        const classified = classifyDynamicRefreshError(error)
        errorName = classified.errorName
        errorCode = classified.errorCode
        console.warn("[pinetree-wallets] wallet_dynamic_wallets_refresh_unexpected_error", {
          reason,
          errorName,
          errorCode,
        })
        return false
      } finally {
        emitWalletSetupStageDiagnostic("wallet_create_runtime_hydration_complete", "runtime_hydration")
        const runtimeWalletCountAfter = dynamicWalletRuntimeCountRef.current
        const diagnostic = {
          refreshReason: reason,
          refreshMode,
          inFlightReused: false,
          stage: "hydrate_runtime",
          sdkLoaded: sdkHasLoaded,
          dynamicUserPresent: Boolean(user),
          runtimeWalletCountBefore,
          runtimeWalletCountAfter,
          errorName,
          errorCode,
        }
        console.info("[pinetree-wallets] wallet_dynamic_wallets_refresh_diagnostic", diagnostic)
        emitWalletSetupDebugEvent("wallet_dynamic_wallets_refresh_diagnostic", {
          refreshReason: diagnostic.refreshReason,
          refreshMode: diagnostic.refreshMode,
          inFlightReused: diagnostic.inFlightReused,
          stage: diagnostic.stage,
          sdkLoaded: diagnostic.sdkLoaded,
          dynamicUserPresent: diagnostic.dynamicUserPresent,
          runtimeWalletCountBefore: diagnostic.runtimeWalletCountBefore,
          runtimeWalletCountAfter: diagnostic.runtimeWalletCountAfter,
          ...(errorName ? { errorName } : {}),
          ...(errorCode ? { errorCode } : {}),
        })
        // Guard against a stale/superseded promise's completion clearing a newer
        // in-flight record (requirement 4): only clear if this run's generation is
        // still the one currently tracked as active.
        const currentMeta = walletRuntimeRefreshMetaRef.current[refreshMode]
        if (currentMeta && currentMeta.generation === generation) {
          walletRuntimeRefreshInFlightRef.current[refreshMode] = null
          walletRuntimeRefreshMetaRef.current[refreshMode] = null
          const clearedDiagnostic = {
            refreshReason: reason,
            refreshMode,
            generation,
            ageMs: Date.now() - startedAt,
            stale: false,
            runtimeWalletCountBefore,
            runtimeWalletCountAfter,
          }
          // A long-running attempt (e.g. an unbounded Dynamic call that only just
          // settled) can still be clearing here well after setup already reached
          // terminal success elsewhere - production showed this take 129+ seconds.
          // Distinguish that case in the logs instead of reporting it as a normal
          // clear of active work.
          const pastTerminalSuccess =
            walletCoreSetupTerminalGenerationRef.current !== null &&
            generation <= walletCoreSetupTerminalGenerationRef.current
          if (pastTerminalSuccess) {
            console.info("[pinetree-wallets] wallet_dynamic_singleflight_cleared_after_success", clearedDiagnostic)
            emitWalletSetupDebugEvent("wallet_dynamic_singleflight_cleared_after_success", clearedDiagnostic)
          } else {
            console.info("[pinetree-wallets] wallet_dynamic_refresh_singleflight_cleared", clearedDiagnostic)
            emitWalletSetupDebugEvent("wallet_dynamic_refresh_singleflight_cleared", clearedDiagnostic)
          }
        }
      }
    })()

    walletRuntimeRefreshInFlightRef.current[refreshMode] = runPromise
    return runPromise
  }, [refreshDynamicWalletRuntimeImpl, sdkHasLoaded, user])

  const collectDynamicRuntimeWalletSnapshot = useCallback((): DynamicWalletLike[] => {
    let runtimeWaasWallets: unknown[] = []
    let credentialSignerWallets: DynamicWalletLike[] = []
    if (dynamicWaasIsEnabled) {
      try {
        runtimeWaasWallets = getWaasWallets() as unknown[]
      } catch {
        runtimeWaasWallets = []
      }
      try {
        credentialSignerWallets = getWaasWalletsByCredentials().flatMap((credential) => {
          const row = credential as unknown as Record<string, unknown>
          const chain = String(row.chain || "").toUpperCase()
          const connectorChain = chain === "EVM" || chain.includes("ETH") ? "EVM" : chain === "SOL" || chain === "SVM" ? "SOL" : null
          if (!connectorChain) return []
          const connector = getWaasWalletConnector(connectorChain)
          if (!connector) return []
          return [{
            id: safeString(row.id) ?? undefined,
            key: safeString(row.walletName) ?? undefined,
            chain: connectorChain,
            address: safeString(row.address) ?? undefined,
            connector: connector as unknown as DynamicWalletLike["connector"],
          } satisfies DynamicWalletLike]
        })
      } catch {
        credentialSignerWallets = []
      }
    }
    return getDynamicWalletSearchList(
      [...(wallets as unknown[]), ...runtimeWaasWallets, ...credentialSignerWallets],
      primaryWallet
    )
  }, [dynamicWaasIsEnabled, getWaasWalletConnector, getWaasWallets, getWaasWalletsByCredentials, primaryWallet, wallets])

  const buildDynamicWalletRuntimeSnapshot = useCallback((
    runtimeWallets?: DynamicWalletLike[],
    authenticatedOverride?: boolean,
    dynamicUserIdOverride?: string | null
  ): DynamicWalletRuntimeSnapshot => {
    const profile = profileState.kind === "loaded" ? profileState.profile : null
    const snapshotWallets = runtimeWallets ?? collectDynamicRuntimeWalletSnapshot()
    const authenticated = authenticatedOverride ?? Boolean(user)
    const dynamicUserId = dynamicUserIdOverride ?? user?.userId ?? null
    const matchingBaseWallet = profile?.base_address
      ? findDynamicApprovalWalletForSource(snapshotWallets, primaryWallet, "base", profile.base_address)
      : null
    const matchingSolanaWallet = profile?.solana_address
      ? findDynamicApprovalWalletForSource(snapshotWallets, primaryWallet, "solana", profile.solana_address)
      : null
    const profileDynamicUserId = String(profile?.dynamic_user_id || "").trim()
    const environmentId = String(process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID || "").trim()
    const walletCount = snapshotWallets.length
    const hydratedWalletAddresses = snapshotWallets.flatMap((wallet) => getDynamicWalletAddresses(wallet))
    const ownership = resolveDynamicWalletOwnership({
      pineTreeMerchantId: merchantId,
      currentDynamicUserId: dynamicUserId,
      storedDynamicUserId: profileDynamicUserId,
      externalUserId: dynamicExternalUserId,
      authenticated,
      sdkLoaded: sdkHasLoaded,
      walletCount,
      storedWalletAddresses: [profile?.base_address, profile?.solana_address],
      hydratedWalletAddresses,
      expectedEnvironmentId: environmentId,
      currentEnvironmentId: environmentId,
    })
    const identityMatches = ownership.failureReason !== "DYNAMIC_IDENTITY_MISMATCH"
      && ownership.failureReason !== "DYNAMIC_ENVIRONMENT_MISMATCH"
    const failureCode: DynamicWalletRuntimeFailureCode | null =
      !sdkHasLoaded
        ? "DYNAMIC_SDK_NOT_READY"
        : !authenticated
          ? "DYNAMIC_NOT_AUTHENTICATED"
          : !dynamicUserId
            ? "DYNAMIC_USER_NOT_FOUND"
            : ownership.failureReason

    return {
      authenticated,
      dynamicUserId,
      sdkLoaded: sdkHasLoaded,
      wallets: snapshotWallets,
      primaryWallet,
      walletCount,
      matchingBaseWallet,
      matchingSolanaWallet,
      identityMatches,
      environmentIdSuffix: environmentId ? environmentId.slice(-6) : null,
      failureCode,
      ownership,
    }
  }, [collectDynamicRuntimeWalletSnapshot, dynamicExternalUserId, merchantId, primaryWallet, profileState, sdkHasLoaded, user])

  const emitDynamicRuntimeStage = useCallback((event: string, details?: WalletSetupDebugDetails) => {
    emitWalletSetupDebugEvent(event, details)
  }, [])

  const ensureDynamicWalletRuntimeReady = useCallback(async (
    prepared: WithdrawalPrepareResponse,
    correlationId: string | null,
    requestId: string
  ): Promise<DynamicWalletRuntimeSnapshot> => {
    emitDynamicRuntimeStage("DYNAMIC_AUTH_CHECK_STARTED", {
      correlationId: correlationId || "none",
      requestId,
      rail: prepared.rail,
      asset: prepared.asset,
      sdkLoaded: sdkHasLoaded,
      dynamicAuthenticated: Boolean(user),
    })
    if (!sdkHasLoaded) {
      throw makeDynamicPostPrepareError("Dynamic wallet SDK is still loading.", "DYNAMIC_SDK_NOT_READY")
    }

    let runtimeUserPresent = Boolean(user)
    let runtimeDynamicUserId = user?.userId ?? null
    if (!runtimeUserPresent && pineTreeControlledDynamicAuthAvailable) {
      const token = accessTokenRef.current
      if (token && typeof signInWithExternalJwt === "function") {
        const payload = await requestPineTreeDynamicExternalJwtAuth(token, { walletDebug: walletSyncDebugQueryEnabled })
        const dynamicProfile = await signInWithExternalJwt({
          externalJwt: payload.externalJwt,
          externalUserId: payload.externalUserId,
        })
        runtimeUserPresent = Boolean(dynamicProfile)
        runtimeDynamicUserId = dynamicProfile?.userId ?? runtimeDynamicUserId
        await refreshDynamicUser().catch(() => undefined)
        emitDynamicRuntimeStage("DYNAMIC_AUTH_RESTORED", {
          correlationId: correlationId || "none",
          requestId,
          rail: prepared.rail,
          asset: prepared.asset,
          dynamicAuthenticated: runtimeUserPresent,
        })
      }
    }

    if (!runtimeUserPresent) {
      throw makeDynamicPostPrepareError("PineTree Wallet access is not authenticated.", "DYNAMIC_NOT_AUTHENTICATED")
    }

    emitDynamicRuntimeStage("DYNAMIC_USER_RESOLVED", {
      correlationId: correlationId || "none",
      requestId,
      rail: prepared.rail,
      asset: prepared.asset,
      dynamicUserIdSuffix: String(runtimeDynamicUserId || "").slice(-6) || null,
    })

    const beforeRefresh = buildDynamicWalletRuntimeSnapshot(undefined, runtimeUserPresent, runtimeDynamicUserId)
    if (!beforeRefresh.identityMatches) {
      emitDynamicRuntimeStage("DYNAMIC_IDENTITY_MISMATCH", {
        correlationId: correlationId || "none",
        requestId,
        rail: prepared.rail,
        asset: prepared.asset,
        walletCount: beforeRefresh.walletCount,
        dynamicUserIdSuffix: String(beforeRefresh.dynamicUserId || "").slice(-6) || null,
        currentDynamicUserIdSuffix: beforeRefresh.ownership.currentDynamicUserIdSuffix,
        storedDynamicUserIdSuffix: beforeRefresh.ownership.storedDynamicUserIdSuffix,
        storedWalletAddresses: dynamicWalletDiagnosticList(beforeRefresh.ownership.storedWalletAddresses),
        hydratedWalletAddresses: dynamicWalletDiagnosticList(beforeRefresh.ownership.hydratedWalletAddresses),
        failureReason: beforeRefresh.ownership.failureReason,
      })
      throw makeDynamicPostPrepareError(
        "PineTree found your wallet profile, but the active wallet session does not match the wallet owner. Reconnect the original PineTree Wallet session.",
        "DYNAMIC_IDENTITY_MISMATCH"
      )
    }
    emitDynamicRuntimeStage("DYNAMIC_IDENTITY_MATCHED", {
      correlationId: correlationId || "none",
      requestId,
      rail: prepared.rail,
      asset: prepared.asset,
      walletCount: beforeRefresh.walletCount,
      environmentIdSuffix: beforeRefresh.environmentIdSuffix,
      currentDynamicUserIdSuffix: beforeRefresh.ownership.currentDynamicUserIdSuffix,
      storedDynamicUserIdSuffix: beforeRefresh.ownership.storedDynamicUserIdSuffix,
    })

    emitDynamicRuntimeStage("DYNAMIC_WALLETS_HYDRATION_STARTED", {
      correlationId: correlationId || "none",
      requestId,
      rail: prepared.rail,
      asset: prepared.asset,
      walletCount: beforeRefresh.walletCount,
    })

    // A wallet count of 0 immediately after auth restoration is frequently
    // just the Dynamic SDK not having hydrated the session's wallets yet
    // (DYNAMIC_WALLETS_HYDRATING), not a genuine identity problem. Retry the
    // existing refresh mechanism a bounded number of times before giving up -
    // never poll indefinitely.
    const MAX_WALLET_HYDRATION_ATTEMPTS = 3
    const WALLET_HYDRATION_RETRY_DELAY_MS = 400
    let snapshot = beforeRefresh
    for (let attempt = 1; attempt <= MAX_WALLET_HYDRATION_ATTEMPTS; attempt++) {
      await refreshDynamicWalletRuntime("withdrawal_approval_runtime_ready", { requireApprovalWallet: true })
      const runtimeWallets = collectDynamicRuntimeWalletSnapshot()
      snapshot = buildDynamicWalletRuntimeSnapshot(runtimeWallets, runtimeUserPresent, runtimeDynamicUserId)
      emitDynamicRuntimeStage("DYNAMIC_WALLETS_HYDRATED", {
        correlationId: correlationId || "none",
        requestId,
        rail: prepared.rail,
        asset: prepared.asset,
        attempt,
        walletCount: snapshot.walletCount,
        matchingBaseWallet: Boolean(snapshot.matchingBaseWallet),
        matchingSolanaWallet: Boolean(snapshot.matchingSolanaWallet),
        currentDynamicUserIdSuffix: snapshot.ownership.currentDynamicUserIdSuffix,
        storedDynamicUserIdSuffix: snapshot.ownership.storedDynamicUserIdSuffix,
        storedWalletAddresses: dynamicWalletDiagnosticList(snapshot.ownership.storedWalletAddresses),
        hydratedWalletAddresses: dynamicWalletDiagnosticList(snapshot.ownership.hydratedWalletAddresses),
        ownershipFailureReason: snapshot.ownership.failureReason,
      })

      if (snapshot.failureCode !== "DYNAMIC_WALLETS_HYDRATING") {
        break
      }
      if (attempt < MAX_WALLET_HYDRATION_ATTEMPTS) {
        emitDynamicRuntimeStage("DYNAMIC_WALLETS_HYDRATION_RETRY", {
          correlationId: correlationId || "none",
          requestId,
          rail: prepared.rail,
          asset: prepared.asset,
          attempt,
          walletCount: snapshot.walletCount,
        })
        await new Promise((resolve) => setTimeout(resolve, WALLET_HYDRATION_RETRY_DELAY_MS * attempt))
      }
    }

    if (snapshot.failureCode === "DYNAMIC_IDENTITY_MISMATCH") {
      emitDynamicRuntimeStage("DYNAMIC_IDENTITY_MISMATCH", {
        correlationId: correlationId || "none",
        requestId,
        rail: prepared.rail,
        asset: prepared.asset,
        walletCount: snapshot.walletCount,
        dynamicUserIdSuffix: String(snapshot.dynamicUserId || "").slice(-6) || null,
        currentDynamicUserIdSuffix: snapshot.ownership.currentDynamicUserIdSuffix,
        storedDynamicUserIdSuffix: snapshot.ownership.storedDynamicUserIdSuffix,
        storedWalletAddresses: dynamicWalletDiagnosticList(snapshot.ownership.storedWalletAddresses),
        hydratedWalletAddresses: dynamicWalletDiagnosticList(snapshot.ownership.hydratedWalletAddresses),
        failureReason: snapshot.ownership.failureReason,
      })
      throw makeDynamicPostPrepareError(
        "PineTree found your wallet profile, but the active wallet session does not match the wallet owner. Reconnect the original PineTree Wallet session.",
        "DYNAMIC_IDENTITY_MISMATCH"
      )
    }
    if (snapshot.failureCode) {
      throw makeDynamicPostPrepareError(
        snapshot.failureCode === "DYNAMIC_WALLETS_MISSING"
          ? "Dynamic wallets are not available for this PineTree Wallet session. Reopen PineTree Wallet and try again."
          : "Dynamic wallets are still hydrating. Reopen PineTree Wallet and try again.",
        snapshot.failureCode
      )
    }

    const matchingPreparedWallet = findDynamicApprovalWalletForSource(
      snapshot.wallets,
      snapshot.primaryWallet,
      prepared.rail,
      prepared.sourceAddress
    )
    if (matchingPreparedWallet) {
      emitDynamicRuntimeStage("DYNAMIC_MATCHING_WALLET_FOUND", {
        correlationId: correlationId || "none",
        requestId,
        rail: prepared.rail,
        asset: prepared.asset,
        walletCount: snapshot.walletCount,
        sourceAddress: maskDiagnosticValue(prepared.sourceAddress),
      })
      return snapshot
    }

    throw makeDynamicPostPrepareError("No Dynamic wallet matched the prepared source address.", "WALLET_NOT_CONNECTED")
  }, [
    buildDynamicWalletRuntimeSnapshot,
    collectDynamicRuntimeWalletSnapshot,
    emitDynamicRuntimeStage,
    pineTreeControlledDynamicAuthAvailable,
    refreshDynamicUser,
    refreshDynamicWalletRuntime,
    sdkHasLoaded,
    signInWithExternalJwt,
    user,
    walletSyncDebugQueryEnabled,
  ])

  useEffect(() => {
    if (!sdkHasLoaded || !user || profileState.kind !== "loaded") return
    if (dynamicWalletRuntimeCount > 0) return
    const profile = profileState.profile
    if (!profile.base_address && !profile.solana_address) return
    const attemptKey = `${user.userId}:${profile.id}`
    if (dynamicHydrationAttemptRef.current === attemptKey) return
    dynamicHydrationAttemptRef.current = attemptKey
    void refreshDynamicWalletRuntime("profile_loaded_runtime_wallets_empty")
  }, [dynamicWalletRuntimeCount, profileState, refreshDynamicWalletRuntime, sdkHasLoaded, user])

  // --- Sync Dynamic wallet addresses (Base/Solana) to the merchant profile DB record ---
  const syncProfileFromDynamic = useCallback(async (options?: { requireBaseAndSolanaSigners?: boolean }) => {
    console.info("[pinetree-wallets] wallet_sync_start", {})
    emitWalletSetupDebugEvent("wallet_sync_start", {})
    const token = accessTokenRef.current
    if (!token || !user) {
      const diagnostics: ProfileSyncDiagnosticsState = {
        dynamicUserId: user?.userId ?? null,
        extractedBaseAddress: dynamicNetworkAddresses.base[0]?.address ?? null,
        extractedSolanaAddress: dynamicNetworkAddresses.solana[0]?.address ?? null,
        baseSignerFound: false,
        solanaSignerFound: false,
        didCallProfileEndpoint: false,
        profileEndpointStatus: null,
        profileEndpointResponse: null,
        skippedReason: !token ? "missing_supabase_auth_token" : "missing_dynamic_user",
        dynamicAuthenticated: Boolean(user),
        dynamicWalletRuntimeCount,
        waasRuntimeWalletCount: waasRuntimeWallets.length,
        waasCredentialWalletSourceCount: waasCredentialWalletSources.length,
        waasCredentialSignerWalletCount: waasCredentialSignerWallets.length,
        updatedAt: new Date().toISOString(),
      }
      setProfileSyncDiagnostics(diagnostics)
      console.info("[pinetree-wallets] profile_sync_not_called", diagnostics)
      // Explains the "JWT returned 200 but POST never happened" case: the profile sync
      // was attempted but bailed out before ever reaching the fetch call.
      emitWalletSetupDebugEvent("wallet_profile_sync_skipped_reason", { reason: diagnostics.skippedReason })
      logWalletCreationStep("failed", { reason: "missing_auth_context" })
      recordWalletSetupFailure(!token ? "pine_tree_auth_missing" : "dynamic_user_missing", "failed", {
        skippedReason: diagnostics.skippedReason,
      })
      return null
    }

    // Identity check runs first - before address extraction, signer lookup, profile
    // sync, or the provisioning timeout - so a wrong/unverifiable Dynamic email never
    // has a chance to fall through to the generic "could not finish" / timeout copy.
    // External-JWT sessions are exempt: the externalUser credential (JWT sub =
    // merchant_id) proves ownership; Dynamic email presentation is not authoritative.
    if (!dynamicSessionExternallyBound && merchantEmail && dynamicUserEmail && dynamicUserEmail !== merchantEmail) {
      const message = "Use your PineTree account email to verify wallet access."
      setIdentityMismatchError({ merchantEmail, dynamicEmail: dynamicUserEmail })
      setIdentityUnverified(false)
      setWalletIdentityError(message)
      clearWalletSetupInProgress()
      setProfileSyncDiagnostics({
        dynamicUserId: user.userId ?? null,
        dynamicEmail: dynamicUserEmail,
        merchantEmail,
        dynamicEmailSource,
        mismatchCheckRan: true,
        mismatchBlocked: true,
        extractedBaseAddress: null,
        extractedSolanaAddress: null,
        baseSignerFound: false,
        solanaSignerFound: false,
        didCallProfileEndpoint: false,
        profileEndpointStatus: null,
        profileEndpointResponse: null,
        skippedReason: "dynamic_email_mismatch",
        dynamicAuthenticated: true,
        dynamicWalletRuntimeCount,
        waasRuntimeWalletCount: waasRuntimeWallets.length,
        waasCredentialWalletSourceCount: waasCredentialWalletSources.length,
        waasCredentialSignerWalletCount: waasCredentialSignerWallets.length,
        updatedAt: new Date().toISOString(),
      })
      logWalletCreationStep("failed", {
        reason: "dynamic_email_mismatch",
        merchant_email_present: true,
        dynamic_email_present: true,
        dynamic_email_source: dynamicEmailSource,
        checked_before_address_extraction: true,
      })
      console.warn("[pinetree-wallets] profile_sync_identity_mismatch", {
        reason: "dynamic_email_mismatch",
        merchantEmailPresent: true,
        dynamicEmailPresent: true,
        dynamicEmailSource,
      })
      recordWalletSetupFailure("dynamic_email_mismatch", "dynamic_identity_mismatch", {
        dynamicEmailSource,
      })
      emitWalletSetupDebugEvent("wallet_profile_sync_skipped_reason", { reason: "dynamic_email_mismatch" })
      return null
    }
    if (!dynamicSessionExternallyBound && (!merchantEmail || !dynamicUserEmail)) {
      const skippedReason = !merchantEmail ? "missing_pinetree_merchant_email" : "missing_dynamic_user_email"
      setIdentityMismatchError(null)
      setIdentityUnverified(true)
      setWalletIdentityError("We could not verify that this wallet session matches your PineTree account email.")
      clearWalletSetupInProgress()
      setProfileSyncDiagnostics({
        dynamicUserId: user.userId ?? null,
        dynamicEmail: dynamicUserEmail,
        merchantEmail,
        dynamicEmailSource,
        mismatchCheckRan: true,
        mismatchBlocked: true,
        extractedBaseAddress: null,
        extractedSolanaAddress: null,
        baseSignerFound: false,
        solanaSignerFound: false,
        didCallProfileEndpoint: false,
        profileEndpointStatus: null,
        profileEndpointResponse: null,
        skippedReason,
        dynamicAuthenticated: true,
        dynamicWalletRuntimeCount,
        waasRuntimeWalletCount: waasRuntimeWallets.length,
        waasCredentialWalletSourceCount: waasCredentialWalletSources.length,
        waasCredentialSignerWalletCount: waasCredentialSignerWallets.length,
        updatedAt: new Date().toISOString(),
      })
      logWalletCreationStep("failed", {
        reason: skippedReason,
        merchant_email_present: Boolean(merchantEmail),
        dynamic_email_present: Boolean(dynamicUserEmail),
        dynamic_email_source: dynamicEmailSource,
        checked_before_address_extraction: true,
      })
      console.warn("[pinetree-wallets] profile_sync_identity_unverified", {
        reason: skippedReason,
        merchantEmailPresent: Boolean(merchantEmail),
        dynamicEmailPresent: Boolean(dynamicUserEmail),
      })
      recordWalletSetupFailure(!merchantEmail ? "merchant_email_missing" : "dynamic_email_missing", "dynamic_identity_unverified", {
        dynamicEmailSource,
      })
      emitWalletSetupDebugEvent("wallet_profile_sync_skipped_reason", { reason: skippedReason })
      return null
    }

    if (
      dynamicNetworkAddresses.base.length === 0 &&
      dynamicNetworkAddresses.solana.length === 0 &&
      dynamicNetworkAddresses.bitcoin.length === 0
    ) {
      const diagnostics: ProfileSyncDiagnosticsState = {
        dynamicUserId: user.userId ?? null,
        extractedBaseAddress: null,
        extractedSolanaAddress: null,
        baseSignerFound: false,
        solanaSignerFound: false,
        didCallProfileEndpoint: false,
        profileEndpointStatus: null,
        profileEndpointResponse: null,
        skippedReason: "no_wallet_addresses_detected",
        dynamicAuthenticated: true,
        dynamicWalletRuntimeCount,
        waasRuntimeWalletCount: waasRuntimeWallets.length,
        waasCredentialWalletSourceCount: waasCredentialWalletSources.length,
        waasCredentialSignerWalletCount: waasCredentialSignerWallets.length,
        updatedAt: new Date().toISOString(),
      }
      setProfileSyncDiagnostics(diagnostics)
      console.info("[pinetree-wallets] profile_sync_not_called", {
        ...diagnostics,
        reason: "no_wallet_addresses_detected",
        dynamicUserIdPresent: Boolean(user.userId),
        baseAddressPresent: false,
        solanaAddressPresent: false,
        useUserWalletsCount: (wallets as unknown[]).length,
      })
      if (repairInProgress) {
        console.info("[pinetree-wallets] repair_dynamic_wallets_missing_after_provisioning", {
          dynamicUserId: user.userId,
          dynamicWalletCountAfterProvisioning: dynamicWalletRuntimeCountRef.current,
        })
        setRepairInProgress(false)
        setRepairFailedIncomplete(true)
      }
      logWalletCreationStep("waiting_for_embedded_wallets", { reason: "no_wallet_addresses_detected" })
      return null
    }

    setSyncing(true)
    logWalletCreationStep("extracting_addresses")
    let keepPendingSync = false
    try {
      const baseAddress = dynamicNetworkAddresses.base[0]?.address ?? null
      const solanaAddress = dynamicNetworkAddresses.solana[0]?.address ?? null
      const baseSigner = baseAddress
        ? await findDynamicApprovalWalletForSourceAsync(dynamicWalletSearchList as unknown[], primaryWallet, "base", baseAddress)
        : null
      const solanaSigner = solanaAddress
        ? await findDynamicApprovalWalletForSourceAsync(dynamicWalletSearchList as unknown[], primaryWallet, "solana", solanaAddress)
        : null
      const baseDiagnostics: ProfileSyncDiagnosticsState = {
        dynamicUserId: user.userId ?? null,
        dynamicEmail: dynamicUserEmail,
        merchantEmail,
        extractedBaseAddress: baseAddress,
        extractedSolanaAddress: solanaAddress,
        baseSignerFound: Boolean(baseSigner),
        solanaSignerFound: Boolean(solanaSigner),
        didCallProfileEndpoint: false,
        profileEndpointStatus: null,
        profileEndpointResponse: null,
        skippedReason: null,
        dynamicAuthenticated: true,
        dynamicWalletRuntimeCount,
        waasRuntimeWalletCount: waasRuntimeWallets.length,
        waasCredentialWalletSourceCount: waasCredentialWalletSources.length,
        waasCredentialSignerWalletCount: waasCredentialSignerWallets.length,
        updatedAt: new Date().toISOString(),
      }
      setProfileSyncDiagnostics(baseDiagnostics)
      console.info("[pinetree-wallets] profile_sync_dynamic_state", {
        ...baseDiagnostics,
        dynamicUserIdPresent: Boolean(user.userId),
        baseAddressPresent: Boolean(baseAddress),
        solanaAddressPresent: Boolean(solanaAddress),
        useUserWalletsCount: (wallets as unknown[]).length,
        profileSyncEndpoint: "/api/wallets/pinetree-profile",
      })
      if (options?.requireBaseAndSolanaSigners && (!baseAddress || !solanaAddress || !baseSigner || !solanaSigner)) {
        keepPendingSync = true
        const skippedReason = !baseAddress
          ? "missing_base_address"
          : !solanaAddress
            ? "missing_solana_address"
            : !baseSigner
              ? "missing_base_runtime_signer"
              : "missing_solana_runtime_signer"
        setProfileSyncDiagnostics({
          ...baseDiagnostics,
          skippedReason,
          updatedAt: new Date().toISOString(),
        })
        if (repairInProgress) {
          console.info("[pinetree-wallets] repair_signer_verification_failed", {
            dynamicUserId: user.userId,
            dynamicWalletCountAfterProvisioning: dynamicWalletRuntimeCountRef.current,
            baseAddressPresent: Boolean(baseAddress),
            solanaAddressPresent: Boolean(solanaAddress),
            baseSignerFound: Boolean(baseSigner),
            solanaSignerFound: Boolean(solanaSigner),
            waasCredentialWalletSourceCount: waasCredentialWalletSources.length,
          })
          setRepairInProgress(false)
          setRepairFailedIncomplete(true)
        }
        logWalletCreationStep("waiting_for_embedded_wallets", {
          reason: "embedded_signers_missing",
          base_address_present: Boolean(baseAddress),
          solana_address_present: Boolean(solanaAddress),
          base_signer_ready: Boolean(baseSigner),
          solana_signer_ready: Boolean(solanaSigner),
        })
        console.info("[pinetree-wallets] profile_sync_not_called", {
          ...baseDiagnostics,
          skippedReason,
          reason: "embedded_signers_missing",
          dynamicUserIdPresent: Boolean(user.userId),
          baseAddressPresent: Boolean(baseAddress),
          solanaAddressPresent: Boolean(solanaAddress),
          useUserWalletsCount: (wallets as unknown[]).length,
        })
        return null
      }
      const body: Record<string, unknown> = {
        dynamic_user_id: user.userId,
        dynamic_external_user_id: dynamicExternalUserId,
        dynamic_email: dynamicUserEmail,
        merchant_email: merchantEmail,
        base_address: baseAddress,
        solana_address: solanaAddress,
      }
      const profilePostKey = [
        user.userId || "",
        dynamicExternalUserId || "",
        dynamicUserEmail || "",
        merchantEmail || "",
        baseAddress || "",
        solanaAddress || "",
      ].join("|")
      if (profilePostInFlightKeyRef.current === profilePostKey) {
        console.info("[pinetree-wallets] wallet_profile_post_deduped_in_flight", {
          dynamicUserIdPresent: Boolean(user.userId),
          dynamicEmailPresent: Boolean(dynamicUserEmail),
          merchantEmailPresent: Boolean(merchantEmail),
          baseAddressPresent: Boolean(baseAddress),
          solanaAddressPresent: Boolean(solanaAddress),
        })
        emitWalletSetupDebugEvent("wallet_profile_sync_skipped_reason", { reason: "profile_post_in_flight" })
        keepPendingSync = true
        return null
      }
      console.info("[pinetree-wallets] profile_sync_request", {
        endpoint: "/api/wallets/pinetree-profile",
        dynamicUserIdPresent: Boolean(user.userId),
        dynamicEmailPresent: Boolean(dynamicUserEmail),
        merchantEmailPresent: Boolean(merchantEmail),
        baseAddressPresent: Boolean(baseAddress),
        solanaAddressPresent: Boolean(solanaAddress),
      })
      setProfileSyncDiagnostics({
        ...baseDiagnostics,
        didCallProfileEndpoint: true,
        updatedAt: new Date().toISOString(),
      })
      logWalletCreationStep("syncing_pinetree_profile", {
        profile_sync_request_sent: true,
      })
      console.info("[pinetree-wallets] wallet_profile_post_attempting", {})
      setCoreSetupStageLabel("Finishing PineTree Wallet setup")
      profilePostInFlightKeyRef.current = profilePostKey
      emitWalletSetupStageDiagnostic("wallet_create_profile_sync_started", "profile_sync_started")
      emitWalletSetupDebugEvent("wallet_profile_post_attempting", {})
      emitWalletSetupDebugEvent("wallet_core_profile_post_started", {})
      const profileSaveStartedAt = Date.now()
      const res = await fetch("/api/wallets/pinetree-profile", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      })
      console.info("[pinetree-wallets] setup_timing", {
        merchant_id: merchantId,
        step: "pinetree_profile_save",
        duration_ms: Date.now() - profileSaveStartedAt,
      })
      const responseText = await res.text()
      let responseBody: unknown = responseText
      try {
        responseBody = responseText ? JSON.parse(responseText) : null
      } catch {
        responseBody = responseText
      }
      setProfileSyncDiagnostics({
        ...baseDiagnostics,
        didCallProfileEndpoint: true,
        profileEndpointStatus: res.status,
        profileEndpointResponse: responseBody,
        providerSyncStatus: getProviderSyncStatus(responseBody),
        updatedAt: new Date().toISOString(),
      })
      console.info("[pinetree-wallets] profile_sync_response", {
        endpoint: "/api/wallets/pinetree-profile",
        status: res.status,
        ok: res.ok,
        body: responseBody,
      })
      emitWalletSetupDebugEvent("wallet_profile_post_response", {
        status: res.status,
        ok: res.ok,
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
        const providerSyncStatus = getProviderSyncStatus(responseBody)
        const json = responseBody as { profile: PineTreeWalletProfile }
        const wasPersistedResume = setupStartedInThisBrowser()
        emitWalletSetupStageDiagnostic("wallet_create_profile_sync_complete", "profile_sync_complete")
        console.info("[pinetree-wallets] profile_sync_success", {
          profileId: json.profile.id,
          dynamicUserIdPersisted: Boolean(json.profile.dynamic_user_id),
          baseAddressPersisted: Boolean(json.profile.base_address),
          solanaAddressPersisted: Boolean(json.profile.solana_address),
          status: json.profile.status,
        })
        emitWalletSetupDebugEvent("wallet_core_profile_post_success", { status: json.profile.status })
        setWalletIdentityError("")
        setIdentityMismatchError(null)
        setIdentityUnverified(false)
        clearWalletSetupInProgress()
        setProfileState({ kind: "loaded", profile: json.profile })
        setProfileSyncDiagnostics({
          ...baseDiagnostics,
          didCallProfileEndpoint: true,
          profileEndpointStatus: res.status,
          profileEndpointResponse: responseBody,
          providerSyncStatus,
          updatedAt: new Date().toISOString(),
        })
        if (providerSyncStatus === "failed") {
          recordWalletSetupFailure("provider_sync_failed", "syncing_providers", {
            profileEndpointStatus: res.status,
            providerSyncStatus,
          })
          logWalletCreationStep("failed", { reason: "provider_sync_failed" })
          return null
        }
        if (repairInProgress) {
          console.info("[pinetree-wallets] repair_profile_saved_with_new_addresses", {
            previousProfileId: repairProfileIdRef.current,
            dynamicUserId: user.userId,
            dynamicWalletCountAfterProvisioning: dynamicWalletRuntimeCountRef.current,
            baseAddressPresent: Boolean(json.profile.base_address),
            solanaAddressPresent: Boolean(json.profile.solana_address),
            baseSignerFound: Boolean(baseSigner),
            solanaSignerFound: Boolean(solanaSigner),
          })
          setRepairInProgress(false)
          setRepairFailedIncomplete(false)
          repairProfileIdRef.current = null
        }
        logWalletCreationStep("profile_synced", {
          profile_sync_response_status: res.status,
          profile_has_base: Boolean(json.profile.base_address),
          profile_has_solana: Boolean(json.profile.solana_address),
          profile_has_btc: Boolean(json.profile.btc_address),
        })
        if (json.profile.status === "ready") {
          if (wasPersistedResume) {
            emitWalletSetupStageDiagnostic("wallet_create_resume_complete", "resume_profile_sync_complete")
          }
          setWalletSetupStage("ready")
          setWalletSetupFailureReason(null)
          setSyncing(false)
          setPendingSync(false)
          emitWalletSetupDebugEvent("wallet_core_create_success", { status: json.profile.status })
          // A merchant-initiated create/retry/native-auth-resume attempt just
          // finished - open the wallet rather than leaving the setup card (and a
          // possibly stale "Try Again") on screen. Page-load auto-repair never
          // sets the flag, so background saves don't pop the modal.
          if (autoOpenWalletAfterCreateRef.current) {
            autoOpenWalletAfterCreateRef.current = false
            schedulePineTreeWalletModalOpenAfterProgress("profile_ready_after_create")
          }
        }
        // Fire rail sync in the background so merchant_wallets stays in sync with
        // the PineTree Wallet profile without blocking the UI response. Deduped
        // per unique address set so overlapping successful profile saves (e.g. an
        // initial attempt and a native-auth resume both landing "ready") never
        // fire more than one rail-sync call for the same wallet.
        runRailSyncOnceForProfile(json.profile, token)
        return json.profile
      }
      const mismatchResponse = getDynamicEmailMismatchResponse(responseBody)
      if (mismatchResponse) {
        const message = "Use your PineTree account email to verify wallet access."
        setIdentityMismatchError(mismatchResponse)
        setIdentityUnverified(false)
        setWalletIdentityError(message)
        clearWalletSetupInProgress()
        setProfileSyncDiagnostics({
          ...baseDiagnostics,
          didCallProfileEndpoint: true,
          profileEndpointStatus: res.status,
          profileEndpointResponse: responseBody,
          providerSyncStatus: getProviderSyncStatus(responseBody),
          skippedReason: "dynamic_email_mismatch",
          updatedAt: new Date().toISOString(),
        })
        logWalletCreationStep("failed", { profile_sync_response_status: res.status, reason: "dynamic_email_mismatch" })
        recordWalletSetupFailure("dynamic_email_mismatch", "dynamic_identity_mismatch", {
          profileEndpointStatus: res.status,
        })
        return null
      }
      if (isWalletAddressConflictResponse(responseBody)) {
        setIdentityMismatchError(null)
        setIdentityUnverified(false)
        setWalletIdentityError(stalePineTreeWalletSetupMessage)
        clearWalletSetupInProgress()
        recordWalletSetupFailure("wallet_address_conflict", "failed", {
          profileEndpointStatus: res.status,
        })
        logWalletCreationStep("failed", {
          profile_sync_response_status: res.status,
          reason: "wallet_address_conflict",
        })
        return null
      }
      if (isWalletIdentityUnavailableResponse(responseBody)) {
        setIdentityMismatchError(null)
        setIdentityUnverified(true)
        setWalletIdentityError("We could not verify wallet access. Please try again.")
        clearWalletSetupInProgress()
        recordWalletSetupFailure("merchant_email_missing", "dynamic_identity_unverified", {
          profileEndpointStatus: res.status,
        })
        logWalletCreationStep("failed", {
          profile_sync_response_status: res.status,
          reason: "wallet_identity_unavailable",
        })
        return null
      }
      if (res.status === 409 && String((responseBody as { code?: unknown } | null)?.code || "") === "business_profile_required") {
        setIdentityMismatchError(null)
        setIdentityUnverified(false)
        setWalletIdentityError("")
        setBusinessProfileReadiness({ kind: "loaded", complete: false, status: "incomplete" })
        blockWalletSetupForBusinessProfile("profile_post_business_profile_required")
        emitWalletSetupDebugEvent("wallet_profile_post_blocked_business_profile_required", { status: res.status })
        return null
      }
      console.warn("[pinetree-wallets] profile_sync_failed", {
        endpoint: "/api/wallets/pinetree-profile",
        status: res.status,
      })
      recordWalletSetupFailure("profile_sync_failed", "syncing_profile", {
        profileEndpointStatus: res.status,
      })
      logWalletCreationStep("failed", { profile_sync_response_status: res.status })
      return null
    } finally {
      profilePostInFlightKeyRef.current = null
      setSyncing(false)
      if (!keepPendingSync) setPendingSync(false)
    }
  }, [user, wallets, primaryWallet, dynamicWalletSearchList, dynamicNetworkAddresses, dynamicWalletRuntimeCount, waasRuntimeWallets.length, waasCredentialWalletSources.length, waasCredentialSignerWallets.length, repairInProgress, logWalletCreationStep, fetchProviderRailState, merchantEmail, dynamicUserEmail, dynamicEmailSource, dynamicSessionExternallyBound, dynamicExternalUserId, recordWalletSetupFailure])

  // --- Post-reconnect wallet match check ---
  // Fires when Dynamic loads wallets after setShowAuthFlow(true). Clears the reconnect
  // pending flag immediately so it only runs once per reconnect attempt.
  useEffect(() => {
    if (!withdrawalReconnectPending) return
    if (dynamicWalletRuntimeCount === 0) return
    setWithdrawalReconnectPending(false)
    const sourceAddress = withdrawalReconnectSourceRef.current
    if (!sourceAddress) {
      setWithdrawalScreen("form")
      return
    }
    const matched = findDynamicApprovalWalletForSource(wallets as unknown[], primaryWallet, withdrawalRail, sourceAddress)
    if (walletCreationDebugEnabled) {
      const walletList = wallets as DynamicWalletLike[]
      console.info("[pinetree-withdrawals] reconnect_after", {
        dynamicWalletCountAfter: wallets.length,
        hasPrimaryWallet: Boolean(primaryWallet),
        sourceAddressPrefix: sourceAddress.slice(0, 8),
        dynamicWalletAddressPrefixesAfter: walletList.map((w) =>
          getDynamicWalletAddresses(w)
            .map((a) => a.slice(0, 8))
            .join(",")
        ),
        matchingWalletFound: Boolean(matched),
      })
    }
    void (async () => {
      if (matched) {
        await syncProfileFromDynamic()
        setWithdrawalScreen(withdrawalReview ? "review" : "form")
        setWithdrawalApprovalError("")
      } else {
        setWithdrawalApprovalError(
          "This browser is connected to a different PineTree Wallet session. Restore the PineTree Wallet used for this merchant, then try again."
        )
        setWithdrawalScreen("failed")
      }
    })()
  }, [dynamicWalletRuntimeCount, wallets, primaryWallet, withdrawalRail, withdrawalReconnectPending, withdrawalReview, syncProfileFromDynamic])

  // --- Identity check gate: runs the instant Dynamic auth completes, before wallet
  // address extraction, signer lookup, profile sync, or the provisioning timeout ever
  // get a chance to run. Unlike wallet addresses (which take time to provision), the
  // Dynamic email is available synchronously with `user`, so there's no reason to wait.
  useEffect(() => {
    if (!pendingSync || !sdkHasLoaded || !user || !merchantEmail) return
    if (dynamicUserEmail && dynamicUserEmail === merchantEmail) return
    // External-JWT sessions are bound to the merchant by the externalUser
    // credential (JWT sub = merchant_id) - a missing/differently-surfaced Dynamic
    // email must not fail a session PineTree itself signed in.
    if (dynamicSessionExternallyBound) return

    pendingWalletProvisionStartedAtRef.current = null
    pendingWalletProvisionAttemptRef.current = null
    pendingProfileSyncAttemptRef.current = false
    setFinalProvisioningRefreshAttempted(false)
    setPendingSync(false)
    setSyncing(false)
    clearWalletSetupInProgress()

    if (dynamicUserEmail && dynamicUserEmail !== merchantEmail) {
      setIdentityMismatchError({ merchantEmail, dynamicEmail: dynamicUserEmail })
      setIdentityUnverified(false)
      setWalletIdentityError("Use your PineTree account email to verify wallet access.")
      recordWalletSetupFailure("dynamic_email_mismatch", "dynamic_identity_mismatch", {
        dynamicEmailSource,
      })
    } else {
      setIdentityMismatchError(null)
      setIdentityUnverified(true)
      setWalletIdentityError("We could not verify that this wallet session matches your PineTree account email.")
      recordWalletSetupFailure("dynamic_email_missing", "dynamic_identity_unverified", {
        dynamicEmailSource,
      })
    }
    setProfileSyncDiagnostics((prev) => ({
      ...prev,
      dynamicUserId: user.userId ?? null,
      dynamicEmail: dynamicUserEmail,
      merchantEmail,
      dynamicEmailSource,
      mismatchCheckRan: true,
      mismatchBlocked: true,
      skippedReason: dynamicUserEmail ? "dynamic_email_mismatch" : "missing_dynamic_user_email",
      dynamicAuthenticated: true,
      updatedAt: new Date().toISOString(),
    }))
    logWalletCreationStep("failed", {
      reason: dynamicUserEmail ? "dynamic_email_mismatch" : "missing_dynamic_user_email",
      dynamic_email_source: dynamicEmailSource,
      checked_before_address_extraction: true,
    })
  }, [pendingSync, sdkHasLoaded, user, merchantEmail, dynamicUserEmail, dynamicEmailSource, dynamicSessionExternallyBound, logWalletCreationStep, recordWalletSetupFailure])

  // --- After wallet creation: retry Dynamic hydration before syncing addresses to DB ---
  useEffect(() => {
    if (!pendingSync) {
      pendingWalletProvisionStartedAtRef.current = null
      pendingWalletProvisionAttemptRef.current = null
      pendingProfileSyncAttemptRef.current = false
      walletSetupStartInFlightRef.current = null
      setFinalProvisioningRefreshAttempted(false)
      return
    }
    if (!sdkHasLoaded) {
      logWalletCreationStep("opening_dynamic", { reason: "sdk_not_loaded" })
      return
    }
    if (!user) {
      logWalletCreationStep("waiting_for_dynamic_auth")
      return
    }

    if (!pendingWalletProvisionStartedAtRef.current) {
      pendingWalletProvisionStartedAtRef.current = Date.now()
      setProvisioningRetryExhausted(false)
      logWalletCreationStep("provisioning_wallet", { reason: "dynamic_auth_complete" })
    }

    const provisionAttemptKey = `${user.userId}:${repairInProgress ? "repair" : "create"}`
    const refreshReason = repairInProgress ? "repair_provision_embedded_wallets" : "create_provision_embedded_wallets"
    if (pendingWalletProvisionAttemptRef.current !== provisionAttemptKey) {
      pendingWalletProvisionAttemptRef.current = provisionAttemptKey
      void refreshDynamicWalletRuntime(refreshReason, { requireApprovalWallet: false })
    }

    const timer = window.setInterval(() => {
      logWalletCreationStep("provisioning_wallet", {
        reason: "dynamic_wallet_hydration_retry",
        retry_interval_ms: walletProvisioningRetryIntervalMs,
      })
      void refreshDynamicWalletRuntime(refreshReason, { requireApprovalWallet: false })
    }, walletProvisioningRetryIntervalMs)

    return () => window.clearInterval(timer)
  }, [pendingSync, sdkHasLoaded, user, repairInProgress, refreshDynamicWalletRuntime, logWalletCreationStep])

  useEffect(() => {
    if (!pendingSync || !sdkHasLoaded || !user || pendingProfileSyncAttemptRef.current) return
    let cancelled = false

    void (async () => {
      const baseAddress = dynamicNetworkAddresses.base[0]?.address ?? null
      const solanaAddress = dynamicNetworkAddresses.solana[0]?.address ?? null

      if (cancelled || pendingProfileSyncAttemptRef.current) return

      console.info("[pinetree-wallets] wallet_dynamic_wallets_detected_count", {
        count: dynamicWalletRuntimeCount,
      })
      emitWalletSetupDebugEvent("wallet_dynamic_wallets_detected_count", {
        count: dynamicWalletRuntimeCount,
      })
      console.info("[pinetree-wallets] wallet_dynamic_base_address_detected", {
        detected: Boolean(baseAddress),
      })
      emitWalletSetupDebugEvent("wallet_dynamic_base_address_detected", {
        detected: Boolean(baseAddress),
      })
      console.info("[pinetree-wallets] wallet_dynamic_solana_address_detected", {
        detected: Boolean(solanaAddress),
      })
      emitWalletSetupDebugEvent("wallet_dynamic_solana_address_detected", {
        detected: Boolean(solanaAddress),
      })

      if (!baseAddress || !solanaAddress) {
        const missingReason = !baseAddress && !solanaAddress
          ? "missing_base_and_solana"
          : !baseAddress
            ? "missing_base"
            : "missing_solana"
        console.info("[pinetree-wallets] wallet_dynamic_missing_required_addresses", {
          missingBase: !baseAddress,
          missingSolana: !solanaAddress,
        })
        emitWalletSetupDebugEvent("wallet_dynamic_missing_required_addresses", {
          missingBase: !baseAddress,
          missingSolana: !solanaAddress,
          runtimeWalletCount: dynamicWalletRuntimeCount,
        })
        console.info("[pinetree-wallets] wallet_profile_sync_skipped_reason", {
          reason: missingReason,
        })
        emitWalletSetupDebugEvent("wallet_profile_sync_skipped_reason", { reason: missingReason })
        logWalletCreationStep("provisioning_wallet", {
          reason: "waiting_for_dynamic_addresses",
          base_address_present: Boolean(baseAddress),
          solana_address_present: Boolean(solanaAddress),
        })
        return
      }

      const detectionStartedAt = pendingWalletProvisionStartedAtRef.current
      console.info("[pinetree-wallets] setup_timing", {
        merchant_id: merchantId,
        step: "dynamic_wallet_detection",
        duration_ms: detectionStartedAt ? Date.now() - detectionStartedAt : 0,
      })
      pendingProfileSyncAttemptRef.current = true
      pendingWalletProvisionAttemptRef.current = null
      emitWalletSetupStageDiagnostic("wallet_create_addresses_detected", "addresses_detected")
      console.info("[pinetree-wallets] wallet_dynamic_addresses_detected", {
        baseAddressPresent: true,
        solanaAddressPresent: true,
      })
      console.info("[pinetree-wallets] wallet_profile_sync_eligible", {})
      emitWalletSetupDebugEvent("wallet_profile_sync_eligible", {})
      logWalletCreationStep("wallets_detected")
      if (repairInProgress) {
        console.info("[pinetree-wallets] repair_dynamic_wallets_after_provisioning", {
          previousProfileId: repairProfileIdRef.current,
          dynamicUserId: user.userId,
          dynamicWalletCountAfterProvisioning: dynamicWalletRuntimeCount,
        })
      }
      if (setupStartedInThisBrowser()) {
        emitWalletSetupStageDiagnostic("wallet_create_resume_profile_sync_started", "resume_profile_sync_started")
      }
      const syncedProfile = await syncProfileFromDynamic()
      if (!syncedProfile && !cancelled) {
        pendingProfileSyncAttemptRef.current = false
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    pendingSync,
    sdkHasLoaded,
    user,
    dynamicNetworkAddresses,
    repairInProgress,
    dynamicWalletRuntimeCount,
    syncProfileFromDynamic,
    logWalletCreationStep,
  ])

  function inferWalletSetupFailureReason(): WalletSetupFailureReason {
    if (!accessTokenRef.current) return "pine_tree_auth_missing"
    if (!user) return "dynamic_auth_missing"
    if (!user.userId) return "dynamic_user_missing"
    if (!dynamicSessionExternallyBound) {
      if (!merchantEmail) return "merchant_email_missing"
      if (!dynamicUserEmail) return "dynamic_email_missing"
      if (dynamicUserEmail !== merchantEmail) return "dynamic_email_mismatch"
    }
    if (dynamicWalletRuntimeCount === 0) return "no_dynamic_wallets"

    const baseAddress = dynamicNetworkAddresses.base[0]?.address ?? null
    const solanaAddress = dynamicNetworkAddresses.solana[0]?.address ?? null
    // A runtime wallet exists (dynamicWalletRuntimeCount > 0, checked above) but one or
    // both required chain addresses are still missing - the exact production symptom
    // (runtimeWalletCount: 1, missingBase/missingSolana: true). Prefer the specific
    // per-chain explicit-create failure reason when one was actually attempted and
    // failed, over the generic address-missing reasons below.
    if (!baseAddress && !solanaAddress) return "dynamic_required_chains_incomplete"
    if (!baseAddress) {
      if (baseWalletCreateFailedRef.current) return "dynamic_base_creation_failed"
      return "base_address_missing"
    }
    if (!solanaAddress) {
      if (solanaWalletCreateFailedRef.current) return "dynamic_solana_creation_failed"
      return "solana_address_missing"
    }

    const baseSigner = findDynamicApprovalWalletForSource(wallets as unknown[], primaryWallet, "base", baseAddress)
    if (!baseSigner) return "base_signer_missing"
    const solanaSigner = findDynamicApprovalWalletForSource(wallets as unknown[], primaryWallet, "solana", solanaAddress)
    if (!solanaSigner) return "solana_signer_missing"

    return "provisioning_timeout_unknown"
  }

  useEffect(() => {
    if (!pendingSync || finalProvisioningRefreshAttempted) return
    // While setup is parked on the Dynamic native auth fallback (external JWT
    // rejected) or the auth sheet is open, the provisioning clock must not run:
    // email OTP sign-in routinely takes longer than the timeout, and timing out
    // mid-auth is what left merchants stranded on "Try Again". The suppression
    // deps below restart the timers from zero once auth completes.
    const suppressionReason = walletProvisioningTimeoutSuppressionReason({
      pendingSync,
      needsUserAuth: coreSetupNeedsUserAuth,
      dynamicAuthSheetOpen: isDynamicAuthSheetConsideredOpen(),
      nativeFallbackPending: nativeFallbackPendingRef.current,
      profilePostInFlight: Boolean(profilePostInFlightKeyRef.current),
    })
    if (suppressionReason) {
      emitWalletSetupDebugEvent("wallet_setup_timeout_suppressed", {
        reason: suppressionReason,
        phase: "final_refresh_timer",
      })
      return
    }
    const savedDynamicProfileBeforeProvisioning =
      profileState.kind === "loaded" &&
      Boolean(profileState.profile.dynamic_user_id && profileState.profile.base_address && profileState.profile.solana_address)
    const timer = window.setTimeout(() => {
      pendingWalletProvisionAttemptRef.current = null
      pendingProfileSyncAttemptRef.current = false
      setFinalProvisioningRefreshAttempted(true)
      logWalletCreationStep("provisioning_wallet", {
        reason: "final_dynamic_runtime_refresh_before_timeout",
        timeout_ms: walletCreationTimeoutMs,
      })
      void refreshDynamicWalletRuntime("final_embedded_wallet_runtime_refresh_before_timeout", { requireApprovalWallet: false })
      if (walletCreationDebugEnabled) {
        console.debug("[pinetree-wallets] wallet_creation_step", {
          step: "provisioning_wallet",
          reason: "final_dynamic_runtime_refresh_before_timeout",
          timeout_ms: walletCreationTimeoutMs,
          final_refresh_grace_ms: walletProvisioningFinalRefreshGraceMs,
        })
      }
    }, walletCreationTimeoutMs)
    return () => window.clearTimeout(timer)
  }, [pendingSync, finalProvisioningRefreshAttempted, coreSetupNeedsUserAuth, showAuthFlow, profileState, repairInProgress, refreshDynamicWalletRuntime, logWalletCreationStep])

  useEffect(() => {
    if (!pendingSync || !finalProvisioningRefreshAttempted) return
    // Same suppression as the first-stage timer: never declare a timeout while
    // waiting on the merchant to finish Dynamic native auth or while a profile
    // POST that could still succeed is in flight.
    const suppressionReason = walletProvisioningTimeoutSuppressionReason({
      pendingSync,
      needsUserAuth: coreSetupNeedsUserAuth,
      dynamicAuthSheetOpen: isDynamicAuthSheetConsideredOpen(),
      nativeFallbackPending: nativeFallbackPendingRef.current,
      profilePostInFlight: Boolean(profilePostInFlightKeyRef.current),
    })
    if (suppressionReason) {
      emitWalletSetupDebugEvent("wallet_setup_timeout_suppressed", {
        reason: suppressionReason,
        phase: "failure_timer",
      })
      return
    }
    const savedDynamicProfileBeforeProvisioning =
      profileState.kind === "loaded" &&
      Boolean(profileState.profile.dynamic_user_id && profileState.profile.base_address && profileState.profile.solana_address)
    const timer = window.setTimeout(() => {
      // Re-check at fire time: a native-auth fallback or profile POST may have
      // started after this timer was scheduled (refs don't re-run the effect).
      const fireTimeSuppression = walletProvisioningTimeoutSuppressionReason({
        pendingSync: true,
        needsUserAuth: coreSetupNeedsUserAuth,
        dynamicAuthSheetOpen: isDynamicAuthSheetConsideredOpen(),
        nativeFallbackPending: nativeFallbackPendingRef.current,
        profilePostInFlight: Boolean(profilePostInFlightKeyRef.current),
      })
      if (fireTimeSuppression) {
        emitWalletSetupDebugEvent("wallet_setup_timeout_suppressed", {
          reason: fireTimeSuppression,
          phase: "failure_timer_fire",
        })
        return
      }
      pendingWalletProvisionStartedAtRef.current = null
      pendingWalletProvisionAttemptRef.current = null
      pendingProfileSyncAttemptRef.current = false
      walletSetupStartInFlightRef.current = null
      setProvisioningRetryExhausted(true)
      overallSetupActiveRef.current = false
      setCoreSetupStageLabel("")
      setPendingSync(false)
      setSyncing(false)
      setRepairInProgress(false)
      setRepairFailedIncomplete(repairInProgress || savedDynamicProfileBeforeProvisioning)
      setWalletCreationStep("timeout")
      recordWalletSetupFailure(inferWalletSetupFailureReason(), "failed", {
        finalProvisioningRefreshAttempted: true,
      })
      // The single most useful log line for "why did this time out": the exact reason
      // classifier plus the runtime state it was computed from.
      emitWalletSetupDebugEvent("wallet_setup_timeout", {
        reason: inferWalletSetupFailureReason(),
        sdkLoaded: sdkHasLoaded,
        userPresent: Boolean(user),
        runtimeWalletCount: dynamicWalletRuntimeCount,
        baseDetected: dynamicNetworkAddresses.base.length > 0,
        solanaDetected: dynamicNetworkAddresses.solana.length > 0,
      })
    }, walletProvisioningFinalRefreshGraceMs)
    return () => window.clearTimeout(timer)
  }, [pendingSync, finalProvisioningRefreshAttempted, coreSetupNeedsUserAuth, showAuthFlow, profileState, repairInProgress, recordWalletSetupFailure])

  useEffect(() => {
    if (!sdkHasLoaded || !user) return

    function refreshAfterDynamicModalChange() {
      const missingDynamicAddresses =
        dynamicNetworkAddresses.base.length === 0 ||
        dynamicNetworkAddresses.solana.length === 0
      const shouldRecheck =
        missingDynamicAddresses &&
        (pendingSync || walletCreationStep === "timeout")

      if (!shouldRecheck) return

      pendingWalletProvisionStartedAtRef.current = null
      pendingWalletProvisionAttemptRef.current = null
      pendingProfileSyncAttemptRef.current = false
      setPendingSync(true)
      markWalletSetupInProgress()
      setProvisioningRetryExhausted(false)
      setFinalProvisioningRefreshAttempted(false)
      logWalletCreationStep("provisioning_wallet", {
        reason: "dynamic_modal_closed_or_page_visible_runtime_recheck",
      })
      void refreshDynamicWalletRuntime("dynamic_modal_close_runtime_recheck", { requireApprovalWallet: false })
    }

    window.addEventListener("focus", refreshAfterDynamicModalChange)
    document.addEventListener("visibilitychange", refreshAfterDynamicModalChange)
    return () => {
      window.removeEventListener("focus", refreshAfterDynamicModalChange)
      document.removeEventListener("visibilitychange", refreshAfterDynamicModalChange)
    }
  }, [
    sdkHasLoaded,
    user,
    pendingSync,
    walletCreationStep,
    dynamicNetworkAddresses,
    refreshDynamicWalletRuntime,
    logWalletCreationStep,
  ])

  // --- After Dynamic logout: open auth flow for the new merchant's wallet creation ---
  useEffect(() => {
    if (!logoutPending) return
    if (user !== null) return // still waiting for logout to clear the user
    setLogoutPending(false)
    logWalletCreationStep("waiting_for_dynamic_auth", { reason: "reopening_after_logout" })
    setPendingSync(true)
    markWalletSetupInProgress()
    setProvisioningRetryExhausted(false)
    setFinalProvisioningRefreshAttempted(false)
    openDynamicEmailFallbackAuth("reopening_after_logout")
  }, [logoutPending, user, openDynamicEmailFallbackAuth, logWalletCreationStep])

  useEffect(() => {
    if (!repairPendingAfterLogout) return
    if (user !== null) return
    setRepairPendingAfterLogout(false)
    console.info("[pinetree-wallets] repair_dynamic_session_reset_auth_opened", {
      previousProfileId: repairProfileIdRef.current,
      dynamicWalletCountBeforeAuth: dynamicWalletRuntimeCountRef.current,
    })
    logWalletCreationStep("waiting_for_dynamic_auth", { reason: "repair_reopening_after_logout" })
    setPendingSync(true)
    markWalletSetupInProgress()
    setProvisioningRetryExhausted(false)
    setFinalProvisioningRefreshAttempted(false)
    setShowDynamicUserProfile(false)
    openDynamicEmailFallbackAuth("repair_reopening_after_logout")
  }, [repairPendingAfterLogout, user, openDynamicEmailFallbackAuth, setShowDynamicUserProfile, logWalletCreationStep])

  // ---------------------------------------------------------------------------
  // Derived state - wallet profile (Base/Solana from Dynamic, DB-backed)
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

  const baseReady = railReadiness?.base.walletProvisioned ?? profileAddresses.base.length > 0
  const solanaReady = railReadiness?.solana.walletProvisioned ?? profileAddresses.solana.length > 0
  const baseSignerReady = Boolean(
    profile?.base_address &&
      findDynamicApprovalWalletForSource(wallets as unknown[], primaryWallet, "base", profile.base_address)
  )
  const solanaSignerReady = Boolean(
    profile?.solana_address &&
      findDynamicApprovalWalletForSource(wallets as unknown[], primaryWallet, "solana", profile.solana_address)
  )

  // ---------------------------------------------------------------------------
  // Derived state - Lightning (PineTree-managed backend, NOT Dynamic Spark)
  // ---------------------------------------------------------------------------

  const bitcoinPayoutEntries: AddressEntry[] = profile?.btc_address
    ? [{
        id: "btc-payout",
        address: profile.btc_address,
      }]
    : []

  // Bitcoin withdrawal availability must never depend on the merchant's old
  // opt-in default-payout-destination preference - that model predates
  // Address Book / manual-destination withdrawals. When server-computed
  // readiness is available, walletProvisioned already reflects only Speed
  // account readiness. The fallback (readiness fetch not yet completed this
  // session) must mirror that same signal - the Lightning profile actually
  // being ready - rather than the old preference or bare address presence
  // (an address can be a placeholder auto-provisioned before Speed is
  // actually set up - see the placeholder reason code in pinetreeRailReadiness.ts).
  const bitcoinReady =
    railReadiness?.bitcoin_lightning.walletProvisioned ??
    (lightningProfileState.kind === "loaded" && lightningProfileState.profile.status === "ready")
  const coreWalletProfileReady = profile?.status === "ready" && baseReady && solanaReady
  const dynamicProfileReady = coreWalletProfileReady && baseSignerReady && solanaSignerReady
  const dynamicEmbeddedSignersReady = baseSignerReady && solanaSignerReady
  const profileHasDynamicAddresses = baseReady || solanaReady
  const businessProfileGateReady = businessProfileReadiness.kind === "loaded" && businessProfileReadiness.complete
  const businessProfileGateBlocking = !businessProfileGateReady
  // Wallet exists only once a core PineTree embedded wallet address is available.
  // Speed/Bitcoin readiness can be active before core wallet creation and must not
  // turn the setup CTA into Open/Reconnect or global Needs attention.
  const hasWallet = profileState.kind === "loaded" && (baseReady || solanaReady)
  const walletProvisioningInProgress =
    pendingSync &&
    !provisioningRetryExhausted &&
    walletCreationStep !== "failed" &&
    walletCreationStep !== "timeout"
  const dbOnlyWalletProfile =
    Boolean(profile?.dynamic_user_id) &&
    profileHasDynamicAddresses &&
    sdkHasLoaded &&
    (!user || dynamicWalletRuntimeCount === 0 || !dynamicEmbeddedSignersReady)
  const walletSetupIncomplete = hasWallet && dbOnlyWalletProfile && !walletProvisioningInProgress
  const repairOrSetupIncomplete = (repairFailedIncomplete || walletSetupIncomplete) && !walletProvisioningInProgress

  // walletStatus is derived from walletSetupPrimaryState further down, once that
  // resolver (and the live identity signals it depends on) is computed.
  const dynamicEnvironmentIdPresent = Boolean(process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID?.trim())
  const clientAuthModeRaw = dynamicAuthConfig.rawMode || "missing"
  const clientAuthModeSource = dynamicAuthConfig.rawMode ? "NEXT_PUBLIC_PINETREE_DYNAMIC_AUTH_MODE" : "missing"
  const clientEmailFallbackRaw = dynamicAuthConfig.rawEmailFallback || "missing"
  const clientEmailFallbackSource = dynamicAuthConfig.rawEmailFallback ? "NEXT_PUBLIC_PINETREE_DYNAMIC_EMAIL_FALLBACK" : "missing"
  const clientBuildFingerprint =
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_BUILD_TIMESTAMP ||
    "unavailable"
  const clientAppUrl = process.env.NEXT_PUBLIC_APP_URL || "missing"
  const dynamicEnvironmentLabel = "unknown"
  const showProfileSyncDebugPanel = walletSyncDebugQueryEnabled
  const showDynamicAuthMisconfigurationWarning =
    showProfileSyncDebugPanel && dynamicAuthConfig.emailFallbackMisconfigured

  useEffect(() => {
    dynamicProfileReadyRef.current = Boolean(coreWalletProfileReady)
    if (coreWalletProfileReady) {
      setWalletSetupFailureReason(null)
      console.info("[pinetree-wallets] wallet_core_ready", {})
      emitWalletSetupDebugEvent("wallet_core_ready", {})
    }
  }, [coreWalletProfileReady])

  // Signer hydration is required only for withdrawals/signing, never for wallet
  // creation or readiness — surface it as informational, not a blocker.
  useEffect(() => {
    if (coreWalletProfileReady && !dynamicEmbeddedSignersReady) {
      console.info("[pinetree-wallets] wallet_signers_missing_non_blocking", {})
    }
  }, [coreWalletProfileReady, dynamicEmbeddedSignersReady])

  // Resume core wallet setup automatically once the Dynamic native auth fallback
  // completes. The provisioning timeout was suppressed while waiting on the merchant;
  // this clears the parked needs-user-auth/failure state, resets the timeout window,
  // and re-enters the pendingSync-driven pipeline (identity gate, embedded wallet
  // provisioning, profile POST) without another "Try Again" click. If a ready profile
  // already exists for this Dynamic user, it opens the wallet instead of recreating.
  useEffect(() => {
    if (!user || !nativeFallbackPendingRef.current) return
    nativeFallbackPendingRef.current = false
    overallSetupActiveRef.current = true
    setCoreSetupStageLabel("Preparing secure wallet")
    setCoreSetupNeedsUserAuth(false)
    console.info("[pinetree-wallets] wallet_dynamic_native_user_detected", {})
    emitWalletSetupDebugEvent("wallet_dynamic_native_user_detected", {})
    emitWalletSetupDebugEvent("wallet_native_auth_resume_started", {})
    emitWalletSetupStageDiagnostic("wallet_create_dynamic_auth_complete", "native_dynamic_auth_complete")

    // Fresh timeout window: the time the merchant spent inside the email sign-in
    // sheet must not count against the resumed provisioning attempt.
    pendingWalletProvisionStartedAtRef.current = null
    pendingWalletProvisionAttemptRef.current = null
    pendingProfileSyncAttemptRef.current = false
    walletSetupStartInFlightRef.current = null
    setWalletSetupFailureReason(null)
    setWalletIdentityError("")
    setProvisioningRetryExhausted(false)
    setFinalProvisioningRefreshAttempted(false)
    setWalletCreationStep("provisioning_wallet")
    setPendingSync(true)
    markWalletSetupInProgress()
    autoOpenWalletAfterCreateRef.current = true
    emitWalletSetupDebugEvent("wallet_native_auth_resume_timeout_reset", {})

    // Speed already ran when the orchestrator started - only re-run it when no
    // Lightning profile or in-flight attempt exists at all.
    if (shouldRerunSpeedOnNativeAuthResume({
      speedProvisionInFlight: speedProvisionInFlightRef.current,
      lightningProfileKind: lightningProfileState.kind,
    })) {
      void provisionSpeedLightning()
    }

    void (async () => {
      // A profile may already exist (an earlier attempt saved it, or this Dynamic
      // user was provisioned before) - open it rather than re-provisioning forever.
      emitWalletSetupDebugEvent("wallet_native_auth_resume_profile_get_started", {})
      const token = accessTokenRef.current
      let existingProfile: PineTreeWalletProfile | null = null
      if (token) {
        try {
          const res = await fetch("/api/wallets/pinetree-profile", {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (res.ok) {
            const json = (await res.json()) as { profile: PineTreeWalletProfile | null }
            existingProfile = json.profile
            if (json.profile) setProfileState({ kind: "loaded", profile: json.profile })
          }
        } catch {
          // Network hiccup - fall through to normal provisioning below.
        }
      }
      if (resolveNativeAuthResumeAction(existingProfile) === "open_existing_ready_wallet") {
        emitWalletSetupDebugEvent("wallet_native_auth_resume_profile_existing_ready", {})
        pendingProfileSyncAttemptRef.current = true
        setPendingSync(false)
        setWalletCreationStep("profile_synced")
        setWalletSetupStage("ready")
        clearWalletSetupInProgress()
        autoOpenWalletAfterCreateRef.current = false
        setActiveView(null)
        setWalletOpen(true)
        emitWalletSetupDebugEvent("wallet_wallet_page_opened_after_create", { existingProfile: true })
        return
      }
      emitWalletSetupDebugEvent("wallet_native_auth_resume_core_started", {})
      void refreshDynamicWalletRuntime("native_auth_resume_embedded_wallet_provisioning", { requireApprovalWallet: false })
    })()
  }, [user, lightningProfileState.kind, refreshDynamicWalletRuntime])

  // Once core wallet setup (Base + Solana + a saved "ready" profile) is terminally
  // successful, capture the refresh generation active at that moment. Any Dynamic
  // create/hydration work at or before this generation belongs to the now-superseded
  // creation attempt and must never call createWalletAccount again, reopen the Dynamic
  // sheet, or report a late resolve/reject as a fresh failure - independent of Lightning,
  // which is a separate Speed-managed rail that can still be pending.
  useEffect(() => {
    if (!coreWalletProfileReady) return
    if (walletCoreSetupTerminalGenerationRef.current !== null) return
    const generationAtSuccess = walletRuntimeRefreshGenerationRef.current
    walletCoreSetupTerminalGenerationRef.current = generationAtSuccess
    const hasInFlightRefresh = Boolean(
      walletRuntimeRefreshInFlightRef.current.normal_hydration ||
      walletRuntimeRefreshInFlightRef.current.approval_wallet_hydration
    )
    if (hasInFlightRefresh) {
      const diagnostic = { generation: generationAtSuccess, terminalSetupStatus: "ready" as const }
      console.info("[pinetree-wallets] wallet_dynamic_setup_cancelled_after_success", diagnostic)
      emitWalletSetupDebugEvent("wallet_dynamic_setup_cancelled_after_success", diagnostic)
    }
  }, [coreWalletProfileReady])

  // syncWalletReadiness: combine the core wallet and Speed/Lightning task outcomes
  // once core setup is ready. Lightning is additive - a pending or failed Lightning
  // rail never demotes a ready core wallet back to failed.
  useEffect(() => {
    if (!coreWalletProfileReady) return
    const lightningStatus = lightningProfileState.kind === "loaded"
      ? lightningProfileState.profile.status
      : null
    const combined = lightningStatus === "ready"
      ? "wallet_setup_ready"
      : lightningStatus === "needs_attention"
        ? "wallet_setup_lightning_needs_attention"
        : "wallet_setup_pending_lightning"
    if (lastCombinedReadinessRef.current === combined) return
    lastCombinedReadinessRef.current = combined
    console.info(`[pinetree-wallets] ${combined}`, {})
    emitWalletSetupDebugEvent(combined, {})
  }, [coreWalletProfileReady, lightningProfileState])

  const bitcoinNeedsAttentionMessage = lightningProfileState.kind === "loaded"
    && lightningProfileState.profile.status === "needs_attention"
    ? lightningProfileState.profile.provider_error_message || "Bitcoin setup needs attention."
    : null

  const walletRailRows = useMemo<WalletRailRow[]>(() => [
    { rail: "base", label: "Base" as const, configured: baseReady, enabled: enabledRails.base },
    { rail: "solana", label: "Solana" as const, configured: solanaReady, enabled: enabledRails.solana },
    {
      rail: "bitcoin",
      label: "Bitcoin" as const,
      configured: bitcoinReady,
      enabled: enabledRails.bitcoin,
      needsAttentionMessage: bitcoinNeedsAttentionMessage,
    },
  ], [baseReady, bitcoinNeedsAttentionMessage, bitcoinReady, enabledRails.base, enabledRails.bitcoin, enabledRails.solana, solanaReady])

  const withdrawalWalletRows = useMemo(() => [
    { rail: "base" as const, configured: baseReady && enabledRails.base },
    { rail: "solana" as const, configured: solanaReady && enabledRails.solana },
    { rail: "bitcoin" as const, configured: bitcoinReady && enabledRails.bitcoin },
  ], [baseReady, bitcoinReady, enabledRails.base, enabledRails.bitcoin, enabledRails.solana, solanaReady])

  const withdrawableAssetOptions = useMemo((): WithdrawalAssetOption[] => {
    return withdrawalWalletRows
      .filter((row) => row.configured)
      .flatMap((row) =>
        withdrawalAssetsByRail[row.rail].map((item) => ({
          rail: row.rail,
          asset: item,
          balance: findWithdrawalBalance(walletSync, row.rail, item),
        }))
      )
  }, [walletSync, withdrawalWalletRows])

  useEffect(() => {
    if (withdrawableAssetOptions.some((option) => option.rail === withdrawalRail && option.asset === withdrawalAsset)) {
      return
    }
    const first = withdrawableAssetOptions[0]
    if (!first) return
    setWithdrawalRail(first.rail)
    setWithdrawalAsset(first.asset)
    setWithdrawalScreen("form")
    setWithdrawalReview(null)
    setWithdrawalSubmitResult(null)
    setWithdrawalError("")
    setWithdrawalApprovalError("")
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
    if (!dynamicSignerWithdrawalRails.includes(withdrawalReview.review.rail)) {
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

  useEffect(() => {
    dynamicApprovalAvailableRef.current = dynamicApprovalAvailableForWithdrawal
  }, [dynamicApprovalAvailableForWithdrawal])

  const withdrawalDiagnostics = useMemo((): WithdrawalDiagnostics => {
    const railState = walletRailRows.find((row) => row.rail === withdrawalRail)
    const sourceAddress = getWithdrawalSourceAddress(profile, withdrawalRail)
    const usesDynamicSigner = dynamicSignerWithdrawalRails.includes(withdrawalRail)
    const shouldResolveWithdrawalSigner = Boolean(withdrawalReview) && usesDynamicSigner
    const browserWalletAddresses = shouldResolveWithdrawalSigner
      ? [
          ...(wallets as unknown[]),
          primaryWallet,
        ].filter(Boolean).flatMap((wallet) => getDynamicWalletAddresses(wallet as DynamicWalletLike))
      : []
    const matchingWallet = shouldResolveWithdrawalSigner
      ? findDynamicWalletForSource(wallets as unknown[], primaryWallet, sourceAddress || "", withdrawalRail)
      : null
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
      signerRail: matchingWallet ? inferredSignerRailForWallet(matchingWallet) : "unknown",
      signerWalletAddressLast4: matchingWallet ? (getDynamicWalletAddresses(matchingWallet)[0]?.slice(-4) ?? null) : null,
      signerWalletAddressLast6: matchingWallet ? (getDynamicWalletAddresses(matchingWallet)[0]?.slice(-6) ?? null) : null,
      signerConnectorKey: matchingWallet ? (matchingWallet.connector?.key ?? matchingWallet.walletConnector?.key ?? null) : null,
      signerConnectorName: matchingWallet ? (matchingWallet.connector?.name ?? matchingWallet.walletConnector?.name ?? null) : null,
      signerChain: matchingWallet ? classifyDynamicWalletChain(matchingWallet) : null,
      primaryWalletChain: primaryWallet ? classifyDynamicWalletChain(primaryWallet as DynamicWalletLike) : null,
      willOpenDynamicModal: Boolean(matchingWallet && inferredSignerRailForWallet(matchingWallet) === withdrawalRail),
    }
    return {
      ...baseDiagnostics,
      fallbackReason: getWithdrawalFallbackReason(baseDiagnostics),
    }
  }, [lightningProfileState, primaryWallet, profile, walletRailRows, wallets, withdrawalAsset, withdrawalRail, withdrawalReview])

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
    profile.dynamic_user_id === user.userId ||
    profile.dynamic_user_id === dynamicExternalUserId

  const hasStaleDynamicSession =
    user !== null &&
    profileState.kind === "none"

  // Ready is authoritative: once the saved profile itself is marked ready with both
  // addresses (or the live Dynamic runtime confirms it), stale failed/timeout/identity
  // state from earlier in the session must never contradict it in the UI.
  const hasReadyBaseAndSolanaProfile =
    profileState.kind === "loaded" &&
    profileState.profile.status === "ready" &&
    Boolean(profileState.profile.base_address) &&
    Boolean(profileState.profile.solana_address)

  // Live identity signals - computed from the current merchantEmail/dynamicUserEmail
  // directly, so the same comparison governs the UI whether or not a profile already
  // exists, and never depends on a stateful flag that might be stale (e.g. left over
  // from a previous PineTree account in the same browser).
  // dynamicSessionExternallyBound short-circuits both: an externalUser credential
  // signed by PineTree (JWT sub = merchant_id) is stronger proof of ownership than
  // any email Dynamic happens to surface, so email presentation can never flip a
  // bound session into stale older-setup state.
  const liveEmailMismatch =
    !dynamicSessionExternallyBound &&
    Boolean(user) && Boolean(merchantEmail) && Boolean(dynamicUserEmail) && dynamicUserEmail !== merchantEmail
  const liveEmailUnverified =
    !dynamicSessionExternallyBound &&
    Boolean(user) && Boolean(merchantEmail) && !dynamicUserEmail
  const emailMismatchActive = Boolean(identityMismatchError) || liveEmailMismatch
  const emailUnverifiedActive = !emailMismatchActive && (identityUnverified || liveEmailUnverified)

  // --- Stale DB recovery (Case C): Dynamic already has Base/Solana addresses (a
  // persisted session, no click required) but the PineTree DB profile is missing
  // or incomplete. Repair automatically instead of waiting for the merchant to
  // press Create/Retry. Gated by attemptKey so it fires once per address pair and
  // never loops if the repair attempt itself fails to complete.
  useEffect(() => {
    if (!sdkHasLoaded || !user || pendingSync || repairInProgress) return
    if (profileState.kind === "loading") return
    if (hasReadyBaseAndSolanaProfile) return
    if (emailMismatchActive || emailUnverifiedActive) return
    if (!dynamicSessionMatchesProfile) return

    const baseAddress = dynamicNetworkAddresses.base[0]?.address ?? null
    const solanaAddress = dynamicNetworkAddresses.solana[0]?.address ?? null
    if (!baseAddress || !solanaAddress) return

    const attemptKey = `${user.userId}:${baseAddress}:${solanaAddress}`
    if (staleProfileAutoRepairAttemptRef.current === attemptKey) return
    staleProfileAutoRepairAttemptRef.current = attemptKey

    console.info("[pinetree-wallets] wallet_sync_start", { reason: "stale_profile_auto_repair" })
    console.info("[pinetree-wallets] wallet_dynamic_addresses_detected", {
      baseAddressPresent: true,
      solanaAddressPresent: true,
      trigger: "stale_profile_auto_repair",
    })
    emitWalletSetupStageDiagnostic("wallet_create_resume_detected", "existing_dynamic_wallets_missing_profile")
    pendingWalletProvisionStartedAtRef.current = null
    pendingWalletProvisionAttemptRef.current = null
    pendingProfileSyncAttemptRef.current = false
    setFinalProvisioningRefreshAttempted(false)
    setProvisioningRetryExhausted(false)
    setPendingSync(true)
    markWalletSetupInProgress()
    logWalletCreationStep("wallets_detected", { reason: "stale_profile_auto_repair" })
  }, [
    sdkHasLoaded,
    user,
    pendingSync,
    repairInProgress,
    profileState,
    hasReadyBaseAndSolanaProfile,
    emailMismatchActive,
    emailUnverifiedActive,
    dynamicSessionMatchesProfile,
    dynamicNetworkAddresses,
    logWalletCreationStep,
  ])

  // Single prioritized state resolver. The PineTree merchant profile is canonical for
  // viewing the wallet; Dynamic session state is required only when we need to create,
  // repair, sync, or sign with embedded wallets.
  const walletSetupPrimaryState = useMemo<WalletSetupPrimaryState>(() => {
    if (openWalletReconnectNeeded) return "reconnect_needed"
    if (emailMismatchActive) return "email_mismatch"
    if (emailUnverifiedActive) return "email_unverified"
    if (!dynamicSessionMatchesProfile) return "reconnect_needed"
    if (dynamicProfileReady || hasReadyBaseAndSolanaProfile) return "ready"
    if (walletProvisioningInProgress) return "provisioning"
    if (walletSetupFailureReason === "profile_sync_failed") return "save_needed"
    if (walletSetupFailureReason === "provider_sync_failed") return "rail_sync_needed"
    if (repairOrSetupIncomplete) return "reconnect_needed"
    if (walletCreationStep === "failed" || walletCreationStep === "timeout") return "failed"
    if (profileState.kind === "none" || !profileHasDynamicAddresses) return "create_wallet"
    return "idle"
  }, [
    dynamicProfileReady,
    hasReadyBaseAndSolanaProfile,
    user,
    emailMismatchActive,
    emailUnverifiedActive,
    dynamicSessionMatchesProfile,
    walletProvisioningInProgress,
    walletSetupFailureReason,
    repairOrSetupIncomplete,
    walletCreationStep,
    profileState,
    profileHasDynamicAddresses,
    openWalletReconnectNeeded,
  ])

  useEffect(() => {
    providerSheetGateStateRef.current = {
      walletReady: walletSetupPrimaryState === "ready",
      profileReady: Boolean(profile?.status === "ready"),
      baseReady,
      solanaReady,
      bitcoinReady,
    }
  }, [baseReady, bitcoinReady, profile?.status, solanaReady, walletSetupPrimaryState])

  useEffect(() => {
    if (walletSetupPrimaryState === "failed") {
      emitWalletSetupDebugEvent("wallet_setup_retry_shown", {
        reason: walletSetupFailureReason || "none",
      })
      // Core failure is authoritative - a succeeded/pending Speed task can never mask it.
      emitWalletSetupDebugEvent("wallet_setup_failed_core", {
        reason: walletSetupFailureReason || "none",
      })
    }
  }, [walletSetupPrimaryState, walletSetupFailureReason])

  const walletStatus =
    repairInProgress ? "Repairing" :
    syncing ? "Saving..." :
    walletSetupPrimaryState === "ready" ? "Connected" :
    walletSetupPrimaryState === "create_wallet" ? "Create wallet" :
    walletSetupPrimaryState === "provisioning" ? "Provisioning" :
    walletSetupPrimaryState === "reconnect_needed" ? "Reconnect needed" :
    walletSetupPrimaryState === "email_mismatch" ? "Older setup found" :
    walletSetupPrimaryState === "email_unverified" ? "Older setup found" :
    walletSetupPrimaryState === "save_needed" ? "Save needed" :
    walletSetupPrimaryState === "rail_sync_needed" ? "Rail sync needed" :
    walletSetupPrimaryState === "failed" ? "Failed" :
    "Not connected"

  const walletCreationMessage =
    walletSetupPrimaryState === "provisioning" && coreSetupStageLabel
      ? coreSetupStageLabel
      : (
          walletSetupPrimaryState === "provisioning" ||
          walletSetupPrimaryState === "failed" ||
          (walletSetupPrimaryState === "ready" && walletCreationStep === "profile_synced")
        )
        ? walletCreationStepMessage(walletCreationStep)
        : ""
  const walletCreationInProgress =
    walletCreationStep !== "idle" &&
    walletCreationStep !== "profile_synced" &&
    walletCreationStep !== "failed" &&
    walletCreationStep !== "timeout"
  const walletSetupProgressActive =
    (walletSetupPrimaryState === "provisioning" || walletSetupOpeningAfterCreate) &&
    walletCreationStep !== "failed" &&
    walletCreationStep !== "timeout"
  const walletSetupProgressStage = walletSetupProgressStageForStep({
    walletCreationStep,
    walletSetupPrimaryState,
    walletSetupOpeningAfterCreate,
  })
  const showProvisioningRetryOnly = walletSetupPrimaryState === "failed" && Boolean(user)
  const showWalletSetupCard = walletSetupPrimaryState !== "ready" || !hasWallet
  // The workspace is the route's primary content once a wallet exists - it must
  // never wait on walletOpen (Dynamic signer hydration for withdrawals, see
  // handleOpenWallet below). Tabs that need that hydration show their own
  // reconnect state instead of hiding the whole workspace behind it.
  const showWalletWorkspace = !showWalletSetupCard

  // Balance/activity data has no dependency on Dynamic signer hydration - fetch
  // it as soon as the workspace is visible instead of waiting on walletOpen.
  useEffect(() => {
    if (!showWalletWorkspace) return
    void syncPineTreeWallet()
  }, [showWalletWorkspace, syncPineTreeWallet])

  useEffect(() => {
    if (directWalletOpenAttemptedRef.current) return
    if (!hasWallet || walletSetupPrimaryState !== "ready" || walletOpen || walletOpening) return
    directWalletOpenAttemptedRef.current = true
    void handleOpenWallet()
    // handleOpenWallet intentionally owns the existing hydration/sync path; this
    // effect only removes the extra merchant click after readiness is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasWallet, walletOpen, walletOpening, walletSetupPrimaryState])

  useEffect(() => {
    if (lastWalletSetupPrimaryStateRef.current === walletSetupPrimaryState) return
    lastWalletSetupPrimaryStateRef.current = walletSetupPrimaryState
    console.info("[pinetree-wallets] wallet_setup_state", {
      state: walletSetupPrimaryState,
      profileState: profileState.kind,
      profileExists: Boolean(profile),
      pendingSync,
      walletCreationStep,
      sdkHasLoaded,
      dynamicAuthenticated: Boolean(user),
      dynamicWalletRuntimeCount,
      baseReady,
      solanaReady,
      bitcoinReady,
      lightningState: lightningProfileState.kind,
    })
  }, [
    baseReady,
    bitcoinReady,
    dynamicWalletRuntimeCount,
    lightningProfileState.kind,
    pendingSync,
    profile,
    profileState.kind,
    sdkHasLoaded,
    solanaReady,
    user,
    walletCreationStep,
    walletSetupPrimaryState,
  ])

  useEffect(() => {
    if (!coreWalletProfileReady) return
    pendingWalletProvisionStartedAtRef.current = null
    pendingWalletProvisionAttemptRef.current = null
    pendingProfileSyncAttemptRef.current = false
    walletSetupStartInFlightRef.current = null
    overallSetupActiveRef.current = false
    setCoreSetupStageLabel("")
    setPendingSync(false)
    setSyncing(false)
    setRepairInProgress(false)
    setRepairFailedIncomplete(false)
    setProvisioningRetryExhausted(false)
    setFinalProvisioningRefreshAttempted(false)
    setWalletIdentityError("")
    setIdentityMismatchError(null)
    setIdentityUnverified(false)
    setWalletSetupStage("ready")
    setWalletSetupFailureReason(null)
    setDynamicVerificationPromptReason(null)
    clearWalletSetupInProgress()
    setWalletCreationStep("profile_synced")
  }, [coreWalletProfileReady])

  useEffect(() => {
    return () => {
      clearScheduledWalletOpenAfterCreate()
    }
  }, [])

  // Defense in depth: the effect above only fires on a false -> true transition of
  // dynamicProfileReady. If a stale failed/timeout step gets set afterward (e.g. a
  // transient auth-context race) while the profile is already ready, nothing would
  // otherwise clear it - so watch walletCreationStep directly and self-correct.
  useEffect(() => {
    if (!coreWalletProfileReady) return
    if (walletCreationStep !== "failed" && walletCreationStep !== "timeout") return
    setWalletCreationStep("profile_synced")
    setIdentityMismatchError(null)
    setIdentityUnverified(false)
    setWalletIdentityError("")
  }, [coreWalletProfileReady, walletCreationStep])

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  function markWalletSetupInProgress() {
    const setupKey = walletSetupStorageKeyForMerchant(merchantId)
    if (!setupKey) return
    window.localStorage.setItem(setupKey, "true")
  }

  function clearWalletSetupInProgress() {
    const setupKey = walletSetupStorageKeyForMerchant(merchantId)
    if (!setupKey) return
    window.localStorage.removeItem(setupKey)
  }

  function setupStartedInThisBrowser() {
    const setupKey = walletSetupStorageKeyForMerchant(merchantId)
    if (!setupKey) return false
    try {
      return window.localStorage.getItem(setupKey) === "true"
    } catch {
      return false
    }
  }

  // Explicit cancellation marker (Part G): distinct from walletSetupStoragePrefix.
  // A page reload after a merely-interrupted setup (browser closed, network drop)
  // should still resume - a page reload after the merchant explicitly logged out or
  // cancelled from the Dynamic sheet must not.
  function markWalletSetupCancelled() {
    const cancelledKey = walletSetupCancelledStorageKeyForMerchant(merchantId)
    if (!cancelledKey) return
    try {
      window.localStorage.setItem(cancelledKey, "true")
    } catch {
      // Storage unavailable - resume gating below simply falls back to "not cancelled".
    }
  }

  function clearWalletSetupCancelled() {
    const cancelledKey = walletSetupCancelledStorageKeyForMerchant(merchantId)
    if (!cancelledKey) return
    try {
      window.localStorage.removeItem(cancelledKey)
    } catch {
      // Nothing to clean up if storage is unavailable.
    }
  }

  function setupCancelledInThisBrowser() {
    const cancelledKey = walletSetupCancelledStorageKeyForMerchant(merchantId)
    if (!cancelledKey) return false
    try {
      return window.localStorage.getItem(cancelledKey) === "true"
    } catch {
      return false
    }
  }

  // Server-visible mirror of the wallet_dynamic_* console diagnostics below - frontend
  // console.info never reaches Vercel logs from a mobile browser, so this fires a small
  // sanitized beacon at the same checkpoints. Fire-and-forget: never awaited, never
  // throws into the UI, and never blocks wallet creation. Reads window.location.search
  // directly (rather than walletSyncDebugQueryEnabled state) so it has no dependency-array
  // staleness concerns and can be called from anywhere in this component.
  function emitWalletSetupDebugEvent(event: string, details?: WalletSetupDebugDetails) {
    if (!isWalletDebugEventsEnabled() && !isProductionWalletWithdrawalDebugEvent(event)) return
    const safeDetails = {
      ...(details ?? {}),
      buildId: safeClientBuildId(clientBuildFingerprint),
    }
    setLastDebugEvents((prev) => [{ event, details: safeDetails, at: new Date().toISOString() }, ...prev].slice(0, 12))
    try {
      const token = accessTokenRef.current
      void fetch("/api/debug/pinetree-wallet/setup-event", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ event, details: safeDetails }),
        keepalive: true,
      }).catch(() => undefined)
    } catch {
      // Diagnostics must never break wallet creation.
    }
  }

  function buildWalletSetupStageDiagnostics(stage: string): WalletSetupDebugDetails {
    const loadedProfile = profileState.kind === "loaded" ? profileState.profile : null
    const dynamicBaseAddress = dynamicNetworkAddresses.base[0]?.address ?? null
    const dynamicSolanaAddress = dynamicNetworkAddresses.solana[0]?.address ?? null

    return {
      // overallSetupActiveRef is a ref (synchronous), unlike pendingSync (React state,
      // which can still read its stale pre-update value in the same tick a
      // setPendingSync(true) call was made) - ORing it in fixes the "setupAttemptActive:
      // false" reported immediately after wallet_create_dynamic_auth_complete and during
      // native auth resume, without changing pendingSync's own semantics anywhere else.
      setupAttemptActive: Boolean(overallSetupActiveRef.current || pendingSync || walletSetupStartInFlightRef.current),
      profileExists: Boolean(loadedProfile),
      profileReady: Boolean(
        (loadedProfile?.status === "ready" && loadedProfile.base_address && loadedProfile.solana_address) ||
          coreWalletProfileReady
      ),
      hasBaseAddress: Boolean(loadedProfile?.base_address || dynamicBaseAddress),
      hasSolanaAddress: Boolean(loadedProfile?.solana_address || dynamicSolanaAddress),
      refreshInFlight: Boolean(
        walletRuntimeRefreshInFlightRef.current.normal_hydration ||
          walletRuntimeRefreshInFlightRef.current.approval_wallet_hydration
      ),
      profilePostInFlight: Boolean(profilePostInFlightKeyRef.current),
      railSyncInFlight: Boolean(railSyncInFlightKeyRef.current),
      modalAlreadyOpened: Boolean(walletModalOpenedForAttemptRef.current || walletOpen),
      stage,
    }
  }

  function emitWalletSetupStageDiagnostic(event: WalletSetupStageDiagnosticEvent, stage: string) {
    emitWalletSetupDebugEvent(event, buildWalletSetupStageDiagnostics(stage))
  }

  function openPineTreeWalletModalOnce(stage: string) {
    if (walletModalOpenedForAttemptRef.current || walletOpen) return
    clearScheduledWalletOpenAfterCreate()
    walletModalOpenedForAttemptRef.current = true
    setWalletSetupOpeningAfterCreate(false)
    setActiveView(null)
    setWalletOpen(true)
    emitWalletSetupStageDiagnostic("wallet_create_modal_opened", stage)
    emitWalletSetupDebugEvent("wallet_wallet_page_opened_after_create", {})
  }

  function clearScheduledWalletOpenAfterCreate() {
    if (walletSetupOpeningDelayRef.current) {
      window.clearTimeout(walletSetupOpeningDelayRef.current)
      walletSetupOpeningDelayRef.current = null
    }
    setWalletSetupOpeningAfterCreate(false)
  }

  function schedulePineTreeWalletModalOpenAfterProgress(stage: string) {
    if (walletModalOpenedForAttemptRef.current || walletOpen) return
    if (walletSetupOpeningDelayRef.current) return
    setWalletSetupOpeningAfterCreate(true)
    walletSetupOpeningDelayRef.current = window.setTimeout(() => {
      walletSetupOpeningDelayRef.current = null
      openPineTreeWalletModalOnce(stage)
    }, walletSetupOpeningDelayMs)
  }

  function runRailSyncOnceForProfile(profileToSync: PineTreeWalletProfile, token: string) {
    const railSyncKey = `${profileToSync.dynamic_user_id || ""}:${profileToSync.base_address || ""}:${profileToSync.solana_address || ""}`
    if (railSyncFiredForProfileRef.current === railSyncKey) return
    if (railSyncInFlightKeyRef.current === railSyncKey) return

    railSyncFiredForProfileRef.current = railSyncKey
    railSyncInFlightKeyRef.current = railSyncKey
    emitWalletSetupStageDiagnostic("wallet_create_rail_sync_started", "rail_sync_started")

    void fetch("/api/wallets/pinetree-wallet/rail-sync", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(() => fetchProviderRailState(token))
      .catch(() => undefined)
      .finally(() => {
        railSyncInFlightKeyRef.current = null
        emitWalletSetupStageDiagnostic("wallet_create_rail_sync_complete", "rail_sync_complete")
      })
  }

  function blockWalletSetupForBusinessProfile(reason: string) {
    clearScheduledWalletOpenAfterCreate()
    setWalletSetupFailureReason("business_profile_required")
    setWalletSetupStage("idle")
    setWalletCreationStep("idle")
    setSyncing(false)
    setPendingSync(false)
    overallSetupActiveRef.current = false
    walletSetupStartInFlightRef.current = null
    pendingWalletProvisionAttemptRef.current = null
    pendingWalletProvisionStartedAtRef.current = null
    pendingProfileSyncAttemptRef.current = false
    autoOpenWalletAfterCreateRef.current = false
    clearWalletSetupInProgress()
    emitWalletSetupDebugEvent("wallet_create_blocked_business_profile_required", { reason })
  }

  function beginWalletProvisioningAttempt(step: WalletCreationStep, reason: string, options?: { retry?: boolean }) {
    if (!businessProfileGateReady) {
      blockWalletSetupForBusinessProfile(reason)
      return false
    }
    if (walletSetupStartInFlightRef.current || (pendingSync && !provisioningRetryExhausted)) return false
    const attemptId = createWalletSetupAttemptId()
    clearScheduledWalletOpenAfterCreate()
    walletSetupStartInFlightRef.current = attemptId
    setWalletSetupAttemptId(attemptId)
    setWalletSetupFailureReason(null)
    setWalletIdentityError("")
    setIdentityMismatchError(null)
    setIdentityUnverified(false)
    logWalletCreationStep(step, { reason, retry: Boolean(options?.retry) })
    pendingWalletProvisionAttemptRef.current = null
    pendingProfileSyncAttemptRef.current = false
    pendingWalletProvisionStartedAtRef.current = null
    walletModalOpenedForAttemptRef.current = false
    setRepairFailedIncomplete(false)
    setProvisioningRetryExhausted(false)
    setFinalProvisioningRefreshAttempted(false)
    overallSetupActiveRef.current = true
    setCoreSetupStageLabel("Preparing secure wallet")
    setPendingSync(true)
    markWalletSetupInProgress()
    // A new explicit click always supersedes a prior cancellation (Part G) - only
    // background/automatic resume is blocked by it, never a merchant-initiated retry.
    clearWalletSetupCancelled()
    // Explicit create/retry attempt: open the wallet as soon as the core profile
    // saves instead of leaving the merchant on the setup card.
    autoOpenWalletAfterCreateRef.current = true
    return true
  }

  async function copyAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address)
      setCopiedAddress(address)
      window.setTimeout(() => setCopiedAddress(""), 1800)
    } catch {
      setCopiedAddress("")
    }
  }

  async function handleOpenWallet() {
    setWalletSetupAttemptId(createWalletSetupAttemptId())
    setWalletSetupFailureReason(null)
    // An active or outcome-uncertain withdrawal must be resumed on reopen,
    // never buried back under "overview" - the merchant would otherwise have
    // no way to see whether it succeeded without hunting through tabs.
    setActiveView(isWithdrawalActivelyProcessing() ? "withdraw" : null)
    setWalletOpening(true)
    setOpenWalletReconnectNeeded(false)
    console.info("[pinetree-wallets] open_wallet_sync_requested", {
      dynamicAuthenticated: Boolean(user),
      dynamicUserId: user?.userId ?? null,
      sdkHasLoaded,
      dynamicWalletRuntimeCount,
      baseAddressPresent: dynamicNetworkAddresses.base.length > 0,
      solanaAddressPresent: dynamicNetworkAddresses.solana.length > 0,
      waasRuntimeWalletCount: waasRuntimeWallets.length,
      waasCredentialWalletSourceCount: waasCredentialWalletSources.length,
      waasCredentialSignerWalletCount: waasCredentialSignerWallets.length,
    })
    overallSetupActiveRef.current = true
    setPendingSync(true)
    markWalletSetupInProgress()
    setProvisioningRetryExhausted(false)
    setFinalProvisioningRefreshAttempted(false)
    pendingProfileSyncAttemptRef.current = false
    if (hasReadyBaseAndSolanaProfile) {
      overallSetupActiveRef.current = false
      setPendingSync(false)
      clearWalletSetupInProgress()
      setWalletOpening(false)
      setWalletOpen(true)
      return
    }
    if (!user) {
      logWalletCreationStep("waiting_for_dynamic_auth", { reason: "open_wallet_sync_missing_dynamic_user" })
      setShowDynamicUserProfile(false)
      openDynamicEmailFallbackAuth("open_wallet_sync_missing_dynamic_user")
      setWalletOpening(false)
      return
    }
    if (!sdkHasLoaded) {
      setWalletOpening(false)
      return
    }

    const firstRefreshReady = await refreshDynamicWalletRuntime("open_wallet_sync_profile", { requireApprovalWallet: false })
    const firstOpenReady = firstRefreshReady && (await waitForOpenWalletReadiness())

    if (!firstOpenReady) {
      console.info("[pinetree-wallets] open_wallet_runtime_retry", {
        dynamicAuthenticated: Boolean(user),
        dynamicUserId: user?.userId ?? null,
        dynamicWalletRuntimeCount: dynamicWalletRuntimeCountRef.current,
      })
      const retryRefreshReady = await refreshDynamicWalletRuntime("open_wallet_sync_profile_retry", { requireApprovalWallet: false })
      const retryOpenReady = retryRefreshReady && (await waitForOpenWalletReadiness())
      if (!retryOpenReady) {
        setPendingSync(false)
        setWalletOpening(false)
        setOpenWalletReconnectNeeded(true)
        recordWalletSetupFailure("dynamic_auth_missing", "failed", {
          reason: "open_wallet_runtime_refresh_failed",
          dynamicUserId: user.userId ?? null,
          dynamicWalletRuntimeCount: dynamicWalletRuntimeCountRef.current,
        })
        return
      }
    }

    setWalletOpening(false)
    setWalletOpen(true)
  }

  async function beginWalletSetupRepair(reason: string) {
    setWalletSetupAttemptId(createWalletSetupAttemptId())
    setWalletSetupFailureReason(null)
    logWalletCreationStep("opening_dynamic", { reason })
    setPendingSync(true)
    markWalletSetupInProgress()
    setProvisioningRetryExhausted(false)
    setFinalProvisioningRefreshAttempted(false)
    pendingProfileSyncAttemptRef.current = false
    setWalletOpen(false)
    setShowDynamicUserProfile(false)
    openDynamicEmailFallbackAuth(reason)
    if (sdkHasLoaded && user) {
      void refreshDynamicWalletRuntime(reason, { requireApprovalWallet: false })
    }
  }

  function handleFinishWalletSetup() {
    if (providerSheetGateStateRef.current.walletReady) {
      openDynamicEmailFallbackAuth("finish_embedded_wallet_setup", {
        selectedRail: withdrawalRail,
        explicitUserAction: false,
        signatureRequired: false,
      })
      setWithdrawalAuthorizationRecoveryOpen(true)
      return
    }
    void beginWalletSetupRepair("finish_embedded_wallet_setup")
  }

  async function handleRepairWalletSetup() {
    const token = accessTokenRef.current
    if (!token) {
      void beginWalletSetupRepair("repair_embedded_wallet_setup_missing_auth")
      return
    }
    const profileBeforeRepair = profileState.kind === "loaded" ? profileState.profile : null
    repairProfileIdRef.current = profileBeforeRepair?.id ?? null
    pendingWalletProvisionAttemptRef.current = null
    setRepairInProgress(true)
    setRepairFailedIncomplete(false)
    setProvisioningRetryExhausted(false)
    setFinalProvisioningRefreshAttempted(false)
    pendingProfileSyncAttemptRef.current = false
    setWalletCreationStep("repairing_profile")
    console.info("[pinetree-wallets] repair_before_reset", {
      profileId: profileBeforeRepair?.id ?? null,
      baseAddressPresent: Boolean(profileBeforeRepair?.base_address),
      solanaAddressPresent: Boolean(profileBeforeRepair?.solana_address),
      dynamicUserIdPresent: Boolean(profileBeforeRepair?.dynamic_user_id),
      dynamicWalletCountBeforeRepair: dynamicWalletRuntimeCount,
      hasPrimaryWalletBeforeRepair: Boolean(primaryWallet),
    })
    setSyncing(true)
    try {
      const res = await fetch("/api/wallets/pinetree-profile", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "reset_dynamic_wallet_profile",
        }),
      })
      if (res.ok) {
        const json = (await res.json()) as { profile: PineTreeWalletProfile }
        setProfileState({ kind: "loaded", profile: json.profile })
        console.info("[pinetree-wallets] repair_profile_cleared", {
          profileId: json.profile.id,
          baseAddressPresent: Boolean(json.profile.base_address),
          solanaAddressPresent: Boolean(json.profile.solana_address),
          dynamicUserIdPresent: Boolean(json.profile.dynamic_user_id),
          withdrawalHistoryUntouched: true,
        })
      } else {
        console.warn("[pinetree-wallets] repair_profile_clear_failed", {
          profileId: profileBeforeRepair?.id ?? null,
          status: res.status,
        })
        logWalletCreationStep("failed", { reason: "repair_profile_clear_failed", profile_sync_response_status: res.status })
        setRepairInProgress(false)
        return
      }
    } finally {
      setSyncing(false)
    }
    setWithdrawalReview(null)
    setWithdrawalScreen("form")
    setWithdrawalApprovalError("")
    setWithdrawalError("")
    console.info("[pinetree-wallets] repair_dynamic_session_reset_start", {
      previousProfileId: repairProfileIdRef.current,
      dynamicWalletCountBeforeReset: dynamicWalletRuntimeCount,
      hadDynamicUser: Boolean(user),
    })
    setPendingSync(false)
    setProvisioningRetryExhausted(false)
    setFinalProvisioningRefreshAttempted(false)
    setShowAuthFlow(false)
    setShowDynamicUserProfile(false)
    if (user && handleLogOut) {
      setRepairPendingAfterLogout(true)
      void handleLogOut()
      return
    }
    console.info("[pinetree-wallets] repair_dynamic_session_reset_auth_opened", {
      previousProfileId: repairProfileIdRef.current,
      dynamicWalletCountBeforeAuth: dynamicWalletRuntimeCount,
    })
    logWalletCreationStep("opening_dynamic", { reason: "repair_embedded_wallet_setup_no_active_dynamic_user" })
    setPendingSync(true)
    markWalletSetupInProgress()
    setProvisioningRetryExhausted(false)
    setFinalProvisioningRefreshAttempted(false)
    pendingProfileSyncAttemptRef.current = false
    scheduleDynamicEmailFallbackAuth("repair_embedded_wallet_setup_no_active_dynamic_user")
  }

  async function handleWithdrawalReconnect() {
    const profile = profileState.kind === "loaded" ? profileState.profile : null
    const sourceAddress = getWithdrawalSourceAddress(profile, withdrawalRail)

    if (walletCreationDebugEnabled) {
      const walletList = wallets as DynamicWalletLike[]
      console.info("[pinetree-withdrawals] reconnect_attempt", {
        withdrawalRail,
        withdrawalAsset,
        sourceAddressPresent: Boolean(sourceAddress),
        sourceAddressPrefix: sourceAddress?.slice(0, 8) ?? null,
        dynamicWalletCountBefore: (wallets as unknown[]).length,
        hasPrimaryWallet: Boolean(primaryWallet),
        dynamicWalletAddressPrefixesBefore: walletList.map((w) =>
          getDynamicWalletAddresses(w)
            .map((a) => a.slice(0, 8))
            .join(",")
        ),
      })
    }

    // Save source address for the post-reconnect effect to check against loaded wallets.
    withdrawalReconnectSourceRef.current = sourceAddress
    setWithdrawalApprovalError("")
    setActiveView("withdraw")
    setWalletOpen(true)
    await refreshDynamicWalletRuntime("withdrawal_reconnect_before_lookup", { requireApprovalWallet: Boolean(withdrawalReview) })

    // If Dynamic wallets are already loaded, check for a match immediately.
    const allWalletCount = dynamicWalletRuntimeCount
    if (allWalletCount > 0 && sourceAddress) {
      const matched = findDynamicApprovalWalletForSource(wallets as unknown[], primaryWallet, withdrawalRail, sourceAddress)
      if (walletCreationDebugEnabled) {
        const walletLike = matched as DynamicWalletLike | null
        console.info("[pinetree-withdrawals] reconnect_wallets_present", {
          dynamicWalletCount: (wallets as unknown[]).length,
          matchingWalletFound: Boolean(matched),
          hasSolanaSigner: Boolean(
            walletLike && resolveDynamicSolanaSignAndSendCapability(walletLike).hasSignAndSendTransaction
          ),
          hasEvmClient: Boolean(
            walletLike && (walletLike.getWalletClient || walletLike.connector?.getWalletClient)
          ),
        })
      }
      if (matched) {
        // Wallet is already active and matches - return to form; values are preserved.
        await syncProfileFromDynamic()
        setWithdrawalScreen(withdrawalReview ? "review" : "form")
        return
      }
      // Wallets are loaded but none match the saved address - different account or session.
    }

    // No Dynamic wallets are active. Trigger the Dynamic auth flow to reconnect the session.
    // The post-reconnect useEffect will re-run address matching once wallets load.
    if (providerSheetGateStateRef.current.walletReady) {
      openDynamicEmailFallbackAuth("withdrawal_reconnect", {
        selectedRail: withdrawalRail,
        explicitUserAction: false,
        signatureRequired: false,
      })
      setWithdrawalReconnectPending(false)
      setWithdrawalApprovalError(pineTreeSignerReconnectMessage)
      return
    }
    setWithdrawalReconnectPending(true)
    setWithdrawalScreen(withdrawalReview ? "review" : "form")
    void syncProfileFromDynamic()
    setShowDynamicUserProfile(false)
    setShowAuthFlow(false)
    scheduleDynamicEmailFallbackAuth("withdrawal_reconnect", {
      selectedRail: withdrawalRail,
      explicitUserAction: true,
      signatureRequired: false,
    })
  }

  function handleCreateWallet() {
    emitWalletSetupDebugEvent("wallet_create_clicked", {
      sdkLoaded: sdkHasLoaded,
      userPresent: Boolean(user),
      businessProfileComplete: businessProfileGateReady,
    })
    if (!businessProfileGateReady) {
      blockWalletSetupForBusinessProfile("create_pinetree_wallet")
      return
    }
    if (walletSetupStartInFlightRef.current || (pendingSync && !provisioningRetryExhausted)) return
    void createPineTreeWalletSetup({ retry: false })
  }

  // Single orchestrator for Create PineTree Wallet and Try Again. Starts the core
  // Dynamic wallet task and Speed/Lightning provisioning at the same time - neither
  // waits for the other, and Promise.allSettled plus non-throwing tasks guarantee a
  // Speed rejection can never short-circuit or fail core wallet creation.
  async function createPineTreeWalletSetup(options: { retry: boolean }) {
    if (!businessProfileGateReady) {
      blockWalletSetupForBusinessProfile(options.retry ? "retry_pinetree_wallet" : "create_pinetree_wallet")
      return
    }
    emitWalletSetupDebugEvent("wallet_setup_orchestrator_started", { retry: options.retry })
    try {
      const [coreResult, lightningResult] = await Promise.allSettled([
        startCoreDynamicWallet(options),
        provisionSpeedLightning(),
      ])
      const core = coreResult.status === "fulfilled" ? coreResult.value : "failed"
      const lightning = lightningResult.status === "fulfilled" ? lightningResult.value : "failed"
      emitWalletSetupDebugEvent("wallet_setup_orchestrator_settled", { core, lightning })
    } finally {
      walletSetupStartInFlightRef.current = null
    }
  }

  // Kicks off core Dynamic wallet setup: reuse an existing Dynamic user when present,
  // otherwise attempt external JWT sign-in (with its own native-auth fallback when
  // Dynamic rejects BYOA). Address detection and the profile POST continue through the
  // pendingSync-driven effects; "started" means the core pipeline is now running.
  async function startCoreDynamicWallet(options: { retry: boolean }): Promise<"started" | "needs_user_auth" | "failed"> {
    emitWalletSetupDebugEvent("wallet_core_setup_started", { retry: options.retry })
    if (options.retry) {
      if (!beginWalletProvisioningAttempt("provisioning_wallet", "restart_embedded_wallet_runtime_polling", { retry: true })) return "started"
      if (sdkHasLoaded && user) {
        void refreshDynamicWalletRuntime("retry_embedded_wallet_setup", { requireApprovalWallet: false })
      } else {
        openDynamicEmailFallbackAuth("retry_embedded_wallet_setup_missing_dynamic_user")
      }
      return "started"
    }
    if (hasStaleDynamicSession && user) {
      logWalletCreationStep("opening_dynamic", { reason: "stale_dynamic_session_logout" })
      setLogoutPending(true)
      void handleLogOut?.()
      return "needs_user_auth"
    }
    if (sdkHasLoaded && user) {
      // An existing Dynamic user skips external JWT entirely and goes straight to
      // embedded wallet provisioning + profile save.
      if (!beginWalletProvisioningAttempt("opening_dynamic", "create_authenticated_dynamic_user")) return "started"
      emitWalletSetupStageDiagnostic("wallet_create_dynamic_auth_complete", "dynamic_auth_complete")
      void refreshDynamicWalletRuntime("create_embedded_wallet_setup", { requireApprovalWallet: false })
      return "started"
    }
    if (!dynamicAuthConfig.configValid) {
      blockDynamicEmailFallbackAuth("create_pinetree_wallet")
      return "failed"
    }
    if (pineTreeControlledDynamicAuthAvailable) {
      if (!beginWalletProvisioningAttempt("opening_dynamic", "create_pinetree_wallet")) return "started"
      openDynamicEmailFallbackAuth("create_pinetree_wallet")
      return "started"
    }
    requestDynamicVerificationPrompt("create_pinetree_wallet")
    return "needs_user_auth"
  }

  // Speed/Lightning provisioning runs concurrently with core Dynamic wallet setup.
  // It never throws into the orchestrator, never touches core failure state, and its
  // outcome only feeds the combined readiness (syncWalletReadiness) effect via
  // lightningProfileState.
  async function provisionSpeedLightning(): Promise<"ready" | "pending" | "needs_attention" | "failed"> {
    emitWalletSetupDebugEvent("wallet_speed_setup_started", {})
    if (!businessProfileGateReady) {
      emitWalletSetupDebugEvent("wallet_speed_setup_skipped_business_profile_required", {})
      return "failed"
    }
    if (speedProvisionInFlightRef.current) return "pending"
    speedProvisionInFlightRef.current = true
    try {
      const token = accessTokenRef.current
      if (!token) {
        emitWalletSetupDebugEvent("wallet_speed_setup_failed", { reason: "missing_auth_token" })
        return "failed"
      }
      const res = await fetch("/api/wallets/lightning/pinetree-managed", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
        cache: "no-store",
      })
      const json = (await res.json().catch(() => ({ profile: null }))) as ManagedLightningResponse
      const normalizedProfile = json.profile
        ? {
            ...json.profile,
            status: json.rail?.status === "failed" || json.rail?.status === "incomplete"
              ? json.profile.status
              : json.rail?.status ?? json.profile.status,
            rail: json.rail?.rail,
            display_name: json.rail?.display_name,
            connected: json.rail?.connected,
            provider_error_message: json.rail?.message ?? json.merchantMessage ?? json.profile.provider_error_message,
          }
        : null
      if (normalizedProfile) {
        setLightningProfileState({ kind: "loaded", profile: normalizedProfile })
      }
      if (!res.ok && json.status !== "needs_attention") {
        emitWalletSetupDebugEvent("wallet_bitcoin_setup_failed", { status: res.status })
        return "failed"
      }
      const status = json.rail?.status ?? json.profile?.status ?? json.status
      if (status === "ready") {
        emitWalletSetupDebugEvent("wallet_bitcoin_setup_success", {})
        return "ready"
      }
      if (status === "needs_attention") {
        emitWalletSetupDebugEvent("wallet_bitcoin_setup_failed", { reason: "needs_attention" })
        return "needs_attention"
      }
      emitWalletSetupDebugEvent("wallet_bitcoin_setup_pending", {})
      return "pending"
    } catch {
      emitWalletSetupDebugEvent("wallet_bitcoin_setup_failed", { reason: "request_threw" })
      return "failed"
    } finally {
      speedProvisionInFlightRef.current = false
    }
  }

  function handleUsePineTreeAccountEmail() {
    setWalletSetupAttemptId(createWalletSetupAttemptId())
    setWalletSetupFailureReason(null)
    clearWalletSetupInProgress()
    setPendingSync(false)
    setSyncing(false)
    setRepairInProgress(false)
    setRepairFailedIncomplete(false)
    setProvisioningRetryExhausted(false)
    setFinalProvisioningRefreshAttempted(false)
    pendingWalletProvisionAttemptRef.current = null
    pendingProfileSyncAttemptRef.current = false
    pendingWalletProvisionStartedAtRef.current = null
    walletSetupStartInFlightRef.current = null
    setShowAuthFlow(false)
    setShowDynamicUserProfile(false)
    logWalletCreationStep("waiting_for_dynamic_auth", {
      reason: "restart_after_dynamic_email_mismatch",
    })
    setWalletIdentityError("")
    setIdentityMismatchError(null)
    setIdentityUnverified(false)
    if (user && handleLogOut) {
      setLogoutPending(true)
      void handleLogOut()
      return
    }
    setPendingSync(true)
    markWalletSetupInProgress()
    scheduleDynamicEmailFallbackAuth("restart_after_dynamic_email_mismatch")
  }

  function handleRetryWalletSetup() {
    const retryFailureReason = walletSetupFailureReason
    emitWalletSetupDebugEvent("wallet_retry_clicked", {
      reason: retryFailureReason || "none",
      sdkLoaded: sdkHasLoaded,
      userPresent: Boolean(user),
      runtimeWalletCount: dynamicWalletRuntimeCount,
    })
    if (emailMismatchActive || emailUnverifiedActive || (walletIdentityError && user)) {
      handleUsePineTreeAccountEmail()
      return
    }
    if (retryFailureReason === "dynamic_auth_missing" || retryFailureReason === "dynamic_auth_cancelled" || retryFailureReason === "dynamic_user_missing") {
      setWalletSetupAttemptId(createWalletSetupAttemptId())
      setWalletSetupFailureReason(null)
      setShowDynamicUserProfile(false)
      openDynamicEmailFallbackAuth("retry_dynamic_auth_missing")
      return
    }
    if (retryFailureReason === "profile_sync_failed") {
      setWalletSetupFailureReason(null)
      void syncProfileFromDynamic()
      return
    }
    if (retryFailureReason === "provider_sync_failed") {
      setWalletSetupFailureReason(null)
      const token = accessTokenRef.current
      if (token) {
        void fetch("/api/wallets/pinetree-wallet/rail-sync", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }).then(() => fetchProviderRailState(token)).catch(() => undefined)
      }
      return
    }
    setPendingSync(false)
    setLogoutPending(false)
    setSyncing(false)
    setRepairInProgress(false)
    setRepairFailedIncomplete(false)
    setProvisioningRetryExhausted(false)
    setFinalProvisioningRefreshAttempted(false)
    pendingWalletProvisionAttemptRef.current = null
    pendingProfileSyncAttemptRef.current = false
    pendingWalletProvisionStartedAtRef.current = null
    walletSetupStartInFlightRef.current = null
    setShowAuthFlow(false)
    window.setTimeout(() => {
      void createPineTreeWalletSetup({ retry: true })
    }, 0)
  }

  async function handleResetPineTreeWalletSetup() {
    const token = accessTokenRef.current
    if (!token || !merchantId) return
    setResettingWalletSetup(true)
    try {
      const res = await fetch("/api/debug/pinetree-wallet/reset-setup", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ merchant_id: merchantId }),
      })
      if (!res.ok) return
      clearWalletSetupInProgress()
      setProfileState({ kind: "none" })
      setEnabledRails(defaultEnabledRails)
      setRailReadiness(null)
      setWalletSync(defaultWalletSyncState)
      setWalletSetupStage("idle")
      setWalletSetupFailureReason(null)
      setWalletCreationStep("idle")
      setPendingSync(false)
      setSyncing(false)
      setRepairInProgress(false)
      setRepairFailedIncomplete(false)
      setIdentityMismatchError(null)
      setIdentityUnverified(false)
      setWalletIdentityError("")
      console.warn("[pinetree-wallets] setup_reset_requested", {
        merchantId,
        untouched: ["payments", "ledger", "transactions"],
      })
    } finally {
      setResettingWalletSetup(false)
    }
  }

  function handleWithdrawalAssetSelect(nextRail: WithdrawalRail, nextAsset: WithdrawalAsset) {
    setWithdrawalRail(nextRail)
    setWithdrawalAsset(nextAsset)
    setWithdrawalScreen("form")
    setWithdrawalReview(null)
    setWithdrawalSubmitResult(null)
    setWithdrawalError("")
    setWithdrawalApprovalError("")
    setInstantSendIdempotencyKey(null)
    setMaxWarning("")
  }

  const handleOverviewRailSelect = useCallback((rail: WithdrawalRail) => {
    setActiveView(walletRailDetailView(rail))
  }, [])

  function handleAssetDetailWithdraw(rail: WithdrawalRail, asset: WithdrawalAsset) {
    if (isWithdrawalActivelyProcessing()) {
      setActiveView("withdraw")
      return
    }
    resetWithdrawalDraft()
    setWithdrawalRail(rail)
    setWithdrawalAsset(asset)
    setActiveView("withdraw")
  }

  function handleEditWithdrawal() {
    setWithdrawalScreen("form")
    setWithdrawalSubmitResult(null)
    setWithdrawalApprovalError("")
    setWithdrawalError("")
  }

  // A withdrawal request row already exists server-side and its outcome
  // isn't known yet - this must never be silently discardable (Cancel,
  // backdrop click, X) or resubmittable as a fresh withdrawal. Covers: an
  // in-flight review/submit network call, the Dynamic approval sheet, an
  // already-submitted result, and the "still pending" status-unknown case
  // surfaced on the failed screen after a submit timeout.
  function isWithdrawalActivelyProcessing() {
    if (reviewingWithdrawal || submittingWithdrawal) return true
    if (withdrawalScreen === "approving" || withdrawalScreen === "submitted") return true
    if (withdrawalScreen === "failed" && withdrawalApprovalError === withdrawalStatusUnknownMessage) return true
    return false
  }

  // Clears only client-side draft/UI state - never touches a withdrawal
  // request row that already exists server-side (that row keeps its own
  // lifecycle regardless of what the merchant does in the UI afterward).
  function resetWithdrawalDraft() {
    setWithdrawalDestination("")
    setWithdrawalSelectedDestinationId(null)
    setWithdrawalAmount("")
    setWithdrawalScreen("form")
    setWithdrawalReview(null)
    setWithdrawalSubmitResult(null)
    setWithdrawalError("")
    setWithdrawalApprovalError("")
    setInstantSendIdempotencyKey(null)
    setMaxWarning("")
  }

  function handleCancelWithdrawal() {
    if (isWithdrawalActivelyProcessing()) return
    resetWithdrawalDraft()
  }

  function handleDoneWithdrawal() {
    resetWithdrawalDraft()
    setActiveView(null)
  }

  // Address Book "Withdraw" shortcut: the merchant should never need to
  // reselect anything after picking a saved destination there. Destination
  // ownership was already validated server-side by the authenticated fetch
  // that populated the Address Book list; submitting still re-validates
  // ownership/rail/asset match via destination_id server-side (canonicalWithdrawal.ts).
  function handleWithdrawShortcut(destination: {
    id: string
    rail: "base" | "solana" | "bitcoin"
    asset: "ETH" | "USDC" | "SOL" | "BTC"
    method: "onchain" | "lightning" | null
    destination_address: string
  }) {
    resetWithdrawalDraft()
    setWithdrawalRail(destination.rail)
    setWithdrawalAsset(destination.asset)
    if (destination.rail === "bitcoin" && destination.method) {
      setWithdrawalBitcoinTransferType(destination.method)
    }
    setWithdrawalDestination(destination.destination_address)
    setWithdrawalSelectedDestinationId(destination.id)
    setActiveView("withdraw")
  }

  async function handleReviewWithdrawal() {
    const token = accessTokenRef.current
    const destination = withdrawalDestination.trim()
    const rawAmount = withdrawalAmount.trim()
    // Normalize leading-dot input (.01 -> 0.01) so the review card and API payload
    // always receive a canonical decimal string.
    const amount = rawAmount.startsWith(".") ? `0${rawAmount}` : rawAmount

    setWithdrawalReview(null)
    setWithdrawalSubmitResult(null)
    setWithdrawalScreen("form")
    setWithdrawalApprovalError("")
    const correlationId = crypto.randomUUID().slice(0, 8)
    withdrawalCorrelationIdRef.current = correlationId
    emitWalletSetupDebugEvent("wallet_withdrawal_review_requested", {
      correlationId,
      rail: withdrawalRail,
      asset: withdrawalAsset,
    })
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
    const amountSats = withdrawalRail === "bitcoin" ? btcDecimalToSats(amount) : null
    if (withdrawalRail === "bitcoin" ? !amountSats || BigInt(amountSats) <= BigInt(0) : !(amountNumber > 0)) {
      setWithdrawalError("Enter an amount greater than 0.")
      return
    }
    const selectedAvailableToWithdraw = selectedWithdrawalBalance?.availableToWithdraw ?? (
      selectedWithdrawalBalance?.balance != null ? String(selectedWithdrawalBalance.balance) : null
    )
    if (selectedWithdrawalBalance?.status === "synced" && selectedAvailableToWithdraw !== null) {
      const availableSats = withdrawalRail === "bitcoin"
        ? btcDecimalToSats(selectedAvailableToWithdraw)
        : null
      const availableBalance = Number(selectedAvailableToWithdraw)
      if (withdrawalRail === "bitcoin" ? !availableSats || BigInt(availableSats) <= BigInt(0) : availableBalance <= 0) {
        setWithdrawalError("No available balance for this asset.")
        return
      }
      if (
        withdrawalRail === "bitcoin"
          ? Boolean(amountSats && availableSats && BigInt(amountSats) > BigInt(availableSats))
          : amountNumber > availableBalance
      ) {
        setWithdrawalError("Amount exceeds available balance.")
        return
      }
    }
    if (withdrawalRail === "bitcoin" && selectedWithdrawalBalance?.status !== "synced") {
      setWithdrawalError("Balance temporarily unavailable. Refresh before withdrawing.")
      return
    }
    if (!withdrawalAssetsByRail[withdrawalRail].includes(withdrawalAsset)) {
      setWithdrawalError("Unsupported rail/asset combination.")
      return
    }
    if (!withdrawableAssetOptions.some((option) => option.rail === withdrawalRail && option.asset === withdrawalAsset)) {
      setWithdrawalError("Withdrawals are being finalized. Receiving funds is available now.")
      return
    }
    if (withdrawalRail === "bitcoin") {
      try {
        const maxRes = await fetch("/api/wallets/pinetree-wallet/withdrawals/max-estimate", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ rail: "bitcoin", asset: "BTC" }),
        })
        const maxJson = await maxRes.json()
        const maxDecimal = maxJson?.estimate?.maxDecimal != null ? String(maxJson.estimate.maxDecimal) : ""
        const maxSats = maxDecimal ? btcDecimalToSats(maxDecimal) : null
        if (!maxRes.ok || maxSats === null) {
          setWithdrawalError("Available-to-withdraw could not be verified. Refresh before withdrawing.")
          return
        }
        if (amountSats && BigInt(amountSats) > BigInt(maxSats)) {
          const warning = maxJson?.estimate?.warning || "This Max leaves room for Speed provider/network fees."
          setMaxWarning(warning)
          setWithdrawalError(`Amount exceeds available to withdraw after estimated fees. Max is ${maxDecimal} BTC.`)
          emitWalletSetupDebugEvent("SPEED_MAX_CALCULATED", {
            correlationId,
            rail: "bitcoin",
            asset: "BTC",
            requestedSats: amountSats,
            maxSats,
          })
          return
        }
      } catch {
        setWithdrawalError("Available-to-withdraw could not be verified. Refresh before withdrawing.")
        return
      }
      setInstantSendIdempotencyKey((current) => current ?? crypto.randomUUID())
      setWithdrawalReview({
        request: {
          id: `instant-send:${crypto.randomUUID()}`,
          status: "review_required",
          provider_reference: null,
          tx_hash: null,
          error_message: null,
        },
        review: {
          rail: "bitcoin",
          asset: "BTC",
          destinationAddress: destination,
          amountDecimal: amount,
          estimatedStatus: "Ready to submit",
          approvalMethod: "manual_review",
          message: "Confirm this Bitcoin Lightning withdrawal.",
        },
        canSubmit: true,
      })
      setWithdrawalError("")
      setWithdrawalScreen("review")
      emitWalletSetupDebugEvent("wallet_withdrawal_review_screen_shown", {
        correlationId,
        rail: "bitcoin",
        approvalMethod: "manual_review",
      })
      return
    }
    // Everything below can call into the Dynamic SDK and does real async work -
    // wrapped in a top-level try/catch so an uncaught throw here (SDK exception,
    // malformed wallet object, etc.) always clears loading state and shows a
    // visible error instead of silently leaving the merchant on the form with
    // no feedback and no server request ever sent (CLIENT_REVIEW_UNHANDLED_ERROR).
    try {
      const reviewSourceAddress = getWithdrawalSourceAddress(profile, withdrawalRail)
      const usesDynamicSignerForReview = withdrawalRail === "base" || withdrawalRail === "solana"
      let reviewSigner = usesDynamicSignerForReview
        ? findDynamicApprovalWalletForSource(wallets as unknown[], primaryWallet, withdrawalRail, reviewSourceAddress)
        : true
      let runtimeCountForReviewGate = dynamicWalletRuntimeCount
      // Base/Solana only: the Dynamic wallet runtime may simply still be hydrating
      // (fresh page load, recent reconnect) rather than genuinely disconnected -
      // give it one bounded retry before treating this as a real failure. Bitcoin
      // never reaches this gate (it returns above, before this point) so this
      // never blocks Speed-executed withdrawals.
      if (usesDynamicSignerForReview && sdkHasLoaded && user && (runtimeCountForReviewGate === 0 || !reviewSigner)) {
        setReviewingWithdrawal(true)
        await refreshDynamicWalletRuntime("withdrawal_review_before_signer_check", { requireApprovalWallet: true })
        runtimeCountForReviewGate = dynamicWalletRuntimeCountRef.current
        // Read via the refs, not the closed-over `wallets`/`primaryWallet` - the
        // refresh above may have just hydrated the SDK's wallet list, but this
        // function's own `wallets` binding was fixed when its closure was
        // created and never updates mid-execution (see walletsRef comment).
        reviewSigner = findDynamicApprovalWalletForSource(walletsRef.current, primaryWalletRef.current, withdrawalRail, reviewSourceAddress)
      }
      // Block review when the Dynamic wallet runtime has no usable signer - creating a withdrawal request
      // row now would result in pending spam that can never be signed in this session.
      if (sdkHasLoaded && user && (runtimeCountForReviewGate === 0 || !reviewSigner)) {
        if (walletCreationDebugEnabled) {
          console.info("[pinetree-wallets] withdrawal_review_blocked_no_runtime_wallets", {
            dynamicUserId: user.userId,
            sdkHasLoaded,
            dynamicWalletRuntimeCount: runtimeCountForReviewGate,
            withdrawalRail,
            withdrawalAsset,
            sourceAddressPresent: Boolean(reviewSourceAddress),
            matchingDynamicWallet: Boolean(reviewSigner),
          })
        }
        emitWalletSetupDebugEvent("wallet_withdrawal_review_blocked", {
          correlationId,
          rail: withdrawalRail,
          reason: "no_matching_dynamic_wallet",
        })
        setReviewingWithdrawal(false)
        setWithdrawalError(pineTreeSignerReconnectMessage)
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
            "X-PineTree-Withdrawal-Correlation": correlationId,
          },
          body: JSON.stringify({
            rail: withdrawalRail,
            asset: withdrawalAsset,
            destination_address: destination,
            amount_decimal: amount,
            destination_id: withdrawalSelectedDestinationId || undefined,
          }),
        })
        const json = (await res.json()) as WithdrawalReviewResponse | { error?: string; error_code?: string }
        if (!res.ok) {
          emitWalletSetupDebugEvent("wallet_withdrawal_review_blocked", {
            correlationId,
            rail: withdrawalRail,
            reason: "server_rejected",
            httpStatus: res.status,
          })
          setWithdrawalError(
            sanitizeWithdrawalErrorForMerchant(
              "error" in json ? json.error : undefined,
              "error_code" in json ? json.error_code : undefined
            )
          )
          return
        }
        const typedJson = json as WithdrawalReviewResponse
        if (!typedJson?.request?.id || !typedJson.review) {
          // The route's real response shape didn't match what this client
          // expects - fail loud with a specific, visible error instead of
          // storing a malformed review that silently disables every action
          // on the review screen (canSubmit undefined -> button permanently
          // disabled with no explanation).
          emitWalletSetupDebugEvent("wallet_withdrawal_review_blocked", {
            correlationId,
            rail: withdrawalRail,
            reason: "malformed_response_shape",
          })
          setWithdrawalError("We couldn't read this withdrawal review. Please try again.")
          return
        }
        setWithdrawalReview(typedJson)
        setWithdrawalScreen("review")
        emitWalletSetupDebugEvent("wallet_withdrawal_review_received", {
          correlationId,
          rail: typedJson.review.rail,
          approvalMethod: typedJson.review.approvalMethod ?? "unknown",
          canSubmit: typedJson.canSubmit,
          requestId: typedJson.request.id,
        })
        emitWalletSetupDebugEvent("wallet_withdrawal_review_screen_shown", {
          correlationId,
          rail: typedJson.review.rail,
          approvalMethod: typedJson.review.approvalMethod ?? "unknown",
        })
      } catch {
        setWithdrawalError("We couldn't create this withdrawal request. Please try again.")
      } finally {
        setReviewingWithdrawal(false)
      }
    } catch (error) {
      console.warn("[pinetree-withdrawals] handleReviewWithdrawal_unhandled_error", {
        rail: withdrawalRail,
        asset: withdrawalAsset,
        error: error instanceof Error ? error.message : "unknown",
      })
      emitWalletSetupDebugEvent("wallet_withdrawal_submit_unhandled_error", {
        correlationId,
        stage: "review",
        rail: withdrawalRail,
      })
      setWithdrawalError("We couldn't prepare this withdrawal for review. Please try again.")
      setReviewingWithdrawal(false)
    }
  }

  /**
   * The true spendable amount, not just the displayed balance: accounts for
   * confirmed balance, pending outgoing amounts, provider/RPC-estimated
   * network fees, and a configured native-gas reserve (see
   * engine/withdrawals/withdrawalFeeEstimate.ts). For token withdrawals
   * (USDC), never subtracts gas from the token balance itself - blocks with
   * a clear message instead if the native asset can't cover the fee.
   */
  async function handleMaxWithdrawalAmount() {
    const token = accessTokenRef.current
    const selectedAvailableToWithdraw = selectedWithdrawalBalance?.availableToWithdraw ?? (
      selectedWithdrawalBalance?.balance != null ? String(selectedWithdrawalBalance.balance) : null
    )
    if (
      !token ||
      selectedWithdrawalBalance?.status !== "synced" ||
      selectedAvailableToWithdraw === null ||
      Number(selectedAvailableToWithdraw) <= 0
    ) {
      return
    }
    setMaxWarning("")
    setMaxEstimating(true)
    try {
      const res = await fetch("/api/wallets/pinetree-wallet/withdrawals/max-estimate", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ rail: withdrawalRail, asset: withdrawalAsset }),
      })
      const json = await res.json()
      if (!res.ok || !json?.estimate) {
        setWithdrawalError("Available-to-withdraw could not be verified. Refresh before withdrawing.")
        return
      } else if (json.estimate.blocked) {
        setMaxWarning(json.estimate.warning || "This withdrawal is currently blocked.")
        setWithdrawalAmount("0")
      } else {
        setWithdrawalAmount(json.estimate.maxDecimal)
        if (json.estimate.warning) setMaxWarning(json.estimate.warning)
      }
    } catch {
      setWithdrawalError("Available-to-withdraw could not be verified. Refresh before withdrawing.")
      return
    } finally {
      setMaxEstimating(false)
    }
    setWithdrawalScreen("form")
    setWithdrawalReview(null)
    setWithdrawalSubmitResult(null)
    setWithdrawalError("")
    setWithdrawalApprovalError("")
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
          json.request.status === "confirmed"
            ? "Confirmed"
            : json.request.status === "processing"
            ? "Processing"
            : json.request.status === "failed"
              ? "Withdrawal failed"
              : initial.merchantStatus
        setWithdrawalSubmitResult({
          ...initial,
          request: json.request,
          merchantStatus: nextStatus,
        })
        if (nextStatus === "Withdrawal failed") setWithdrawalScreen("failed")
        if (json.request.status === "processing" || json.request.status === "confirmed" || json.request.status === "failed") {
          void syncPineTreeWallet()
          return
        }
      } catch {
        return
      }
    }
  }

  async function handleSubmitWithdrawal(context: WithdrawalSubmitContext = {}) {
    const token = accessTokenRef.current
    const review = withdrawalReview
    const withdrawalId = review?.request.id
    const correlationId = withdrawalCorrelationIdRef.current ?? "none"
    const submitRail = review?.review.rail ?? withdrawalRail
    const submitAsset = review?.review.asset ?? withdrawalAsset
    const submitStage = "pre_prepare"
    const emitSubmitBlocked = (reason: string) => {
      emitWalletSetupDebugEvent("wallet_withdrawal_submit_blocked", {
        correlationId,
        stage: submitStage,
        rail: submitRail,
        asset: submitAsset,
        requestId: withdrawalId ?? "none",
        reason,
      })
    }
    emitWalletSetupDebugEvent("wallet_withdrawal_submit_entered", {
      correlationId,
      stage: "submit_entered",
      rail: submitRail,
      asset: submitAsset,
      requestId: withdrawalId ?? "none",
    })
    emitWalletSetupDebugEvent("wallet_withdrawal_approve_clicked", {
      correlationId,
      stage: "approve_clicked",
      rail: submitRail,
      asset: submitAsset,
      requestId: withdrawalId ?? "none",
    })

    if (submittingWithdrawal) {
      const reason = "SUBMIT_ALREADY_RUNNING"
      console.warn("[pinetree-withdrawals] handleSubmitWithdrawal_blocked", { reason })
      emitSubmitBlocked(reason)
      return
    }
    if (!context.irreversibleAckChecked) {
      const reason = "CHECKBOX_NOT_CONFIRMED"
      console.warn("[pinetree-withdrawals] handleSubmitWithdrawal_blocked", { reason })
      emitSubmitBlocked(reason)
      setWithdrawalApprovalError("Confirm the acknowledgment above to enable withdrawal approval.")
      setWithdrawalScreen("review")
      return
    }
    if (!token) {
      const reason = "TOKEN_MISSING"
      console.warn("[pinetree-withdrawals] handleSubmitWithdrawal_blocked", { reason })
      emitSubmitBlocked(reason)
      setWithdrawalApprovalError(
        "Wallet session is not available. Refresh the page and try again."
      )
      setWithdrawalScreen("failed")
      return
    }
    if (!review) {
      const reason = "REVIEW_MISSING"
      console.warn("[pinetree-withdrawals] handleSubmitWithdrawal_blocked", { reason })
      emitSubmitBlocked(reason)
      setWithdrawalApprovalError("This withdrawal review has expired. Go back and review it again.")
      setWithdrawalScreen("failed")
      return
    }
    if (!withdrawalId) {
      const reason = "REQUEST_ID_MISSING"
      console.warn("[pinetree-withdrawals] handleSubmitWithdrawal_blocked", { reason })
      emitSubmitBlocked(reason)
      setWithdrawalApprovalError("This withdrawal review has expired. Go back and review it again.")
      setWithdrawalScreen("failed")
      return
    }

    if (review.review.rail === "bitcoin") {
      const amountSats = btcDecimalToSats(review.review.amountDecimal)
      if (!amountSats || !instantSendIdempotencyKey) {
        emitSubmitBlocked("REQUEST_ID_MISSING")
        setWithdrawalApprovalError("Review this withdrawal again before submitting.")
        setWithdrawalScreen("failed")
        return
      }
      setSubmittingWithdrawal(true)
      setWithdrawalError("")
      setWithdrawalApprovalError("")
      setWithdrawalSubmitResult(null)
      setWithdrawalScreen("approving")
      try {
        emitWalletSetupDebugEvent("wallet_withdrawal_speed_submit_requested", { correlationId })
        const response = await fetch("/api/wallets/withdrawals", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Idempotency-Key": instantSendIdempotencyKey,
            "X-PineTree-Withdrawal-Correlation": correlationId,
          },
          body: JSON.stringify({
            asset: "SATS",
            amount_decimal: amountSats,
            destination: review.review.destinationAddress,
            destination_id: withdrawalSelectedDestinationId || undefined,
          }),
        })
        const result = (await response.json()) as WalletWithdrawalResponse
        emitWalletSetupDebugEvent("wallet_withdrawal_speed_submit_returned", {
          correlationId,
          httpStatus: response.status,
          ok: Boolean(result.ok),
        })
        if (!response.ok || !result.ok || !result.data?.operation) {
          const presented = presentWithdrawalErrorClient({
            code: result.error?.code as WalletApiErrorCode | undefined,
            rawMessage: result.error?.message,
          })
          setWithdrawalApprovalError(presented.code === "STATUS_UNKNOWN" ? withdrawalStatusUnknownMessage : presented.message)
          setWithdrawalScreen(presented.code === "INSUFFICIENT_BALANCE" ? "review" : "failed")
          void syncPineTreeWallet()
          return
        }
        if (["REQUIRES_ACTION", "ACTION_REQUIRED"].includes(String(result.data.operation.status || "").toUpperCase())) {
          setWithdrawalApprovalError(withdrawalStatusUnknownMessage)
          setWithdrawalScreen("failed")
          void syncPineTreeWallet()
          return
        }
        setWithdrawalSubmitResult({
          request: {
            id: result.data.operation.id,
            status: "processing",
            provider_reference: null,
            tx_hash: result.data.operation.txHash ?? null,
            error_message: null,
          },
          merchantStatus: "Processing",
          message: "Your Bitcoin Lightning withdrawal was submitted.",
        })
        setWithdrawalScreen("submitted")
        void syncPineTreeWallet()
      } catch (error) {
        console.warn("[pinetree-withdrawals] speed_submit_unhandled_error", {
          error: error instanceof Error ? error.message : "unknown",
        })
        emitWalletSetupDebugEvent("wallet_withdrawal_submit_unhandled_error", { correlationId, stage: "speed_submit" })
        setWithdrawalApprovalError("We couldn't submit this Bitcoin Lightning withdrawal. Please try again.")
        setWithdrawalScreen("failed")
      } finally {
        setSubmittingWithdrawal(false)
      }
      return
    }

    if (review.review.rail !== withdrawalRail) {
      const reason = "RAIL_MISMATCH"
      console.warn("[pinetree-withdrawals] handleSubmitWithdrawal_blocked", { reason })
      emitSubmitBlocked(reason)
      setWithdrawalApprovalError("This withdrawal review no longer matches your selected network. Go back and review it again.")
      setWithdrawalScreen("failed")
      return
    }
    if (review.review.asset !== withdrawalAsset) {
      const reason = "ASSET_MISMATCH"
      console.warn("[pinetree-withdrawals] handleSubmitWithdrawal_blocked", { reason })
      emitSubmitBlocked(reason)
      setWithdrawalApprovalError("This withdrawal review no longer matches your selected asset. Go back and review it again.")
      setWithdrawalScreen("failed")
      return
    }
    if (review.review.approvalMethod !== "dynamic_browser") {
      const reason = "APPROVAL_METHOD_INVALID"
      console.warn("[pinetree-withdrawals] handleSubmitWithdrawal_blocked", { reason })
      emitSubmitBlocked(reason)
      setWithdrawalApprovalError("This withdrawal cannot be signed in this browser session.")
      setWithdrawalScreen("failed")
      return
    }
    if (!dynamicSignerWithdrawalRails.includes(review.review.rail)) {
      const reason = "RAIL_MISMATCH"
      console.warn("[pinetree-withdrawals] handleSubmitWithdrawal_blocked", { reason })
      emitSubmitBlocked(reason)
      setWithdrawalApprovalError("This network isn't supported for browser approval.")
      setWithdrawalScreen("failed")
      return
    }

    setSubmittingWithdrawal(true)
    setWithdrawalError("")
    setWithdrawalApprovalError("")
    setWithdrawalSubmitResult(null)
    // Everything below performs real Dynamic SDK and network work - wrapped
    // top-to-bottom so an uncaught throw from the SDK's signing call or
    // anything else after prepare always clears loading state and shows a
    // visible error.
    try {
      console.info("[pinetree-withdrawals] approval_state", {
        rail: review.review.rail,
        asset: review.review.asset,
        requestId: withdrawalId,
        approvalMethod: review.review.approvalMethod,
        approvalReady: Boolean(review.canSubmit && review.review.approvalMethod === "dynamic_browser"),
        routeStage: "pre_prepare",
      })

      setWithdrawalScreen("approving")
      // Route by the server's approvalMethod decision, not by client wallet-lookup state.
      // When the server says dynamic_browser, always use prepare -> sign -> complete. If the
      // Dynamic wallet is not found at signing time, the user gets a clear error to retry.
      if (review.review.approvalMethod === "dynamic_browser") {
        emitWalletSetupDebugEvent("wallet_withdrawal_prepare_requested", {
          correlationId,
          stage: "prepare_requested",
          rail: review.review.rail,
          asset: review.review.asset,
          requestId: withdrawalId,
        })
        const prepareRes = await fetch(`/api/wallets/pinetree-wallet/withdrawals/${encodeURIComponent(withdrawalId)}/prepare`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-PineTree-Withdrawal-Correlation": correlationId,
          },
        })
        const prepared = (await prepareRes.json()) as WithdrawalPrepareResponse | { error?: string; error_code?: string }
        emitWalletSetupDebugEvent("wallet_withdrawal_prepare_returned", {
          correlationId,
          httpStatus: prepareRes.status,
          ok: prepareRes.ok,
        })
        if (!prepareRes.ok) {
          // Clear the stale review so the button reverts to "Review withdrawal". The
          // underlying request status may have changed (e.g. already "pending"), and
          // prepare will keep rejecting it. The merchant must re-review to start fresh.
          setWithdrawalReview(null)
          setWithdrawalApprovalError(
            sanitizeWithdrawalSubmitErrorForMerchant(
              "error" in prepared ? prepared.error : undefined,
              "error_code" in prepared ? prepared.error_code : undefined
            )
          )
          setWithdrawalScreen("failed")
          return
        }
        if (!("payload" in prepared) || !prepared.sourceAddress) {
          // The prepare route's real response shape didn't match what this
          // client expects - fail loud instead of handing a malformed
          // payload to the Dynamic signer.
          emitWalletSetupDebugEvent("wallet_withdrawal_submit_blocked", {
            correlationId,
            reason: "CLIENT_PREPARE_MALFORMED_RESPONSE",
          })
          setWithdrawalApprovalError("We couldn't prepare this withdrawal for signing. Please try again.")
          setWithdrawalScreen("failed")
          return
        }

        const dynamicRuntime = await ensureDynamicWalletRuntimeReady(
          prepared as WithdrawalPrepareResponse,
          correlationId,
          withdrawalId
        )

        // Same staleness hazard as the pre-flight checks above, but for the
        // actual signing call: the runtime readiness helper returns the wallet
        // snapshot it just hydrated so this closure does not depend on a future
        // React render to observe refreshed Dynamic wallets.
        emitWalletSetupDebugEvent("wallet_withdrawal_signature_started", { correlationId, requestId: withdrawalId })
        const dynamicSubmission = await sendDynamicPreparedWithdrawal(prepared as WithdrawalPrepareResponse, dynamicRuntime.wallets, dynamicRuntime.primaryWallet, {
          selectedRail: withdrawalRail,
          selectedAsset: withdrawalAsset,
          destinationAddress: withdrawalReview?.review.destinationAddress ?? withdrawalDestination,
          pineTreeProfileSolanaAddress: profile?.solana_address ?? null,
          primaryWallet: dynamicRuntime.primaryWallet,
          switchDynamicWallet,
          requestId: withdrawalId,
          correlationId,
          emitDynamicStage: emitWalletSetupDebugEvent,
        })
        emitWalletSetupDebugEvent("wallet_withdrawal_signature_returned", {
          correlationId,
          hasTxHash: Boolean(dynamicSubmission.txHash),
          hasSignedPsbt: Boolean(dynamicSubmission.signedPsbtBase64),
        })
        emitWalletSetupDebugEvent("DYNAMIC_SUBMIT_REQUESTED", {
          correlationId,
          requestId: withdrawalId,
          rail: review.review.rail,
          asset: review.review.asset,
          stage: "DYNAMIC_SUBMIT_REQUESTED",
        })
        emitWalletSetupDebugEvent("wallet_withdrawal_submit_requested", { correlationId, requestId: withdrawalId })
        const submitRes = await fetch(`/api/wallets/pinetree-wallet/withdrawals/${encodeURIComponent(withdrawalId)}/submit`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-PineTree-Withdrawal-Correlation": correlationId,
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
        const submitted = (await submitRes.json()) as WithdrawalSubmitResponse | { error?: string; error_code?: string }
        emitWalletSetupDebugEvent("wallet_withdrawal_submit_returned", {
          correlationId,
          httpStatus: submitRes.status,
          ok: submitRes.ok,
        })
        if (!submitRes.ok) {
          // Clear stale review: status is no longer "review_required" after prepare
          // succeeded, so a retry would fail at prepare with "not ready".
          setWithdrawalReview(null)
          setWithdrawalApprovalError(
            sanitizeWithdrawalSubmitErrorForMerchant(
              "error" in submitted ? submitted.error : undefined,
              "error_code" in submitted ? submitted.error_code : undefined
            )
          )
          setWithdrawalScreen("failed")
          void syncPineTreeWallet()
          return
        }
        emitWalletSetupDebugEvent("DYNAMIC_SUBMIT_ACCEPTED", {
          correlationId,
          requestId: withdrawalId,
          rail: review.review.rail,
          asset: review.review.asset,
          stage: "DYNAMIC_SUBMIT_ACCEPTED",
          httpStatus: submitRes.status,
        })
        emitWalletSetupDebugEvent("DYNAMIC_SUBMIT_COMPLETED", {
          correlationId,
          requestId: withdrawalId,
          rail: review.review.rail,
          asset: review.review.asset,
          stage: "DYNAMIC_SUBMIT_COMPLETED",
          httpStatus: submitRes.status,
        })
        setWithdrawalSubmitResult(submitted as WithdrawalSubmitResponse)
        setWithdrawalScreen("submitted")
        // Refresh Activity immediately so it reflects the just-submitted transaction
        // (tx hash present) instead of the stale pre-submission "pending" snapshot.
        void syncPineTreeWallet()
        void pollWithdrawalRequest(withdrawalId, submitted as WithdrawalSubmitResponse)
        return
      }

      setWithdrawalApprovalError("This withdrawal cannot be signed in this browser session.")
      setWithdrawalScreen("failed")
      return
    } catch (error) {
      const safeMessage = sanitizeWithdrawalSubmitErrorForMerchant(error instanceof Error ? error.message : undefined)
      console.warn("[pinetree-withdrawals] handleSubmitWithdrawal_unhandled_error", {
        rail: withdrawalReview?.review.rail,
        error: error instanceof Error ? error.message : "unknown",
      })
      emitWalletSetupDebugEvent("wallet_withdrawal_submit_unhandled_error", {
        correlationId,
        stage: "dynamic_post_prepare",
        rail: review.review.rail,
        asset: review.review.asset,
        requestId: withdrawalId,
        errorName: safeDynamicErrorName(error),
        errorCode: safeDynamicErrorCode(error) || "UNKNOWN_DYNAMIC_ERROR",
        errorMessage: safeDynamicErrorMessage(error),
      })
      setWithdrawalApprovalError(safeMessage)
      void syncPineTreeWallet()
      if (withdrawalReview?.review.approvalMethod === "dynamic_browser" && (withdrawalRail === "base" || withdrawalRail === "solana")) {
        setWithdrawalAuthorizationRecoveryOpen(true)
      }
      setWithdrawalScreen("failed")
    } finally {
      setSubmittingWithdrawal(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Early returns
  // ---------------------------------------------------------------------------

  if (sdkTimedOut && !sdkHasLoaded) return <WalletSetupUnavailable kind="sdk" />

  if (profileState.kind === "loading" || businessProfileReadiness.kind === "loading" || lightningProfileState.kind === "loading" || (!sdkHasLoaded && profileState.kind !== "error")) {
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
      {businessProfileGateBlocking ? (
        <div className="mb-3 max-w-2xl">
          <BusinessProfileRequirementBanner
            message="Complete Business Profile Before Continuing"
            returnDestination="wallet"
            compact
          />
        </div>
      ) : null}
      {showWalletSetupCard ? (
      <article className="max-w-2xl min-h-[15rem] flex flex-col rounded-[1.35rem] border border-blue-200/70 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.13),transparent_38%),linear-gradient(135deg,rgba(255,255,255,0.98),rgba(247,251,255,0.96))] p-6 shadow-[0_20px_55px_rgba(37,99,235,0.12)] backdrop-blur sm:min-h-[16rem] sm:p-7">
        <h2 className="min-w-0 text-base font-semibold text-gray-950">PineTree Wallet</h2>
        {!walletProvisioningInProgress ? (
          <div className="mt-7 max-w-xl">
            <EnabledRailChips rows={walletRailRows} />
          </div>
        ) : null}

        {/* Exactly one problem card renders, per walletSetupPrimaryState - never stacked. */}
        {walletSetupPrimaryState === "reconnect_needed" ? (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-blue-600" />
            <p className="text-xs leading-5 text-blue-800">
              {walletSetupNoticeCopy(walletSetupPrimaryState, walletSetupFailureReason)}
            </p>
          </div>
        ) : walletSetupPrimaryState === "email_mismatch" ? (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-blue-600" />
            <p className="text-xs font-semibold leading-5 text-blue-900">
              {walletSetupNoticeCopy(walletSetupPrimaryState, walletSetupFailureReason)}
            </p>
          </div>
        ) : walletSetupPrimaryState === "email_unverified" ? (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-blue-600" />
            <p className="text-xs font-semibold leading-5 text-blue-900">
              {walletSetupNoticeCopy(walletSetupPrimaryState, walletSetupFailureReason)}
            </p>
          </div>
        ) : walletSetupPrimaryState === "failed" ? (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-blue-600" />
            <p className="text-xs leading-5 text-blue-800">
              {walletSetupFailureMessage(walletSetupFailureReason || "provisioning_timeout_unknown")}
            </p>
          </div>
        ) : walletSetupPrimaryState === "save_needed" || walletSetupPrimaryState === "rail_sync_needed" ? (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-blue-600" />
            <p className="text-xs leading-5 text-blue-800">
              {walletSetupNoticeCopy(walletSetupPrimaryState, walletSetupFailureReason)}
            </p>
          </div>
        ) : null}

        {walletSetupProgressActive ? (
          <WalletSetupProgress
            stage={walletSetupProgressStage}
            active={walletSetupProgressActive}
          />
        ) : walletCreationMessage ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2.5">
            <p className="text-xs font-semibold leading-5 text-amber-800">
              {walletCreationMessage}
            </p>
          </div>
        ) : null}

        {dynamicVerificationPromptReason ? (
          <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-3">
            <p className="text-xs font-semibold leading-5 text-blue-900">Verification required</p>
            <p className="mt-1 text-xs leading-5 text-blue-800">
              For security, we need to verify access to your PineTree Wallet before enabling wallet creation and withdrawals.
            </p>
          </div>
        ) : null}

        {showDynamicAuthMisconfigurationWarning ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-3 text-xs text-amber-900">
            <p className="font-semibold">Dynamic auth configuration warning</p>
            <p className="mt-1 leading-5">{pineTreeDynamicEmailFallbackMisconfiguredWarning}</p>
          </div>
        ) : null}

        {/* Safe diagnostics, visible only with ?walletDebug=1. */}
        {showProfileSyncDebugPanel ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-3 text-xs text-slate-700">
            <p className="font-semibold text-slate-900">Wallet auth diagnostics</p>
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              <p>nodeEnv: {dynamicAuthConfig.nodeEnv}</p>
              <p>buildFingerprint: {clientBuildFingerprint}</p>
              <p>publicAppUrl: {clientAppUrl}</p>
              <p>dynamicEnvironmentIdPresent: {dynamicEnvironmentIdPresent ? "yes" : "no"}</p>
              <p>dynamicEnvironmentLabel: {dynamicEnvironmentLabel}</p>
              <p>clientAuthModeRaw: {clientAuthModeRaw}</p>
              <p>clientAuthModeSource: {clientAuthModeSource}</p>
              <p>clientAuthModeResolved: {dynamicAuthConfig.mode}</p>
              <p>clientAuthConfigValid: {String(dynamicAuthConfig.configValid)}</p>
              <p>clientAuthInvalidReason: {dynamicAuthConfig.invalidReason || "none"}</p>
              <p>clientEmailFallbackRaw: {clientEmailFallbackRaw}</p>
              <p>clientEmailFallbackSource: {clientEmailFallbackSource}</p>
              <p>clientEmailFallbackEnabledResolved: {String(dynamicAuthConfig.emailFallbackEnabled)}</p>
              <p>clientExternalJwtConfigured: {String(dynamicAuthConfig.externalJwtConfigured)}</p>
              <p>merchantEmailPresent: {merchantEmail ? "yes" : "no"}</p>
              <p>sdkLoaded: {sdkHasLoaded ? "yes" : "no"}</p>
              <p>dynamicUserPresent: {user ? "yes" : "no"}</p>
              <p>lastWalletAuthAttemptState: {profileSyncDiagnostics.lastWalletAuthAttemptState || "none"}</p>
              <p>lastExternalJwtRouteStatus: {profileSyncDiagnostics.externalJwtEndpointStatus ?? "none"}</p>
              <p>lastExternalJwtFailureCode: {profileSyncDiagnostics.externalJwtErrorCode || "none"}</p>
              <p>dynamicEmailFallbackBlocked: {String(Boolean(profileSyncDiagnostics.dynamicEmailFallbackBlocked))}</p>
              <p>signInWithExternalJwtCalled: {String(Boolean(profileSyncDiagnostics.signInWithExternalJwtCalled))}</p>
              <p>signInWithExternalJwtSucceeded: {String(Boolean(profileSyncDiagnostics.signInWithExternalJwtSucceeded))}</p>
            </div>
          </div>
        ) : null}

        {showProfileSyncDebugPanel && lastDebugEvents.length > 0 ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-3 text-xs text-slate-700">
            <p className="font-semibold text-slate-900">Wallet setup event log</p>
            <div className="mt-2 space-y-1">
              {lastDebugEvents.map((entry, index) => (
                <p key={`${entry.event}-${entry.at}-${index}`}>
                  {entry.event}
                  {Object.keys(entry.details).length > 0
                    ? ` — ${Object.entries(entry.details)
                        .map(([key, value]) => `${key}=${String(value)}`)
                        .join(", ")}`
                    : ""}
                </p>
              ))}
            </div>
          </div>
        ) : null}

        {showProfileSyncDebugPanel && walletSetupPrimaryState === "failed" ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-3 text-xs text-slate-700">
            <p className="font-semibold text-slate-900">Setup diagnostics</p>
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              <p>merchantEmailPresent: {String(Boolean(merchantEmail))}</p>
              <p>attemptPresent: {String(Boolean(walletSetupAttemptId))}</p>
              <p>merchantResolved: {String(Boolean(merchantId))}</p>
              <p>stage: {walletSetupStage}</p>
              <p>failureReason: {walletSetupFailureReason || "none"}</p>
              <p>dynamicEmailPresent: {String(Boolean(dynamicUserEmail))}</p>
              <p>dynamicAuthenticated: {String(Boolean(user))}</p>
              <p>dynamicUserIdPresent: {String(Boolean(user?.userId))}</p>
              <p>dynamicEmailSource: {dynamicEmailSource || "none"}</p>
              <p>externalJwtEnabled: {String(Boolean(profileSyncDiagnostics.externalJwtEnabled))}</p>
              <p>externalJwtIssuerConfigured: {String(Boolean(profileSyncDiagnostics.externalJwtIssuerConfigured))}</p>
              <p>externalJwtAudienceConfigured: {String(Boolean(profileSyncDiagnostics.externalJwtAudienceConfigured))}</p>
              <p>kidConfigured: {String(Boolean(profileSyncDiagnostics.externalJwtKidConfigured))}</p>
              <p>signingKeyConfigured: {String(Boolean(profileSyncDiagnostics.externalJwtSigningKeyConfigured))}</p>
              <p>jwksDerivedFromSigningKey: {String(Boolean(profileSyncDiagnostics.externalJwtJwksDerivedFromSigningKey))}</p>
              <p>externalJwtEndpointStatus: {profileSyncDiagnostics.externalJwtEndpointStatus ?? "none"}</p>
              <p>externalJwtErrorCode: {profileSyncDiagnostics.externalJwtErrorCode || "none"}</p>
              <p>dynamicExternalAuthAttempted: {String(Boolean(profileSyncDiagnostics.dynamicExternalAuthAttempted))}</p>
              <p>dynamicExternalAuthSucceeded: {String(Boolean(profileSyncDiagnostics.dynamicExternalAuthSucceeded))}</p>
              <p>mismatchCheckRan: {String(Boolean(profileSyncDiagnostics.mismatchCheckRan))}</p>
              <p>mismatchBlocked: {String(Boolean(profileSyncDiagnostics.mismatchBlocked))}</p>
              <p>timeoutReason: {walletCreationStep === "timeout" ? "embedded_wallet_provisioning_timeout" : "none"}</p>
            </div>
          </div>
        ) : null}

        {showProfileSyncDebugPanel && profileSyncDiagnostics.updatedAt ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-3 text-xs text-slate-700">
            <p className="font-semibold text-slate-900">PineTree Wallet sync debug</p>
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              <p>attemptPresent: {String(Boolean(walletSetupAttemptId))}</p>
              <p>merchantResolved: {String(Boolean(merchantId))}</p>
              <p>merchantEmailPresent: {String(Boolean(merchantEmail))}</p>
              <p>dynamicEmailPresent: {String(Boolean(profileSyncDiagnostics.dynamicEmail || dynamicUserEmail))}</p>
              <p>dynamicEmailSource: {profileSyncDiagnostics.dynamicEmailSource || dynamicEmailSource || "none"}</p>
              <p>stage: {walletSetupStage}</p>
              <p>failureReason: {walletSetupFailureReason || "none"}</p>
              <p>dynamicAuthenticated: {String(profileSyncDiagnostics.dynamicAuthenticated)}</p>
              <p>dynamicUserIdPresent: {String(Boolean(profileSyncDiagnostics.dynamicUserId))}</p>
              <p>externalJwtEnabled: {String(Boolean(profileSyncDiagnostics.externalJwtEnabled))}</p>
              <p>externalJwtIssuerConfigured: {String(Boolean(profileSyncDiagnostics.externalJwtIssuerConfigured))}</p>
              <p>externalJwtAudienceConfigured: {String(Boolean(profileSyncDiagnostics.externalJwtAudienceConfigured))}</p>
              <p>kidConfigured: {String(Boolean(profileSyncDiagnostics.externalJwtKidConfigured))}</p>
              <p>signingKeyConfigured: {String(Boolean(profileSyncDiagnostics.externalJwtSigningKeyConfigured))}</p>
              <p>jwksDerivedFromSigningKey: {String(Boolean(profileSyncDiagnostics.externalJwtJwksDerivedFromSigningKey))}</p>
              <p>externalJwtEndpointStatus: {profileSyncDiagnostics.externalJwtEndpointStatus ?? "none"}</p>
              <p>externalJwtErrorCode: {profileSyncDiagnostics.externalJwtErrorCode || "none"}</p>
              <p>dynamicExternalAuthAttempted: {String(Boolean(profileSyncDiagnostics.dynamicExternalAuthAttempted))}</p>
              <p>dynamicExternalAuthSucceeded: {String(Boolean(profileSyncDiagnostics.dynamicExternalAuthSucceeded))}</p>
              <p>extractedBaseAddressPresent: {String(Boolean(profileSyncDiagnostics.extractedBaseAddress))}</p>
              <p>extractedSolanaAddressPresent: {String(Boolean(profileSyncDiagnostics.extractedSolanaAddress))}</p>
              <p>baseSignerFound: {String(profileSyncDiagnostics.baseSignerFound)}</p>
              <p>solanaSignerFound: {String(profileSyncDiagnostics.solanaSignerFound)}</p>
              <p>didCallProfileEndpoint: {String(profileSyncDiagnostics.didCallProfileEndpoint)}</p>
              <p>profileEndpointStatus: {profileSyncDiagnostics.profileEndpointStatus ?? "none"}</p>
              <p>providerSyncStatus: {profileSyncDiagnostics.providerSyncStatus || "none"}</p>
              <p>runtimeWallets: {profileSyncDiagnostics.dynamicWalletRuntimeCount}</p>
              <p>waasRuntimeWallets: {profileSyncDiagnostics.waasRuntimeWalletCount}</p>
              <p>waasCredentialSources: {profileSyncDiagnostics.waasCredentialWalletSourceCount}</p>
              <p>waasCredentialSigners: {profileSyncDiagnostics.waasCredentialSignerWalletCount}</p>
              <p>skippedReason: {profileSyncDiagnostics.skippedReason || "none"}</p>
            </div>
          </div>
        ) : null}

        {showProfileSyncDebugPanel ? (
          <div className="mt-4 rounded-lg border border-slate-200 bg-white px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs leading-5 text-slate-600">
                Reset PineTree Wallet setup clears only wallet profile, crypto provider rows, and wallet balances.
              </p>
              <button
                type="button"
                onClick={() => void handleResetPineTreeWalletSetup()}
                disabled={resettingWalletSetup || !merchantId}
                className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
              >
                {resettingWalletSetup ? "Resetting..." : "Reset PineTree Wallet setup"}
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-auto flex justify-start pt-8">
          {dynamicVerificationPromptReason ? (
            <button
              type="button"
              onClick={continueDynamicVerification}
              disabled={syncing || logoutPending}
              className="h-10 rounded-lg bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
            >
              Verify PineTree Wallet access
            </button>
          ) : walletSetupPrimaryState === "email_mismatch" || walletSetupPrimaryState === "email_unverified" ? (
            <button
              type="button"
              onClick={handleUsePineTreeAccountEmail}
              disabled={logoutPending}
              className="h-10 rounded-lg bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
            >
              {logoutPending ? "Creating PineTree Wallet..." : "Try Again"}
            </button>
          ) : walletSetupPrimaryState === "reconnect_needed" ? (
            <button
              type="button"
              onClick={handleOpenWallet}
              disabled={syncing || walletCreationInProgress || walletOpening}
              className="h-10 rounded-lg bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
            >
              {walletOpening ? "Opening PineTree Wallet..." : "Reconnect PineTree Wallet"}
            </button>
          ) : walletSetupPrimaryState === "failed" || walletSetupPrimaryState === "save_needed" || walletSetupPrimaryState === "rail_sync_needed" ? (
            <button
              type="button"
              onClick={handleRetryWalletSetup}
              disabled={syncing || walletCreationInProgress}
              className="h-10 rounded-lg bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
            >
              {coreSetupNeedsUserAuth ? "Continue setup" : walletSetupFailureRecoveryLabel(walletSetupFailureReason)}
            </button>
          ) : showProvisioningRetryOnly ? null : (
            <button
              type="button"
              onClick={handleCreateWallet}
              disabled={businessProfileGateBlocking || syncing || logoutPending || walletCreationInProgress}
              className="h-10 rounded-lg bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
            >
              {businessProfileGateBlocking ? "Create PineTree Wallet" : logoutPending || walletCreationInProgress ? "Creating PineTree Wallet..." : "Create PineTree Wallet"}
            </button>
          )}
        </div>
      </article>
      ) : null}

      {process.env.NODE_ENV !== "production" ? (
        <WalletDiagnosticsPanel wallets={wallets} sdkNetworkGroups={dynamicNetworkAddresses} />
      ) : null}

      {withdrawalAuthorizationRecoveryOpen ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-sm sm:p-5"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setWithdrawalAuthorizationRecoveryOpen(false)
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="pinetree-withdrawal-auth-recovery-title"
            className="w-full max-w-[26rem] rounded-[1.25rem] border border-white/70 bg-white px-5 py-5 shadow-[0_28px_80px_rgba(15,23,42,0.28)]"
          >
            <h2 id="pinetree-withdrawal-auth-recovery-title" className="text-base font-semibold text-gray-950">
              {"We couldn't authorize this withdrawal"}
            </h2>
            {withdrawalReview ? (
              <p className="mt-2 text-sm leading-6 text-gray-600">
                Your PineTree Wallet is still connected. Please try authorizing this withdrawal again.
              </p>
            ) : (
              <p className="mt-2 text-sm leading-6 text-gray-600">
                Review the withdrawal details again before authorizing.
              </p>
            )}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              {withdrawalReview ? (
                <button
                  type="button"
                  onClick={() => {
                    setWithdrawalAuthorizationRecoveryOpen(false)
                    void handleSubmitWithdrawal({ irreversibleAckChecked: true })
                  }}
                  disabled={submittingWithdrawal}
                  className="inline-flex h-10 items-center justify-center rounded-lg bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 disabled:shadow-none sm:order-2"
                >
                  {submittingWithdrawal ? "Trying again..." : "Try Again"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setWithdrawalAuthorizationRecoveryOpen(false)}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-blue-200 hover:text-blue-700 sm:order-1"
              >
                Cancel
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {showWalletWorkspace ? (
        <section aria-label="PineTree Wallet workspace" className="space-y-5">
          {activeView === null ? (
            <WalletOverviewSummary
              rows={walletRailRows}
              sync={walletSync}
              syncing={walletSyncing}
              onSelectRail={handleOverviewRailSelect}
              onOpenWithdraw={() => setActiveView("withdraw")}
              onViewAllActivity={() => setActiveView("activity")}
              onOpenAddressBook={() => setActiveView("address-book")}
              onOpenSettings={() => setActiveView("settings")}
            />
          ) : null}

          {activeView === "base-details" ? (
            <WalletFloatingWorkspace title="Base Details" onClose={() => setActiveView(null)}>
              <BalanceRows
                sync={walletSync}
                syncing={walletSyncing}
                railFilter="base"
                profileAddresses={profileAddresses}
                bitcoinReady={bitcoinReady}
                bitcoinPayoutEntries={bitcoinPayoutEntries}
                copiedAddress={copiedAddress}
                onCopy={(a) => void copyAddress(a)}
                onWithdrawAsset={handleAssetDetailWithdraw}
              />
            </WalletFloatingWorkspace>
          ) : null}

          {activeView === "solana-details" ? (
            <WalletFloatingWorkspace title="Solana Details" onClose={() => setActiveView(null)}>
              <BalanceRows
                sync={walletSync}
                syncing={walletSyncing}
                railFilter="solana"
                profileAddresses={profileAddresses}
                bitcoinReady={bitcoinReady}
                bitcoinPayoutEntries={bitcoinPayoutEntries}
                copiedAddress={copiedAddress}
                onCopy={(a) => void copyAddress(a)}
                onWithdrawAsset={handleAssetDetailWithdraw}
              />
            </WalletFloatingWorkspace>
          ) : null}

          {activeView === "bitcoin-details" ? (
            <WalletFloatingWorkspace title="Bitcoin Details" onClose={() => setActiveView(null)}>
              <BalanceRows
                sync={walletSync}
                syncing={walletSyncing}
                railFilter="bitcoin"
                profileAddresses={profileAddresses}
                bitcoinReady={bitcoinReady}
                bitcoinPayoutEntries={bitcoinPayoutEntries}
                copiedAddress={copiedAddress}
                onCopy={(a) => void copyAddress(a)}
                onWithdrawAsset={handleAssetDetailWithdraw}
              />
            </WalletFloatingWorkspace>
          ) : null}

          {activeView === "withdraw" ? (
            <WalletFloatingWorkspace title="Withdraw" onClose={() => setActiveView(null)}>
              <WithdrawalFormShell
                rail={withdrawalRail}
                asset={withdrawalAsset}
                assetOptions={withdrawableAssetOptions}
                bitcoinTransferType={withdrawalBitcoinTransferType}
                onBitcoinTransferTypeChange={(value) => {
                  setWithdrawalBitcoinTransferType(value)
                  // A saved destination or validation error from the previous transfer
                  // type is never compatible with the new one - clear both, but never
                  // touch Address Book (this only clears local form state).
                  setWithdrawalSelectedDestinationId(null)
                  setWithdrawalScreen("form")
                  setWithdrawalReview(null)
                  setWithdrawalSubmitResult(null)
                  setWithdrawalError("")
                  setWithdrawalApprovalError("")
                  setInstantSendIdempotencyKey(null)
                }}
                destinationAddress={withdrawalDestination}
                selectedDestinationId={withdrawalSelectedDestinationId}
                amountDecimal={withdrawalAmount}
                screen={withdrawalScreen}
                review={withdrawalReview}
                error={withdrawalError}
                approvalError={withdrawalApprovalError}
                reviewing={reviewingWithdrawal}
                submitting={submittingWithdrawal}
                submitResult={withdrawalSubmitResult}
                selectedBalance={selectedWithdrawalBalance}
                diagnostics={withdrawalDiagnostics}
                debugEnabled={walletSyncDebugQueryEnabled}
                accessToken={accessTokenRef.current}
                maxEstimating={maxEstimating}
                maxWarning={maxWarning}
                onAssetSelect={handleWithdrawalAssetSelect}
                onDestinationChange={(value) => {
                  setWithdrawalDestination(value)
                  // A manual edit only clears which saved destination is
                  // considered "selected" - it must never delete or modify
                  // the saved destination itself.
                  setWithdrawalSelectedDestinationId(null)
                  setWithdrawalScreen("form")
                  setWithdrawalReview(null)
                  setWithdrawalSubmitResult(null)
                  setWithdrawalError("")
                  setWithdrawalApprovalError("")
                  setInstantSendIdempotencyKey(null)
                }}
                onSelectDestination={(destination) => {
                  if (!destination) {
                    setWithdrawalSelectedDestinationId(null)
                    return
                  }
                  setWithdrawalDestination(destination.destination_address)
                  setWithdrawalSelectedDestinationId(destination.id)
                  if (withdrawalRail === "bitcoin" && destination.method) {
                    setWithdrawalBitcoinTransferType(destination.method)
                  }
                  setWithdrawalScreen("form")
                  setWithdrawalReview(null)
                  setWithdrawalSubmitResult(null)
                  setWithdrawalError("")
                  setWithdrawalApprovalError("")
                  setInstantSendIdempotencyKey(null)
                }}
                onAmountChange={(value) => {
                  setWithdrawalAmount(value)
                  setWithdrawalScreen("form")
                  setWithdrawalReview(null)
                  setWithdrawalSubmitResult(null)
                  setWithdrawalError("")
                  setWithdrawalApprovalError("")
                  setInstantSendIdempotencyKey(null)
                }}
                onMaxAmount={handleMaxWithdrawalAmount}
                onEdit={handleEditWithdrawal}
                onDone={handleDoneWithdrawal}
                onCancel={handleCancelWithdrawal}
                onReview={() => void handleReviewWithdrawal()}
                onSubmit={(context) => void handleSubmitWithdrawal(context)}
                onOpenWallet={handleWithdrawalReconnect}
                onOpenAddressBook={() => setActiveView("address-book")}
                onFinishSetup={handleFinishWalletSetup}
              />
            </WalletFloatingWorkspace>
          ) : null}

          {activeView === "activity" ? (
            <WalletFloatingWorkspace title="Activity" onClose={() => setActiveView(null)}>
              <ActivityTab sync={walletSync} syncing={walletSyncing} accessToken={accessTokenRef.current} />
            </WalletFloatingWorkspace>
          ) : null}

          {activeView === "address-book" ? (
            <WalletFloatingWorkspace
              title="Address Book"
              onClose={() => setActiveView(null)}
            >
              <AddressBookTab accessToken={accessTokenRef.current} onWithdraw={handleWithdrawShortcut} />
            </WalletFloatingWorkspace>
          ) : null}

          {activeView === "settings" ? (
            <WalletFloatingWorkspace title="Wallet Settings" onClose={() => setActiveView(null)}>
              <WalletSettingsWorkspace />
            </WalletFloatingWorkspace>
          ) : null}
        </section>
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
      <h1 className={dashboardPageTitleClass}>PineTree Wallet</h1>
      {!infrastructure.configured ? (
        <WalletSetupUnavailable kind="missing-env" />
      ) : infrastructure.sdkUnavailable ? (
        <WalletSetupUnavailable kind="sdk" />
      ) : (
        <PineTreeWalletRuntime />
      )}
    </div>
  )
}
