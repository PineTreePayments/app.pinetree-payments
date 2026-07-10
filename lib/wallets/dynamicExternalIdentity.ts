/**
 * Identity mapping for Dynamic external-JWT (BYOA) sessions.
 *
 * When PineTree signs a merchant into Dynamic with an external JWT, Dynamic
 * attaches a verified credential of format "externalUser" whose public
 * identifier equals the JWT `sub` - the stable PineTree merchant_id (verified
 * against Dynamic's externalAuth/signin response 2026-07-10). That credential,
 * not a typed email, is the canonical proof that a Dynamic session belongs to a
 * PineTree merchant: emails on the Dynamic side can be missing, differently
 * cased, or manually entered, but the externalUser binding can only come from a
 * PineTree-signed JWT.
 */

type DynamicVerifiedCredentialLike = {
  format?: string
  publicIdentifier?: string
  public_identifier?: string
}

type DynamicUserLike = {
  verifiedCredentials?: DynamicVerifiedCredentialLike[] | null
}

/** The PineTree merchant_id this Dynamic session was externally signed in as, if any. */
export function getDynamicExternalUserId(user: unknown): string | null {
  const credentials = (user as DynamicUserLike | null | undefined)?.verifiedCredentials
  if (!Array.isArray(credentials)) return null
  for (const credential of credentials) {
    if (!credential || typeof credential !== "object") continue
    if (String(credential.format || "") !== "externalUser") continue
    const identifier = credential.publicIdentifier ?? credential.public_identifier
    if (typeof identifier === "string" && identifier.trim()) return identifier.trim()
  }
  return null
}

/**
 * True when the Dynamic session carries an externalUser credential issued for
 * this exact PineTree merchant. Sessions matched this way must never be failed
 * by email-comparison identity gates.
 */
export function dynamicSessionBoundToMerchant(user: unknown, merchantId: string | null | undefined): boolean {
  if (!merchantId) return false
  const externalUserId = getDynamicExternalUserId(user)
  return Boolean(externalUserId && externalUserId === merchantId)
}
