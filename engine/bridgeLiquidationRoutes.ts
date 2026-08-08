/**
 * PineTree Engine - settlement routes for bank withdrawals.
 *
 * A settlement route is the permanent pairing of one source chain + asset with
 * one merchant bank destination. The provider issues a deposit address for it
 * once and that address never changes, so PineTree ensures the route exists and
 * reuses it forever after.
 *
 * ── Duplicate prevention, in three layers ────────────────────────────────────
 *   1. PineTree's own stored route is reused first - no provider call at all.
 *   2. Otherwise the provider's existing routes are enumerated and matched.
 *   3. Only then is one created, with a DETERMINISTIC idempotency key derived
 *      from the complete route identity.
 * The provider itself also rejects an equivalent duplicate, so a race between
 * two withdrawal attempts converges instead of creating a second permanent
 * route.
 *
 * ── Return address ───────────────────────────────────────────────────────────
 * The provider requires a return address on the SAME source chain, used when a
 * deposit cannot be processed. PineTree always uses the merchant's own PineTree
 * Wallet address for that chain, and refuses to create a route without a valid
 * one - an unreturnable deposit is worse than a blocked withdrawal.
 *
 * MERCHANT-FACING: nothing here is. Merchants see their bank account.
 */

import { randomUUID } from "node:crypto"

import {
  findLiquidationRoute,
  upsertLiquidationRoute,
  type LiquidationRouteRail,
  type MerchantBridgeLiquidationRoute,
} from "@/database/merchantBridgeLiquidationRoutes"
import { getMerchantBridgeConnection } from "@/database/merchantBridgeConnections"
import { getMerchantBankDestination } from "@/database/merchantBankDestinations"
import { getPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"
import { insertMerchantAuditEvent } from "@/database/merchantAuditEvents"
import {
  bridgeListItems,
  createLiquidationAddress,
  listLiquidationAddresses,
} from "@/providers/bridge/client"
import { isBridgeConfigured } from "@/providers/bridge/config"
import { describeBridgeError, isBridgeUnknownOutcomeError } from "@/providers/bridge/errors"
import { bridgeLiquidationAddressIdempotencyKey } from "@/providers/bridge/idempotency"
import {
  bridgeChainForRail,
  findMatchingLiquidationAddress,
  isReturnAddressValidForChain,
  normalizeBridgeLiquidationAddress,
} from "@/providers/bridge/normalizeMoneyMovement"
import type { BridgeLiquidationAddress } from "@/providers/bridge/types"

/** The only source combinations PineTree supports for a bank withdrawal today. */
export const SUPPORTED_BANK_WITHDRAWAL_SOURCES = [
  { rail: "base", asset: "USDC" },
  { rail: "solana", asset: "USDC" },
] as const

export function isSupportedBankWithdrawalSource(rail: string, asset: string): boolean {
  return SUPPORTED_BANK_WITHDRAWAL_SOURCES.some(
    (entry) => entry.rail === rail && entry.asset === asset
  )
}

export type LiquidationRouteFailure = {
  ok: false
  error: string
  retryable: boolean
  correlationId: string
}

function failure(error: string, correlationId: string, retryable = false): LiquidationRouteFailure {
  return { ok: false, error, retryable, correlationId }
}

/** The merchant's own wallet address on a chain, used as the return address. */
function walletAddressForRail(
  profile: Awaited<ReturnType<typeof getPineTreeWalletProfile>>,
  rail: LiquidationRouteRail
): string | null {
  if (!profile) return null
  const address = rail === "base" ? profile.base_address : profile.solana_address
  return String(address || "").trim() || null
}

export async function ensureLiquidationRouteEngine(args: {
  merchantId: string
  bankDestinationId: string
  sourceRail: LiquidationRouteRail
  sourceAsset: string
}): Promise<
  { ok: true; route: MerchantBridgeLiquidationRoute; reused: boolean; correlationId: string }
  | LiquidationRouteFailure
> {
  const correlationId = randomUUID()

  if (!isBridgeConfigured()) {
    return failure("Bank withdrawals are not available yet.", correlationId)
  }
  if (!isSupportedBankWithdrawalSource(args.sourceRail, args.sourceAsset)) {
    return failure("Bank withdrawals support USDC on Base and Solana.", correlationId)
  }

  // 1. PineTree's own stored route wins - no provider call.
  const stored = await findLiquidationRoute({
    merchantId: args.merchantId,
    bankDestinationId: args.bankDestinationId,
    sourceRail: args.sourceRail,
    sourceAsset: args.sourceAsset,
  }).catch(() => null)
  if (stored) return { ok: true, route: stored, reused: true, correlationId }

  const [connectionRow, destination, walletProfile] = await Promise.all([
    getMerchantBridgeConnection(args.merchantId).catch(() => null),
    getMerchantBankDestination(args.merchantId, args.bankDestinationId).catch(() => null),
    getPineTreeWalletProfile(args.merchantId).catch(() => null),
  ])

  const customerId = String(connectionRow?.credentials?.bridge_customer_id || "").trim()
  if (!customerId) {
    return failure("Finish your Business Profile verification to withdraw to a bank.", correlationId)
  }
  if (!destination || destination.archived_at) {
    return failure("Bank account not found.", correlationId)
  }
  if (destination.status !== "active" || !destination.provider_external_account_id) {
    return failure("This bank account is still being verified. Try again shortly.", correlationId)
  }

  const returnAddress = walletAddressForRail(walletProfile, args.sourceRail)
  if (!returnAddress || !isReturnAddressValidForChain(args.sourceRail, returnAddress)) {
    // Without a valid same-chain return address, an unprocessable deposit could
    // not be returned to the merchant. That is not a risk PineTree takes.
    return failure(
      "Your PineTree Wallet address for this network is not ready yet. Refresh your wallet and try again.",
      correlationId
    )
  }

  const chain = bridgeChainForRail(args.sourceRail)
  if (!chain) return failure("Unsupported network for bank withdrawals.", correlationId)

  const routeIdentity = {
    chain,
    currency: "usdc" as const,
    externalAccountId: destination.provider_external_account_id,
    destinationPaymentRail: "ach" as const,
    destinationCurrency: "usd" as const,
  }

  // 2. Reuse an equivalent route the provider already holds.
  try {
    const existing = await listLiquidationAddresses({
      customerId,
      context: { correlationId, merchantId: args.merchantId },
    })
    const match = findMatchingLiquidationAddress(
      bridgeListItems<BridgeLiquidationAddress>(existing.data),
      routeIdentity
    )
    if (match?.depositAddress) {
      const route = await upsertLiquidationRoute({
        merchantId: args.merchantId,
        bankDestinationId: destination.id,
        providerCustomerId: customerId,
        providerExternalAccountId: destination.provider_external_account_id,
        providerLiquidationAddressId: match.liquidationAddressId,
        depositAddress: match.depositAddress,
        sourceRail: args.sourceRail,
        sourceAsset: args.sourceAsset,
        destinationPaymentRail: routeIdentity.destinationPaymentRail,
        destinationCurrency: routeIdentity.destinationCurrency,
        returnAddress,
        state: match.state || "active",
      })
      return { ok: true, route, reused: true, correlationId }
    }
  } catch (error) {
    // Enumeration is an optimization. Failing it does not block creation: the
    // deterministic idempotency key and the provider's own duplicate rejection
    // still prevent a second permanent route.
    console.warn("[liquidation-routes] enumerate_failed", {
      correlationId,
      ...describeBridgeError(error),
    })
  }

  // 3. Create.
  try {
    const created = await createLiquidationAddress({
      customerId,
      chain,
      currency: "usdc",
      externalAccountId: destination.provider_external_account_id,
      destinationPaymentRail: "ach",
      destinationCurrency: "usd",
      returnAddress,
      idempotencyKey: bridgeLiquidationAddressIdempotencyKey({
        merchantId: args.merchantId,
        chain,
        currency: "usdc",
        externalAccountId: destination.provider_external_account_id,
        destinationPaymentRail: "ach",
        destinationCurrency: "usd",
      }),
      context: { correlationId, merchantId: args.merchantId },
    })

    const normalized = normalizeBridgeLiquidationAddress(created.data)
    if (!normalized.depositAddress) {
      console.error("[liquidation-routes] missing_deposit_address", { correlationId })
      return failure("Bank withdrawals are temporarily unavailable.", correlationId, true)
    }

    const route = await upsertLiquidationRoute({
      merchantId: args.merchantId,
      bankDestinationId: destination.id,
      providerCustomerId: customerId,
      providerExternalAccountId: destination.provider_external_account_id,
      providerLiquidationAddressId: normalized.liquidationAddressId,
      depositAddress: normalized.depositAddress,
      sourceRail: args.sourceRail,
      sourceAsset: args.sourceAsset,
      destinationPaymentRail: routeIdentity.destinationPaymentRail,
      destinationCurrency: routeIdentity.destinationCurrency,
      returnAddress,
      state: normalized.state || "active",
    })

    await insertMerchantAuditEvent({
      merchantId: args.merchantId,
      eventType: "wallet.bank_settlement_route_created",
      metadata: {
        destination_id: destination.id,
        source_rail: args.sourceRail,
        source_asset: args.sourceAsset,
        correlation_id: correlationId,
      },
    })

    return { ok: true, route, reused: false, correlationId }
  } catch (error) {
    const unknown = isBridgeUnknownOutcomeError(error)
    console.error("[liquidation-routes] create_failed", {
      correlationId,
      merchantId: args.merchantId,
      ...describeBridgeError(error),
    })
    return failure(
      unknown
        ? "That request did not complete in time. Nothing was lost - try again in a moment."
        : "Unable to prepare this bank withdrawal right now.",
      correlationId,
      true
    )
  }
}
