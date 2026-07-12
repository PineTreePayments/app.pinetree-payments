/**
 * Centralized resolver for the Speed Instant Send `X-Speed-Account` header
 * value. This is the ONLY place in the codebase allowed to decide what goes
 * in that header - do not scatter ca_ vs acct_ selection logic elsewhere.
 *
 * Speed has confirmed connected-account context is supplied via
 * `X-Speed-Account: {connected_account_id}`, but has NOT yet confirmed
 * whether that identifier is the `ca_` relationship id or the `acct_`
 * connected-account id. Both are already retained
 * (merchant_lightning_profiles.speed_connected_account_relationship_id /
 * .speed_account_id), but this resolver deliberately does NOT read either of
 * them - guessing which one Speed expects for this specific header would be
 * exactly the kind of provider-contract invention this module exists to
 * prevent.
 *
 * Instead this resolver requires two independent, deliberate confirmations
 * before it will ever return a value:
 *   1. merchant_lightning_profiles.speed_header_account_id is set - a
 *      dedicated field populated only once Speed's contract is confirmed
 *      (administratively, or by a future backfill), never auto-derived.
 *   2. SPEED_HEADER_ACCOUNT_ID_PREFIX is configured (e.g. "ca_" or "acct_",
 *      set once Speed confirms the format) AND the stored value matches it.
 *
 * Until both are true, this throws SpeedHeaderAccountIdUnresolvedError.
 * Callers (the Instant Send adapter) MUST treat that as fail-closed - never
 * fall back to an unverified identifier.
 */

export type SpeedHeaderAccountIdUnresolvedReason =
  | "missing"
  | "prefix_not_configured"
  | "prefix_mismatch"

export class SpeedHeaderAccountIdUnresolvedError extends Error {
  readonly reason: SpeedHeaderAccountIdUnresolvedReason
  readonly merchantId: string

  constructor(reason: SpeedHeaderAccountIdUnresolvedReason, merchantId: string) {
    super(`Speed X-Speed-Account header identifier is unresolved for merchant (reason: ${reason}).`)
    this.name = "SpeedHeaderAccountIdUnresolvedError"
    this.reason = reason
    this.merchantId = merchantId
  }
}

export function getConfiguredSpeedHeaderAccountIdPrefix(): string | null {
  const prefix = String(process.env.SPEED_HEADER_ACCOUNT_ID_PREFIX || "").trim()
  return prefix || null
}

export type SpeedHeaderAccountIdSource = {
  merchant_id: string
  speed_header_account_id: string | null | undefined
}

/**
 * Resolves the exact value to send as the X-Speed-Account header, or throws
 * SpeedHeaderAccountIdUnresolvedError. Never returns an empty string, never
 * guesses between ca_/acct_, never falls back to a different stored field.
 */
export function resolveSpeedHeaderAccountId(profile: SpeedHeaderAccountIdSource): string {
  const stored = String(profile.speed_header_account_id || "").trim()
  if (!stored) {
    throw new SpeedHeaderAccountIdUnresolvedError("missing", profile.merchant_id)
  }

  const prefix = getConfiguredSpeedHeaderAccountIdPrefix()
  if (!prefix) {
    throw new SpeedHeaderAccountIdUnresolvedError("prefix_not_configured", profile.merchant_id)
  }

  if (!stored.startsWith(prefix)) {
    throw new SpeedHeaderAccountIdUnresolvedError("prefix_mismatch", profile.merchant_id)
  }

  return stored
}
