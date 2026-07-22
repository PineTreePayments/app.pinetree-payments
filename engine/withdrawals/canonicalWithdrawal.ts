/**
 * Canonical withdrawal dispatcher - the single entry point manual, saved-
 * address, and automatic-sweep withdrawals all funnel through, so a caller
 * never needs to know which of PineTree's two independent, already-tested
 * per-rail engines actually executes a given withdrawal.
 *
 * This is a thin router, not a merge: Base/Solana (self-custodial Dynamic
 * embedded wallet, requires two-phase browser signing) still goes through
 * engine/withdrawals/walletWithdrawals.ts's review/prepare/complete flow
 * unchanged; Bitcoin (Speed custodial sub-account, server-executed) still
 * goes through engine/wallet/walletOperations.ts unchanged. Both existing
 * engines' internal logic is untouched - this file only adds a uniform
 * calling convention plus source/destination stamping on top.
 */

import {
  createWalletWithdrawalReview,
  type CreateWalletWithdrawalReviewResult,
} from "@/engine/withdrawals/walletWithdrawals"
import { createWalletWithdrawal as createBitcoinWalletWithdrawal } from "@/engine/wallet/walletOperations"
import type { WalletAdapterWriteDiagnostics } from "@/engine/wallet/walletProviderAdapter"
import type { PineTreeWalletWriteResult } from "@/engine/wallet/walletTypes"
import {
  updateWalletWithdrawalRequestCanonicalFields,
  findWalletWithdrawalRequestByIdempotencyKey,
  type WalletWithdrawalRequestRecord,
} from "@/database/walletWithdrawalRequests"
import { updateWalletOperationCanonicalFields } from "@/database/merchantWalletOperations"
import {
  getWithdrawalDestination,
  markWithdrawalDestinationUsed,
  type MerchantWithdrawalDestination,
} from "@/database/merchantWithdrawalDestinations"

export type CanonicalWithdrawalSource = "manual" | "saved_address" | "automatic_sweep"
export type CanonicalWithdrawalRail = "base" | "solana" | "bitcoin"
export type CanonicalWithdrawalAsset = "ETH" | "USDC" | "SOL" | "BTC"

export type SubmitCanonicalWithdrawalInput = {
  merchantId: string
  rail: CanonicalWithdrawalRail
  asset: CanonicalWithdrawalAsset
  amountDecimal: string
  source: CanonicalWithdrawalSource
  /** Stable, caller-supplied idempotency key. Required for every caller. */
  idempotencyKey: string
  /** Exactly one of destinationId / destinationAddress must be provided. */
  destinationId?: string
  destinationAddress?: string
  correlationId?: string | null
  diagnostics?: WalletAdapterWriteDiagnostics
}

// Base/Solana: nothing has executed yet - this is a two-phase review, same
// contract as createWalletWithdrawalReview today. The caller still must
// drive prepare -> sign -> complete via the existing Dynamic browser flow.
export type CanonicalWithdrawalReviewResult = {
  kind: "review_required"
  table: "wallet_withdrawal_requests"
  request: WalletWithdrawalRequestRecord
  review: CreateWalletWithdrawalReviewResult["review"]
  canSubmit: boolean
}

// Bitcoin: already submitted server-side via Speed by the time this returns.
export type CanonicalWithdrawalExecutedResult = {
  kind: "executed"
  table: "merchant_wallet_operations"
  write: PineTreeWalletWriteResult
}

export type SubmitCanonicalWithdrawalResult =
  | CanonicalWithdrawalReviewResult
  | CanonicalWithdrawalExecutedResult

async function resolveDestination(
  merchantId: string,
  input: SubmitCanonicalWithdrawalInput
): Promise<{ address: string; destination: MerchantWithdrawalDestination | null }> {
  const hasId = Boolean(input.destinationId)
  const hasRaw = Boolean(input.destinationAddress)
  if (hasId === hasRaw) {
    throw Object.assign(
      new Error("Provide exactly one of a saved destination or a manually entered address."),
      { status: 400 }
    )
  }

  if (input.source === "automatic_sweep" && !hasId) {
    throw Object.assign(
      new Error("Automatic sweeps must use a saved, confirmed destination - never a raw address."),
      { status: 400 }
    )
  }

  if (hasId) {
    const destination = await getWithdrawalDestination(merchantId, input.destinationId as string)
    if (!destination || destination.archived_at) {
      throw Object.assign(new Error("Saved destination not found."), { status: 404 })
    }
    if (destination.rail !== input.rail || destination.asset !== input.asset) {
      throw Object.assign(
        new Error("Saved destination does not match the selected asset and network."),
        { status: 400 }
      )
    }
    if (!destination.is_enabled) {
      throw Object.assign(new Error("This saved destination is disabled."), { status: 409 })
    }
    if (input.source === "automatic_sweep" && destination.confirmation_status !== "confirmed") {
      throw Object.assign(
        new Error("This destination must be confirmed before it can back an automatic sweep."),
        { status: 409 }
      )
    }
    return { address: destination.destination_address, destination }
  }

  return { address: input.destinationAddress as string, destination: null }
}

function buildDestinationSnapshot(
  destination: MerchantWithdrawalDestination | null
): Record<string, unknown> | null {
  if (!destination) return null
  return {
    id: destination.id,
    label: destination.label,
    rail: destination.rail,
    asset: destination.asset,
    method: destination.method,
    destination_address: destination.destination_address,
    provider_name: destination.provider_name,
    memo_or_tag: destination.memo_or_tag,
    snapshotted_at: new Date().toISOString(),
  }
}

export async function submitCanonicalWithdrawal(
  input: SubmitCanonicalWithdrawalInput
): Promise<SubmitCanonicalWithdrawalResult> {
  const idempotencyKey = String(input.idempotencyKey || "").trim()
  if (!idempotencyKey) {
    throw Object.assign(new Error("An idempotency key is required."), { status: 400 })
  }

  const { address, destination } = await resolveDestination(input.merchantId, input)
  const snapshot = buildDestinationSnapshot(destination)

  if (input.rail === "bitcoin") {
    // Bitcoin's own idempotency is enforced inside createWalletWithdrawal via
    // merchant_wallet_operations' unique (merchant_id, idempotency_key)
    // index - a retry with the same key returns the existing operation
    // without re-submitting to Speed, so no separate pre-check is needed
    // here.
    const write = await createBitcoinWalletWithdrawal(input.merchantId, {
      asset: "SATS",
      amountDecimal: input.amountDecimal,
      destination: address,
      idempotencyKey,
      correlationId: input.correlationId,
      diagnostics: input.diagnostics,
    })
    await updateWalletOperationCanonicalFields(input.merchantId, write.operation.id, {
      source: input.source,
      destinationId: destination?.id ?? null,
      destinationSnapshot: snapshot,
    })
    if (destination) await markWithdrawalDestinationUsed(input.merchantId, destination.id)
    return { kind: "executed", table: "merchant_wallet_operations", write }
  }

  // Base / Solana: two-phase, browser-signed. A retry with the same
  // idempotency key must never create a second review row.
  const existing = await findWalletWithdrawalRequestByIdempotencyKey(input.merchantId, idempotencyKey)
  if (existing) {
    return {
      kind: "review_required",
      table: "wallet_withdrawal_requests",
      request: existing,
      review: existing.review_payload as unknown as CreateWalletWithdrawalReviewResult["review"],
      canSubmit: existing.status === "review_required" || existing.status === "pending",
    }
  }

  const result = await createWalletWithdrawalReview(input.merchantId, {
    rail: input.rail,
    asset: input.asset,
    destinationAddress: address,
    amountDecimal: input.amountDecimal,
  })

  const request = await updateWalletWithdrawalRequestCanonicalFields(input.merchantId, result.request.id, {
    source: input.source,
    destinationId: destination?.id ?? null,
    destinationSnapshot: snapshot,
    idempotencyKey,
  })

  if (destination) await markWithdrawalDestinationUsed(input.merchantId, destination.id)

  return {
    kind: "review_required",
    table: "wallet_withdrawal_requests",
    request,
    review: result.review,
    canSubmit: result.canSubmit,
  }
}
