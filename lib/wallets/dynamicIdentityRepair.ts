/**
 * Dynamic identity write/repair contract for PineTree Wallet profiles.
 *
 * `dynamic_user_id` must always hold Dynamic's own internal user id, never
 * PineTree's merchant UUID. Historical data (and older clients) can leave
 * `dynamic_user_id` equal to `merchant_id` ("legacy" state) — this module
 * decides, for a single incoming write, whether that legacy state may be
 * safely repaired to the real Dynamic user id, without ever silently
 * clobbering a different, already-valid stored identity.
 */

export type DynamicIdentityWriteDecision =
  | { action: "write"; dynamicUserId: string; reason: "initial_provision" | "legacy_repair" }
  | { action: "noop"; reason: "no_incoming_value" | "matches_existing" | "incoming_equals_merchant_id" }
  | { action: "blocked"; reason: "different_owner_without_ownership_proof" | "existing_identity_already_valid_and_different" }

function normalizedId(value: string | null | undefined) {
  return String(value || "").trim() || null
}

/**
 * A stored dynamic_user_id is "legacy/invalid" when it is missing or when it
 * was written as the PineTree merchant UUID instead of Dynamic's real user id
 * (the historical bug this module exists to repair).
 */
export function isLegacyOrInvalidDynamicUserId(
  storedDynamicUserId: string | null | undefined,
  merchantId: string
): boolean {
  const stored = normalizedId(storedDynamicUserId)
  if (!stored) return true
  return stored === normalizedId(merchantId)
}

/**
 * Decide whether an incoming dynamic_user_id value may be persisted.
 *
 * - Never accepts merchant_id itself as a dynamic_user_id value.
 * - Freely writes when there is no prior stored value (initial provisioning).
 * - No-ops when the incoming value already matches what's stored.
 * - Repairs a legacy/invalid stored value only when ownership of the Dynamic
 *   session has been proven (the request's dynamic_external_user_id/JWT
 *   subject matches this merchant).
 * - Blocks (never silently overwrites) when the stored value is already a
 *   different, valid Dynamic user id — that could be a different Dynamic
 *   owner, and must not be replaced automatically.
 */
export function decideDynamicUserIdWrite(params: {
  merchantId: string
  existingDynamicUserId: string | null | undefined
  incomingDynamicUserId: string | null | undefined
  ownershipProven: boolean
}): DynamicIdentityWriteDecision {
  const merchantId = normalizedId(params.merchantId)
  const incoming = normalizedId(params.incomingDynamicUserId)
  const existing = normalizedId(params.existingDynamicUserId)

  if (!incoming) {
    return { action: "noop", reason: "no_incoming_value" }
  }
  if (incoming === merchantId) {
    return { action: "noop", reason: "incoming_equals_merchant_id" }
  }
  if (!existing) {
    return { action: "write", dynamicUserId: incoming, reason: "initial_provision" }
  }
  if (existing === incoming) {
    return { action: "noop", reason: "matches_existing" }
  }

  if (isLegacyOrInvalidDynamicUserId(existing, params.merchantId)) {
    if (!params.ownershipProven) {
      return { action: "blocked", reason: "different_owner_without_ownership_proof" }
    }
    return { action: "write", dynamicUserId: incoming, reason: "legacy_repair" }
  }

  return { action: "blocked", reason: "existing_identity_already_valid_and_different" }
}
