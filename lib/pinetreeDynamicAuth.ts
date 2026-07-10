export type PineTreeDynamicAuthMode = "disabled" | "dynamic_email_fallback" | "external_jwt"

export type PineTreeDynamicAuthConfig = {
  mode: PineTreeDynamicAuthMode
  rawMode: string
  rawEmailFallback: string
  nodeEnv: string
  externalJwtConfigured: boolean
  emailFallbackEnabled: boolean
  emailFallbackMisconfigured: boolean
  configValid: boolean
  invalidReason: string | null
}

export type PineTreeDynamicExternalJwtClaimsDiagnostics = {
  issuerMatch: boolean
  audienceMatch: boolean
  subjectPresent: boolean
  environmentIdPresent: boolean
}

export type PineTreeDynamicExternalJwtPayload = {
  externalJwt: string
  externalUserId: string
  expiresAt: string
  // Boolean-only claim diagnostics from the issuing route (never claim values):
  // whether the signed issuer matches the app origin the JWKS is served under,
  // and whether the signed audience matches the Dynamic environment ID.
  claims?: PineTreeDynamicExternalJwtClaimsDiagnostics
  jwtVerification?: {
    jwtSelfVerificationPassed: boolean
    jwtHeaderKidPresent: boolean
    jwtHeaderKidMatchesJwks: boolean
    signingPublicKeyMatchesJwks: boolean
    jwksKidPresent: boolean
    algorithmRs256: boolean
    routeExternalUserIdPresent: boolean
    routeExternalUserIdMatchesSubject: boolean
  }
  diagnostics?: {
    enabled: boolean
    issuerConfigured: boolean
    audienceConfigured: boolean
    kidConfigured: boolean
    signingKeyConfigured: boolean
    jwksDerivedFromSigningKey: boolean
    merchantResolved?: boolean
  }
}

export const pineTreeDynamicEmailFallbackMisconfiguredWarning =
  "Dynamic email fallback is disabled, but PineTree external JWT auth is not configured."

export const pineTreeDynamicExternalJwtRestoreFailedMessage =
  "PineTree Wallet access could not be verified. Please try again."

export const pineTreeDynamicConfigurationErrorMessage =
  "PineTree Wallet verification is not configured correctly. Please contact support."

// Client callers MUST NOT invoke this with no argument. The `= process.env`
// default only resolves correctly in Node (server routes, tests); Next.js/webpack
// inlines NEXT_PUBLIC_* values by statically matching the literal expression
// `process.env.NEXT_PUBLIC_X` wherever it appears in source, not by evaluating
// `process.env` as a whole object. Client call sites must pass an explicit
// object built from literal `process.env.NEXT_PUBLIC_...` reads at the call
// site (see PineTreeDynamicProvider.tsx / wallet-setup/page.tsx), or the vars
// will silently resolve to "missing" in the deployed browser bundle even when
// correctly set in Vercel.
export function getPineTreeDynamicAuthConfig(env: Record<string, string | undefined> = process.env): PineTreeDynamicAuthConfig {
  const rawMode = (env.NEXT_PUBLIC_PINETREE_DYNAMIC_AUTH_MODE || "").trim()
  const rawEmailFallback = (env.NEXT_PUBLIC_PINETREE_DYNAMIC_EMAIL_FALLBACK || "").trim()
  const nodeEnv = (env.NODE_ENV || "").trim() || "unknown"
  const mode: PineTreeDynamicAuthMode =
    rawMode === "external_jwt"
      ? "external_jwt"
      : rawMode === "dynamic_email_fallback"
        ? "dynamic_email_fallback"
        : "disabled"
  const externalJwtConfigured = mode === "external_jwt"
  // Dynamic email fallback is an explicit opt-in only. Missing/invalid public
  // auth env must fail closed so production can never silently open Dynamic's
  // generic login/signup sheet.
  const emailFallbackEnabled = mode === "dynamic_email_fallback" && rawEmailFallback === "true"
  const invalidReason =
    !rawMode
      ? "missing_auth_mode"
      : mode === "disabled"
        ? "invalid_auth_mode"
        : mode === "dynamic_email_fallback" && rawEmailFallback !== "true"
          ? "email_fallback_not_explicitly_enabled"
          : null

  return {
    mode,
    rawMode,
    rawEmailFallback,
    nodeEnv,
    externalJwtConfigured,
    emailFallbackEnabled,
    emailFallbackMisconfigured: !externalJwtConfigured && !emailFallbackEnabled,
    configValid: invalidReason === null,
    invalidReason,
  }
}

export function shouldOpenDynamicEmailFallbackAuth(config: PineTreeDynamicAuthConfig) {
  return config.configValid && config.mode === "dynamic_email_fallback" && config.emailFallbackEnabled
}

export function assertCanOpenDynamicEmailFallbackAuth(config: PineTreeDynamicAuthConfig) {
  if (!shouldOpenDynamicEmailFallbackAuth(config)) {
    throw Object.assign(new Error("dynamic_email_fallback_blocked"), { code: "dynamic_email_fallback_blocked" })
  }
}

export const pineTreeDynamicCanonicalIssuer = "https://app.pinetree-payments.com"

export type PineTreeDynamicExternalJwtContractAnalysis = {
  headerKid: string | null
  algorithm: string | null
  issuerMatch: boolean
  audienceMatch: boolean
  environmentIdPresent: boolean
  subjectPresent: boolean
  emailClaimIncluded: boolean
  externalUserIdPresent: boolean
  externalUserIdMatchesSubject: boolean
}

function decodeJwtSegment(segment: string): Record<string, unknown> | null {
  try {
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4)
    const binary = atob(padded)
    const json = decodeURIComponent(
      Array.from(binary, (char) => "%" + char.charCodeAt(0).toString(16).padStart(2, "0")).join("")
    )
    const parsed = JSON.parse(json) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * TEMPORARY contract diagnostic for a PineTree-issued external JWT. Decodes the
 * token locally (client-side) and reduces it to safe comparison booleans plus
 * the public header kid/alg - never the token itself, claim values, or emails.
 *
 * - issuerMatch: iss === https://app.pinetree-payments.com (the value
 *   configured in Dynamic's dashboard).
 * - audienceMatch: aud === the Dynamic environment ID this client bundle was
 *   built with - the exact claim Dynamic rejects with "Audience (aud) does not
 *   match" when wrong. Comparing against the CLIENT-inlined environment ID also
 *   catches a server/client env split, which a server-only check cannot see.
 */
export function analyzePineTreeDynamicExternalJwtContract(
  externalJwt: string,
  env: { NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID?: string },
  externalUserId?: string | null
): PineTreeDynamicExternalJwtContractAnalysis {
  const environmentId = (env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID || "").trim()
  const routeExternalUserId = String(externalUserId || "")
  const segments = String(externalJwt || "").split(".")
  const header = segments.length === 3 ? decodeJwtSegment(segments[0]) : null
  const payload = segments.length === 3 ? decodeJwtSegment(segments[1]) : null

  const aud = payload?.aud
  const audienceMatch = Boolean(
    environmentId &&
      (aud === environmentId || (Array.isArray(aud) && aud.includes(environmentId)))
  )

  return {
    headerKid: typeof header?.kid === "string" ? header.kid : null,
    algorithm: typeof header?.alg === "string" ? header.alg : null,
    issuerMatch: payload?.iss === pineTreeDynamicCanonicalIssuer,
    audienceMatch,
    environmentIdPresent: Boolean(environmentId),
    subjectPresent: typeof payload?.sub === "string" && payload.sub.length > 0,
    emailClaimIncluded: Boolean(
      payload && ("email" in payload || "emailVerified" in payload || "email_verified" in payload)
    ),
    externalUserIdPresent: Boolean(routeExternalUserId),
    externalUserIdMatchesSubject: Boolean(routeExternalUserId && payload?.sub === routeExternalUserId),
  }
}

export async function requestPineTreeDynamicExternalJwtAuth(
  accessToken: string,
  options?: { walletDebug?: boolean }
): Promise<PineTreeDynamicExternalJwtPayload> {
  // PineTree Supabase user/session
  // -> PineTree backend issues/verifies JWT for Dynamic
  // -> Dynamic session initializes for the same PineTree externalUser subject
  // -> embedded wallet signer restores without merchant typing a second email.
  const res = await fetch("/api/wallets/dynamic/external-jwt", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ walletDebug: Boolean(options?.walletDebug) }),
    credentials: "include",
    cache: "no-store",
  })
  const json = (await res.json().catch(() => null)) as
    | (PineTreeDynamicExternalJwtPayload & { error?: string })
    | { error?: string }
    | null

  if (!res.ok || !json || !("externalJwt" in json) || !("externalUserId" in json)) {
    const error = new Error(json?.error || "dynamic_external_jwt_failed")
    ;(error as Error & { status?: number; code?: string }).status = res.status
    ;(error as Error & { status?: number; code?: string }).code = json?.error || "dynamic_external_jwt_failed"
    throw error
  }

  return {
    externalJwt: json.externalJwt,
    externalUserId: json.externalUserId,
    expiresAt: json.expiresAt,
    claims: json.claims,
    jwtVerification: json.jwtVerification,
    diagnostics: json.diagnostics,
  }
}
