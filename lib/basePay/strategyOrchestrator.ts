/**
 * Base Pay Strategy Orchestrator
 *
 * Pure, client-safe module — no server imports, no environment reads.
 * The caller resolves server-side flags (delegatedEnabled, relayerAvailable)
 * and passes them in. This module returns the optimal strategy order for
 * the current wallet + session.
 *
 * Architecture: UI (lib/) → component → API → ENGINE → DB
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type BasePayAsset = "ETH" | "USDC"

export type WalletFamily =
  | "coinbase"
  | "trust"
  | "metamask"
  | "rainbow"
  | "kraken"
  | "unknown"

export type BasePayWalletCapabilities = {
  walletFamily: WalletFamily
  /** Wallet explicitly advertised wallet_sendCalls in WC session namespaces */
  supportsSendCalls: boolean
  /** Wallet supports eth_signTypedData_v4 (EIP-3009) */
  supportsTypedData: boolean
  /** Skip EIP-3009 relayer path entirely (Trust Wallet) */
  skipEip3009: boolean
  /**
   * Skip delegated batch attempt. True only when WC namespaces are present AND
   * wallet_sendCalls is absent AND wallet is not Coinbase (which should always
   * be tried for Smart Wallet).
   */
  skipDelegatedBatch: boolean
}

export type BasePayStrategy =
  | "base_eth_direct"
  | "usdc_delegated_batch_wallet_sendCalls"
  | "usdc_eip3009_relayer"
  | "usdc_allowance_direct"
  | "usdc_allowance_two_step"

export type BasePayOrchestrationInput = {
  asset: BasePayAsset
  walletCapabilities: BasePayWalletCapabilities
  /** Server flag: PINETREE_BASE_DELEGATED_EOA_ENABLED=true */
  delegatedEnabled: boolean
  /** Server flag: V5 relayer configured and gas within cap */
  relayerAvailable: boolean
  /** Whether payer's current USDC allowance covers the required amount */
  allowanceSufficient: boolean
}

export type BasePayOrchestrationResult = {
  primaryStrategy: BasePayStrategy
  fallbackStrategies: BasePayStrategy[]
  reason: string
  expectedWalletPrompts: number
  expectedTransactions: number
  requiresWalletConnect: boolean
  customerFacingNotice: string
  debugSummary: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Classify wallet family from WalletConnect peer name. */
export function classifyWalletFamily(peerName: string | null): WalletFamily {
  const name = (peerName || "").toLowerCase()
  if (name.includes("coinbase")) return "coinbase"
  if (name.includes("trust")) return "trust"
  if (name.includes("metamask")) return "metamask"
  if (name.includes("rainbow")) return "rainbow"
  if (name.includes("kraken")) return "kraken"
  return "unknown"
}

/**
 * Build wallet capabilities from WalletConnect session data.
 * Accepts the provider as `unknown` so this can be called from browser code
 * without importing the WalletConnectProvider type.
 */
export function detectCapabilitiesFromProvider(
  peerName: string | null,
  provider: unknown
): BasePayWalletCapabilities {
  const walletFamily = classifyWalletFamily(peerName)

  const sessionNamespaces = (
    provider as {
      session?: { namespaces?: Record<string, { methods?: string[] }> }
    }
  ).session?.namespaces

  let supportsSendCalls = true // optimistic when no namespace data
  if (sessionNamespaces) {
    supportsSendCalls = false
    for (const ns of Object.values(sessionNamespaces)) {
      if (Array.isArray(ns.methods) && ns.methods.includes("wallet_sendCalls")) {
        supportsSendCalls = true
        break
      }
    }
  }

  const supportsTypedData = walletFamily !== "trust"
  const skipEip3009 = !supportsTypedData

  // Skip delegated only when namespaces definitively show no sendCalls AND wallet
  // is not Coinbase (Smart Wallet must always be tried regardless of namespace state).
  const skipDelegatedBatch =
    Boolean(sessionNamespaces) && !supportsSendCalls && walletFamily !== "coinbase"

  return {
    walletFamily,
    supportsSendCalls,
    supportsTypedData,
    skipEip3009,
    skipDelegatedBatch,
  }
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export function orchestrateBasePayStrategy(
  input: BasePayOrchestrationInput
): BasePayOrchestrationResult {
  const { asset, walletCapabilities, delegatedEnabled, relayerAvailable, allowanceSufficient } =
    input
  const { walletFamily, supportsSendCalls, skipEip3009, skipDelegatedBatch } = walletCapabilities

  // ── ETH ────────────────────────────────────────────────────────────────────
  if (asset === "ETH") {
    return {
      primaryStrategy: "base_eth_direct",
      fallbackStrategies: [],
      reason: "ETH payments always use a direct on-chain split transaction.",
      expectedWalletPrompts: 1,
      expectedTransactions: 1,
      requiresWalletConnect: true,
      customerFacingNotice: "Approve payment in your wallet.",
      debugSummary: `asset=ETH walletFamily=${walletFamily} strategy=base_eth_direct`,
    }
  }

  // ── USDC ───────────────────────────────────────────────────────────────────
  // Capability flags
  const canDelegated = delegatedEnabled && !skipDelegatedBatch && supportsSendCalls
  const canEip3009 = relayerAvailable && !skipEip3009

  const fallbacks: BasePayStrategy[] = []
  let primaryStrategy: BasePayStrategy
  let reason: string
  let expectedWalletPrompts: number
  let expectedTransactions: number
  let customerFacingNotice: string

  if (canDelegated) {
    // Best path: wallet_sendCalls batches approve + payment into one approval.
    // User sees exactly one wallet prompt regardless of allowance state.
    primaryStrategy = "usdc_delegated_batch_wallet_sendCalls"
    reason = `${walletFamily} wallet supports batch calls — approve and payment combined into one prompt.`
    expectedWalletPrompts = 1
    expectedTransactions = 1
    customerFacingNotice = "Approve payment in your wallet."
    if (canEip3009) fallbacks.push("usdc_eip3009_relayer")
    if (allowanceSufficient) fallbacks.push("usdc_allowance_direct")
    fallbacks.push("usdc_allowance_two_step")
  } else if (canEip3009) {
    // Second-best: customer signs typed data once, PineTree relayer submits on-chain.
    // One wallet prompt (signature), zero user-submitted transactions.
    primaryStrategy = "usdc_eip3009_relayer"
    reason = `${walletFamily} wallet: one wallet approval (signature), PineTree relayer submits the transaction.`
    expectedWalletPrompts = 1
    expectedTransactions = 1
    customerFacingNotice = "Approve payment in your wallet."
    if (allowanceSufficient) fallbacks.push("usdc_allowance_direct")
    fallbacks.push("usdc_allowance_two_step")
  } else if (allowanceSufficient) {
    // Sufficient allowance exists — single payment transaction, no approve needed.
    primaryStrategy = "usdc_allowance_direct"
    reason = skipEip3009
      ? `${walletFamily} wallet: typed data not supported. Existing USDC authorization covers this payment.`
      : "Existing USDC authorization covers this payment — no additional step needed."
    expectedWalletPrompts = 1
    expectedTransactions = 1
    customerFacingNotice = "Approve payment in your wallet."
    fallbacks.push("usdc_allowance_two_step")
  } else {
    // Last resort: two-step. One-time authorization transaction then payment transaction.
    primaryStrategy = "usdc_allowance_two_step"
    reason = skipEip3009
      ? `${walletFamily} wallet: typed data not supported. One-time authorization required before payment.`
      : "No single-prompt path available. One-time authorization required before payment."
    expectedWalletPrompts = 2
    expectedTransactions = 2
    customerFacingNotice = "One-time USDC authorization required, then confirm payment."
  }

  const debugSummary = [
    `asset=USDC`,
    `primary=${primaryStrategy}`,
    `walletFamily=${walletFamily}`,
    `supportsSendCalls=${supportsSendCalls}`,
    `skipEip3009=${skipEip3009}`,
    `skipDelegatedBatch=${skipDelegatedBatch}`,
    `delegatedEnabled=${delegatedEnabled}`,
    `relayerAvailable=${relayerAvailable}`,
    `allowanceSufficient=${allowanceSufficient}`,
  ].join(" | ")

  return {
    primaryStrategy,
    fallbackStrategies: fallbacks,
    reason,
    expectedWalletPrompts,
    expectedTransactions,
    requiresWalletConnect: true,
    customerFacingNotice,
    debugSummary,
  }
}
