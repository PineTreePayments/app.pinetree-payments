import { describe, expect, it } from "vitest"
import {
  assertCanOpenDynamicEmailFallbackAuth,
  getPineTreeDynamicAuthConfig,
  pineTreeDynamicEmailFallbackMisconfiguredWarning,
  shouldOpenDynamicEmailFallbackAuth,
} from "@/lib/pinetreeDynamicAuth"

describe("PineTree Dynamic auth config", () => {
  it("fails closed when auth mode is missing", () => {
    const config = getPineTreeDynamicAuthConfig({})

    expect(config.mode).toBe("disabled")
    expect(config.rawMode).toBe("")
    expect(config.configValid).toBe(false)
    expect(config.invalidReason).toBe("missing_auth_mode")
    expect(config.emailFallbackEnabled).toBe(false)
    expect(shouldOpenDynamicEmailFallbackAuth(config)).toBe(false)
    expect(() => assertCanOpenDynamicEmailFallbackAuth(config)).toThrow("dynamic_email_fallback_blocked")
  })

  it("allows Dynamic email fallback only when explicitly configured", () => {
    const config = getPineTreeDynamicAuthConfig({
      NEXT_PUBLIC_PINETREE_DYNAMIC_AUTH_MODE: "dynamic_email_fallback",
      NEXT_PUBLIC_PINETREE_DYNAMIC_EMAIL_FALLBACK: "true",
    })

    expect(config.mode).toBe("dynamic_email_fallback")
    expect(config.configValid).toBe(true)
    expect(config.emailFallbackEnabled).toBe(true)
    expect(shouldOpenDynamicEmailFallbackAuth(config)).toBe(true)
    expect(() => assertCanOpenDynamicEmailFallbackAuth(config)).not.toThrow()
  })

  it("warns when email fallback is disabled without PineTree external JWT auth", () => {
    const config = getPineTreeDynamicAuthConfig({
      NEXT_PUBLIC_PINETREE_DYNAMIC_AUTH_MODE: "dynamic_email_fallback",
      NEXT_PUBLIC_PINETREE_DYNAMIC_EMAIL_FALLBACK: "false",
    })

    expect(config.externalJwtConfigured).toBe(false)
    expect(config.emailFallbackEnabled).toBe(false)
    expect(config.emailFallbackMisconfigured).toBe(true)
    expect(config.configValid).toBe(false)
    expect(config.invalidReason).toBe("email_fallback_not_explicitly_enabled")
    expect(shouldOpenDynamicEmailFallbackAuth(config)).toBe(false)
    expect(pineTreeDynamicEmailFallbackMisconfiguredWarning).toBe(
      "Dynamic email fallback is disabled, but PineTree external JWT auth is not configured."
    )
  })

  it("external_jwt mode disables Dynamic email fallback auth helper", () => {
    const config = getPineTreeDynamicAuthConfig({
      NEXT_PUBLIC_PINETREE_DYNAMIC_AUTH_MODE: "external_jwt",
      NEXT_PUBLIC_PINETREE_DYNAMIC_EMAIL_FALLBACK: "false",
    })

    expect(config.mode).toBe("external_jwt")
    expect(config.externalJwtConfigured).toBe(true)
    expect(config.emailFallbackEnabled).toBe(false)
    expect(config.emailFallbackMisconfigured).toBe(false)
    expect(config.configValid).toBe(true)
    expect(shouldOpenDynamicEmailFallbackAuth(config)).toBe(false)
    expect(() => assertCanOpenDynamicEmailFallbackAuth(config)).toThrow("dynamic_email_fallback_blocked")
  })
})
