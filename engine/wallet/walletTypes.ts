/**
 * Provider-agnostic PineTree wallet-management types.
 *
 * Every type here is what crosses the PineTree route/UI boundary. Nothing
 * provider-specific (Speed field names, Speed object shapes, Speed account
 * identifiers) may appear on these types - a provider adapter's job is to
 * translate its own raw payloads into exactly these shapes. See
 * engine/wallet/walletProviderAdapter.ts for the adapter contract that
 * produces them.
 */

import type {
  WalletOperationDirection,
  WalletOperationStatus,
  WalletOperationType,
} from "@/database/merchantWalletOperations"
import type { AutoPayoutSchedule, AutoSwapStatus } from "@/database/merchantWalletPreferences"

export type PineTreeWalletOperationStatus = WalletOperationStatus | "INCOMPLETE" | "ACTION_REQUIRED"

export type PineTreeWalletCapabilities = {
  balances: boolean
  activity: boolean
  withdrawals: boolean
  payouts: boolean
  swaps: boolean
  automaticPayouts: boolean
  automaticConversion: boolean
}

/** Non-blocking diagnostics for the UI/operator - never a reason to change routing. */
export type PineTreeWalletCapabilitiesResult = {
  provider: string | null
  providerDisplayName: string | null
  configured: boolean
  ready: boolean
  capabilities: PineTreeWalletCapabilities
}

export type PineTreeWalletBalance = {
  asset: string
  availableBaseUnits: string
  pendingBaseUnits: string | null
  totalBaseUnits: string | null
  decimals: number
  network: string | null
  providerUpdatedAt: string | null
  cachedAt: string | null
  stale: boolean
}

export type PineTreeWalletBalancesResult = {
  capabilityAvailable: boolean
  unavailableReason: string | null
  syncStatus: "live" | "cached" | "unavailable"
  lastSuccessfulSyncAt: string | null
  balances: PineTreeWalletBalance[]
}

export type PineTreeWalletOperation = {
  id: string
  provider: string
  operationType: WalletOperationType
  direction: WalletOperationDirection
  status: PineTreeWalletOperationStatus
  asset: string
  network: string | null
  amountBaseUnits: string
  feeBaseUnits: string | null
  destinationSummary: string | null
  txHash: string | null
  explorerUrl: string | null
  failureReason: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type PineTreeWalletActivityPage = {
  operations: PineTreeWalletOperation[]
  nextCursor: string | null
}

export type PineTreeWalletSwapQuote = {
  sourceAsset: string
  targetAsset: string
  sourceAmountBaseUnits: string
  targetAmountBaseUnits: string
  exchangeRate: number | null
  expiresAt: string | null
  quoteReference: string | null
}

export type PineTreeWalletPreferences = {
  autoPayoutEnabled: boolean
  autoPayoutSchedule: AutoPayoutSchedule
  autoPayoutDestination: string | null
  autoPayoutSourceAsset: string | null
  autoPayoutMinThresholdBaseUnits: string | null
  autoPayoutRetainedBalanceBaseUnits: string | null
  autoSwapEnabled: boolean
  autoSwapSourceAsset: string | null
  autoSwapTargetAsset: string | null
  autoSwapStatus: AutoSwapStatus
}

export type PineTreeWalletWriteResult = {
  operation: PineTreeWalletOperation
  capabilityAvailable: boolean
}
