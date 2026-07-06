export type PineTreeDynamicAuthMode = "dynamic_email_fallback" | "external_jwt"

export type PineTreeDynamicAuthConfig = {
  mode: PineTreeDynamicAuthMode
  externalJwtConfigured: boolean
  emailFallbackEnabled: boolean
  emailFallbackMisconfigured: boolean
}

export type PineTreeDynamicExternalJwtPayload = {
  externalJwt: string
  externalUserId: string
  expiresAt: string
  diagnostics?: {
    enabled: boolean
    issuer: string
    audienceConfigured: boolean
    jwksUrl: string
    kidConfigured: boolean
    signingKeyConfigured: boolean
  }
}

export const pineTreeDynamicEmailFallbackMisconfiguredWarning =
  "Dynamic email fallback is disabled, but PineTree external JWT auth is not configured."

export const pineTreeDynamicExternalJwtRestoreFailedMessage =
  "PineTree Wallet sign-in could not be restored. Please try again."

export function getPineTreeDynamicAuthConfig(env: Record<string, string | undefined> = process.env): PineTreeDynamicAuthConfig {
  const externalJwtConfigured = env.NEXT_PUBLIC_PINETREE_DYNAMIC_AUTH_MODE === "external_jwt"
  // Sandbox/dev should keep Dynamic Email login enabled until PineTree external
  // JWT/BYOA auth is fully configured in both PineTree and the Dynamic dashboard.
  const emailFallbackEnabled = !externalJwtConfigured && env.NEXT_PUBLIC_PINETREE_DYNAMIC_EMAIL_FALLBACK !== "false"

  return {
    mode: externalJwtConfigured ? "external_jwt" : "dynamic_email_fallback",
    externalJwtConfigured,
    emailFallbackEnabled,
    emailFallbackMisconfigured: !externalJwtConfigured && !emailFallbackEnabled,
  }
}

export function shouldOpenDynamicEmailFallbackAuth(config: PineTreeDynamicAuthConfig) {
  return config.mode !== "external_jwt" && config.emailFallbackEnabled
}

export async function requestPineTreeDynamicExternalJwtAuth(accessToken: string): Promise<PineTreeDynamicExternalJwtPayload> {
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
    body: JSON.stringify({}),
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
