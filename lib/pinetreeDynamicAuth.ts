export type PineTreeDynamicAuthMode = "dynamic_email_fallback" | "external_jwt"

export type PineTreeDynamicAuthConfig = {
  mode: PineTreeDynamicAuthMode
  externalJwtConfigured: boolean
  emailFallbackEnabled: boolean
  emailFallbackMisconfigured: boolean
}

export const pineTreeDynamicEmailFallbackMisconfiguredWarning =
  "Dynamic email fallback is disabled, but PineTree external JWT auth is not configured."

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

export async function requestPineTreeDynamicExternalJwtAuth(): Promise<never> {
  // TODO(PineTree external JWT auth):
  // PineTree Supabase user/session
  // -> PineTree backend issues/verifies JWT for Dynamic
  // -> Dynamic session initializes for same PineTree user/email
  // -> embedded wallet signer restores without merchant typing a second email.
  throw new Error("PineTree external JWT Dynamic auth is not implemented yet")
}
