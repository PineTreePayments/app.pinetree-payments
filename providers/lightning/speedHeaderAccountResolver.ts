/**
 * Resolves the provider-confirmed `speed-account` header value.
 *
 * `merchant_lightning_profiles.speed_account_id` is the canonical `acct_…`
 * connected-account identifier returned by Speed account provisioning. The
 * resolver never accepts browser input and never falls back to PineTree's
 * root/platform account. The legacy dedicated header field is accepted only
 * when it exactly matches the canonical account, which keeps older rows safe
 * during normalization without creating a second identity source.
 */

export type SpeedHeaderAccountIdUnresolvedReason = "missing" | "mismatch" | "invalid_format"

export class SpeedHeaderAccountIdUnresolvedError extends Error {
  readonly reason: SpeedHeaderAccountIdUnresolvedReason
  readonly merchantId: string

  constructor(reason: SpeedHeaderAccountIdUnresolvedReason, merchantId: string) {
    super(`Speed connected-account identifier is unresolved for merchant (reason: ${reason}).`)
    this.name = "SpeedHeaderAccountIdUnresolvedError"
    this.reason = reason
    this.merchantId = merchantId
  }
}

export function getConfiguredSpeedHeaderAccountIdPrefix(): "acct_" {
  return "acct_"
}

export type SpeedHeaderAccountIdSource = {
  merchant_id: string
  speed_account_id?: string | null
  speed_header_account_id?: string | null
}

export function resolveSpeedHeaderAccountId(profile: SpeedHeaderAccountIdSource): string {
  const canonical = String(profile.speed_account_id || "").trim()
  if (!canonical) throw new SpeedHeaderAccountIdUnresolvedError("missing", profile.merchant_id)
  if (!canonical.startsWith("acct_")) {
    throw new SpeedHeaderAccountIdUnresolvedError("invalid_format", profile.merchant_id)
  }

  const legacy = String(profile.speed_header_account_id || "").trim()
  if (legacy && legacy !== canonical) {
    throw new SpeedHeaderAccountIdUnresolvedError("mismatch", profile.merchant_id)
  }
  return canonical
}
