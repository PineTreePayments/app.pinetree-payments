/**
 * Bridge (by Stripe) - normalization for bank destinations, liquidation routes,
 * and drains.
 *
 * Everything here is a pure translation from Bridge's vocabulary into PineTree
 * terms. Nothing in this module writes to a database, contacts Bridge, or
 * produces merchant-facing copy - the Engine owns both.
 *
 * SECURITY: none of these normalizers accept or return a raw bank account
 * number. Bridge returns only the masked last four, and that is the only bank
 * identifier PineTree ever holds.
 */

import {
  BRIDGE_DRAIN_STATES,
  BRIDGE_LIQUIDATION_CHAINS,
  type BridgeDrain,
  type BridgeDrainState,
  type BridgeExternalAccount,
  type BridgeLiquidationAddress,
  type BridgeLiquidationChain,
} from "./types"

function trimmedOrNull(value: unknown): string | null {
  const normalized = String(value ?? "").trim()
  return normalized || null
}

/** The PineTree source rails that can feed a Bridge liquidation address. */
export type PineTreeLiquidationRail = "base" | "solana"

/**
 * Map a PineTree rail onto Bridge's `chain` value.
 *
 * They happen to use the same words today, but the mapping is explicit so a
 * future PineTree rail name change cannot silently send Bridge a chain it does
 * not recognize.
 */
export function bridgeChainForRail(rail: string): BridgeLiquidationChain | null {
  const normalized = String(rail || "").trim().toLowerCase()
  if (normalized === "base") return "base"
  if (normalized === "solana") return "solana"
  return null
}

export function railForBridgeChain(chain: unknown): PineTreeLiquidationRail | null {
  const normalized = String(chain ?? "").trim().toLowerCase()
  return (BRIDGE_LIQUIDATION_CHAINS as readonly string[]).includes(normalized)
    ? (normalized as PineTreeLiquidationRail)
    : null
}

/**
 * A Bridge liquidation address is chain-scoped, so its `return_address` must be
 * valid on that same chain. Sending a Base address for a Solana route would
 * make an unprocessable deposit unreturnable.
 */
export function isReturnAddressValidForChain(chain: string, address: string): boolean {
  const normalizedAddress = String(address || "").trim()
  if (!normalizedAddress) return false
  if (chain === "base") return /^0x[a-fA-F0-9]{40}$/.test(normalizedAddress)
  if (chain === "solana") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(normalizedAddress)
  return false
}

// ─── External accounts ───────────────────────────────────────────────────────

/** The safe, non-sensitive projection of a merchant's bank destination. */
export type NormalizedBridgeExternalAccount = {
  externalAccountId: string
  bankName: string | null
  accountName: string | null
  accountOwnerName: string | null
  /** Masked last four, exactly as Bridge returns it. Never the full number. */
  last4: string | null
  checkingOrSavings: "checking" | "savings" | null
  currency: string | null
  active: boolean
  /** Bridge's own reason when it deactivated the account. */
  deactivationReason: string | null
  providerCreatedAt: string | null
  providerUpdatedAt: string | null
}

export function normalizeBridgeExternalAccount(
  account: BridgeExternalAccount
): NormalizedBridgeExternalAccount {
  const nested = account.account || null
  const checking = trimmedOrNull(nested?.checking_or_savings)?.toLowerCase()

  return {
    externalAccountId: String(account.id || "").trim(),
    bankName: trimmedOrNull(account.bank_name),
    accountName: trimmedOrNull(account.account_name),
    accountOwnerName: trimmedOrNull(account.account_owner_name),
    last4: trimmedOrNull(nested?.last_4) || trimmedOrNull(account.last_4),
    checkingOrSavings: checking === "savings" ? "savings" : checking === "checking" ? "checking" : null,
    currency: trimmedOrNull(account.currency)?.toLowerCase() ?? null,
    // Bridge omits `active` on some creation responses; a freshly created
    // account is active, so absence is treated as active rather than as a
    // deactivated destination the merchant cannot use.
    active: account.active !== false,
    deactivationReason: trimmedOrNull(account.deactivation_reason),
    providerCreatedAt: trimmedOrNull(account.created_at),
    providerUpdatedAt: trimmedOrNull(account.updated_at),
  }
}

// ─── Liquidation addresses ───────────────────────────────────────────────────

export type NormalizedBridgeLiquidationAddress = {
  liquidationAddressId: string
  /** The on-chain address a merchant withdrawal is sent to. */
  depositAddress: string | null
  chain: PineTreeLiquidationRail | null
  currency: string | null
  externalAccountId: string | null
  destinationPaymentRail: string | null
  destinationCurrency: string | null
  /** Bridge reports `active` or `deactivated`. */
  state: string | null
  active: boolean
  providerCreatedAt: string | null
  providerUpdatedAt: string | null
}

export function normalizeBridgeLiquidationAddress(
  address: BridgeLiquidationAddress
): NormalizedBridgeLiquidationAddress {
  const state = trimmedOrNull(address.state)?.toLowerCase() ?? null

  return {
    liquidationAddressId: String(address.id || "").trim(),
    depositAddress: trimmedOrNull(address.address),
    chain: railForBridgeChain(address.chain),
    currency: trimmedOrNull(address.currency)?.toLowerCase() ?? null,
    externalAccountId: trimmedOrNull(address.external_account_id),
    destinationPaymentRail: trimmedOrNull(address.destination_payment_rail)?.toLowerCase() ?? null,
    destinationCurrency: trimmedOrNull(address.destination_currency)?.toLowerCase() ?? null,
    state,
    active: state !== "deactivated",
    providerCreatedAt: trimmedOrNull(address.created_at),
    providerUpdatedAt: trimmedOrNull(address.updated_at),
  }
}

/**
 * Find an existing Bridge liquidation address that already implements a route.
 *
 * A liquidation address is permanent and Bridge rejects a duplicate equivalent
 * route, so PineTree enumerates first and reuses rather than creating.
 */
export function findMatchingLiquidationAddress(
  addresses: BridgeLiquidationAddress[],
  route: {
    chain: PineTreeLiquidationRail
    currency: string
    externalAccountId: string
    destinationPaymentRail: string
    destinationCurrency: string
  }
): NormalizedBridgeLiquidationAddress | null {
  for (const candidate of addresses) {
    const normalized = normalizeBridgeLiquidationAddress(candidate)
    if (!normalized.liquidationAddressId || !normalized.active) continue
    if (normalized.chain !== route.chain) continue
    if (normalized.currency !== route.currency.toLowerCase()) continue
    if (normalized.externalAccountId !== route.externalAccountId) continue
    if (normalized.destinationPaymentRail !== route.destinationPaymentRail.toLowerCase()) continue
    if (normalized.destinationCurrency !== route.destinationCurrency.toLowerCase()) continue
    return normalized
  }
  return null
}

// ─── Drains ──────────────────────────────────────────────────────────────────

export function normalizeBridgeDrainState(value: unknown): BridgeDrainState | "unknown" {
  const normalized = trimmedOrNull(value)?.toLowerCase()
  if (!normalized) return "unknown"
  return (BRIDGE_DRAIN_STATES as readonly string[]).includes(normalized)
    ? (normalized as BridgeDrainState)
    : "unknown"
}

/**
 * The evidence a drain carries. Amounts stay decimal strings exactly as Bridge
 * serializes them - they are never parsed into a float.
 */
export type NormalizedBridgeDrain = {
  drainId: string
  liquidationAddressId: string | null
  customerId: string | null
  state: BridgeDrainState | "unknown"
  rawState: string | null
  amount: string | null
  currency: string | null
  /** The merchant's source-chain transaction that funded this drain. */
  depositTxHash: string | null
  /** Bridge's outgoing payment reference, when the payout has been made. */
  destinationTxHash: string | null
  refundTxHash: string | null
  destinationPaymentRail: string | null
  destinationCurrency: string | null
  externalAccountId: string | null
  /** ACH trace number / wire IMAD, when Bridge has one. Support evidence only. */
  payoutTraceReference: string | null
  returnReason: string | null
  occurredAt: string | null
  occurredAtMs: number | null
}

function parseTimestamp(value: unknown): { iso: string | null; ms: number | null } {
  const raw = trimmedOrNull(value)
  if (!raw) return { iso: null, ms: null }
  const parsed = Date.parse(raw)
  if (!Number.isFinite(parsed)) return { iso: raw, ms: null }
  return { iso: new Date(parsed).toISOString(), ms: parsed }
}

export function normalizeBridgeDrain(drain: BridgeDrain): NormalizedBridgeDrain | null {
  const drainId = String(drain.id || "").trim()
  if (!drainId) return null

  const destination = drain.destination || null
  // `updated_at` is the ordering key when present: a drain progresses forward
  // through its states, and created_at is identical across those transitions.
  const occurred = parseTimestamp(drain.updated_at ?? drain.created_at)

  return {
    drainId,
    liquidationAddressId: trimmedOrNull(drain.liquidation_address_id),
    customerId: trimmedOrNull(drain.customer_id),
    state: normalizeBridgeDrainState(drain.state),
    rawState: trimmedOrNull(drain.state),
    amount: trimmedOrNull(drain.amount),
    currency: trimmedOrNull(drain.currency)?.toLowerCase() ?? null,
    depositTxHash: trimmedOrNull(drain.deposit_tx_hash),
    destinationTxHash: trimmedOrNull(drain.destination_tx_hash),
    refundTxHash: trimmedOrNull(drain.refund_tx_hash),
    destinationPaymentRail: trimmedOrNull(destination?.payment_rail)?.toLowerCase() ?? null,
    destinationCurrency: trimmedOrNull(destination?.currency)?.toLowerCase() ?? null,
    externalAccountId: trimmedOrNull(destination?.external_account_id),
    payoutTraceReference: trimmedOrNull(destination?.trace_number) || trimmedOrNull(destination?.imad),
    returnReason: trimmedOrNull(drain.return_details?.reason),
    occurredAt: occurred.iso,
    occurredAtMs: occurred.ms,
  }
}

/**
 * Compare two deposit transaction references.
 *
 * EVM hashes are case-insensitive hex; Solana signatures are base58 and case
 * IS significant. Comparing case-insensitively for Base and exactly for Solana
 * keeps correlation correct on both rails.
 */
export function depositTxHashMatches(
  rail: PineTreeLiquidationRail,
  candidate: string | null | undefined,
  expected: string | null | undefined
): boolean {
  const left = String(candidate || "").trim()
  const right = String(expected || "").trim()
  if (!left || !right) return false
  return rail === "base" ? left.toLowerCase() === right.toLowerCase() : left === right
}
