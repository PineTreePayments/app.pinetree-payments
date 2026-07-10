import { createPrivateKey, createPublicKey, randomUUID } from "node:crypto"
import { SignJWT, exportJWK, importPKCS8 } from "jose"

/**
 * Server-side PineTree -> Dynamic external JWT signing.
 *
 * VERIFIED CONTRACT (2026-07-10, probed directly against Dynamic's
 * `POST /api/v0/sdk/{environmentId}/externalAuth/signin`):
 * - Dynamic validates `aud` against the dashboard-configured audience, which is
 *   the Dynamic environment ID. A JWT signed without that audience is rejected
 *   422 `invalid_external_auth` with "Audience (aud) does not match" - surfaced
 *   in the SDK as InvalidExternalAuthError, the exact failure production saw.
 * - With `aud` = environment ID (and the existing issuer/JWKS/kid), sign-in
 *   succeeds and returns a Dynamic user carrying an `externalUser` verified
 *   credential whose public identifier equals the JWT `sub` (PineTree
 *   merchant_id).
 *
 * The environment ID is therefore the canonical audience. A custom audience can
 * only be forced via DYNAMIC_EXTERNAL_JWT_AUDIENCE_OVERRIDE (for a future
 * support-mandated value); the legacy DYNAMIC_EXTERNAL_JWT_AUDIENCE var is
 * consulted only when no environment ID is configured, and its historical
 * "dynamic" placeholder is never signed.
 */

export type DynamicJwtClaimsDiagnostics = {
  issuerMatch: boolean
  audienceMatch: boolean
  subjectPresent: boolean
  environmentIdPresent: boolean
}

export const pineTreeDynamicCanonicalIssuer = "https://app.pinetree-payments.com"

export function getDynamicExternalJwtIssuer() {
  return process.env.DYNAMIC_EXTERNAL_JWT_ISSUER || "https://app.pinetree-payments.com"
}

export function resolveDynamicJwtAudience() {
  const override = process.env.DYNAMIC_EXTERNAL_JWT_AUDIENCE_OVERRIDE?.trim()
  if (override) return override
  const environmentId = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID?.trim()
  if (environmentId) return environmentId
  const legacy = process.env.DYNAMIC_EXTERNAL_JWT_AUDIENCE?.trim()
  if (legacy && legacy !== "dynamic") return legacy
  return undefined
}

function normalizeOrigin(value: string | undefined) {
  return (value || "").trim().replace(/\/+$/, "")
}

/**
 * Boolean-only claim diagnostics, safe to log and to return to the client.
 * - issuerMatch: the signed issuer exactly equals the value configured in the
 *   Dynamic dashboard: https://app.pinetree-payments.com.
 * - audienceMatch: the signed audience equals the Dynamic environment ID (the
 *   dashboard-configured audience, per the verified contract above).
 */
export function getDynamicJwtClaimsDiagnostics(input: {
  issuer: string
  audience: string | undefined
  subject: string | null | undefined
}): DynamicJwtClaimsDiagnostics {
  const environmentId = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID?.trim()
  return {
    issuerMatch: input.issuer === pineTreeDynamicCanonicalIssuer,
    audienceMatch: Boolean(input.audience && environmentId && input.audience === environmentId),
    subjectPresent: Boolean(input.subject),
    environmentIdPresent: Boolean(environmentId),
  }
}

export function getDynamicExternalJwtSigningKeyPem() {
  const encodedSigningKey = process.env.DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64?.trim()
  if (encodedSigningKey) {
    try {
      const decoded = Buffer.from(encodedSigningKey, "base64").toString("utf8")
      if (!decoded.includes("-----BEGIN PRIVATE KEY-----") || !decoded.includes("-----END PRIVATE KEY-----")) {
        throw new Error("invalid_pem")
      }
      return decoded
    } catch {
      throw Object.assign(new Error("dynamic_external_jwt_signing_key_invalid"), { status: 503 })
    }
  }

  // TODO: Remove this raw PEM fallback after all environments use
  // DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64.
  const legacyPrivateKey = process.env.DYNAMIC_EXTERNAL_JWT_PRIVATE_KEY?.replace(/\\n/g, "\n")
  if (legacyPrivateKey) return legacyPrivateKey

  throw Object.assign(new Error("dynamic_external_jwt_signing_key_missing"), { status: 503 })
}

export function getDynamicExternalJwtKid() {
  return process.env.DYNAMIC_EXTERNAL_JWT_KID || process.env.DYNAMIC_EXTERNAL_JWT_KEY_ID || undefined
}

export type SignedDynamicExternalJwt = {
  externalJwt: string
  expiresAt: Date
  issuer: string
  audience: string | undefined
  keyId: string
  claims: DynamicJwtClaimsDiagnostics
}

export async function signDynamicExternalJwt(input: {
  merchantId: string
  email: string
}): Promise<SignedDynamicExternalJwt> {
  const issuer = getDynamicExternalJwtIssuer()
  const audience = resolveDynamicJwtAudience()
  const keyId = getDynamicExternalJwtKid()
  const ttlSeconds = 5 * 60
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)

  if (!keyId) {
    throw Object.assign(new Error("dynamic_external_jwt_kid_missing"), { status: 503 })
  }
  const privateKey = getDynamicExternalJwtSigningKeyPem()

  const environmentId = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID?.trim()
  console.info("[pinetree-wallets] dynamic_jwt_claims_config_check", {
    issuerPresent: Boolean(issuer),
    audiencePresent: Boolean(audience),
    audienceMatchesDynamicEnv: Boolean(audience && environmentId && audience === environmentId),
    kidPresent: Boolean(keyId),
    algRs256: true,
    subjectPresent: Boolean(input.merchantId),
    emailPresent: Boolean(input.email),
  })

  let jwt = new SignJWT({
    email: input.email,
    emailVerified: true,
    // Dynamic's BYOA docs use camelCase emailVerified, but the standard OIDC claim
    // name is snake_case - send both so a stricter validator on Dynamic's side that
    // looks for the standard name still finds it, without removing the one Dynamic's
    // own docs document.
    email_verified: true,
    merchant_id: input.merchantId,
  })
    .setProtectedHeader({
      alg: "RS256",
      kid: keyId,
    })
    .setIssuer(issuer)
    .setSubject(input.merchantId)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(expiresAt)

  if (audience) jwt = jwt.setAudience(audience)

  let signingKey: Awaited<ReturnType<typeof importPKCS8>>
  try {
    signingKey = await importPKCS8(privateKey, "RS256")
  } catch {
    throw Object.assign(new Error("dynamic_external_jwt_signing_key_invalid"), { status: 503 })
  }
  return {
    externalJwt: await jwt.sign(signingKey),
    expiresAt,
    issuer,
    audience,
    keyId,
    claims: getDynamicJwtClaimsDiagnostics({ issuer, audience, subject: input.merchantId }),
  }
}

/**
 * TEMPORARY external-JWT contract diagnostic (safe fields only). Compares what
 * this deployment SIGNS against what the canonical JWKS URL (the one configured
 * in Dynamic's dashboard) actually SERVES:
 * - headerKid: the kid this deployment puts in the JWT header.
 * - jwksKid: the kid served by the issuer-origin JWKS.
 * - kidMatch: exact equality of the two.
 * - signingKeyMatchesJwks: the public key derived from this deployment's
 *   signing key has the same RSA modulus/exponent as the JWKS entry - i.e. the
 *   JWT signature will verify against the key Dynamic fetches.
 * - issuerMatch: signed issuer === https://app.pinetree-payments.com (the
 *   dashboard-configured value).
 * - audienceMatch: signed audience === NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID.
 *
 * kids are public JWKS values; nothing here includes the JWT, private key
 * material, or emails.
 */
export type DynamicExternalJwtContractCheck = {
  headerKid: string | null
  jwksKid: string | null
  kidMatch: boolean
  signingKeyMatchesJwks: boolean
  issuerMatch: boolean
  audienceMatch: boolean
  environmentIdPresent: boolean
  algorithm: "RS256"
  jwksLoaded: boolean
}

export async function runDynamicExternalJwtContractCheck(): Promise<DynamicExternalJwtContractCheck> {
  const issuer = getDynamicExternalJwtIssuer()
  const audience = resolveDynamicJwtAudience()
  const environmentId = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID?.trim()
  const headerKid = getDynamicExternalJwtKid() ?? null

  const check: DynamicExternalJwtContractCheck = {
    headerKid,
    jwksKid: null,
    kidMatch: false,
    signingKeyMatchesJwks: false,
    issuerMatch: issuer === pineTreeDynamicCanonicalIssuer,
    audienceMatch: Boolean(audience && environmentId && audience === environmentId),
    environmentIdPresent: Boolean(environmentId),
    algorithm: "RS256",
    jwksLoaded: false,
  }

  let localPublicJwk: { n?: string; e?: string } | null = null
  try {
    const signingKeyPem = getDynamicExternalJwtSigningKeyPem()
    localPublicJwk = await exportJWK(createPublicKey(createPrivateKey(signingKeyPem)))
  } catch {
    localPublicJwk = null
  }

  try {
    const res = await fetch(`${normalizeOrigin(issuer)}/.well-known/dynamic-jwks.json`, { cache: "no-store" })
    if (res.ok) {
      const json = (await res.json()) as { keys?: Array<{ kid?: string; n?: string; e?: string }> }
      const keys = Array.isArray(json?.keys) ? json.keys : []
      check.jwksLoaded = keys.length > 0
      const matching = keys.find((key) => key?.kid === headerKid) ?? keys[0] ?? null
      check.jwksKid = matching?.kid ?? null
      check.kidMatch = Boolean(headerKid && matching?.kid === headerKid)
      check.signingKeyMatchesJwks = Boolean(
        localPublicJwk?.n && matching?.n === localPublicJwk.n && matching?.e === localPublicJwk.e
      )
    }
  } catch {
    // Unreachable JWKS is itself the diagnostic result - report booleans as-is.
  }

  return check
}

/**
 * Fetches the public JWKS from the issuer origin (the URL configured in
 * Dynamic's dashboard) and reports whether it loads and carries the active kid.
 * Boolean-only; never returns key material.
 */
export async function checkDynamicExternalJwks(): Promise<{ jwksLoaded: boolean; kidFound: boolean }> {
  const issuer = normalizeOrigin(getDynamicExternalJwtIssuer())
  const kid = getDynamicExternalJwtKid()
  try {
    const res = await fetch(`${issuer}/.well-known/dynamic-jwks.json`, { cache: "no-store" })
    if (!res.ok) return { jwksLoaded: false, kidFound: false }
    const json = (await res.json()) as { keys?: Array<{ kid?: string }> }
    const keys = Array.isArray(json?.keys) ? json.keys : []
    return {
      jwksLoaded: keys.length > 0,
      kidFound: Boolean(kid && keys.some((key) => key?.kid === kid)),
    }
  } catch {
    return { jwksLoaded: false, kidFound: false }
  }
}
