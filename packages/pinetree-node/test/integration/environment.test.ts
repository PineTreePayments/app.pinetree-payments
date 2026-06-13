import { describe, expect, it } from "vitest"
import { loadIntegrationEnvironment } from "./helpers"

// Minimal valid local config used across multiple tests.
const LOCAL_BASE = {
  PINETREE_RUN_INTEGRATION: "true",
  PINETREE_INTEGRATION_BASE_URL: "http://localhost:3000",
  PINETREE_INTEGRATION_API_KEY:
    "pt_live_0000000000000000000000000000000000000000000000000000000000000000",
  PINETREE_INTEGRATION_WEBHOOK_SECRET: "whsec_redacted",
}

describe("integration environment safety", () => {
  it("skips when integration execution or required variables are missing", () => {
    expect(loadIntegrationEnvironment({})).toMatchObject({ enabled: false })
    expect(
      loadIntegrationEnvironment({
        PINETREE_RUN_INTEGRATION: "true",
      })
    ).toMatchObject({
      enabled: false,
      reason: expect.stringContaining("PINETREE_INTEGRATION_BASE_URL"),
    })
  })

  it("requires explicit production confirmation", () => {
    expect(() =>
      loadIntegrationEnvironment({
        PINETREE_RUN_INTEGRATION: "true",
        PINETREE_INTEGRATION_BASE_URL: "https://app.pinetree-payments.com",
        PINETREE_INTEGRATION_API_KEY: "pt_live_redacted",
        PINETREE_INTEGRATION_WEBHOOK_SECRET: "whsec_redacted",
      })
    ).toThrow("PINETREE_ALLOW_PRODUCTION_INTEGRATION=true")
  })

  it("allows pt_live_* keys against localhost (local integration keys)", () => {
    // PineTree uses a single pt_live_* key format for all environments.
    // Keys created in a local database have the same format and must be
    // accepted against a local dev server.
    const result = loadIntegrationEnvironment(LOCAL_BASE)
    expect(result).toMatchObject({ enabled: true })
    if (result.enabled) {
      expect(result.config.apiKey).toBe(LOCAL_BASE.PINETREE_INTEGRATION_API_KEY)
      expect(result.config.baseUrl).toBe("http://localhost:3000")
    }
  })

  it("pt_test_* is not a supported API key format — the guard passes it through and the API rejects it", () => {
    // There is no pt_test_* key format. The environment guard does not filter
    // on key prefix; an unrecognised prefix will receive a 401 from the API.
    // This test ensures we do not silently add pt_test_* guard logic here.
    const result = loadIntegrationEnvironment({
      ...LOCAL_BASE,
      PINETREE_INTEGRATION_API_KEY: "pt_test_redacted",
    })
    // The guard enables the run — the API will reject the key at runtime.
    expect(result).toMatchObject({ enabled: true })
  })
})
