import { describe, expect, it } from "vitest"
import {
  getPineTreeDynamicAuthConfig,
  pineTreeDynamicEmailFallbackMisconfiguredWarning,
  shouldOpenDynamicEmailFallbackAuth,
} from "@/lib/pinetreeDynamicAuth"

describe("PineTree Dynamic auth config", () => {
  it("keeps Dynamic email fallback enabled for sandbox unless external JWT is configured", () => {
    const config = getPineTreeDynamicAuthConfig({})

    expect(config.mode).toBe("dynamic_email_fallback")
    expect(config.emailFallbackEnabled).toBe(true)
    expect(config.emailFallbackMisconfigured).toBe(false)
    expect(shouldOpenDynamicEmailFallbackAuth(config)).toBe(true)
  })

  it("warns when email fallback is disabled without PineTree external JWT auth", () => {
    const config = getPineTreeDynamicAuthConfig({
      NEXT_PUBLIC_PINETREE_DYNAMIC_EMAIL_FALLBACK: "false",
    })

    expect(config.externalJwtConfigured).toBe(false)
    expect(config.emailFallbackEnabled).toBe(false)
    expect(config.emailFallbackMisconfigured).toBe(true)
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
    expect(shouldOpenDynamicEmailFallbackAuth(config)).toBe(false)
  })
})
