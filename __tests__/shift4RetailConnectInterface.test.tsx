/**
 * Shift4 Retail sandbox connect interface - operator safety contracts.
 *
 * Three layers are covered:
 *   1. the pure exchange client (`lib/shift4/retailConnect.ts`) - dispatch
 *      count, auth-token lifetime, error narrowing, timeout handling;
 *   2. the React card - render gating and source guarantees;
 *   3. the GET surface service - authentication and environment gating.
 *
 * NO SHIFT4 REQUEST IS MADE. Every fetch is a local mock, and a guard asserts
 * that no request ever targets a Shift4 host.
 */

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  buildRetailConnectBody,
  canSubmitRetailConnection,
  RETAIL_CHANNEL,
  RETAIL_CONFIRMATION_TEXT,
  SHIFT4_CONNECT_PATH,
  submitRetailConnection,
} from "@/lib/shift4/retailConnect"

const FAKE_AUTH_TOKEN = "11111111-2222-3333-4444444444444444"
const BEARER = "pinetree-session-jwt"
const TIME_ZONE = "America/Chicago"

const cardSource = readFileSync("components/dashboard/Shift4RetailConnectCard.tsx", "utf8")
const clientSource = readFileSync("lib/shift4/retailConnect.ts", "utf8")
const surfaceSource = readFileSync("engine/shift4/connectSurface.ts", "utf8")

/**
 * Remove comments and JSX prose so a "must not contain" assertion tests the
 * CODE rather than the documentation that describes what the code avoids.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
}

const cardCode = stripComments(cardSource)
const clientCode = stripComments(clientSource)
const surfaceCode = stripComments(surfaceSource)

const SAFE_RESULT = {
  connectionId: "connection-1",
  environment: "test",
  channel: "retail",
  accessTokenFingerprint: "abcdef123456",
  connectedAt: "2026-08-02T00:00:01.000Z",
  correlationId: "correlation-1",
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

describe("Shift4 Retail connect interface", () => {
  /* ── The pure exchange client ─────────────────────────────────────────── */

  describe("exchange client", () => {
    let fetchMock: ReturnType<typeof vi.fn>
    let consoleSpies: ReturnType<typeof vi.spyOn>[]
    let logged: unknown[]

    beforeEach(() => {
      logged = []
      fetchMock = vi.fn(async () => jsonResponse(200, { ok: true, data: SAFE_RESULT }))
      // Any console output during an exchange is captured so a test can prove
      // the auth token never reaches it.
      consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
          logged.push(...args)
        })
      )
    })

    afterEach(() => {
      for (const spy of consoleSpies) spy.mockRestore()
    })

    const run = (overrides: Record<string, unknown> = {}) =>
      submitRetailConnection({
        authToken: FAKE_AUTH_TOKEN,
        merchantTimeZone: TIME_ZONE,
        getBearerToken: async () => BEARER,
        onTokenConsumed: () => {},
        fetchImpl: fetchMock as unknown as typeof fetch,
        ...overrides,
      })

    it("always sends channel retail and cannot be aimed elsewhere", async () => {
      await run()

      const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(path).toBe(SHIFT4_CONNECT_PATH)
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      expect(body.channel).toBe("retail")
      expect(RETAIL_CHANNEL).toBe("retail")

      // The body builder ignores anything that is not the two allowed inputs.
      expect(
        buildRetailConnectBody({
          authToken: FAKE_AUTH_TOKEN,
          merchantTimeZone: TIME_ZONE,
          // @ts-expect-error - proving an extra key cannot reach the request
          channel: "ecommerce",
        })
      ).toEqual({ authToken: FAKE_AUTH_TOKEN, channel: "retail", merchantTimeZone: TIME_ZONE })
    })

    it("sends exactly the approved request body", async () => {
      await run()
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(JSON.parse(String(init.body))).toEqual({
        authToken: FAKE_AUTH_TOKEN,
        channel: "retail",
        merchantTimeZone: TIME_ZONE,
      })
    })

    it("uses the session bearer token from the caller, never a pasted value", async () => {
      const getBearerToken = vi.fn(async () => BEARER)
      await run({ getBearerToken })

      expect(getBearerToken).toHaveBeenCalledTimes(1)
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${BEARER}`)
    })

    it("consumes the auth token before dispatch on success", async () => {
      const order: string[] = []
      await run({
        onTokenConsumed: () => order.push("cleared"),
        fetchImpl: vi.fn(async () => {
          order.push("dispatched")
          return jsonResponse(200, { ok: true, data: SAFE_RESULT })
        }) as unknown as typeof fetch,
      })

      expect(order).toEqual(["cleared", "dispatched"])
    })

    it("consumes the auth token before dispatch on failure too", async () => {
      const onTokenConsumed = vi.fn()
      fetchMock.mockResolvedValue(
        jsonResponse(502, { ok: false, error: { message: "Shift4 connection failed", correlationId: "c-1" } })
      )

      const outcome = await run({ onTokenConsumed })

      expect(onTokenConsumed).toHaveBeenCalledTimes(1)
      expect(outcome.status).toBe("failure")
    })

    it("consumes the auth token even when the request throws", async () => {
      const onTokenConsumed = vi.fn()
      fetchMock.mockRejectedValue(new Error("network down"))

      const outcome = await run({ onTokenConsumed })

      expect(onTokenConsumed).toHaveBeenCalledTimes(1)
      expect(outcome.status).toBe("failure")
    })

    it("dispatches exactly once and never retries automatically", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(502, { ok: false, error: { message: "Shift4 connection failed", correlationId: "c-1" } })
      )
      await run()
      expect(fetchMock).toHaveBeenCalledTimes(1)

      fetchMock.mockReset()
      fetchMock.mockRejectedValue(new Error("network down"))
      await run()
      expect(fetchMock).toHaveBeenCalledTimes(1)

      // Structurally impossible to retry: one dispatch site, no loop, no
      // recursion, no scheduled re-invocation.
      expect(clientCode.match(/fetchImpl\(/g)?.length).toBe(1)
      expect(clientCode).not.toMatch(/\b(for|while|do)\s*[\s(]/)
      expect(clientCode).not.toMatch(/setInterval|setTimeout\([^)]*submitRetailConnection/)
      // The only occurrence is the declaration itself: the function never
      // calls itself, so no recursive retry is possible.
      expect(clientCode.match(/submitRetailConnection\(/g)?.length).toBe(1)
      expect(clientCode).toMatch(/export async function submitRetailConnection\(/)
    })

    it("returns only the six approved safe fields on success", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          ok: true,
          data: {
            ...SAFE_RESULT,
            // A server that leaked extra material must not widen the interface.
            accessToken: "LEAKED-ACCESS-TOKEN",
            clientGuid: "LEAKED-CLIENT-GUID",
            encryptedEnvelope: { ciphertext: "…" },
          },
        })
      )

      const outcome = await run()
      expect(outcome.status).toBe("success")
      if (outcome.status !== "success") return

      expect(Object.keys(outcome.result).sort()).toEqual([
        "accessTokenFingerprint",
        "channel",
        "connectedAt",
        "connectionId",
        "correlationId",
        "environment",
      ])
      expect(JSON.stringify(outcome.result)).not.toMatch(/LEAKED|ciphertext/)
    })

    it("shows only a generic message and correlation ID on failure", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(502, {
          ok: false,
          error: { message: "Shift4 connection failed", correlationId: "correlation-9" },
          stack: "Error: at exchangeAccessToken (providers/shift4/rest/...)",
          providerBody: { credential: { accessToken: "LEAKED" } },
        })
      )

      const outcome = await run()
      expect(outcome.status).toBe("failure")
      if (outcome.status !== "failure") return

      expect(Object.keys(outcome.failure).sort()).toEqual([
        "correlationId",
        "message",
        "outcomeUnclear",
      ])
      expect(outcome.failure.correlationId).toBe("correlation-9")
      expect(JSON.stringify(outcome.failure)).not.toMatch(/LEAKED|providers\/shift4|Error:/)
    })

    it("treats a timeout as an unclear outcome that must not be retried blindly", async () => {
      fetchMock.mockImplementation(async () => {
        const abort = new Error("aborted")
        abort.name = "AbortError"
        throw abort
      })

      const outcome = await run({ timeoutMs: 5 })
      expect(outcome.status).toBe("failure")
      if (outcome.status !== "failure") return

      expect(outcome.failure.outcomeUnclear).toBe(true)
      expect(outcome.failure.message).toMatch(/timed out/i)
    })

    it("blocks the request when the merchant time zone is missing", async () => {
      const outcome = await run({ merchantTimeZone: "" })

      expect(fetchMock).not.toHaveBeenCalled()
      expect(outcome.status).toBe("failure")
    })

    it("blocks the request when the session has expired", async () => {
      const outcome = await run({ getBearerToken: async () => null })

      expect(fetchMock).not.toHaveBeenCalled()
      expect(outcome.status).toBe("failure")
    })

    it("never writes the auth token to console output", async () => {
      await run()
      fetchMock.mockResolvedValue(jsonResponse(500, { ok: false, error: { message: "failed" } }))
      await run()

      expect(JSON.stringify(logged)).not.toContain(FAKE_AUTH_TOKEN)
    })

    it("never returns the auth token in any outcome", async () => {
      const success = await run()
      fetchMock.mockResolvedValue(jsonResponse(409, { ok: false, error: { message: "used" } }))
      const failure = await run()

      expect(JSON.stringify(success)).not.toContain(FAKE_AUTH_TOKEN)
      expect(JSON.stringify(failure)).not.toContain(FAKE_AUTH_TOKEN)
    })

    it("makes no request to any Shift4 host", () => {
      for (const call of fetchMock.mock.calls) {
        expect(String(call[0])).toBe(SHIFT4_CONNECT_PATH)
        expect(String(call[0])).not.toMatch(/shift4test\.com|shift4api\.net|shift4\.com/)
      }
    })
  })

  /* ── Submit gating ────────────────────────────────────────────────────── */

  describe("submit gating", () => {
    const base = {
      enabled: true,
      merchantTimeZoneValid: true,
      confirmed: true,
      authToken: FAKE_AUTH_TOKEN,
      submitting: false,
      formVisible: true,
    }

    it("enables only when every precondition is satisfied", () => {
      expect(canSubmitRetailConnection(base)).toBe(true)
    })

    it("blocks without the explicit confirmation", () => {
      expect(canSubmitRetailConnection({ ...base, confirmed: false })).toBe(false)
    })

    it("blocks an invalid or missing merchant time zone", () => {
      expect(canSubmitRetailConnection({ ...base, merchantTimeZoneValid: false })).toBe(false)
    })

    it("blocks a second submission while one is in flight", () => {
      expect(canSubmitRetailConnection({ ...base, submitting: true })).toBe(false)
    })

    it("blocks a blank auth token", () => {
      expect(canSubmitRetailConnection({ ...base, authToken: "   " })).toBe(false)
    })

    it("blocks while the form is hidden behind the replace action", () => {
      expect(canSubmitRetailConnection({ ...base, formVisible: false })).toBe(false)
    })

    it("blocks when the deployment has not enabled the interface", () => {
      expect(canSubmitRetailConnection({ ...base, enabled: false })).toBe(false)
    })
  })

  /* ── The React card ──────────────────────────────────────────────────── */

  describe("operator card", () => {
    it("renders nothing before an authenticated surface has loaded", async () => {
      const Card = (await import("@/components/dashboard/Shift4RetailConnectCard")).default
      // No session, so the GET never resolves a surface and nothing is exposed.
      expect(renderToStaticMarkup(createElement(Card))).toBe("")
    })

    it("is a client component inside the authenticated dashboard, not a public page", () => {
      expect(cardSource).toMatch(/^"use client"/m)
      const providers = readFileSync("app/dashboard/providers/page.tsx", "utf8")
      expect(providers).toContain("Shift4RetailConnectCard")
      // Mounted in the merchant Providers area only.
      expect(providers).toMatch(/<Shift4RetailConnectCard \/>/)
    })

    it("masks the auth token input and opts out of autofill", () => {
      expect(cardSource).toMatch(/type="password"/)
      expect(cardSource).toMatch(/autoComplete="off"/)
      expect(cardSource).toMatch(/spellCheck=\{false\}/)
      expect(cardSource).toMatch(/data-1p-ignore/)
      expect(cardSource).toMatch(/data-lpignore/)
    })

    it("never persists the auth token to browser storage or a URL", () => {
      for (const sink of [
        "localStorage",
        "sessionStorage",
        "document.cookie",
        "URLSearchParams",
        "searchParams",
        "history.pushState",
        "navigator.sendBeacon",
        "indexedDB",
      ]) {
        expect(cardCode).not.toContain(sink)
        expect(clientCode).not.toContain(sink)
      }
      // The token travels in a POST body, never a query string.
      expect(clientCode).not.toMatch(/authToken=\$\{|\?authToken/)
      expect(clientCode).toMatch(/method: "POST"/)
    })

    it("never logs or reports the auth token", () => {
      for (const code of [cardCode, clientCode]) {
        expect(code).not.toMatch(/console\.(log|info|warn|error|debug)/)
        expect(code).not.toMatch(
          /\b(analytics|telemetry|gtag|posthog|Sentry|datadog|mixpanel|emitWalletSetupDebugEvent)\b/i
        )
        expect(code).not.toMatch(/\btrack\(|\bcapture\(|\breportEvent\(/)
      }
    })

    it("clears the auth token on every exit path", () => {
      // Cleared before dispatch via the client callback, and again in `finally`.
      expect(cardSource).toMatch(/onTokenConsumed: \(\) => setAuthToken\(""\)/)
      expect(cardSource).toMatch(/finally \{[\s\S]*setAuthToken\(""\)/)
    })

    it("guards double submission with a synchronous ref", () => {
      expect(cardSource).toMatch(/inFlightRef\.current/)
      expect(cardSource).toMatch(/if \(inFlightRef\.current\) return/)
    })

    it("hardcodes retail and offers no channel, environment, or production control", () => {
      // No selector of any kind, and no channel/environment state to change.
      expect(cardCode).not.toMatch(/<select|type="radio"/)
      expect(cardCode).not.toMatch(/setChannel|setEnvironment|channel:\s*channel/)
      expect(cardCode).not.toMatch(/["']production["']|["']ecommerce["']/)
      // The channel constant lives in the client module and is not an argument.
      expect(clientCode).toMatch(/const RETAIL_CHANNEL = "retail"/)
      expect(clientCode).toMatch(/channel: RETAIL_CHANNEL/)
      expect(clientCode).not.toMatch(/channel:\s*(input|deps)\./)
    })

    it("carries the exact confirmation text and button label", () => {
      expect(RETAIL_CONFIRMATION_TEXT).toBe(
        "I understand this will send one Retail sandbox credential exchange request to Shift4."
      )
      expect(cardSource).toContain("RETAIL_CONFIRMATION_TEXT")
      expect(cardSource).toContain("Connect Shift4 Retail Sandbox")
    })

    it("requires an explicit replace action before re-exposing the form", () => {
      expect(cardSource).toMatch(/Replace Retail connection/)
      expect(cardSource).toMatch(/const formVisible = !retailConnected \|\| replacing/)
      expect(cardSource).toMatch(/setReplacing\(true\)/)
      // And warns that replacing performs another exchange.
      expect(cardSource).toMatch(/performs another Shift4 exchange|another Shift4 exchange/)
    })

    it("never offers a control that could modify the ecommerce credential", () => {
      // Ecommerce appears only as a read-only informational line.
      expect(cardSource).toMatch(/never modifies it/)
      expect(cardSource).not.toMatch(/channel:\s*["']ecommerce["']/)
    })

    it("displays only the approved safe result fields", () => {
      for (const label of [
        "Connection ID",
        "Environment",
        "Channel",
        "Access token fingerprint",
        "Connected at",
        "Correlation ID",
      ]) {
        expect(cardSource).toContain(label)
      }
      // The fingerprint is rendered; the token itself has no accessor at all.
      expect(cardCode).toContain("result.accessTokenFingerprint")
      expect(cardCode).not.toMatch(/result\.accessToken\b/)
      for (const forbidden of [
        "clientGuid",
        "ciphertext",
        "authTag",
        "rawResponse",
        "requestHeaders",
        "providerBody",
      ]) {
        expect(cardCode).not.toContain(forbidden)
      }
    })

    it("instructs the operator to stop rather than retry when the outcome is unclear", () => {
      expect(cardSource).toMatch(/Stop and review/i)
      expect(cardSource).toMatch(/outcomeUnclear/)
      expect(cardSource).not.toMatch(/setTimeout\([^)]*submit|retryCount/)
    })
  })

  /* ── The GET surface service ─────────────────────────────────────────── */

  describe("connect surface service", () => {
    afterEach(() => {
      vi.unstubAllEnvs()
      vi.resetModules()
    })

    async function loadSurface(env: Record<string, string>) {
      vi.resetModules()
      for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
      vi.doMock("@/database/merchants", () => ({
        getMerchantSettings: async () => ({ timezone: TIME_ZONE }),
      }))
      vi.doMock("@/database/merchantShift4RestConnections", () => ({
        getShift4RestConnectionStatus: async () => null,
      }))
      const { getShift4RetailConnectSurface } = await import("@/engine/shift4/connectSurface")
      const surface = await getShift4RetailConnectSurface("merchant-1")
      vi.doUnmock("@/database/merchants")
      vi.doUnmock("@/database/merchantShift4RestConnections")
      return surface
    }

    const configured = {
      SHIFT4_REST_ENABLED: "true",
      SHIFT4_REST_ENVIRONMENT: "test",
      SHIFT4_INTERFACE_NAME: "PineTreePayments",
      SHIFT4_INTERFACE_VERSION: "1.0.0",
      SHIFT4_COMPANY_NAME: "PineTree Payments",
    }

    it("enables only when the REST gate is on and the environment is test", async () => {
      const surface = await loadSurface(configured)
      expect(surface.enabled).toBe(true)
      expect(surface.merchantTimeZone).toBe(TIME_ZONE)
      expect(surface.merchantTimeZoneValid).toBe(true)
    })

    it("stays disabled when SHIFT4_REST_ENABLED is off", async () => {
      const surface = await loadSurface({ ...configured, SHIFT4_REST_ENABLED: "false" })
      expect(surface.enabled).toBe(false)
      expect(surface.disabledReason).toBe("rest_disabled")
    })

    it("stays disabled when the environment is production", async () => {
      const surface = await loadSurface({ ...configured, SHIFT4_REST_ENVIRONMENT: "production" })
      expect(surface.enabled).toBe(false)
      expect(surface.disabledReason).toBe("not_test_environment")
    })

    it("stays disabled when the interface identity is not configured", async () => {
      const surface = await loadSurface({ ...configured, SHIFT4_INTERFACE_NAME: "" })
      expect(surface.enabled).toBe(false)
      expect(surface.disabledReason).toBe("not_configured")
    })

    it("exposes no environment variable name or value to the browser", async () => {
      const surface = await loadSurface(configured)
      const serialized = JSON.stringify(surface)
      expect(serialized).not.toMatch(/SHIFT4_|shift4test|shift4api|PineTreePayments|1\.0\.0/)
      // Only a boolean plus a coarse reason code describes the environment.
      expect(typeof surface.enabled).toBe("boolean")
      expect(["rest_disabled", "not_test_environment", "not_configured", null]).toContain(
        surface.disabledReason
      )
    })

    it("reads the merchant time zone from merchant settings, never the server or browser", () => {
      expect(surfaceSource).toMatch(/getMerchantSettings/)
      expect(surfaceSource).not.toMatch(/resolvedOptions\(\)|process\.env\.TZ/)
      expect(surfaceSource).toMatch(/Never falls back to server or browser/)
    })

    it("enables no processing capability flag", () => {
      for (const flag of [
        "SHIFT4_RETAIL_ENABLED",
        "SHIFT4_ECOMMERCE_ENABLED",
        "SHIFT4_CERTIFICATION_MODE",
        "SHIFT4_PRODUCTION_ENABLED",
        "SHIFT4_PARTIAL_APPROVAL_ENABLED",
        "SHIFT4_SPLIT_TENDER_ENABLED",
        "SHIFT4_APPLE_PAY_ENABLED",
        "SHIFT4_GOOGLE_PAY_ENABLED",
      ]) {
        expect(surfaceCode).not.toContain(flag)
        expect(cardCode).not.toContain(flag)
      }
    })

    it("adds no auth-token environment variable", () => {
      for (const source of [surfaceCode, cardCode, clientCode]) {
        expect(source).not.toMatch(/SHIFT4_RETAIL_AUTH_TOKEN|SHIFT4_ECOM_AUTH_TOKEN|SHIFT4_API_BASE_URL/)
      }
    })
  })

  /* ── Route wiring ────────────────────────────────────────────────────── */

  describe("route wiring", () => {
    it("adds no second connection route", () => {
      const route = readFileSync("app/api/internal/shift4/connect/route.ts", "utf8")
      // GET describes the surface, POST performs the exchange - one route.
      expect(route).toMatch(/export async function GET/)
      expect(route).toMatch(/export async function POST/)
      expect(route).toMatch(/requireMerchantIdFromRequest/)
      expect(clientSource).toContain(SHIFT4_CONNECT_PATH)
      // The interface talks to exactly one path.
      expect(clientSource.match(/\/api\/internal\/shift4\//g)?.length).toBe(1)
    })

    it("derives merchant identity from the session on both verbs", () => {
      const route = readFileSync("app/api/internal/shift4/connect/route.ts", "utf8")
      expect(route.match(/requireMerchantIdFromRequest\(request/g)?.length).toBe(2)
      expect(route).toMatch(/merchant_id_not_accepted/)
    })
  })
})
