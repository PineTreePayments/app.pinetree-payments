import {
  createWithdrawalDestination,
  deleteWithdrawalDestination,
  archiveWithdrawalDestination,
  confirmWithdrawalDestination,
  updateWithdrawalDestination,
  getWithdrawalDestination,
  listWithdrawalDestinations,
  countWithdrawalDestinationsForRail,
  MAX_DESTINATIONS_PER_MERCHANT_RAIL,
  type MerchantWithdrawalDestination,
  type WithdrawalDestinationRail,
  type WithdrawalDestinationAsset,
  type WithdrawalDestinationMethod,
} from "@/database/merchantWithdrawalDestinations"
import { normalizeWithdrawalRail, normalizeWithdrawalAsset } from "@/engine/withdrawals/walletWithdrawals"
import { classifyBitcoinWithdrawalDestination } from "@/providers/wallets/bitcoinWithdrawalDestination"
import { insertMerchantAuditEvent } from "@/database/merchantAuditEvents"
import { sendWalletSecurityNotification } from "@/lib/email/sendWalletSecurityNotification"

export type CreateWithdrawalDestinationRequest = {
  rail: string
  asset: string
  destinationAddress: string
  label?: string
  isDefault?: boolean
  providerName?: string
  memoOrTag?: string
}

function isValidNonBitcoinAddress(rail: WithdrawalDestinationRail, address: string): boolean {
  if (rail === "base") return /^0x[a-fA-F0-9]{40}$/.test(address)
  if (rail === "solana") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)
  return false
}

async function notifyDestinationChange(
  merchantId: string,
  kind: "destination_added" | "destination_updated" | "destination_archived",
  destination: MerchantWithdrawalDestination
): Promise<void> {
  try {
    const { getMerchantById } = await import("@/database/merchants")
    const merchant = await getMerchantById(merchantId).catch(() => null)
    await sendWalletSecurityNotification({
      merchantEmail: merchant?.email ?? null,
      kind,
      summary: `A withdrawal destination on your PineTree Wallet was ${
        kind === "destination_added" ? "added" : kind === "destination_updated" ? "updated" : "archived"
      }.`,
      details: [
        { label: "Label", value: destination.label || "(no label)" },
        { label: "Asset", value: `${destination.asset} · ${destination.rail}` },
        { label: "Address", value: destination.destination_address },
      ],
    })
  } catch (error) {
    console.warn("[withdrawalDestinations] security notification failed", error)
  }
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

  const destination = await createWithdrawalDestination({
    merchantId,
    rail,
    asset,
    method,
    destinationAddress,
    label: input.label,
    isDefault: input.isDefault,
    providerName: input.providerName,
    memoOrTag: input.memoOrTag,
  })

  void insertMerchantAuditEvent({
    merchantId,
    eventType: "address_book.entry_added",
    metadata: { destination_id: destination.id, rail, asset, method },
  })
  void notifyDestinationChange(merchantId, "destination_added", destination)

  return destination
}

export async function listMerchantWithdrawalDestinations(
  merchantId: string,
  filter: {
    rail?: WithdrawalDestinationRail
    asset?: WithdrawalDestinationAsset
    method?: WithdrawalDestinationMethod
    includeArchived?: boolean
    includeDisabled?: boolean
  } = {}
): Promise<MerchantWithdrawalDestination[]> {
  return listWithdrawalDestinations(merchantId, filter)
}

export type PatchWithdrawalDestinationRequest = {
  label?: string
  isDefault?: boolean
  isEnabled?: boolean
  providerName?: string | null
}

export async function patchWithdrawalDestination(
  merchantId: string,
  id: string,
  input: PatchWithdrawalDestinationRequest
): Promise<MerchantWithdrawalDestination> {
  const existing = await getWithdrawalDestination(merchantId, id)
  if (!existing || existing.archived_at) {
    throw Object.assign(new Error("Saved destination not found."), { status: 404 })
  }

  const destination = await updateWithdrawalDestination(merchantId, id, {
    label: input.label,
    isDefault: input.isDefault,
    isEnabled: input.isEnabled,
    providerName: input.providerName,
  })

  void insertMerchantAuditEvent({
    merchantId,
    eventType: "address_book.entry_updated",
    metadata: { destination_id: id, changes: input },
  })
  void notifyDestinationChange(merchantId, "destination_updated", destination)

  return destination
}

/**
 * The merchant explicitly acknowledges the irreversible-transfer warning for
 * this exact destination. This is a real, application-level fact ("PineTree
 * has confirmed the merchant typed this exact acknowledgment for this exact
 * address"), NOT a cryptographic ownership proof - the UI/API must never
 * label this "Verified." Automatic sweep rules require a confirmed
 * destination; manual/saved-address withdrawals do not (no mandatory
 * cooldown or test transfer).
 */
export async function confirmMerchantWithdrawalDestination(
  merchantId: string,
  id: string
): Promise<MerchantWithdrawalDestination> {
  const existing = await getWithdrawalDestination(merchantId, id)
  if (!existing || existing.archived_at) {
    throw Object.assign(new Error("Saved destination not found."), { status: 404 })
  }
  const destination = await confirmWithdrawalDestination(merchantId, id)

  void insertMerchantAuditEvent({
    merchantId,
    eventType: "address_book.entry_confirmed",
    metadata: { destination_id: id },
  })

  return destination
}

/**
 * Deletes the destination if nothing references it yet; otherwise archives
 * it (soft delete) so withdrawal/sweep history stays intact. Never leaves
 * the merchant with a confusing "delete failed" dead end - always resolves
 * to one of these two outcomes.
 */
export async function removeWithdrawalDestination(
  merchantId: string,
  id: string
): Promise<{ archived: boolean }> {
  const existing = await getWithdrawalDestination(merchantId, id)
  if (!existing) {
    throw Object.assign(new Error("Saved destination not found."), { status: 404 })
  }

  try {
    await deleteWithdrawalDestination(merchantId, id)
    void insertMerchantAuditEvent({
      merchantId,
      eventType: "address_book.entry_deleted",
      metadata: { destination_id: id, rail: existing.rail, asset: existing.asset },
    })
    return { archived: false }
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 409) {
      await archiveWithdrawalDestination(merchantId, id)
      void insertMerchantAuditEvent({
        merchantId,
        eventType: "address_book.entry_archived",
        metadata: { destination_id: id, rail: existing.rail, asset: existing.asset, reason: "referenced_by_history" },
      })
      void notifyDestinationChange(merchantId, "destination_archived", { ...existing, archived_at: new Date().toISOString() })
      return { archived: true }
    }
    throw error
  }
}
