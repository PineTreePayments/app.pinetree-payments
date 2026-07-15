/**
 * Fully resolved, provider-agnostic payment rail eligibility.
 *
 * Answers "which payment rails are eligible for this merchant/channel?" by
 * combining the canonical rail category definitions (types/payment.ts) with
 * this specific merchant's actual provider connections and readiness
 * (engine/paymentIntents.ts's getMerchantAvailableNetworks, which already
 * owns that DB/readiness resolution - not re-implemented here).
 *
 * Callers (POS, Checkout, a future /api/payment-methods route) ask this
 * resolver, never compute the category/readiness intersection themselves.
 * The frontend must never perform this intersection.
 */

import { getMerchantAvailableNetworks } from "./paymentIntents"
import {
  getPaymentRailDefinition,
  getRailsForCategory,
  getRailsForChannel,
  type PaymentNetwork,
  type PaymentRailCategory,
  type PaymentRailChannel
} from "@/types/payment"

export type PaymentRailEligibility = {
  rail: PaymentNetwork
  category: PaymentRailCategory
  enabled: boolean
  unavailableReason: "not_connected_or_not_ready" | null
}

export type GetEligiblePaymentRailsInput = {
  merchantId: string
  channel: PaymentRailChannel
  /** Restrict to one category (e.g. POS's Crypto button) - omit to return every customer-facing rail on the channel. */
  category?: PaymentRailCategory
}

export async function getEligiblePaymentRails(
  input: GetEligiblePaymentRailsInput
): Promise<PaymentRailEligibility[]> {
  const merchantId = String(input.merchantId || "").trim()
  if (!merchantId) throw new Error("Missing merchant id")

  const channelRails = new Set(getRailsForChannel(input.channel))
  const candidateRails = (input.category ? getRailsForCategory(input.category) : Array.from(channelRails)).filter(
    (rail) => channelRails.has(rail)
  )

  const merchantNetworks = await getMerchantAvailableNetworks(merchantId)
  const availableSet = new Set(merchantNetworks)

  return candidateRails.map((rail) => {
    const definition = getPaymentRailDefinition(rail)
    const enabled = definition.customerFacing && availableSet.has(rail)
    return {
      rail,
      category: definition.category,
      enabled,
      unavailableReason: enabled ? null : "not_connected_or_not_ready"
    }
  })
}

/** Convenience wrapper for callers that only need the enabled rail ids for a category (e.g. POS's crypto-only intent restriction). */
export async function getEnabledRailsForCategory(
  merchantId: string,
  category: PaymentRailCategory,
  channel: PaymentRailChannel
): Promise<PaymentNetwork[]> {
  const eligibility = await getEligiblePaymentRails({ merchantId, channel, category })
  return eligibility.filter((rail) => rail.enabled).map((rail) => rail.rail)
}
