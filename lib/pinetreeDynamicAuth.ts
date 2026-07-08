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

export type PineTreeDynamicExternalJwtPayload = {
  externalJwt: string
  externalUserId: string
  expiresAt: string
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

export async function requestPineTreeDynamicExternalJwtAuth(
  accessToken: string,
  options?: { walletDebug?: boolean }
): Promise<PineTreeDynamicExternalJwtPayload> {
  // PineTree Supabase user/session
  // -> PineTree backend issues/verifies JWT for Dynamic
  // -> Dynamic session initializes for same PineTree user/email
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
    diagnostics: json.diagnostics,
  }
}
