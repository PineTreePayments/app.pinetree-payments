/**
 * Generic wallet-provider adapter contract.
 *
 * This is the ONLY boundary a provider integration (Speed today; Dynamic,
 * Fireblocks, Coinbase, etc. in the future) may cross to participate in
 * PineTree wallet management. Nothing above this layer (routes, the
 * frontend, or engine/wallet/walletOperations.ts's callers) may import a
 * provider package directly or branch on a provider name - the engine only
 * ever calls these methods through a registered WalletProviderAdapter.
 *
 * A provider adapter (e.g. providers/lightning/speedWalletAdapter.ts) is
 * free to use whatever provider-specific request/response shapes,
 * credentials, or account identifiers it needs internally - it must
 * translate everything into the generic types in engine/wallet/walletTypes.ts
 * (or the adapter-local input/result types below) before returning.
 */

import type { WalletOperationStatus } from "@/database/merchantWalletOperations"
import type { PineTreeWalletCapabilities, PineTreeWalletSwapQuote } from "./walletTypes"

/**
 * Resolved once per request by the generic engine from PineTree's own
 * merchant/provider records - never trust a client-supplied value for
 * providerAccountId. See each adapter's resolveContext().
 */
export type WalletAdapterContext = {
  merchantId: string
  providerAccountId: string
}

export type WalletAdapterResolution =
  | { configured: true; ready: true; context: WalletAdapterContext }
  | { configured: true; ready: false; reason: string }
  | { configured: false; reason: string }

export type WalletAdapterCapabilities = Omit<PineTreeWalletCapabilities, "activity">

export type WalletAdapterBalance = {
  asset: string
  availableBaseUnits: bigint
  pendingBaseUnits: bigint
  totalBaseUnits: bigint
  network: string | null
  providerUpdatedAt: string | null
}

export type WalletAdapterWriteInput = {
  asset: string
  amountBaseUnits: bigint
  destination: string
  note?: string
  idempotencyKey: string
}

export type WalletAdapterOperationResult = {
  providerReference: string | null
  providerStatus: string | null
  status: WalletOperationStatus
  txHash?: string | null
  explorerUrl?: string | null
  feeBaseUnits?: bigint | null
}

export type WalletAdapterSwapQuoteInput = {
  sourceAsset: string
  targetAsset: string
  amountBaseUnits: bigint
}

export type WalletAdapterSwapInput = WalletAdapterSwapQuoteInput & { idempotencyKey: string }

/**
 * A provider only needs to implement the optional methods it actually
 * supports - the engine checks getCapabilities() before ever calling one of
 * the optional methods, and treats a missing method as
 * WALLET_CAPABILITY_UNAVAILABLE regardless of what getCapabilities() says
 * (defense in depth).
 */
export interface WalletProviderAdapter {
  readonly provider: string
  readonly providerDisplayName: string

  /** Determines whether merchantId has a ready account with this provider - never accepts a client-supplied account id. */
  resolveContext(merchantId: string): Promise<WalletAdapterResolution>

  getCapabilities(context: WalletAdapterContext): Promise<WalletAdapterCapabilities>

  getBalances?(context: WalletAdapterContext): Promise<WalletAdapterBalance[]>

  listActivity?(context: WalletAdapterContext): Promise<void>

  createWithdrawal?(
    context: WalletAdapterContext,
    input: WalletAdapterWriteInput
  ): Promise<WalletAdapterOperationResult>

  getWithdrawalStatus?(
    context: WalletAdapterContext,
    providerReference: string
  ): Promise<WalletAdapterOperationResult>

  createPayout?(
    context: WalletAdapterContext,
    input: WalletAdapterWriteInput
  ): Promise<WalletAdapterOperationResult>

  getPayoutStatus?(
    context: WalletAdapterContext,
    providerReference: string
  ): Promise<WalletAdapterOperationResult>

  quoteSwap?(
    context: WalletAdapterContext,
    input: WalletAdapterSwapQuoteInput
  ): Promise<PineTreeWalletSwapQuote>

  createSwap?(
    context: WalletAdapterContext,
    input: WalletAdapterSwapInput
  ): Promise<WalletAdapterOperationResult>

  getSwapStatus?(
    context: WalletAdapterContext,
    providerReference: string
  ): Promise<WalletAdapterOperationResult>
}
