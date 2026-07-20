import {
  createWithdrawalDestination,
  deleteWithdrawalDestination,
  getWithdrawalDestination,
  listWithdrawalDestinations,
  countWithdrawalDestinationsForRail,
  MAX_DESTINATIONS_PER_MERCHANT_RAIL,
  type MerchantWithdrawalDestination,
  type WithdrawalDestinationRail,
  type WithdrawalDestinationMethod,
} from "@/database/merchantWithdrawalDestinations"
import { normalizeWithdrawalRail, normalizeWithdrawalAsset } from "@/engine/withdrawals/walletWithdrawals"
import { classifyBitcoinWithdrawalDestination } from "@/providers/wallets/bitcoinWithdrawalDestination"

export type CreateWithdrawalDestinationRequest = {
  rail: string
  asset: string
  destinationAddress: string
  label?: string
  isDefault?: boolean
}

function isValidNonBitcoinAddress(rail: WithdrawalDestinationRail, address: string): boolean {
  if (rail === "base") return /^0x[a-fA-F0-9]{40}$/.test(address)
  if (rail === "solana") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)
  return false
}

/**
 * Validates and classifies a destination exactly like the withdrawal review
 * flow (engine/withdrawals/walletWithdrawals.ts) so a saved address book
 * entry can never be invalid for its rail, and so a Bitcoin entry is always
 * tagged with the correct method (onchain vs lightning) - the address book
 * is rail-aware: a saved Lightning destination must never be offered while
 * withdrawing on Bitcoin Network, and vice versa.
 */
export async function saveWithdrawalDestination(
  merchantId: string,
  input: CreateWithdrawalDestinationRequest
): Promise<MerchantWithdrawalDestination> {
  const rail = normalizeWithdrawalRail(input.rail)
  const asset = normalizeWithdrawalAsset(input.asset)
  const rawAddress = String(input.destinationAddress || "").trim()

  if (!rail) throw Object.assign(new Error("Unsupported withdrawal rail."), { status: 400 })
  if (!asset) throw Object.assign(new Error("Unsupported asset."), { status: 400 })
  if (!rawAddress) throw Object.assign(new Error("Destination address is required."), { status: 400 })

  let method: WithdrawalDestinationMethod | null = null
  let destinationAddress: string

  if (rail === "bitcoin") {
    const classified = classifyBitcoinWithdrawalDestination(rawAddress)
    if (!classified.valid) {
      throw Object.assign(
        new Error("Enter a valid Bitcoin address, Lightning Address, or Lightning invoice."),
        { status: 400 }
      )
    }
    // BOLT11 invoices are single-use by design - saving one to the address
    // book would just save something already useless for a second withdrawal.
    // Only reusable destinations (an on-chain address, or a Lightning Address)
    // may be saved.
    if (classified.kind === "bolt11_invoice") {
      throw Object.assign(
        new Error("Lightning invoices are single-use and can't be saved. Save a Lightning Address instead."),
        { status: 400 }
      )
    }
    method = classified.method
    destinationAddress = classified.normalized
  } else {
    if (!isValidNonBitcoinAddress(rail, rawAddress)) {
      throw Object.assign(new Error("Destination address is invalid for the selected rail."), { status: 400 })
    }
    destinationAddress = rawAddress
  }

  const existingCount = await countWithdrawalDestinationsForRail(merchantId, rail)
  if (existingCount >= MAX_DESTINATIONS_PER_MERCHANT_RAIL) {
    throw Object.assign(new Error("Saved destination limit reached for this rail."), { status: 409 })
  }

  return createWithdrawalDestination({
    merchantId,
    rail,
    asset,
    method,
    destinationAddress,
    label: input.label,
    isDefault: input.isDefault,
  })
}

export async function listMerchantWithdrawalDestinations(
  merchantId: string,
  filter: { rail?: WithdrawalDestinationRail; method?: WithdrawalDestinationMethod } = {}
): Promise<MerchantWithdrawalDestination[]> {
  return listWithdrawalDestinations(merchantId, filter)
}

export async function removeWithdrawalDestination(merchantId: string, id: string): Promise<void> {
  const existing = await getWithdrawalDestination(merchantId, id)
  if (!existing) {
    throw Object.assign(new Error("Saved destination not found."), { status: 404 })
  }
  await deleteWithdrawalDestination(merchantId, id)
}
