// Settlement Destinations engine layer.
// Sits between API routes and the database module.
// Enforces address validation, business rules, and activity logging.
// NEVER stores private keys, seed phrases, exchange passwords, or API keys.

import {
  listSettlementDestinations,
  getSettlementDestination,
  createSettlementDestination,
  updateSettlementDestination,
  deleteSettlementDestination,
  setDefaultSettlementDestination,
  countSettlementDestinations,
  MAX_DESTINATIONS_PER_MERCHANT,
  type SettlementDestinationRecord,
  type CreateSettlementDestinationInput,
  type UpdateSettlementDestinationInput
} from "@/database/settlementDestinations"
import {
  createWalletOperation,
  recordWalletOperationEvent
} from "@/database/walletOperations"

// ─── Supported asset/network combinations ────────────────────────────────────

export type SettlementAssetOption = {
  asset: string
  network: string
  label: string
}

export const SETTLEMENT_ASSET_OPTIONS: SettlementAssetOption[] = [
  { asset: "SOL",  network: "solana", label: "SOL on Solana" },
  { asset: "USDC", network: "solana", label: "USDC on Solana" },
  { asset: "USDC", network: "base",   label: "USDC on Base" },
  { asset: "ETH",  network: "base",   label: "ETH on Base" },
]

export const SETTLEMENT_EXCHANGE_OPTIONS = [
  "Coinbase",
  "Kraken",
  "Gemini",
  "Robinhood",
  "Strike",
  "Custom Wallet",
] as const

export type SettlementExchangeName = (typeof SETTLEMENT_EXCHANGE_OPTIONS)[number]

function isSupportedAssetNetwork(asset: string, network: string): boolean {
  const a = asset.trim().toUpperCase()
  const n = network.trim().toLowerCase()
  return SETTLEMENT_ASSET_OPTIONS.some((opt) => opt.asset === a && opt.network === n)
}

// ─── Address validation ───────────────────────────────────────────────────────

function validateAddress(
  address: string,
  network: string
): { valid: true } | { valid: false; error: string } {
  const a = address.trim()
  const n = network.trim().toLowerCase()

  if (!a) return { valid: false, error: "Address is required." }

  if (n === "base" || n === "ethereum") {
    if (!/^0x[a-fA-F0-9]{40}$/.test(a)) {
      return {
        valid: false,
        error: "Invalid Base address. Must start with 0x followed by 40 hex characters."
      }
    }
  } else if (n === "solana") {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) {
      return {
        valid: false,
        error: "Invalid Solana address. Must be a base58-encoded public key (32–44 characters)."
      }
    }
  }
  // Lightning/BTC: presence check only — address formats vary (Lightning address, LNURL, on-chain)
  return { valid: true }
}

// ─── Field validation ─────────────────────────────────────────────────────────

type DestinationFields = {
  label: string
  exchangeName: string
  asset: string
  network: string
  address: string
  memoOrTag?: string | null
}

function validateDestinationFields(
  fields: DestinationFields
): { valid: true } | { valid: false; error: string } {
  if (!fields.label.trim()) return { valid: false, error: "Label is required." }
  if (fields.label.trim().length > 80) return { valid: false, error: "Label must be 80 characters or fewer." }

  if (!fields.exchangeName.trim()) return { valid: false, error: "Exchange is required." }

  const asset = fields.asset.trim().toUpperCase()
  const network = fields.network.trim().toLowerCase()

  if (!asset) return { valid: false, error: "Asset is required." }
  if (!network) return { valid: false, error: "Network is required." }

  if (!isSupportedAssetNetwork(asset, network)) {
    return { valid: false, error: `${asset} on ${network} is not a supported settlement combination.` }
  }

  const addrResult = validateAddress(fields.address, network)
  if (!addrResult.valid) return addrResult

  if (fields.memoOrTag && fields.memoOrTag.trim().length > 200) {
    return { valid: false, error: "Memo/Tag must be 200 characters or fewer." }
  }

  return { valid: true }
}

// ─── Engine functions ─────────────────────────────────────────────────────────

export async function getSettlementDestinationsEngine(
  merchantId: string
): Promise<SettlementDestinationRecord[]> {
  return listSettlementDestinations(merchantId)
}

export async function createSettlementDestinationEngine(
  merchantId: string,
  input: Omit<CreateSettlementDestinationInput, "merchantId">
): Promise<SettlementDestinationRecord> {
  const validation = validateDestinationFields({
    label: input.label,
    exchangeName: input.exchangeName,
    asset: input.asset,
    network: input.network,
    address: input.address,
    memoOrTag: input.memoOrTag
  })

  if (!validation.valid) {
    throw Object.assign(new Error(validation.error), { status: 400 })
  }

  const count = await countSettlementDestinations(merchantId)
  if (count >= MAX_DESTINATIONS_PER_MERCHANT) {
    throw Object.assign(
      new Error(`Maximum of ${MAX_DESTINATIONS_PER_MERCHANT} exchange destinations allowed.`),
      { status: 422 }
    )
  }

  const dest = await createSettlementDestination({ merchantId, ...input })

  // If this is the first destination or isDefault is requested, it's already set.
  // If other defaults exist and this is marked default, clear them.
  if (dest.is_default) {
    await setDefaultSettlementDestination(merchantId, dest.id)
  }

  // Activity log: destination created
  try {
    const op = await createWalletOperation({
      merchantId,
      provider: "settlement",
      operationType: "SETTLEMENT_DESTINATION_CREATED",
      asset: dest.asset,
      network: dest.network,
      amount: 0,
      destinationType: "exchange",
      destinationValue: dest.address,
      status: "COMPLETED",
      metadata: {
        destination_id: dest.id,
        label: dest.label,
        exchange_name: dest.exchange_name
      }
    })
    await recordWalletOperationEvent({
      walletOperationId: op.id,
      merchantId,
      eventType: "destination_created",
      provider: "settlement",
      rawPayload: { destination_id: dest.id, label: dest.label }
    })
  } catch {
    // Activity logging is non-critical; do not fail the create
  }

  return dest
}

export async function updateSettlementDestinationEngine(
  merchantId: string,
  id: string,
  input: Omit<UpdateSettlementDestinationInput, "merchantId" | "id">
): Promise<SettlementDestinationRecord> {
  const existing = await getSettlementDestination(merchantId, id)
  if (!existing) {
    throw Object.assign(new Error("Settlement destination not found."), { status: 404 })
  }

  // Validate with merged values
  const merged = {
    label:       input.label       ?? existing.label,
    exchangeName: input.exchangeName ?? existing.exchange_name,
    asset:       input.asset       ?? existing.asset,
    network:     input.network     ?? existing.network,
    address:     input.address     ?? existing.address,
    memoOrTag:   input.memoOrTag   !== undefined ? input.memoOrTag : existing.memo_or_tag
  }

  const validation = validateDestinationFields(merged)
  if (!validation.valid) {
    throw Object.assign(new Error(validation.error), { status: 400 })
  }

  const updated = await updateSettlementDestination({ merchantId, id, ...input })

  if (updated.is_default) {
    await setDefaultSettlementDestination(merchantId, id)
  }

  // Activity log
  try {
    const op = await createWalletOperation({
      merchantId,
      provider: "settlement",
      operationType: "SETTLEMENT_DESTINATION_UPDATED",
      asset: updated.asset,
      network: updated.network,
      amount: 0,
      destinationType: "exchange",
      destinationValue: updated.address,
      status: "COMPLETED",
      metadata: { destination_id: id, label: updated.label }
    })
    await recordWalletOperationEvent({
      walletOperationId: op.id,
      merchantId,
      eventType: "destination_updated",
      provider: "settlement",
      rawPayload: { destination_id: id }
    })
  } catch {
    // Non-critical
  }

  return updated
}

export async function deleteSettlementDestinationEngine(
  merchantId: string,
  id: string
): Promise<void> {
  const existing = await getSettlementDestination(merchantId, id)
  if (!existing) {
    throw Object.assign(new Error("Settlement destination not found."), { status: 404 })
  }

  await deleteSettlementDestination(merchantId, id)

  // Activity log
  try {
    const op = await createWalletOperation({
      merchantId,
      provider: "settlement",
      operationType: "SETTLEMENT_DESTINATION_DELETED",
      asset: existing.asset,
      network: existing.network,
      amount: 0,
      destinationType: "exchange",
      destinationValue: existing.address,
      status: "COMPLETED",
      metadata: { destination_id: id, label: existing.label }
    })
    await recordWalletOperationEvent({
      walletOperationId: op.id,
      merchantId,
      eventType: "destination_deleted",
      provider: "settlement",
      rawPayload: { destination_id: id, label: existing.label }
    })
  } catch {
    // Non-critical
  }
}

export async function setDefaultSettlementDestinationEngine(
  merchantId: string,
  id: string
): Promise<SettlementDestinationRecord[]> {
  const existing = await getSettlementDestination(merchantId, id)
  if (!existing) {
    throw Object.assign(new Error("Settlement destination not found."), { status: 404 })
  }

  await setDefaultSettlementDestination(merchantId, id)
  return listSettlementDestinations(merchantId)
}

// Initiating a withdrawal is not yet enabled for execution.
// This records intent only — no funds are moved.
export async function initiateWithdrawalReviewEngine(
  merchantId: string,
  destinationId: string
): Promise<{ status: "review_only"; message: string }> {
  const dest = await getSettlementDestination(merchantId, destinationId)
  if (!dest) {
    throw Object.assign(new Error("Settlement destination not found."), { status: 404 })
  }

  // Activity log: withdrawal initiated (review only)
  try {
    const op = await createWalletOperation({
      merchantId,
      provider: "settlement",
      operationType: "SETTLEMENT_WITHDRAWAL_INITIATED",
      asset: dest.asset,
      network: dest.network,
      amount: 0,
      destinationType: "exchange",
      destinationValue: dest.address,
      status: "DRAFT",
      metadata: {
        destination_id: dest.id,
        label: dest.label,
        execution_status: "not_enabled"
      }
    })
    await recordWalletOperationEvent({
      walletOperationId: op.id,
      merchantId,
      eventType: "withdrawal_review_initiated",
      provider: "settlement",
      rawPayload: { destination_id: dest.id, execution_status: "not_enabled" }
    })
  } catch {
    // Non-critical
  }

  return {
    status: "review_only",
    message: "Withdrawal execution is not yet enabled. This review was logged."
  }
}
