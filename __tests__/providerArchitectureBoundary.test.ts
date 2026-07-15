import { describe, expect, it } from "vitest"
import { existsSync, readdirSync, readFileSync, statSync } from "fs"
import path from "path"

/**
 * Guards the Phase 2 move of card provider readiness out of the
 * non-canonical lib/providers/* path (banned by the repo's own
 * no-restricted-imports ESLint rule - see eslint.config.mjs) into
 * providers/cardProviderReadiness.ts, and guards against the duplicate/
 * manual rail-list pattern that caused the Stripe-as-crypto POS bug from
 * recurring.
 */

const ROOT = process.cwd()
const CODE_EXTENSIONS = new Set([".ts", ".tsx"])
const BROWSER_DIRS = ["app", "components", "hooks"]

function listFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) return []
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      files.push(...listFilesRecursive(full))
    } else if (CODE_EXTENSIONS.has(path.extname(full))) {
      files.push(full)
    }
  }
  return files
}

describe("Provider architecture boundary", () => {
  it("providers/cardProviderReadiness.ts exists at the canonical location", () => {
    expect(existsSync(path.join(ROOT, "providers", "cardProviderReadiness.ts"))).toBe(true)
  })

  it("the old non-canonical lib/providers tree no longer exists", () => {
    expect(existsSync(path.join(ROOT, "lib", "providers"))).toBe(false)
  })

  it("no source file imports from the old @/lib/providers path", () => {
    const selfPath = path.relative(ROOT, path.join(ROOT, "__tests__", "providerArchitectureBoundary.test.ts"))
    const offenders: string[] = []
    for (const dir of ["app", "components", "hooks", "engine", "providers", "lib", "__tests__"]) {
      for (const file of listFilesRecursive(path.join(ROOT, dir))) {
        const relative = path.relative(ROOT, file)
        if (relative === selfPath) continue // this test's own strings reference the banned path by name
        const content = readFileSync(file, "utf8")
        if (content.includes("@/lib/providers")) {
          offenders.push(relative)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("engine/stripeConnect.ts uses provider-owned Stripe onboarding, not the raw Stripe client", () => {
    const source = readFileSync(path.join(ROOT, "engine", "stripeConnect.ts"), "utf8")
    expect(source).not.toContain("@/providers/stripe/client")
    expect(source).not.toMatch(/from ["']@\/providers\/stripe\/client["']/)
    expect(source).toContain("createStripeOnboardingLink")
    expect(source).toContain("retrieveStripeConnectedAccount")
  })

  it("browser-facing code does not import provider clients, adapters, or card readiness predicates", () => {
    const offenders: string[] = []
    const bannedImportPattern =
      /from\s+["']@\/providers\/(?:[^"']*\/)?(?:client|adapter|payments|paymentStatus|verifyWebhook|translateEvent)["']|from\s+["']@\/providers\/cardProviderReadiness["']/

    for (const dir of BROWSER_DIRS) {
      for (const file of listFilesRecursive(path.join(ROOT, dir))) {
        const relative = path.relative(ROOT, file)
        const content = readFileSync(file, "utf8")
        if (bannedImportPattern.test(content)) offenders.push(relative)
      }
    }

    expect(offenders).toEqual([])
  })

  it("providers dashboard page consumes normalized card readiness instead of provider credential internals", () => {
    const source = readFileSync(path.join(ROOT, "app", "dashboard", "providers", "page.tsx"), "utf8")
    expect(source).toContain("cardReadiness")
    expect(source).not.toContain("@/providers/cardProviderReadiness")
    expect(source).not.toContain("stripe_account_id")
    expect(source).not.toContain("charges_enabled")
    expect(source).not.toContain("payouts_enabled")
    expect(source).not.toContain("details_submitted")
    expect(source).not.toContain("application_status")
  })

  it("provider dashboard engine returns normalized card readiness without exposing card-provider credentials", () => {
    const source = readFileSync(path.join(ROOT, "engine", "providersDashboard.ts"), "utf8")
    expect(source).toContain("cardReadiness")
    expect(source).toContain("sanitizeCardProviderRow")
    expect(source).toContain("canCardProviderProcessPayments")
    expect(source).toContain("isStripeConnectReady")
  })

  it("engine/posMethodReadiness.ts and engine/posPayments.ts derive their crypto rail list from the canonical types/payment.ts definitions, not a manually maintained array", () => {
    const posMethodReadiness = readFileSync(path.join(ROOT, "engine", "posMethodReadiness.ts"), "utf8")
    expect(posMethodReadiness).toContain('getRailsForCategory("crypto")')
    expect(posMethodReadiness).not.toMatch(/CRYPTO_RAILS[^=]*=\s*\[\s*["']solana["']/)

    const posPayments = readFileSync(path.join(ROOT, "engine", "posPayments.ts"), "utf8")
    expect(posPayments).toContain('getRailsForCategory("crypto")')
    expect(posPayments).toContain('from "@/types/payment"')
  })

  it("engine/paymentIntents.ts's walletNetworkToProviderKey derives its values from the canonical rail definitions rather than re-hardcoding them", () => {
    const source = readFileSync(path.join(ROOT, "engine", "paymentIntents.ts"), "utf8")
    expect(source).toContain("getPaymentRailDefinition(network).providerCapability")
  })
})
