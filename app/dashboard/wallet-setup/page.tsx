"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useDynamicContext, useDynamicEvents, useDynamicWaas, useEmbeddedWallet, useExternalAuth, useRefreshUser, useSwitchWallet, useUserWallets } from "@dynamic-labs/sdk-react-core"
import { Transaction } from "@solana/web3.js"
import { AlertTriangle, CheckCircle2, ChevronDown, Copy, X } from "lucide-react"
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
  getDynamicWalletSearchList,
  inferredSignerRailForWallet,
  signDynamicSolanaTransactionWithActiveAccount,
  type DynamicSignerRail,
  type DynamicWalletLike,
} from "@/lib/wallets/dynamicSignerLookup"
import {
  DashboardSection,
  ProviderStatusPill,
  dashboardPageTitleClass,
} from "@/components/dashboard/DashboardPrimitives"
import { usePineTreeWalletInfrastructureStatus } from "@/components/providers/PineTreeDynamicProvider"
import type { PineTreeRailReadinessMap } from "@/lib/pinetreeRailReadiness"
import {
  getPineTreeDynamicAuthConfig,
  assertCanOpenDynamicEmailFallbackAuth,
  pineTreeDynamicConfigurationErrorMessage,
  pineTreeDynamicEmailFallbackMisconfiguredWarning,
  requestPineTreeDynamicExternalJwtAuth,
  shouldOpenDynamicEmailFallbackAuth,
} from "@/lib/pinetreeDynamicAuth"
import {
  resolveNativeAuthResumeAction,
  shouldRerunSpeedOnNativeAuthResume,
  walletProvisioningTimeoutSuppressionReason,
} from "@/lib/pinetreeWalletSetupResume"

// Legacy compatibility route exists server-side but is not called by PineTree Wallet:
// "/api/merchant/business-owner-profile"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WalletTab = "overview" | "balances" | "withdraw" | "activity"
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
  merchantStatus: "Processing" | "Withdrawal failed"
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
  balance: number | null
  usdValue: number | null
  lastSyncedAt: string | null
  status: "synced" | "pending_sync" | "config_missing"
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
    rail: "base" | "solana" | "bitcoin"
    status: string
    createdAt: string
  }>
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
  | "dynamic_email_fallback_blocked"
  | "no_dynamic_wallets"
  | "base_address_missing"
  | "solana_address_missing"
  | "base_signer_missing"
  | "solana_signer_missing"
  | "profile_sync_failed"
  | "provider_sync_failed"
  | "wallet_address_conflict"
  | "provisioning_timeout_unknown"

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

const walletTabs: Array<{ id: WalletTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "balances", label: "Balances" },
  { id: "withdraw", label: "Withdraw" },
  { id: "activity", label: "Activity" },
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

async function sendDynamicPreparedWithdrawal(
  prepared: WithdrawalPrepareResponse,
  wallets: unknown[],
  primaryWallet: unknown,
  context: DynamicSigningPreflightContext
): Promise<{ txHash?: string; signedPsbtBase64?: string; providerReference?: string }> {
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

  const wallet = findDynamicWalletForSource(wallets, primaryWallet, prepared.sourceAddress, prepared.rail)

  if (walletCreationDebugEnabled && wallet) {
    const walletLike = wallet as DynamicWalletLike
    console.info("[pinetree-withdrawals] signer_ready", {
      payloadKind: prepared.payload.kind,
      selectedWalletChainClassification: classifyDynamicWalletChain(walletLike),
      selectedConnectorKey: walletLike.connector?.key ?? walletLike.walletConnector?.key ?? null,
      selectedConnectorName: walletLike.connector?.name ?? walletLike.walletConnector?.name ?? null,
      hasSolanaSigner: Boolean(
        walletLike.signAndSendTransaction || walletLike.connector?.signAndSendTransaction
      ),
      hasEvmClient: Boolean(
        walletLike.getWalletClient || walletLike.connector?.getWalletClient
      ),
      hasBtcSigner: Boolean(walletLike.signPsbt || walletLike.connector?.signPsbt),
    })
  }

  if (!wallet) {
    const hasAnyDynamicWallet = walletsToCheck.length > 0
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
    if (!hasAnyDynamicWallet && prepared.rail === "solana") {
      throw new Error("Reconnect your Solana wallet session before approving this withdrawal.")
    }
    if (hasAnyDynamicWallet) {
      // Wallets are loaded but none match the saved DB address â€” different account/session.
      throw new Error(
        "This browser is connected to a different PineTree Wallet session. Reopen PineTree Wallet or verify access."
      )
    }
    // No Dynamic wallets present at all â€” session expired or SDK not yet loaded.
    throw new Error(pineTreeSignerReconnectMessage)
  }

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
  const transaction = Transaction.from(base64ToBytes(prepared.payload.transactionBase64))
  return signDynamicSolanaTransactionWithActiveAccount(
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
  // Pass through session-specific reconnect errors so merchants get actionable guidance.
  if (raw.includes("PineTree Wallet is not active in this browser session")) return pineTreeSignerReconnectMessage
  if (raw.includes("different PineTree Wallet session")) return raw
  if (raw === pineTreeSignerReconnectMessage) return raw
  if (raw === withdrawalSignerRailMismatchMessage) return raw
  if (raw === solanaWithdrawalReconnectMessage) return raw
  if (/user rejected|user denied|rejected by user|approval rejected|request rejected|denied transaction/i.test(raw)) {
    return "Withdrawal approval was rejected. No funds were moved."
  }
  if (raw === "Withdrawal approval is still pending. Check your wallet activity before trying again.") return raw
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
const walletCreationTimeoutMs = 20_000
const walletProvisioningRetryIntervalMs = 1_800
const walletProvisioningFinalRefreshGraceMs = 5_000
// Explicit fallback for createWalletAccount when Dynamic's needsAutoCreateWalletChains
// comes back empty for a brand new user (SDK hasn't caught up yet) but no wallet or
// WaaS credential exists either â€” PineTree Wallet always needs both of these chains.
const REQUIRED_WAAS_WALLET_CHAINS = [{ chain: "EVM" }, { chain: "SOL" }]
const walletSetupStoragePrefix = "pinetree_wallet_setup_in_progress:"
const walletCreationDebugEnabled =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_PINE_TREE_WALLET_DEBUG === "true" ||
  process.env.NEXT_PUBLIC_PINETREE_WALLET_DEBUG === "true"
const withdrawalSignerRailMismatchMessage = "Selected wallet network does not match this withdrawal asset."
const solanaWithdrawalReconnectMessage = "Reconnect your Solana wallet session before approving this withdrawal."
const pineTreeSignerReconnectMessage = "Reconnect PineTree Wallet to verify secure signing access."

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function WalletStatusPill({
  label,
  tone,
  className = "",
}: {
  label: string
  tone: "blue" | "default"
  className?: string
}) {
  return (
    <ProviderStatusPill
      label={label}
      tone={tone}
      className={`min-h-0 w-[6.75rem] justify-center px-3 py-1 text-center text-[11px] leading-none ${className}`}
    />
  )
}

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
  if (step === "profile_synced") return "Wallet ready"
  if (step === "timeout") return ""
  if (step === "failed") return ""
  return ""
}

function walletSetupFailureMessage(reason: WalletSetupFailureReason | null) {
  if (
    reason === "dynamic_email_mismatch" ||
    reason === "dynamic_email_missing" ||
    reason === "dynamic_email_unverified"
  ) return "We could not verify wallet access. Please try again."
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
  return toRecord(value).error === "wallet_address_conflict"
}

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
  messageHint: string
}

/**
 * Classifies a thrown signInWithExternalJwt error into a safe enum reason for the
 * server-visible beacon. Never returns the raw error.message or stack - only a
 * short error name/code (standard JS error identifiers, not user content) and the
 * matched hint enum.
 */
function classifyDynamicSignInError(error: unknown): ClassifiedDynamicSignInError {
  const row = typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {}
  const errorName = error instanceof Error
    ? error.name
    : typeof row.name === "string" ? row.name : undefined
  const rawMessage = error instanceof Error
    ? error.message
    : typeof row.message === "string" ? row.message : ""
  const message = rawMessage.toLowerCase()
  const status = typeof row.status === "number" ? row.status : undefined
  const errorCode = typeof row.code === "string" ? row.code : undefined

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
    messageHint,
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
    addressPrefix: w.address ? `${w.address.slice(0, 6)}â€¦` : "â€”",
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
      <p className="mb-2 font-sans text-xs font-semibold text-yellow-700">DEV â€” wallet SDK diagnostics (hidden in production)</p>
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
  lightningPayout,
  destinationAddress,
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
  onAssetSelect,
  onDestinationChange,
  onAmountChange,
  onMaxAmount,
  onEdit,
  onDone,
  onReview,
  onSubmit,
  onOpenWallet,
  onFinishSetup,
}: {
  rail: WithdrawalRail
  asset: WithdrawalAsset
  assetOptions: WithdrawalAssetOption[]
  lightningPayout: {
    connected: boolean
    destinationLabel: "PineTree BTC Wallet" | "Not set"
  }
  destinationAddress: string
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
  onAssetSelect: (rail: WithdrawalRail, asset: WithdrawalAsset) => void
  onDestinationChange: (value: string) => void
  onAmountChange: (value: string) => void
  onMaxAmount: () => void
  onEdit: () => void
  onDone: () => void
  onReview: () => void
  onSubmit: () => void
  onOpenWallet?: () => void
  onFinishSetup?: () => void
}) {
  const amountTrimmed = amountDecimal.trim()
  const selectedBalanceAmount = selectedBalance?.balance ?? null
  const selectedBalanceKnown = selectedBalanceAmount !== null && selectedBalance?.status === "synced"
  const selectedBalanceZero = selectedBalanceKnown && selectedBalanceAmount <= 0
  const amountValue = Number(amountTrimmed)
  const missingAmount = amountTrimmed.length === 0
  const amountParseError = amountTrimmed.length > 0 && !Number.isFinite(amountValue)
  const invalidAmount = amountTrimmed.length > 0 && Number.isFinite(amountValue) && !(amountValue > 0)
  const amountExceedsBalance = selectedBalanceKnown && amountValue > selectedBalanceAmount
  const missingDestination = destinationAddress.trim().length === 0
  const noWithdrawableAssets = assetOptions.length === 0
  const missingRuntimeSigner =
    dynamicSignerWithdrawalRails.includes(rail) &&
    diagnostics.walletProfileAddressPresent &&
    !diagnostics.dynamicMethodAvailable
  const reviewBlockedByInput = reviewing || noWithdrawableAssets || missingDestination || missingAmount || amountParseError || invalidAmount || selectedBalanceZero || amountExceedsBalance
  const reviewDisabled = missingRuntimeSigner ? false : reviewBlockedByInput
  const formattedAvailable = formatCryptoAmount(selectedBalanceAmount, asset)
  const maxDisabled = !selectedBalanceKnown || selectedBalanceZero
  const nativeMaxNote = isNativeWithdrawalAsset(asset) && selectedBalanceKnown && !selectedBalanceZero
  const showLightningPayoutSetup = rail === "bitcoin" && asset === "BTC" && !lightningPayout.connected
  const reviewActionLabel = review?.review.approvalMethod === "dynamic_browser" ? "Approve withdrawal" : "Submit withdrawal request"
  const blockingMessage =
    error ||
    (missingRuntimeSigner
      ? pineTreeSignerReconnectMessage
      : missingDestination
      ? "Enter a destination address to review."
      : missingAmount
        ? "Enter an amount to review."
        : amountParseError
          ? "Enter a valid withdrawal amount."
          : invalidAmount
            ? "Enter an amount greater than 0."
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
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting || !review.canSubmit}
            className="inline-flex h-11 items-center justify-center rounded-lg bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 disabled:shadow-none sm:order-2"
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
    return (
      <div className="space-y-4">
        <div className="rounded-[1.2rem] border border-red-200 bg-red-50 px-5 py-5">
          <p className="text-base font-semibold text-red-900">Withdrawal failed</p>
          <p className="mt-1 text-sm leading-6 text-red-800">
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
          ) : review ? (
            <button
              type="button"
              onClick={onSubmit}
              disabled={submitting}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 disabled:shadow-none"
            >
              Try approval again
            </button>
          ) : null}
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-blue-200 hover:text-blue-700"
          >
            Edit withdrawal
          </button>
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
                ? `â‰ˆ ${formatUsd(option.balance.usdValue)}`
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

      {showLightningPayoutSetup ? (
        <div className="rounded-2xl border border-blue-100/70 bg-white px-4 py-3 shadow-sm">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-950">Bitcoin Lightning payout</p>
              <p className="mt-1 text-xs leading-5 text-gray-500">
                Destination: {lightningPayout.destinationLabel}
              </p>
            </div>
            <WalletStatusPill
              label={lightningPayout.connected ? "Connected" : "Not connected"}
              tone={lightningPayout.connected ? "blue" : "default"}
            />
          </div>
          {!lightningPayout.connected ? (
            <button
              type="button"
              disabled
              className="mt-3 inline-flex h-8 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 px-3 text-xs font-semibold text-gray-400"
            >
              Set Bitcoin payout destination
            </button>
          ) : null}
        </div>
      ) : null}

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
            disabled={maxDisabled}
            className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-blue-200 hover:text-blue-700 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 disabled:shadow-none"
          >
            Max
          </button>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
          <span>
            {selectedBalanceKnown
              ? `Available: ${formattedAvailable} ${asset}`
              : "Balance indexing pending"}
            {selectedBalanceKnown && selectedBalance?.usdValue !== null && selectedBalance?.usdValue !== undefined
              ? ` Â· â‰ˆ ${formatUsd(selectedBalance.usdValue)}`
              : null}
          </span>
          {!selectedBalanceKnown ? <span>Balance will be verified before processing.</span> : nativeMaxNote ? <span>Network fee may apply.</span> : null}
        </div>
      </div>

      {blockingMessage ? (
        <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2 text-xs font-semibold leading-5 text-blue-800">
          {blockingMessage}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={missingRuntimeSigner && onFinishSetup ? onFinishSetup : onReview}
          disabled={reviewDisabled}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 disabled:shadow-none"
        >
          {reviewing ? "Reviewing..." : missingRuntimeSigner ? "Reconnect PineTree Wallet" : "Review withdrawal"}
        </button>
        {missingRuntimeSigner && onFinishSetup ? (
          <button
            type="button"
            onClick={onFinishSetup}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-blue-200 hover:text-blue-700"
          >
            Finish setup
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
  if (value === null) return "â€”"
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

function formatActivityTimestamp(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const datePart = date.toLocaleString(undefined, { month: "short", day: "numeric" })
  const timePart = date.toLocaleString(undefined, { hour: "numeric", minute: "2-digit" })
  return `${datePart} at ${timePart}`
}

function BusinessProfileRequiredBanner() {
  return (
    <div className="mb-3 rounded-lg border border-red-200 bg-red-50/70 px-3 py-2 text-sm shadow-none">
      <div className="flex items-center gap-2">
        <span className="h-4 w-1 shrink-0 rounded-full bg-red-500" />
        <p className="min-w-0 flex-1 font-semibold leading-5 text-red-950">Complete Business Profile before continuing</p>
        <Link
          href="/dashboard/settings#business-profile"
          className="hidden shrink-0 font-semibold text-red-700 transition hover:text-red-800 sm:inline"
        >
          Complete
        </Link>
      </div>
    </div>
  )
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
                <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_7.25rem_minmax(4.5rem,auto)] items-center gap-3 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_7.75rem_minmax(5.75rem,auto)] sm:px-5">
                  <p className="min-w-0 text-sm font-semibold text-gray-900">{row.label}</p>
                  <span className="flex justify-center">
                    <WalletStatusPill
                      label={connected ? "Connected" : "Not connected"}
                      tone={connected ? "blue" : "default"}
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
  const assetRailLabel = (rail: SyncedBalanceAsset["rail"]) =>
    rail === "base" ? "Base" : rail === "solana" ? "Solana" : "Bitcoin"
  const balanceOptions = useMemo(() => {
    const rows: SyncedBalanceAsset[] = []
    if (profileAddresses.base.length > 0) rows.push(...(sync?.balances.base ?? []))
    if (profileAddresses.solana.length > 0) rows.push(...(sync?.balances.solana ?? []))
    if (bitcoinPayoutEntries.length > 0) rows.push(...(sync?.balances.bitcoin ?? []))
    return rows.filter((row) => {
      if (row.rail === "bitcoin" && bitcoinPayoutEntries.length === 0) return false
      if (row.rail === "base" && profileAddresses.base.length === 0) return false
      if (row.rail === "solana" && profileAddresses.solana.length === 0) return false
      return row.status === "synced" || row.balance !== null || row.usdValue !== null
    })
  }, [bitcoinPayoutEntries.length, profileAddresses.base.length, profileAddresses.solana.length, sync?.balances.base, sync?.balances.bitcoin, sync?.balances.solana])

  const preferredSelectedKey =
    balanceOptions.find((row) => row.key === "BASE_ETH")?.key ??
    balanceOptions[0]?.key ??
    ""
  const [selectedKey, setSelectedKey] = useState(preferredSelectedKey)
  const selectedAsset = balanceOptions.find((row) => row.key === selectedKey) ?? balanceOptions[0] ?? null

  useEffect(() => {
    if (balanceOptions.length === 0) {
      if (selectedKey) setSelectedKey("")
      return
    }
    if (!balanceOptions.some((row) => row.key === selectedKey)) {
      setSelectedKey(preferredSelectedKey)
    }
  }, [balanceOptions, preferredSelectedKey, selectedKey])

  const dropdownOptions: AssetDropdownOption[] = balanceOptions.map((row) => ({
    key: row.key,
    asset: row.asset,
    railLabel: assetRailLabel(row.rail),
    balanceLabel: formatBalance(row.balance, row.asset),
    usdLabel: row.status === "synced" && row.usdValue !== null ? `â‰ˆ ${formatUsd(row.usdValue)}` : null,
  }))
  const lastSynced = formatLastSynced(sync?.lastSyncedAt ?? null)

  const walletAddress = selectedAsset
    ? selectedAsset.rail === "base"
      ? profileAddresses.base[0]?.address ?? null
      : selectedAsset.rail === "solana"
        ? profileAddresses.solana[0]?.address ?? null
        : bitcoinPayoutEntries[0]?.address ?? null
    : null

  if (balanceOptions.length === 0) {
    return (
      <div className="rounded-[1.1rem] border border-dashed border-gray-200 bg-gray-50 px-4 py-5">
        <p className="text-sm font-semibold text-gray-950">No balances yet</p>
        <p className="mt-1 text-xs leading-5 text-gray-500">Received funds will appear here after payments settle.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <AssetSelectDropdown
        label="Asset"
        options={dropdownOptions}
        selectedKey={selectedAsset?.key ?? selectedKey}
        onSelect={setSelectedKey}
      />

      {selectedAsset ? (
        <div className="rounded-[1.2rem] border border-blue-100/80 bg-white px-4 py-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-950">{selectedAsset.asset}</p>
              <p className="mt-1 text-xs text-gray-500">{assetRailLabel(selectedAsset.rail)}</p>
            </div>
            <p className="text-right text-sm font-semibold text-gray-950">
              {formatBalance(selectedAsset.balance, selectedAsset.asset)}
            </p>
          </div>
          <dl className="mt-4 divide-y divide-gray-100 text-sm">
            <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 py-2.5">
              <dt className="text-xs font-semibold text-gray-500">Balance</dt>
              <dd className="min-w-0 text-right font-semibold text-gray-950">{formatBalance(selectedAsset.balance, selectedAsset.asset)}</dd>
            </div>
            <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 py-2.5">
              <dt className="text-xs font-semibold text-gray-500">Estimated USD value</dt>
              <dd className="min-w-0 text-right font-semibold text-gray-950">
                {selectedAsset.status === "synced" && selectedAsset.usdValue !== null ? formatUsd(selectedAsset.usdValue) : "Pending value"}
              </dd>
            </div>
            <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 py-2.5">
              <dt className="text-xs font-semibold text-gray-500">Network</dt>
              <dd className="min-w-0 text-right font-semibold text-gray-950">{assetRailLabel(selectedAsset.rail)}</dd>
            </div>
            <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 py-2.5">
              <dt className="text-xs font-semibold text-gray-500">Asset</dt>
              <dd className="min-w-0 text-right font-semibold text-gray-950">{selectedAsset.asset}</dd>
            </div>
            <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 py-2.5">
              <dt className="text-xs font-semibold text-gray-500">Last synced</dt>
              <dd className="min-w-0 text-right font-semibold text-gray-950">
                {syncing ? "Syncing..." : lastSynced ?? "Pending sync"}
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
// Activity tab
// ---------------------------------------------------------------------------

function ActivityStatusPill({ status }: { status: string }) {
  const s = status.toLowerCase()
  const cls =
    s === "confirmed"
      ? "bg-blue-100 text-blue-700"
      : s === "sent" || s === "processing"
        ? "bg-blue-50 text-blue-500"
        : s === "failed"
          ? "bg-red-50 text-red-600"
          : "bg-gray-100 text-gray-500"
  const label =
    s === "confirmed" ? "Confirmed"
    // "processing" is the legacy internal status name for a signed/submitted
    // transaction PineTree hasn't independently reconciled on-chain yet - display it
    // the same as "sent" rather than exposing internal vocabulary to merchants.
    : s === "sent" || s === "processing" ? "Sent"
    : s === "failed" ? "Failed"
    : s === "canceled" ? "Canceled"
    : s === "blocked" ? "Blocked"
    : "Pending"
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none ${cls}`}>
      {label}
    </span>
  )
}

function ActivityTab({
  sync,
  syncing,
}: {
  sync: PineTreeWalletSyncResponse | null
  syncing: boolean
}) {
  const items = sync?.recentActivity ?? []
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-[1.35rem] border border-blue-200/60 bg-white shadow-[0_18px_42px_rgba(15,23,42,0.07)]">
        <div className="border-b border-blue-100/70 bg-blue-50/55 px-4 py-3 sm:px-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">
            {syncing ? "Syncing..." : "RECENT WITHDRAWALS"}
          </p>
        </div>
        {items.length === 0 ? (
          <div className="px-4 py-6 text-center sm:px-5">
            <p className="text-sm text-gray-500">No wallet activity yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-blue-50">
            {items.map((item) => (
              <div key={item.id} className="px-4 py-3.5 sm:px-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900">{item.label}</p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {railDisplayName(item.rail)} Â· {formatActivityTimestamp(item.createdAt) ?? item.createdAt}
                    </p>
                  </div>
                  <ActivityStatusPill status={item.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
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
  const { user, sdkHasLoaded, showAuthFlow, setShowAuthFlow, setShowDynamicUserProfile, handleLogOut, primaryWallet } = useDynamicContext()
  const { signInWithExternalJwt } = useExternalAuth()
  const refreshDynamicUser = useRefreshUser()
  const switchDynamicWallet = useSwitchWallet()
  // Literal process.env.NEXT_PUBLIC_X reads are required here so webpack can
  // statically inline them into the client bundle â€” see PineTreeDynamicProvider.tsx.
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

  // --- UI state ---
  const [sdkTimedOut, setSdkTimedOut] = useState(false)
  const [walletOpen, setWalletOpen] = useState(false)
  const [walletOpening, setWalletOpening] = useState(false)
  const [openWalletReconnectNeeded, setOpenWalletReconnectNeeded] = useState(false)
  const [activeTab, setActiveTab] = useState<WalletTab>("overview")
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
  const [withdrawalDestination, setWithdrawalDestination] = useState("")
  const [withdrawalAmount, setWithdrawalAmount] = useState("")
  const [withdrawalScreen, setWithdrawalScreen] = useState<WithdrawalScreen>("form")
  const [withdrawalReview, setWithdrawalReview] = useState<WithdrawalReviewResponse | null>(null)
  const [withdrawalSubmitResult, setWithdrawalSubmitResult] = useState<WithdrawalSubmitResponse | null>(null)
  const [withdrawalError, setWithdrawalError] = useState("")
  const [withdrawalApprovalError, setWithdrawalApprovalError] = useState("")
  const [reviewingWithdrawal, setReviewingWithdrawal] = useState(false)
  const [submittingWithdrawal, setSubmittingWithdrawal] = useState(false)
  const [withdrawalReconnectPending, setWithdrawalReconnectPending] = useState(false)
  const withdrawalReconnectSourceRef = useRef<string | null>(null)
  const dynamicHydrationAttemptRef = useRef<string | null>(null)
  const dynamicWalletRuntimeCountRef = useRef(0)
  const dynamicApprovalAvailableRef = useRef(false)
  const dynamicProfileReadyRef = useRef(false)
  const lastWalletSetupPrimaryStateRef = useRef<WalletSetupPrimaryState | null>(null)
  const repairProfileIdRef = useRef<string | null>(null)
  const pendingWalletProvisionAttemptRef = useRef<string | null>(null)
  const pendingWalletProvisionStartedAtRef = useRef<number | null>(null)
  const pendingProfileSyncAttemptRef = useRef(false)
  const profilePostInFlightKeyRef = useRef<string | null>(null)
  const walletSetupStartInFlightRef = useRef<string | null>(null)
  const staleProfileAutoRepairAttemptRef = useRef<string | null>(null)
  const creatingEmbeddedWalletRef = useRef(false)
  const nativeFallbackPendingRef = useRef(false)
  // True while an explicit create/retry/native-auth-resume attempt is running, so a
  // successful core profile save opens the wallet instead of leaving the merchant on
  // the setup card. Never set by page-load auto-repair, which must not pop the modal.
  const autoOpenWalletAfterCreateRef = useRef(false)
  const speedProvisionInFlightRef = useRef(false)
  const lastCombinedReadinessRef = useRef<string | null>(null)

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
        if (typeof window !== "undefined") {
          const setupKey = walletSetupStorageKeyForMerchant(sessionUser.id)
          if (setupKey) {
            const setupStarted = window.localStorage.getItem(setupKey) === "true"
            if (!json.profile) {
              if (setupStarted) {
                window.localStorage.removeItem(setupKey)
              }
              setPendingSync(false)
              setProvisioningRetryExhausted(false)
              setFinalProvisioningRefreshAttempted(false)
              setWalletCreationStep("idle")
              setDynamicVerificationPromptReason(null)
              console.info("[pinetree-wallets] wallet_profile_load_state", {
                profileExists: false,
                setupFlagPresent: setupStarted,
                staleSetupCleared: setupStarted,
                status: "new_wallet_required",
              })
            } else if (setupStarted && json.profile.status !== "ready") {
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
            }
          }
        }
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

  // --- Live Dynamic wallet addresses â€” used only for sync, never for display ---
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

  const openDynamicEmailFallbackAuth = useCallback((reason: string) => {
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
        let signinMessageHint: string | undefined
        try {
          console.info("[pinetree-wallets] wallet_dynamic_jwt_requested", {})
          emitWalletSetupDebugEvent("wallet_dynamic_jwt_requested", {})
          const payload = await requestPineTreeDynamicExternalJwtAuth(token, { walletDebug: walletSyncDebugQueryEnabled })
          endpointStatus = 200
          emitWalletSetupDebugEvent("wallet_dynamic_jwt_response_received", {
            ok: true,
            tokenPresent: Boolean(payload.externalJwt),
            expiresAtPresent: Boolean(payload.expiresAt),
          })
          if (!payload.externalJwt || !payload.externalUserId) {
            signinFailureReason = "jwt_missing_token"
            throw Object.assign(new Error("dynamic_external_jwt_failed"), { status: 502 })
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
            status,
            code,
          })
          if (signinMessageHint === "external_auth_rejected") {
            // Dynamic's backend explicitly rejected the BYOA JWT (a dashboard-side
            // configuration/approval issue PineTree can't fix client-side). Instead of
            // hard-failing wallet creation, fall back to Dynamic's native auth flow so
            // the merchant can still finish setup while BYOA approval is pending. The
            // existing identity gate still rejects a mismatched Dynamic email, and any
            // already-started Speed provisioning keeps running in the background.
            emitWalletSetupDebugEvent("wallet_dynamic_external_jwt_rejected", {})
            emitWalletSetupDebugEvent("wallet_dynamic_native_fallback_started", {})
            nativeFallbackPendingRef.current = true
            setCoreSetupNeedsUserAuth(true)
            setPendingSync(true)
            markWalletSetupInProgress()
            setWalletIdentityError("")
            logWalletCreationStep("waiting_for_dynamic_auth", {
              reason: "external_jwt_rejected_native_fallback",
            })
            setProfileSyncDiagnostics((prev) => ({
              ...prev,
              lastWalletAuthAttemptState: "external_jwt_rejected_native_fallback_opened",
              updatedAt: new Date().toISOString(),
            }))
            setShowDynamicUserProfile(false)
            setShowAuthFlow(true)
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
    openDynamicEmailFallbackAuth(reason)
  }, [
    dynamicVerificationPromptReason,
    logWalletCreationStep,
    merchantEmail,
    openDynamicEmailFallbackAuth,
  ])

  const scheduleDynamicEmailFallbackAuth = useCallback((reason: string) => {
    window.setTimeout(() => {
      openDynamicEmailFallbackAuth(reason)
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

  const refreshDynamicWalletRuntime = useCallback(async (reason: string, options?: { requireApprovalWallet?: boolean }) => {
    if (!sdkHasLoaded || !user) return false
    console.info("[pinetree-wallets] wallet_dynamic_wallets_refresh_started", { reason })
    emitWalletSetupDebugEvent("wallet_dynamic_wallets_refresh_started", {
      reason,
      dynamicWaasIsEnabled,
      runtimeWalletCount: dynamicWalletRuntimeCountRef.current,
    })
    try {
      await refreshDynamicUser()
      if (dynamicWaasIsEnabled) {
        if (shouldInitializeWaas) {
          await initializeWaas({ forceClientRebuild: true })
        }
        // When WaaS wallets are absent after initialization, provision them.
        // createWalletAccount uses needsAutoCreateWalletChains â€” the SDK-populated list of chains
        // that require wallet creation for this user.
        let runtimeWallets = getWaasWallets()
        const runtimeCredentials = getWaasWalletsByCredentials()

        // Credentials already exist server-side (a wallet was provisioned in an earlier
        // session) but the local runtime never restored them. Force a rebuild instead of
        // falling through to explicit creation, which would attempt to create a duplicate.
        if (runtimeWallets.length === 0 && runtimeCredentials.length > 0 && !shouldInitializeWaas) {
          console.info("[pinetree-wallets] wallet_dynamic_create_or_restore_started", { reason, path: "restore_existing" })
          emitWalletSetupDebugEvent("wallet_dynamic_create_or_restore_started", { reason, path: "restore_existing" })
          await initializeWaas({ forceClientRebuild: true })
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
          if (requiredChains.length > 0 && !creatingEmbeddedWalletRef.current) {
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
              await createWalletAccount(requiredChains)
              console.info("[pinetree-wallets] wallet_dynamic_create_embedded_wallet_complete", { reason })
              emitWalletSetupDebugEvent("wallet_dynamic_create_embedded_wallet_complete", { reason, path: "waas_create" })
              setDynamicWalletRuntimeRefreshNonce((value) => value + 1)
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
          // No embedded wallet exists yet â€” create one using the legacy embedded wallet API.
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
      const hydrated = await waitForDynamicWalletRuntime(options)
      console.info("[pinetree-wallets] wallet_dynamic_wallets_refresh_complete", { reason, hydrated })
      emitWalletSetupDebugEvent("wallet_dynamic_wallets_refresh_complete", {
        reason,
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
      console.warn("[pinetree-wallets] dynamic_wallet_runtime_refresh_failed", {
        reason,
        dynamicUserId: user.userId ?? null,
        error: error instanceof Error ? error.message : String(error),
      })
      creatingEmbeddedWalletRef.current = false
      // Surface the throw server-side too - this is the "createWalletAccount /
      // createEmbeddedWallet threw but was swallowed client-side" case that's
      // otherwise invisible in Vercel logs from a mobile browser.
      emitWalletSetupDebugEvent("wallet_dynamic_wallets_refresh_complete", {
        reason,
        hydrated: false,
        threw: true,
        errorName: error instanceof Error ? error.name.slice(0, 40) : "unknown_error",
      })
      return false
    }
  }, [
    createEmbeddedWallet,
    createOrRestoreSession,
    createWalletAccount,
    dynamicWaasIsEnabled,
    embeddedWalletSessionActive,
    getWaasWalletConnector,
    getWaasWallets,
    getWaasWalletsByCredentials,
    initializeWaas,
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
    if (merchantEmail && dynamicUserEmail && dynamicUserEmail !== merchantEmail) {
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
    if (!merchantEmail || !dynamicUserEmail) {
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
        dynamic_email: dynamicUserEmail,
        merchant_email: merchantEmail,
        base_address: baseAddress,
        solana_address: solanaAddress,
      }
      const profilePostKey = [
        user.userId || "",
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
      emitWalletSetupDebugEvent("wallet_profile_post_attempting", {})
      emitWalletSetupDebugEvent("wallet_core_profile_post_started", {})
      profilePostInFlightKeyRef.current = profilePostKey
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
            setActiveTab("overview")
            setWalletOpen(true)
            emitWalletSetupDebugEvent("wallet_wallet_page_opened_after_create", {})
          }
        }
        // Fire rail sync in the background so merchant_wallets stays in sync with
        // the PineTree Wallet profile without blocking the UI response.
        void fetch("/api/wallets/pinetree-wallet/rail-sync", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }).then(() => fetchProviderRailState(token)).catch(() => undefined)
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
        setWalletIdentityError(
          "This PineTree Wallet doesn't match the one already saved for your account. Contact support to continue."
        )
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
  }, [user, wallets, primaryWallet, dynamicWalletSearchList, dynamicNetworkAddresses, dynamicWalletRuntimeCount, waasRuntimeWallets.length, waasCredentialWalletSources.length, waasCredentialSignerWallets.length, repairInProgress, logWalletCreationStep, fetchProviderRailState, merchantEmail, dynamicUserEmail, dynamicEmailSource, recordWalletSetupFailure])

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
  }, [pendingSync, sdkHasLoaded, user, merchantEmail, dynamicUserEmail, dynamicEmailSource, logWalletCreationStep, recordWalletSetupFailure])

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
    if (!merchantEmail) return "merchant_email_missing"
    if (!dynamicUserEmail) return "dynamic_email_missing"
    if (dynamicUserEmail !== merchantEmail) return "dynamic_email_mismatch"
    if (dynamicWalletRuntimeCount === 0) return "no_dynamic_wallets"

    const baseAddress = dynamicNetworkAddresses.base[0]?.address ?? null
    const solanaAddress = dynamicNetworkAddresses.solana[0]?.address ?? null
    if (!baseAddress) return "base_address_missing"
    if (!solanaAddress) return "solana_address_missing"

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
      dynamicAuthSheetOpen: Boolean(showAuthFlow),
      nativeFallbackPending: nativeFallbackPendingRef.current,
      profilePostInFlight: Boolean(profilePostInFlightKeyRef.current),
    })
    if (suppressionReason) {
      emitWalletSetupDebugEvent("wallet_setup_timeout_suppressed_waiting_for_native_auth", {
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
      dynamicAuthSheetOpen: Boolean(showAuthFlow),
      nativeFallbackPending: nativeFallbackPendingRef.current,
      profilePostInFlight: Boolean(profilePostInFlightKeyRef.current),
    })
    if (suppressionReason) {
      emitWalletSetupDebugEvent("wallet_setup_timeout_suppressed_waiting_for_native_auth", {
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
        dynamicAuthSheetOpen: Boolean(showAuthFlow),
        nativeFallbackPending: nativeFallbackPendingRef.current,
        profilePostInFlight: Boolean(profilePostInFlightKeyRef.current),
      })
      if (fireTimeSuppression) {
        emitWalletSetupDebugEvent("wallet_setup_timeout_suppressed_waiting_for_native_auth", {
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
  // Derived state â€” wallet profile (Base/Solana from Dynamic, DB-backed)
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
  // Derived state â€” Lightning (PineTree-managed backend, NOT Dynamic Spark)
  // ---------------------------------------------------------------------------

  const btcPayoutReady = railReadiness?.bitcoin_lightning.withdrawalReady ?? Boolean(profile?.btc_address && profile.btc_payout_enabled)
  const bitcoinPayoutEntries: AddressEntry[] = profile?.btc_address
    ? [{
        id: "btc-payout",
        address: profile.btc_address,
      }]
    : []

  const bitcoinReady = railReadiness?.bitcoin_lightning.walletProvisioned ?? btcPayoutReady
  const coreWalletProfileReady = profile?.status === "ready" && baseReady && solanaReady
  const dynamicProfileReady = coreWalletProfileReady && baseSignerReady && solanaSignerReady
  const dynamicEmbeddedSignersReady = baseSignerReady && solanaSignerReady
  const profileHasDynamicAddresses = baseReady || solanaReady
  // Wallet exists once a PineTree embedded wallet address is available.
  const hasWallet = profileState.kind === "loaded" && (baseReady || solanaReady || btcPayoutReady || bitcoinReady)
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
    setCoreSetupNeedsUserAuth(false)
    console.info("[pinetree-wallets] wallet_dynamic_native_user_detected", {})
    emitWalletSetupDebugEvent("wallet_dynamic_native_user_detected", {})
    emitWalletSetupDebugEvent("wallet_native_auth_resume_started", {})

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
        setActiveTab("overview")
        setWalletOpen(true)
        emitWalletSetupDebugEvent("wallet_wallet_page_opened_after_create", { existingProfile: true })
        return
      }
      emitWalletSetupDebugEvent("wallet_native_auth_resume_core_started", {})
      void refreshDynamicWalletRuntime("native_auth_resume_embedded_wallet_provisioning", { requireApprovalWallet: false })
    })()
  }, [user, lightningProfileState.kind, refreshDynamicWalletRuntime])

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

  const walletRailRows = useMemo<WalletRailRow[]>(() => [
    { rail: "base", label: "Base" as const, configured: baseReady, enabled: enabledRails.base },
    { rail: "solana", label: "Solana" as const, configured: solanaReady, enabled: enabledRails.solana },
    { rail: "bitcoin", label: "Bitcoin" as const, configured: bitcoinReady, enabled: enabledRails.bitcoin },
  ], [baseReady, bitcoinReady, enabledRails.base, enabledRails.bitcoin, enabledRails.solana, solanaReady])

  const withdrawalWalletRows = useMemo(() => [
    { rail: "base" as const, configured: baseReady && enabledRails.base },
    { rail: "solana" as const, configured: solanaReady && enabledRails.solana },
    { rail: "bitcoin" as const, configured: btcPayoutReady && enabledRails.bitcoin },
  ], [baseReady, btcPayoutReady, enabledRails.base, enabledRails.bitcoin, enabledRails.solana, solanaReady])

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
    const browserWalletAddresses = [
      ...(wallets as unknown[]),
      primaryWallet,
    ].filter(Boolean).flatMap((wallet) => getDynamicWalletAddresses(wallet as DynamicWalletLike))
    const matchingWallet = findDynamicWalletForSource(wallets as unknown[], primaryWallet, sourceAddress || "", withdrawalRail)
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
  }, [lightningProfileState, primaryWallet, profile, walletRailRows, wallets, withdrawalAsset, withdrawalRail])

  const lightningPayoutSummary = useMemo(() => {
    const connected =
      btcPayoutReady &&
      lightningProfileState.kind === "loaded" &&
      lightningProfileState.profile.status === "ready"
    return {
      connected,
      destinationLabel: btcPayoutReady ? "PineTree BTC Wallet" as const : "Not set" as const,
    }
  }, [btcPayoutReady, lightningProfileState])

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
  const liveEmailMismatch =
    Boolean(user) && Boolean(merchantEmail) && Boolean(dynamicUserEmail) && dynamicUserEmail !== merchantEmail
  const liveEmailUnverified =
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
    if (profileState.kind === "none") return "create_wallet"
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
    openWalletReconnectNeeded,
  ])

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
    walletSetupPrimaryState === "email_mismatch" ? "Wrong sign-in" :
    walletSetupPrimaryState === "email_unverified" ? "Wrong sign-in" :
    walletSetupPrimaryState === "save_needed" ? "Save needed" :
    walletSetupPrimaryState === "rail_sync_needed" ? "Rail sync needed" :
    walletSetupPrimaryState === "failed" ? "Failed" :
    "Not connected"

  const walletCreationMessage =
    (
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
  const showProvisioningRetryOnly = walletSetupPrimaryState === "failed" && Boolean(user)

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

  // Server-visible mirror of the wallet_dynamic_* console diagnostics below - frontend
  // console.info never reaches Vercel logs from a mobile browser, so this fires a small
  // sanitized beacon at the same checkpoints. Fire-and-forget: never awaited, never
  // throws into the UI, and never blocks wallet creation. Reads window.location.search
  // directly (rather than walletSyncDebugQueryEnabled state) so it has no dependency-array
  // staleness concerns and can be called from anywhere in this component.
  function emitWalletSetupDebugEvent(event: string, details?: WalletSetupDebugDetails) {
    if (!isWalletDebugEventsEnabled()) return
    const safeDetails = details ?? {}
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

  function beginWalletProvisioningAttempt(step: WalletCreationStep, reason: string, options?: { retry?: boolean }) {
    if (walletSetupStartInFlightRef.current || (pendingSync && !provisioningRetryExhausted)) return false
    const attemptId = createWalletSetupAttemptId()
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
    setRepairFailedIncomplete(false)
    setProvisioningRetryExhausted(false)
    setFinalProvisioningRefreshAttempted(false)
    setPendingSync(true)
    markWalletSetupInProgress()
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
    setActiveTab("overview")
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
    setPendingSync(true)
    markWalletSetupInProgress()
    setProvisioningRetryExhausted(false)
    setFinalProvisioningRefreshAttempted(false)
    pendingProfileSyncAttemptRef.current = false
    if (hasReadyBaseAndSolanaProfile) {
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
    setActiveTab("withdraw")
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
            walletLike &&
              (walletLike.signAndSendTransaction || walletLike.connector?.signAndSendTransaction)
          ),
          hasEvmClient: Boolean(
            walletLike && (walletLike.getWalletClient || walletLike.connector?.getWalletClient)
          ),
        })
      }
      if (matched) {
        // Wallet is already active and matches â€” return to form; values are preserved.
        await syncProfileFromDynamic()
        setWithdrawalScreen(withdrawalReview ? "review" : "form")
        return
      }
      // Wallets are loaded but none match the saved address â€” different account or session.
    }

    // No Dynamic wallets are active. Trigger the Dynamic auth flow to reconnect the session.
    // The post-reconnect useEffect will re-run address matching once wallets load.
    setWithdrawalReconnectPending(true)
    setWithdrawalScreen(withdrawalReview ? "review" : "form")
    void syncProfileFromDynamic()
    setShowDynamicUserProfile(false)
    setShowAuthFlow(false)
    scheduleDynamicEmailFallbackAuth("withdrawal_reconnect")
  }

  function handleCreateWallet() {
    emitWalletSetupDebugEvent("wallet_create_clicked", {
      sdkLoaded: sdkHasLoaded,
      userPresent: Boolean(user),
    })
    if (walletSetupStartInFlightRef.current || (pendingSync && !provisioningRetryExhausted)) return
    void createPineTreeWalletSetup({ retry: false })
  }

  // Single orchestrator for Create PineTree Wallet and Try Again. Starts the core
  // Dynamic wallet task and Speed/Lightning provisioning at the same time - neither
  // waits for the other, and Promise.allSettled plus non-throwing tasks guarantee a
  // Speed rejection can never short-circuit or fail core wallet creation.
  async function createPineTreeWalletSetup(options: { retry: boolean }) {
    emitWalletSetupDebugEvent("wallet_setup_orchestrator_started", { retry: options.retry })
    const [coreResult, lightningResult] = await Promise.allSettled([
      startCoreDynamicWallet(options),
      provisionSpeedLightning(),
    ])
    const core = coreResult.status === "fulfilled" ? coreResult.value : "failed"
    const lightning = lightningResult.status === "fulfilled" ? lightningResult.value : "failed"
    emitWalletSetupDebugEvent("wallet_setup_orchestrator_settled", { core, lightning })
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
      if (!res.ok) {
        emitWalletSetupDebugEvent("wallet_speed_setup_failed", { status: res.status })
        return "failed"
      }
      const json = (await res.json()) as { profile: MerchantLightningProfile | null }
      if (json.profile) {
        setLightningProfileState({ kind: "loaded", profile: json.profile })
      }
      const status = json.profile?.status
      if (status === "ready") {
        emitWalletSetupDebugEvent("wallet_speed_setup_success", {})
        return "ready"
      }
      if (status === "needs_attention") {
        emitWalletSetupDebugEvent("wallet_speed_setup_failed", { reason: "needs_attention" })
        return "needs_attention"
      }
      emitWalletSetupDebugEvent("wallet_speed_setup_pending", {})
      return "pending"
    } catch {
      emitWalletSetupDebugEvent("wallet_speed_setup_failed", { reason: "request_threw" })
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
  }

  function handleEditWithdrawal() {
    setWithdrawalScreen("form")
    setWithdrawalSubmitResult(null)
    setWithdrawalApprovalError("")
    setWithdrawalError("")
  }

  function handleDoneWithdrawal() {
    setWithdrawalScreen("form")
    setWithdrawalReview(null)
    setWithdrawalSubmitResult(null)
    setWithdrawalApprovalError("")
    setWithdrawalError("")
    setWalletOpen(false)
  }

  async function handleReviewWithdrawal() {
    const token = accessTokenRef.current
    const destination = withdrawalDestination.trim()
    const rawAmount = withdrawalAmount.trim()
    // Normalize leading-dot input (.01 â†’ 0.01) so the review card and API payload
    // always receive a canonical decimal string.
    const amount = rawAmount.startsWith(".") ? `0${rawAmount}` : rawAmount

    setWithdrawalReview(null)
    setWithdrawalSubmitResult(null)
    setWithdrawalScreen("form")
    setWithdrawalApprovalError("")
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
      setWithdrawalError("Enter an amount greater than 0.")
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
      setWithdrawalError("Withdrawals are being finalized. Receiving funds is available now.")
      return
    }
    const reviewSourceAddress = getWithdrawalSourceAddress(profile, withdrawalRail)
    const reviewSigner =
      withdrawalRail === "base" || withdrawalRail === "solana"
        ? findDynamicApprovalWalletForSource(wallets as unknown[], primaryWallet, withdrawalRail, reviewSourceAddress)
        : true
    // Block review when the Dynamic wallet runtime has no usable signer â€” creating a withdrawal request
    // row now would result in pending spam that can never be signed in this session.
    if (sdkHasLoaded && user && (dynamicWalletRuntimeCount === 0 || !reviewSigner)) {
      if (walletCreationDebugEnabled) {
        console.info("[pinetree-wallets] withdrawal_review_blocked_no_runtime_wallets", {
          dynamicUserId: user.userId,
          sdkHasLoaded,
          dynamicWalletRuntimeCount,
          withdrawalRail,
          withdrawalAsset,
          sourceAddressPresent: Boolean(reviewSourceAddress),
          matchingDynamicWallet: Boolean(reviewSigner),
        })
      }
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
      setWithdrawalScreen("review")
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
        if (nextStatus === "Withdrawal failed") setWithdrawalScreen("failed")
        if (json.request.status === "processing" || json.request.status === "failed") {
          void syncPineTreeWallet()
          return
        }
      } catch {
        return
      }
    }
  }

  async function handleSubmitWithdrawal() {
    const token = accessTokenRef.current
    const withdrawalId = withdrawalReview?.request.id
    if (!token || !withdrawalId) return

    const _debugRail = withdrawalReview?.review.rail
    const _debugApprovalMethod = withdrawalReview?.review.approvalMethod
    if (_debugApprovalMethod === "dynamic_browser") {
      await refreshDynamicWalletRuntime("withdrawal_submit_before_signing", { requireApprovalWallet: true })
    }
    const _debugSourceAddress = _debugRail ? getWithdrawalSourceAddress(profile, _debugRail) : null
    const _debugMatchingWallet = _debugRail
      ? findDynamicApprovalWalletForSource(wallets as unknown[], primaryWallet, _debugRail, _debugSourceAddress)
      : null
    if (_debugApprovalMethod === "dynamic_browser" && !_debugMatchingWallet) {
      setWithdrawalApprovalError(
        _debugRail === "solana"
          ? solanaWithdrawalReconnectMessage
          : pineTreeSignerReconnectMessage
      )
      setWithdrawalScreen("failed")
      return
    }
    if (_debugApprovalMethod === "dynamic_browser" && _debugMatchingWallet && _debugRail) {
      try {
        assertDynamicWalletChain(_debugMatchingWallet as DynamicWalletLike, _debugRail)
        if (!dynamicWalletSupportsRail(_debugMatchingWallet as DynamicWalletLike, _debugRail)) {
          throw new Error("Dynamic signer method mismatch.")
        }
      } catch (error) {
        console.warn("[pinetree-withdrawals] selected_signer_asset_rail_mismatch", {
          requestedRail: _debugRail,
          requestedAsset: withdrawalReview?.review.asset,
          requestId: withdrawalId,
          selectedWalletChainClassification: classifyDynamicWalletChain(_debugMatchingWallet as DynamicWalletLike),
          sourceAddressPresent: Boolean(_debugSourceAddress),
          error: error instanceof Error ? error.message : "unknown",
        })
        setWithdrawalApprovalError(withdrawalSignerRailMismatchMessage)
        setWithdrawalScreen("failed")
        return
      }
    }
    console.info("[pinetree-withdrawals] approval_state", {
      rail: _debugRail,
      asset: withdrawalReview?.review.asset,
      requestId: withdrawalId,
      approvalMethod: _debugApprovalMethod,
      approvalReady: Boolean(withdrawalReview?.canSubmit && _debugApprovalMethod === "dynamic_browser"),
      hasMatchingDynamicWallet: Boolean(_debugMatchingWallet),
      hasSolanaSigner: Boolean(_debugMatchingWallet && dynamicWalletSupportsRail(_debugMatchingWallet as DynamicWalletLike, "solana")),
      hasEvmSigner: Boolean(_debugMatchingWallet && dynamicWalletSupportsRail(_debugMatchingWallet as DynamicWalletLike, "base")),
      primaryActionLabel: _debugApprovalMethod === "dynamic_browser" ? "Approve withdrawal" : "Submit withdrawal request",
    })

    setSubmittingWithdrawal(true)
    setWithdrawalError("")
    setWithdrawalApprovalError("")
    setWithdrawalSubmitResult(null)
    setWithdrawalScreen("approving")
    try {
      // Route by the server's approvalMethod decision, not by client wallet-lookup state.
      // When the server says dynamic_browser, always use prepareâ†’signâ†’complete. If the
      // Dynamic wallet is not found at signing time, the user gets a clear error to retry.
      if (withdrawalReview?.review.approvalMethod === "dynamic_browser") {
        const prepareRes = await fetch(`/api/wallets/pinetree-wallet/withdrawals/${encodeURIComponent(withdrawalId)}/prepare`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        })
        const prepared = (await prepareRes.json()) as WithdrawalPrepareResponse | { error?: string }
        if (!prepareRes.ok) {
          // Clear the stale review so the button reverts to "Review withdrawal". The
          // underlying request status may have changed (e.g. already "pending"), and
          // prepare will keep rejecting it. The merchant must re-review to start fresh.
          setWithdrawalReview(null)
          setWithdrawalApprovalError(sanitizeWithdrawalSubmitErrorForMerchant("error" in prepared ? prepared.error : undefined))
          setWithdrawalScreen("failed")
          return
        }

        const dynamicSubmission = await sendDynamicPreparedWithdrawal(prepared as WithdrawalPrepareResponse, wallets as unknown[], primaryWallet, {
          selectedRail: withdrawalRail,
          selectedAsset: withdrawalAsset,
          destinationAddress: withdrawalReview?.review.destinationAddress ?? withdrawalDestination,
          pineTreeProfileSolanaAddress: profile?.solana_address ?? null,
          primaryWallet,
          switchDynamicWallet,
        })
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
          // Clear stale review: status is no longer "review_required" after prepare
          // succeeded, so a retry would fail at prepare with "not ready".
          setWithdrawalReview(null)
          setWithdrawalApprovalError(sanitizeWithdrawalSubmitErrorForMerchant("error" in submitted ? submitted.error : undefined))
          setWithdrawalScreen("failed")
          return
        }
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
      setWithdrawalApprovalError(sanitizeWithdrawalSubmitErrorForMerchant(error instanceof Error ? error.message : undefined))
      setWithdrawalScreen("failed")
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
          <WalletStatusPill
            label={walletStatus}
            tone="blue"
            className="shrink-0"
          />
        </div>
        {!walletProvisioningInProgress ? (
          <div className="mt-3 max-w-xl">
            <p className="text-sm leading-6 text-gray-600">
              One merchant wallet for receiving funds and managing payments.
            </p>
            <div className="mt-4">
              <EnabledRailChips rows={walletRailRows} />
            </div>
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

        <div className="mt-6 flex justify-start">
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
          ) : hasWallet ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleOpenWallet}
                disabled={syncing || walletCreationInProgress || walletOpening}
                className="h-10 rounded-lg bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
              >
                {walletOpening ? "Opening PineTree Wallet..." : "Open PineTree Wallet"}
              </button>
            </div>
          ) : showProvisioningRetryOnly ? null : (
            <button
              type="button"
              onClick={handleCreateWallet}
              disabled={syncing || logoutPending || walletCreationInProgress}
              className="h-10 rounded-lg bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
            >
              {logoutPending || walletCreationInProgress ? "Creating PineTree Wallet..." : "Create PineTree Wallet"}
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
                  <WalletStatusPill
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
              className="grid shrink-0 grid-cols-4 gap-1.5 border-b border-gray-100 px-4 py-3 sm:px-6"
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
                <>
                  {lightningProfileState.kind === "loaded" &&
                  lightningProfileState.profile.status === "needs_attention" &&
                  ["business_profile_required", "business_owner_profile_required"].includes(String(lightningProfileState.profile.speed_connected_account_status || "")) ? (
                    <BusinessProfileRequiredBanner />
                  ) : null}
                  <WalletOverviewSummary
                    rows={walletRailRows}
                    sync={walletSync}
                    syncing={walletSyncing}
                  />
                </>
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
                  lightningPayout={lightningPayoutSummary}
                  destinationAddress={withdrawalDestination}
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
                  onAssetSelect={handleWithdrawalAssetSelect}
                  onDestinationChange={(value) => {
                    setWithdrawalDestination(value)
                    setWithdrawalScreen("form")
                    setWithdrawalReview(null)
                    setWithdrawalSubmitResult(null)
                    setWithdrawalError("")
                    setWithdrawalApprovalError("")
                  }}
                  onAmountChange={(value) => {
                    setWithdrawalAmount(value)
                    setWithdrawalScreen("form")
                    setWithdrawalReview(null)
                    setWithdrawalSubmitResult(null)
                    setWithdrawalError("")
                    setWithdrawalApprovalError("")
                  }}
                  onMaxAmount={handleMaxWithdrawalAmount}
                  onEdit={handleEditWithdrawal}
                  onDone={handleDoneWithdrawal}
                  onReview={() => void handleReviewWithdrawal()}
                  onSubmit={() => void handleSubmitWithdrawal()}
                  onOpenWallet={handleWithdrawalReconnect}
                  onFinishSetup={handleFinishWalletSetup}
                />
              ) : null}

              {activeTab === "activity" ? (
                <ActivityTab sync={walletSync} syncing={walletSyncing} />
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
        <h1 className={dashboardPageTitleClass}>PineTree Wallet</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
          Create and open your merchant wallet.
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
