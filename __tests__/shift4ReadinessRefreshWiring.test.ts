/**
 * Shift4 readiness refresh after a successful Retail credential exchange.
 *
 * Root cause this covers: the readiness card fetched once on mount and had no
 * dependency that changed when a sibling card performed an exchange, so it kept
 * rendering its pre-exchange snapshot. The fix is an explicit one-shot refresh
 * signal, not polling and not a retry.
 *
 * NO SHIFT4 REQUEST IS MADE: every fetch is a local mock and a guard asserts no
 * Shift4 host is ever contacted.
 */

import { readFileSync } from "node:fs"

import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  fetchShift4Readiness,
  SHIFT4_READINESS_PATH,
} from "@/lib/shift4/readinessClient"
import {
  SHIFT4_CONNECT_PATH,
  shouldRefreshAfterOutcome,
  submitRetailConnection,
} from "@/lib/shift4/retailConnect"

const BEARER = "pinetree-session-jwt"
const REFRESHED_BEARER = "pinetree-session-jwt-refreshed"
const FAKE_AUTH_TOKEN = "11111111-2222-3333-4444444444444444"
const TIME_ZONE = "America/Chicago"

const cardSource = readFileSync("components/dashboard/Shift4RetailConnectCard.tsx", "utf8")
const readinessCardSource = readFileSync(
  "components/dashboard/Shift4RestReadinessCard.tsx",
  "utf8"
)
// The cards live in the operator-gated admin section, not on the merchant
// Providers page.
const pageSource = readFileSync(
  "components/admin/Shift4SandboxOperationsSection.tsx",
  "utf8"
)
const providersPageSource = readFileSync("app/dashboard/providers/page.tsx", "utf8")
const readinessClientSource = readFileSync("lib/shift4/readinessClient.ts", "utf8")

const SAFE_EXCHANGE_RESULT = {
  connectionId: "connection-1",
  environment: "test",
  channel: "retail",
  accessTokenFingerprint: "abcdef123456",
  connectedAt: "2026-08-02T00:00:01.000Z",
  correlationId: "correlation-1",
}

const READINESS_SNAPSHOT = {
  authenticated: true,
  credentialPresent: true,
  authenticatedChannels: { retail: true, ecommerce: false },
  processingEnabled: false,
  flags: { restApi: true },
  capabilities: {
    merchant_authentication: {
      state: "authenticated",
      ready: true,
      reason: "Encrypted merchant credential is present",
    },
    retail: { state: "disabled", ready: false, reason: "Retail feature gate is off" },
    ecommerce: {
      state: "configured",
      ready: false,
      reason: "No E-commerce credential is connected for this merchant",
    },
    production_processing: { state: "blocked", ready: false, reason: "gates must all pass" },
  },
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
}

const cardCode = stripComments(cardSource)
const readinessCardCode = stripComments(readinessCardSource)
const pageCode = stripComments(pageSource)

describe("Shift4 readiness refresh wiring", () => {
  /* ── The refresh decision ─────────────────────────────────────────────── */

  describe("refresh decision", () => {
    let fetchMock: ReturnType<typeof vi.fn>

    beforeEach(() => {
      fetchMock = vi.fn(async () => jsonResponse(200, { ok: true, data: SAFE_EXCHANGE_RESULT }))
    })

    const exchange = (overrides: Record<string, unknown> = {}) =>
      submitRetailConnection({
        authToken: FAKE_AUTH_TOKEN,
        merchantTimeZone: TIME_ZONE,
        getBearerToken: async () => BEARER,
        onTokenConsumed: () => {},
        fetchImpl: fetchMock as unknown as typeof fetch,
        ...overrides,
      })

    it("refreshes after a real successful exchange", async () => {
      const outcome = await exchange()

      expect(outcome.status).toBe("success")
      expect(shouldRefreshAfterOutcome(outcome)).toBe(true)
    })

    it("does not refresh after a rejected exchange", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(502, { ok: false, error: { message: "failed", correlationId: "c-1" } })
      )

      const outcome = await exchange()

      expect(outcome.status).toBe("failure")
      expect(shouldRefreshAfterOutcome(outcome)).toBe(false)
    })

    it("does not refresh after a replayed single-use auth token", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(409, { ok: false, error: { message: "already used", correlationId: "c-2" } })
      )

      expect(shouldRefreshAfterOutcome(await exchange())).toBe(false)
    })

    it("does not refresh after a timeout or unclear outcome", async () => {
      fetchMock.mockImplementation(async () => {
        const abort = new Error("aborted")
        abort.name = "AbortError"
        throw abort
      })

      const outcome = await exchange({ timeoutMs: 5 })

      expect(outcome.status).toBe("failure")
      if (outcome.status !== "failure") return
      expect(outcome.failure.outcomeUnclear).toBe(true)
      expect(shouldRefreshAfterOutcome(outcome)).toBe(false)
    })

    it("does not refresh when the request never left", async () => {
      const blocked = await exchange({ merchantTimeZone: "" })

      expect(fetchMock).not.toHaveBeenCalled()
      expect(shouldRefreshAfterOutcome(blocked)).toBe(false)
    })
  })

  /* ── The readiness read client ────────────────────────────────────────── */

  describe("readiness read client", () => {
    let fetchMock: ReturnType<typeof vi.fn>

    beforeEach(() => {
      fetchMock = vi.fn(async () => jsonResponse(200, { ok: true, data: READINESS_SNAPSHOT }))
    })

    it("issues exactly one request per call, to the PineTree readiness route only", async () => {
      await fetchShift4Readiness({
        getBearerToken: async () => BEARER,
        fetchImpl: fetchMock as unknown as typeof fetch,
      })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][0]).toBe("/api/internal/shift4/readiness")
      expect(SHIFT4_READINESS_PATH).toBe("/api/internal/shift4/readiness")
    })

    it("re-reads the current session on every call rather than caching one", async () => {
      const tokens = [BEARER, REFRESHED_BEARER]
      const getBearerToken = vi.fn(async () => tokens.shift() ?? null)

      await fetchShift4Readiness({ getBearerToken, fetchImpl: fetchMock as unknown as typeof fetch })
      await fetchShift4Readiness({ getBearerToken, fetchImpl: fetchMock as unknown as typeof fetch })

      expect(getBearerToken).toHaveBeenCalledTimes(2)
      const headerOf = (index: number) =>
        (fetchMock.mock.calls[index][1] as RequestInit).headers as Record<string, string>
      expect(headerOf(0).authorization).toBe(`Bearer ${BEARER}`)
      expect(headerOf(1).authorization).toBe(`Bearer ${REFRESHED_BEARER}`)
    })

    it("makes one readiness request for one refresh, never a duplicate", async () => {
      // Simulates the effect firing once for the bumped version.
      await fetchShift4Readiness({
        getBearerToken: async () => BEARER,
        fetchImpl: fetchMock as unknown as typeof fetch,
      })

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it("returns the refreshed projection, with Retail and E-commerce separate", async () => {
      const snapshot = await fetchShift4Readiness({
        getBearerToken: async () => BEARER,
        fetchImpl: fetchMock as unknown as typeof fetch,
      })

      expect(snapshot?.authenticated).toBe(true)
      expect(snapshot?.authenticatedChannels).toEqual({ retail: true, ecommerce: false })
      expect(snapshot?.capabilities.merchant_authentication.state).toBe("authenticated")
      expect(snapshot?.capabilities.retail.state).toBe("disabled")
      expect(snapshot?.capabilities.production_processing.ready).toBe(false)
    })

    it("carries no secret material in or out", async () => {
      const snapshot = await fetchShift4Readiness({
        getBearerToken: async () => BEARER,
        fetchImpl: fetchMock as unknown as typeof fetch,
      })

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      // A GET with no body: nothing can be smuggled outbound.
      expect(init.body).toBeUndefined()
      expect(init.method ?? "GET").toBe("GET")
      expect(JSON.stringify(snapshot)).not.toMatch(
        /accessToken|authToken|clientGuid|ciphertext|authTag/
      )
    })

    it("returns null without a session and issues no request", async () => {
      const result = await fetchShift4Readiness({
        getBearerToken: async () => null,
        fetchImpl: fetchMock as unknown as typeof fetch,
      })

      expect(result).toBeNull()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("returns null instead of throwing when the read fails", async () => {
      fetchMock.mockRejectedValue(new Error("network down"))

      await expect(
        fetchShift4Readiness({
          getBearerToken: async () => BEARER,
          fetchImpl: fetchMock as unknown as typeof fetch,
        })
      ).resolves.toBeNull()
    })

    it("never contacts a Shift4 host", async () => {
      await fetchShift4Readiness({
        getBearerToken: async () => BEARER,
        fetchImpl: fetchMock as unknown as typeof fetch,
      })

      for (const call of fetchMock.mock.calls) {
        expect(String(call[0])).not.toMatch(/shift4test\.com|shift4api\.net|shift4\.com/)
      }
    })

    it("has no polling or retry construct", () => {
      const code = stripComments(readinessClientSource)
      expect(code).not.toMatch(/setInterval|setTimeout/)
      expect(code).not.toMatch(/\b(for|while|do)\s*[\s(]/)
      expect(code.match(/fetchImpl\(/g)?.length).toBe(1)
    })
  })

  /* ── Component and page wiring ────────────────────────────────────────── */

  describe("component wiring", () => {
    it("invokes onConnectionChanged only on the success path", () => {
      expect(cardCode).toMatch(/onConnectionChanged\?\.\(\)/)
      // Exactly one call site in the whole component.
      expect(cardCode.match(/onConnectionChanged\?\.\(\)/g)?.length).toBe(1)
      // Guarded by the shared decision rule, inside the success branch.
      expect(cardCode).toMatch(/const changed = shouldRefreshAfterOutcome\(outcome\)/)
      expect(cardCode).toMatch(/if \(changed\) onConnectionChanged\?\.\(\)/)
      // Never called beside the failure state update.
      expect(cardCode).not.toMatch(/setFailure\(outcome\.failure\)[\s\S]{0,120}onConnectionChanged/)
    })

    it("passes no argument through the callback, so no secret can cross", () => {
      expect(cardCode).toMatch(/onConnectionChanged\?:\s*\(\)\s*=>\s*void/)
      expect(cardCode).not.toMatch(/onConnectionChanged\?\.\([^)]+\)/)
    })

    it("keys the readiness effect on the refresh version", () => {
      expect(readinessCardCode).toMatch(/refreshVersion\s*=\s*0/)
      expect(readinessCardCode).toMatch(/\}, \[refreshVersion\]\)/)
      expect(readinessCardCode).toMatch(/fetchShift4Readiness\(\{ getBearerToken: currentAccessToken \}\)/)
    })

    it("uses no polling anywhere in the readiness card", () => {
      expect(readinessCardCode).not.toMatch(/setInterval|setTimeout/)
    })

    it("wires the version counter between the sibling cards in the admin section", () => {
      expect(pageCode).toMatch(/const \[readinessVersion, setReadinessVersion\] = useState\(0\)/)
      expect(pageCode).toMatch(/setReadinessVersion\(\(version\) => version \+ 1\)/)
      expect(pageCode).toMatch(/onConnectionChanged=\{handleConnectionChanged\}/)
      expect(pageCode).toMatch(/<Shift4RestReadinessCard refreshVersion=\{readinessVersion\} \/>/)
    })

    it("declares the hooks before the authorization early return", () => {
      const callbackIndex = pageCode.indexOf("const handleConnectionChanged")
      const guardIndex = pageCode.indexOf("if (authorized !== true) return null")
      expect(callbackIndex).toBeGreaterThan(-1)
      // Hooks must run unconditionally, so the gate comes after them.
      expect(callbackIndex).toBeLessThan(guardIndex)
      expect(pageCode).not.toMatch(/onConnectionChanged=\{useCallback/)
    })

    it("leaves no refresh wiring on the merchant Providers page", () => {
      const providersCode = stripComments(providersPageSource)
      expect(providersCode).not.toMatch(/shift4ReadinessVersion|handleShift4ConnectionChanged/)
      expect(providersCode).not.toContain("Shift4RestReadinessCard")
    })

    it("does not rely on router.refresh for these client-fetched cards", () => {
      expect(readinessCardCode).not.toMatch(/router\.refresh/)
      expect(cardCode).not.toMatch(/router\.refresh/)
    })

    it("never repeats the credential exchange as part of a refresh", () => {
      // The refresh path touches the readiness route only.
      expect(readinessCardCode).not.toContain(SHIFT4_CONNECT_PATH)
      expect(stripComments(readinessClientSource)).not.toContain(SHIFT4_CONNECT_PATH)
      expect(stripComments(readinessClientSource)).toContain(SHIFT4_READINESS_PATH)
    })
  })
})
