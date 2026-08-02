import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { getShift4I4GoBrowserConfig } from "@/providers/shift4/i4go/config"
import { assertOpaqueI4GoToken, assertTrustedI4GoOrigin } from "@/providers/shift4/i4go/validation"
import { Shift4CommerceEngineSimulator } from "@/providers/shift4/commerce-engine/simulator"
import { executeShift4RetailInteraction } from "@/engine/shift4/retail"
import { logShift4Event, safeShift4LogFields } from "@/engine/shift4/observability"
import { DisabledShift4EncryptedTokenVault } from "@/engine/shift4/cardOnFileVault"

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

describe("Shift4 i4Go, retail, and certification safety", () => {
  it("returns blocked config rather than guessing i4Go values", () => {
    const config = getShift4I4GoBrowserConfig({})
    expect(config.configured).toBe(false)
    expect(config.scriptUrl).toBeNull()
    expect(config.reason).toContain("Official i4Go")
  })

  it("accepts only HTTPS config and exact callback origin", () => {
    const config = getShift4I4GoBrowserConfig({ SHIFT4_I4GO_SCRIPT_URL: "https://example.test/i4go.js", SHIFT4_I4GO_IFRAME_ORIGIN: "https://pay.example.test/frame", SHIFT4_I4GO_APPLICATION_ID: "app-test" })
    expect(config.configured).toBe(true)
    expect(() => assertTrustedI4GoOrigin("https://evil.test", config.iframeOrigin)).toThrow("Untrusted")
    expect(() => assertOpaqueI4GoToken("4111111111111111")).toThrow("Raw card")
    expect(assertOpaqueI4GoToken("opaque_test_token_123")).toBe("opaque_test_token_123")
  })

  it("simulates deterministic retail approval and timeout evidence", async () => {
    const request = { operation: "authorization" as const, invoice: "INV-1", amountMinor: 11145, currency: "USD" as const, terminalId: "terminal-1" }
    const approved = await executeShift4RetailInteraction({ client: new Shift4CommerceEngineSimulator("approve"), request, timeoutMs: 100 })
    expect(approved.state).toBe("approved")
    expect(approved.result.approvedAmountMinor).toBe(11145)
    const timeout = await executeShift4RetailInteraction({ client: new Shift4CommerceEngineSimulator("timeout"), request, timeoutMs: 100 })
    expect(timeout.state).toBe("unresolved")
    expect(timeout.result.lookupRequired).toBe(true)
  })

  it("redacts by allowlist and never logs credential-like values", () => {
    expect(safeShift4LogFields({ paymentId: "p1", accessToken: "secret", manualAuthorizationCode: "123456", payload: { card: "x" } })).toEqual({ paymentId: "p1" })
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)
    logShift4Event("info", "attempt", { paymentId: "p1", cardToken: "must-not-log" })
    expect(JSON.stringify(info.mock.calls)).not.toContain("must-not-log")
    info.mockRestore()
  })

  it("keeps the future card-on-file vault disabled", () => {
    const vault = new DisabledShift4EncryptedTokenVault()
    expect(() => vault.loadEncryptedProviderToken()).toThrow("not implemented or certified")
  })

  it("contains all normalized workbook cases and a multiply gated live runner", () => {
    const manifest = source("scripts/shift4-certification/manifest.mjs")
    expect((manifest.match(/c\("ecommerce"/g) || []).length).toBe(23)
    expect((manifest.match(/c\("retail"/g) || []).length).toBe(26)
    expect(manifest).toContain("B2020945C7257E34306BF44EB316083B11F8FCFDB2DF671972866FB00F7D82B1")
    expect(manifest).toContain("0205015935BEFEEA46F5E980EFCEB1417455B85DAF02F51FE4B16AAC20D447E2")
    const runner = source("scripts/shift4-certification/run.mjs")
    expect(runner).toContain("--confirm-test-environment")
    expect(runner).toContain("providerRequestsSent: 0")
    expect(runner).toContain("Live certification remains blocked")
  })
})
