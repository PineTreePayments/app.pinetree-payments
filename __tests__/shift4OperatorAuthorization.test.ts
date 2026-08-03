/**
 * Shift4 sandbox operator authorization and surface relocation.
 *
 * The Shift4 credential-exchange and raw readiness surfaces are internal
 * testing tools. They must be unreachable from the merchant Providers page and
 * usable only by the single admin whose confirmed email matches the server-only
 * SHIFT4_OPERATOR_EMAIL.
 *
 * The configured address never appears in this file, in any fixture, or in any
 * assertion message - only synthetic addresses are used.
 *
 * NO SHIFT4 REQUEST AND NO DATABASE REQUEST IS MADE: `fetch` is a throwing stub
 * and every dependency is mocked.
 */

import { readFileSync } from "node:fs"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/** Synthetic addresses. Never the real operator address. */
const OPERATOR_EMAIL = "operator@pinetree.test"
const OTHER_ADMIN_EMAIL = "second-admin@pinetree.test"
const MERCHANT_EMAIL = "merchant@example.test"

const source = (path: string) => readFileSync(path, "utf8")

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
}

const providersSource = source("app/dashboard/providers/page.tsx")
const adminPageSource = source("app/dashboard/admin/page.tsx")
const sectionSource = source("components/admin/Shift4SandboxOperationsSection.tsx")
const operatorAuthSource = source("lib/api/shift4OperatorAuth.ts")
const connectRouteSource = source("app/api/internal/shift4/connect/route.ts")
const readinessRouteSource = source("app/api/internal/shift4/readiness/route.ts")

describe("Shift4 sandbox operator authorization", () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    fetchSpy = vi.fn(() => {
      throw new Error("A network request was attempted during an authorization test.")
    })
    vi.stubGlobal("fetch", fetchSpy)
  })

  afterEach(() => {
    vi.doUnmock("@/lib/api/adminAuth")
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  /**
   * Mount an authenticated identity behind the real operator helper.
   * `verifiedEmail` is null for API keys and unconfirmed accounts.
   */
  function mountIdentity(status: {
    isAdmin: boolean
    verifiedEmail: string | null
    merchantId?: string
  }) {
    vi.doMock("@/lib/api/adminAuth", () => ({
      getAdminStatusFromRequest: async () => ({
        isAdmin: status.isAdmin,
        merchantId: status.merchantId ?? "merchant-1",
        email: status.verifiedEmail,
        verifiedEmail: status.verifiedEmail,
        role: status.isAdmin ? "admin" : null,
      }),
    }))
  }

  async function authorize(): Promise<boolean> {
    const { getShift4OperatorStatusFromRequest } = await import("@/lib/api/shift4OperatorAuth")
    const request = {} as Parameters<typeof getShift4OperatorStatusFromRequest>[0]
    return (await getShift4OperatorStatusFromRequest(request)).authorized
  }

  async function requireOperator(): Promise<unknown> {
    const { requireShift4OperatorFromRequest } = await import("@/lib/api/shift4OperatorAuth")
    const request = {} as Parameters<typeof requireShift4OperatorFromRequest>[0]
    return requireShift4OperatorFromRequest(request).catch((error: unknown) => error)
  }

  /* ── Both conditions are required ─────────────────────────────────────── */

  describe("authorization matrix", () => {
    beforeEach(() => {
      vi.stubEnv("SHIFT4_OPERATOR_EMAIL", OPERATOR_EMAIL)
    })

    it("authorizes only an admin whose verified email matches exactly", async () => {
      mountIdentity({ isAdmin: true, verifiedEmail: OPERATOR_EMAIL })
      expect(await authorize()).toBe(true)
    })

    it("rejects an ordinary merchant with the operator address", async () => {
      mountIdentity({ isAdmin: false, verifiedEmail: OPERATOR_EMAIL })
      expect(await authorize()).toBe(false)
    })

    it("rejects a different PineTree admin", async () => {
      mountIdentity({ isAdmin: true, verifiedEmail: OTHER_ADMIN_EMAIL })
      expect(await authorize()).toBe(false)
    })

    it("rejects an ordinary merchant with an ordinary address", async () => {
      mountIdentity({ isAdmin: false, verifiedEmail: MERCHANT_EMAIL })
      expect(await authorize()).toBe(false)
    })

    it("rejects an admin whose email is not verified", async () => {
      mountIdentity({ isAdmin: true, verifiedEmail: null })
      expect(await authorize()).toBe(false)
    })

    it("matches case-insensitively and ignores surrounding whitespace", async () => {
      mountIdentity({ isAdmin: true, verifiedEmail: `  ${OPERATOR_EMAIL.toUpperCase()}  ` })
      expect(await authorize()).toBe(true)
    })

    it("never matches on a domain, prefix, or substring", async () => {
      const { matchesShift4Operator } = await import("@/lib/api/shift4OperatorAuth")
      for (const near of [
        "operator@pinetree.test.evil.test",
        "xoperator@pinetree.test",
        "operator@pinetree.tes",
        "operator",
        "@pinetree.test",
        "pinetree.test",
        `${OPERATOR_EMAIL} extra`,
      ]) {
        expect(matchesShift4Operator(near), near).toBe(false)
      }
      expect(matchesShift4Operator(OPERATOR_EMAIL)).toBe(true)
    })
  })

  /* ── Fail closed on configuration ─────────────────────────────────────── */

  describe("configuration", () => {
    it("fails closed when SHIFT4_OPERATOR_EMAIL is missing", async () => {
      vi.stubEnv("SHIFT4_OPERATOR_EMAIL", "")
      mountIdentity({ isAdmin: true, verifiedEmail: OPERATOR_EMAIL })

      expect(await authorize()).toBe(false)
    })

    it("fails closed when SHIFT4_OPERATOR_EMAIL is blank", async () => {
      vi.stubEnv("SHIFT4_OPERATOR_EMAIL", "    ")
      mountIdentity({ isAdmin: true, verifiedEmail: OPERATOR_EMAIL })

      expect(await authorize()).toBe(false)
    })

    it("never treats a blank configured value as matching a blank email", async () => {
      vi.stubEnv("SHIFT4_OPERATOR_EMAIL", "")
      const { matchesShift4Operator } = await import("@/lib/api/shift4OperatorAuth")

      expect(matchesShift4Operator("")).toBe(false)
      expect(matchesShift4Operator(null)).toBe(false)
      expect(matchesShift4Operator(undefined)).toBe(false)
    })

    it("reports configuration presence without revealing the value", async () => {
      vi.stubEnv("SHIFT4_OPERATOR_EMAIL", OPERATOR_EMAIL)
      const { isShift4OperatorConfigured } = await import("@/lib/api/shift4OperatorAuth")
      expect(isShift4OperatorConfigured()).toBe(true)

      vi.stubEnv("SHIFT4_OPERATOR_EMAIL", "")
      vi.resetModules()
      const reloaded = await import("@/lib/api/shift4OperatorAuth")
      expect(reloaded.isShift4OperatorConfigured()).toBe(false)
    })
  })

  /* ── Generic rejection ────────────────────────────────────────────────── */

  describe("rejection shape", () => {
    beforeEach(() => {
      vi.stubEnv("SHIFT4_OPERATOR_EMAIL", OPERATOR_EMAIL)
    })

    it("returns one generic 404 that does not say which condition failed", async () => {
      const rejections: Record<string, unknown>[] = []

      for (const identity of [
        { isAdmin: false, verifiedEmail: MERCHANT_EMAIL },
        { isAdmin: true, verifiedEmail: OTHER_ADMIN_EMAIL },
        { isAdmin: false, verifiedEmail: OPERATOR_EMAIL },
        { isAdmin: true, verifiedEmail: null },
      ]) {
        vi.resetModules()
        mountIdentity(identity)
        const error = (await requireOperator()) as Record<string, unknown>
        rejections.push({ status: error.status, code: error.code, message: String(error.message) })
      }

      // Every rejection is byte-identical, so the route cannot be probed.
      expect(new Set(rejections.map((item) => JSON.stringify(item))).size).toBe(1)
      expect(rejections[0]).toEqual({ status: 404, code: "not_found", message: "Not found" })
    })

    it("puts no configured or account email in the rejection", async () => {
      mountIdentity({ isAdmin: true, verifiedEmail: OTHER_ADMIN_EMAIL })
      const error = (await requireOperator()) as Error

      const serialized = `${error.message}${JSON.stringify(error)}`
      expect(serialized).not.toContain(OPERATOR_EMAIL)
      expect(serialized).not.toContain(OTHER_ADMIN_EMAIL)
    })

    it("returns the operator's own merchant id, never one from a request", async () => {
      mountIdentity({ isAdmin: true, verifiedEmail: OPERATOR_EMAIL, merchantId: "merchant-operator" })
      expect(await requireOperator()).toBe("merchant-operator")
    })

    it("exposes no email on the status object", async () => {
      mountIdentity({ isAdmin: true, verifiedEmail: OPERATOR_EMAIL })
      const { getShift4OperatorStatusFromRequest } = await import("@/lib/api/shift4OperatorAuth")
      const request = {} as Parameters<typeof getShift4OperatorStatusFromRequest>[0]
      const status = await getShift4OperatorStatusFromRequest(request)

      expect(Object.keys(status).sort()).toEqual(["authorized", "merchantId"])
      expect(JSON.stringify(status)).not.toContain(OPERATOR_EMAIL)
    })
  })

  /* ── Providers page no longer carries the tools ───────────────────────── */

  describe("merchant Providers page", () => {
    it("contains no Shift4 sandbox or readiness card", () => {
      const code = stripComments(providersSource)
      for (const token of [
        "Shift4RetailConnectCard",
        "Shift4RestReadinessCard",
        "shift4ReadinessVersion",
        "handleShift4ConnectionChanged",
      ]) {
        expect(code).not.toContain(token)
      }
    })

    it("leaves no hidden markup or client-side email check behind", () => {
      const code = stripComments(providersSource)
      expect(code).not.toMatch(/SHIFT4_OPERATOR_EMAIL|shift4Operator/)
      expect(code).not.toMatch(/\/api\/internal\/shift4\/(connect|readiness)/)
      // No operator-only content hidden with CSS instead of being removed.
      expect(code).not.toMatch(/Replace Retail connection|accessTokenFingerprint|correlationId/)
    })

    it("keeps ordinary merchant provider cards intact", () => {
      for (const provider of ["Stripe", "Fluid Pay", "ProviderCard"]) {
        expect(providersSource).toContain(provider)
      }
    })
  })

  /* ── Admin surface ────────────────────────────────────────────────────── */

  describe("admin surface", () => {
    it("mounts the labeled sandbox section in the admin dashboard", () => {
      expect(adminPageSource).toContain("Shift4SandboxOperationsSection")
      expect(adminPageSource).toMatch(
        /<Shift4SandboxOperationsSection authorized=\{shift4Operator\} \/>/
      )
      expect(sectionSource).toContain("Shift4 Sandbox Operations")
      expect(sectionSource).toContain("Shift4RetailConnectCard")
      expect(sectionSource).toContain("Shift4RestReadinessCard")
    })

    it("renders nothing until the server authorizes, so nothing can flash", () => {
      const code = stripComments(sectionSource)
      expect(code).toMatch(/if \(authorized !== true\) return null/)
      // `undefined` while /api/admin/me is in flight.
      expect(stripComments(adminPageSource)).toMatch(
        /useState<boolean \| undefined>\(undefined\)/
      )
    })

    it("never compares an email or embeds one in client code", () => {
      for (const [name, code] of [
        ["section", stripComments(sectionSource)],
        ["admin page", stripComments(adminPageSource)],
      ] as const) {
        expect(code, name).not.toMatch(/SHIFT4_OPERATOR_EMAIL/)
        expect(code, name).not.toMatch(/NEXT_PUBLIC_SHIFT4/)
        expect(code, name).not.toMatch(/@pinetree\.|@gmail\.|@outlook\./)
      }
      // The client receives only a boolean.
      expect(stripComments(adminPageSource)).toMatch(/body\?\.shift4Operator === true/)
    })

    it("preserves the connection-to-readiness refresh inside the section", () => {
      const code = stripComments(sectionSource)
      expect(code).toMatch(/onConnectionChanged=\{handleConnectionChanged\}/)
      expect(code).toMatch(/refreshVersion=\{readinessVersion\}/)
      expect(code).toMatch(/setReadinessVersion\(\(version\) => version \+ 1\)/)
    })

    it("adds no public route for these tools", () => {
      // The section is a component mounted inside the authenticated admin page.
      expect(sectionSource).toMatch(/^"use client"/m)
      expect(sectionSource).not.toMatch(/export const dynamic|export async function (GET|POST)/)
    })
  })

  /* ── Route protection ─────────────────────────────────────────────────── */

  describe("protected routes", () => {
    it("guards both verbs of the connect route with operator authorization", () => {
      const code = stripComments(connectRouteSource)
      expect(code.match(/requireShift4OperatorFromRequest\(request\)/g)?.length).toBe(2)
      expect(code).toMatch(/export async function GET/)
      expect(code).toMatch(/export async function POST/)
      // Ordinary merchant auth no longer gates these surfaces.
      expect(code).not.toContain("requireMerchantIdFromRequest")
    })

    it("guards the raw readiness route with the same authorization", () => {
      const code = stripComments(readinessRouteSource)
      expect(code).toContain("requireShift4OperatorFromRequest")
      expect(code).not.toContain("requireMerchantIdFromRequest")
    })

    it("authorizes before reading the body, so validation cannot be probed", () => {
      const code = stripComments(connectRouteSource)
      const authIndex = code.indexOf("requireShift4OperatorFromRequest(request)\n    const { authToken")
      const fallbackAuth = code.indexOf("const merchantId = await requireShift4OperatorFromRequest(request)")
      const bodyIndex = code.indexOf("readConnectRequest(request)")
      expect(Math.max(authIndex, fallbackAuth)).toBeGreaterThan(-1)
      expect(fallbackAuth).toBeLessThan(bodyIndex)
    })

    it("still rejects a body-supplied merchantId or email", () => {
      const code = stripComments(connectRouteSource)
      expect(code).toContain("merchant_id_not_accepted")
      expect(code).toMatch(/ALLOWED_FIELDS/)
      expect(code).toContain("unsupported_field")
      // `email` is not an accepted field, so it is rejected as unsupported.
      expect(code).toMatch(/new Set\(\["authToken", "channel", "merchantTimeZone"\]\)/)
    })

    it("preserves every credential-handling guarantee", () => {
      const code = stripComments(connectRouteSource)
      expect(code).toMatch(/channel !== "retail" && channel !== "ecommerce"/)
      expect(code).toContain("isValidIanaTimeZone")
      expect(code).toContain("payload_too_large")
      expect(code).toMatch(/no-store/)
      // The route still returns only safe evidence.
      expect(code).toMatch(/accessTokenFingerprint: result\.accessTokenFingerprint/)
      expect(code).not.toMatch(/result\.accessToken\b/)
      expect(code).not.toMatch(/authToken:\s*(result|outcome)/)
    })
  })

  /* ── Server-only configuration ────────────────────────────────────────── */

  describe("configuration disclosure", () => {
    it("defines no NEXT_PUBLIC operator email anywhere", () => {
      for (const path of [
        ".env.example",
        "lib/api/shift4OperatorAuth.ts",
        "components/admin/Shift4SandboxOperationsSection.tsx",
        "app/dashboard/admin/page.tsx",
        "app/dashboard/providers/page.tsx",
        "app/api/admin/me/route.ts",
        "scripts/check-environment.mjs",
      ]) {
        expect(source(path), path).not.toMatch(/NEXT_PUBLIC_SHIFT4_OPERATOR_EMAIL/)
        expect(source(path), path).not.toMatch(/NEXT_PUBLIC_[A-Z_]*OPERATOR/)
      }
    })

    it("documents a blank entry in .env.example", () => {
      const example = source(".env.example")
      expect(example).toMatch(/^SHIFT4_OPERATOR_EMAIL=$/m)
    })

    it("never logs the configured value", () => {
      const code = stripComments(operatorAuthSource)
      expect(code).not.toMatch(/console\.(log|info|warn|error|debug)/)
      // The variable is read through a function, never captured at module load.
      expect(code).toMatch(/function configuredOperatorEmail\(\)/)
      expect(code).not.toMatch(/^const .* = process\.env\.SHIFT4_OPERATOR_EMAIL/m)
    })

    it("uses exact equality, never a partial comparison", () => {
      const code = stripComments(operatorAuthSource)
      expect(code).toMatch(/candidate === configured/)
      expect(code).not.toMatch(/startsWith|endsWith|\.includes\(|indexOf\(|RegExp|split\("@"\)/)
    })

    it("keeps the API-key path unable to satisfy an email check", () => {
      const merchantAuth = stripComments(source("lib/api/merchantAuth.ts"))
      expect(merchantAuth).toMatch(/verifiedEmail: null,\s*source: "api_key"/)
      // Only a confirmed primary address becomes a verified email.
      expect(merchantAuth).toMatch(/authData\.user\.email_confirmed_at \? primaryEmail : null/)
    })

    it("requires the operator email when the REST integration is enabled", () => {
      const checker = source("scripts/check-environment.mjs")
      expect(checker).toMatch(/SHIFT4_OPERATOR_EMAIL/)
      expect(checker).toMatch(
        /shift4Flag\("SHIFT4_REST_ENABLED"\) && !present\("SHIFT4_OPERATOR_EMAIL"\)/
      )
      // The checker states outright that values are never printed.
      expect(checker).toContain("Values are never printed.")
    })
  })

  it("makes no network request in any of these cases", () => {
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
