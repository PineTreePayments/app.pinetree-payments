/**
 * Automatic capability activation, existing-merchant migration behavior, and
 * the guarantee that wallet/settlement infrastructure is never merchant-facing.
 *
 * All provider identifiers and payloads are fully fabricated.
 */

import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { beforeEach, describe, expect, it } from "vitest"

import { resolveBridgeActivation, isBridgeCapabilityRolloutEnabled } from "@/engine/bridgeConnect"

const repoRoot = path.resolve(__dirname, "..")
const read = (relative: string) => readFileSync(path.join(repoRoot, relative), "utf8")

/**
 * SQL with `--` comments removed.
 *
 * Destructive-statement assertions must run against executable SQL only:
 * prose like "Truncated by the application" is documentation, not a TRUNCATE.
 */
const readSqlStatements = (relative: string) =>
  read(relative)
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")

const FAKE_CUSTOMER_ID = "cust_ffffffff-ffff-4fff-8fff-ffffffffffff"
const FAKE_KYC_LINK_ID = "kyc_11112222-3333-4444-8555-666677778888"

beforeEach(() => {
  delete process.env.BRIDGE_CAPABILITY_ROLLOUT_ENABLED
})

describe("Automatic capability activation", () => {
  it("activates automatically once approved - no merchant action", () => {
    const decision = resolveBridgeActivation({ approved: true, credentials: {} })

    expect(decision.active).toBe(true)
    expect(decision.decided).toBe(true)
    expect(decision.autoActivatedAt).toBeTruthy()
    expect(decision.blockedReason).toBeNull()
  })

  it("never activates an unapproved merchant", () => {
    const decision = resolveBridgeActivation({ approved: false, credentials: {} })

    expect(decision.active).toBe(false)
    expect(decision.blockedReason).toBe("not_approved")
  })

  it("cannot be activated by a merchant asserting approval in stored state", () => {
    // Even with an activation timestamp already present, loss of approval
    // immediately deactivates: approval authority stays with the provider.
    const decision = resolveBridgeActivation({
      approved: false,
      credentials: { auto_activated_at: "2026-08-01T00:00:00.000Z" },
    })

    expect(decision.active).toBe(false)
  })

  it("lets an administrator hold block activation for a controlled rollout", () => {
    const decision = resolveBridgeActivation({
      approved: true,
      credentials: { admin_activation_blocked_at: "2026-08-05T00:00:00.000Z" },
    })

    expect(decision.active).toBe(false)
    expect(decision.blockedReason).toBe("administrator_hold")
  })

  it("lets a deployment-wide rollout flag block activation", () => {
    process.env.BRIDGE_CAPABILITY_ROLLOUT_ENABLED = "false"

    expect(isBridgeCapabilityRolloutEnabled()).toBe(false)
    expect(resolveBridgeActivation({ approved: true, credentials: {} })).toMatchObject({
      active: false,
      blockedReason: "rollout_disabled",
    })
  })

  it("defaults the rollout flag to enabled so a normal deployment needs none", () => {
    expect(isBridgeCapabilityRolloutEnabled()).toBe(true)
    process.env.BRIDGE_CAPABILITY_ROLLOUT_ENABLED = "true"
    expect(isBridgeCapabilityRolloutEnabled()).toBe(true)
  })

  it("preserves the original activation timestamp across later evaluations", () => {
    const decision = resolveBridgeActivation({
      approved: true,
      credentials: { auto_activated_at: "2026-08-01T00:00:00.000Z" },
      now: "2026-09-09T00:00:00.000Z",
    })

    expect(decision.autoActivatedAt).toBe("2026-08-01T00:00:00.000Z")
  })
})

describe("Infrastructure is never merchant-facing", () => {
  it("removed the Bridge provider card component", () => {
    expect(existsSync(path.join(repoRoot, "components/dashboard/BridgeProviderCard.tsx"))).toBe(false)
  })

  it("removed every merchant-facing Bridge API route", () => {
    expect(existsSync(path.join(repoRoot, "app/api/providers/bridge"))).toBe(false)
  })

  it("keeps the Providers page free of Bridge and of connect/enable controls for it", () => {
    const page = read("app/dashboard/providers/page.tsx")

    expect(page).not.toContain("BridgeProviderCard")
    expect(page).not.toContain("Bridge by Stripe")
    expect(page).not.toMatch(/\/api\/providers\/bridge/)
    expect(page).not.toMatch(/Start Bridge onboarding|Connect Bridge|Refresh Bridge/i)
  })

  it("leaves the Bitcoin Lightning and other provider cards unchanged", () => {
    const page = read("app/dashboard/providers/page.tsx")

    // Cards merchants genuinely connect must all still be present.
    expect(page).toContain("Bitcoin Lightning")
    expect(page).toContain('provider="lightning"')
    expect(page).toContain('name="Shift4"')
    expect(page).toContain('name="Stripe"')
    expect(page).toContain('name="Fluid Pay"')
    expect(page).toContain('name="Solana Pay"')
    expect(page).toContain('name="Base Pay"')
    expect(page).toContain('name="Coinbase Business"')
  })

  it("excludes the infrastructure connection from the merchant provider projection", () => {
    const dashboard = read("engine/providersDashboard.ts")
    expect(dashboard).toContain("row.provider !== BRIDGE_PROVIDER_NAME")
  })

  it("keeps merchant-facing verification UI free of provider naming and extra controls", () => {
    const panel = read("components/dashboard/BusinessVerificationPanel.tsx")

    expect(panel.toLowerCase()).not.toContain("bridge by stripe")
    expect(panel).not.toMatch(/Connect Bridge|Enable Bridge|Disable Bridge/i)
    // Merchant surfaces call PineTree-domain endpoints only.
    expect(panel).toContain("/api/onboarding/business-verification")
    expect(panel).not.toContain("/api/providers/bridge")
    // Status text is Engine-authored, never hardcoded provider vocabulary.
    expect(panel).toContain("verification?.statusLabel")
  })

  it("does not import provider internals into browser-facing code", () => {
    for (const file of [
      "components/dashboard/BusinessVerificationPanel.tsx",
      "components/dashboard/ServiceTermsConsentCard.tsx",
      "app/dashboard/providers/page.tsx",
    ]) {
      expect(read(file)).not.toMatch(/from ["']@\/providers\//)
    }
  })

  it("names the partner only in the required disclosure and admin diagnostics", () => {
    // The consent card is a required legal disclosure surface, so it may name
    // the provider - that is the one merchant-facing exception.
    expect(read("components/dashboard/ServiceTermsConsentCard.tsx")).toContain("Service providers")
    // Admin diagnostics identify the underlying provider for support.
    expect(read("engine/bridgeAdminDiagnostics.ts")).toContain("BRIDGE_PROVIDER_NAME")
  })
})

describe("Existing merchants", () => {
  it("ships no destructive or mass-creating migration", () => {
    const sql = readSqlStatements(
      "database/migrations/20260806120000_create_service_terms_acceptances.sql"
    )

    // Consent is evidence of a deliberate act; it can never be backfilled,
    // so no migration may mass-create acceptances or provider customers.
    expect(sql).not.toMatch(/insert\s+into[\s\S]{0,200}select/i)
    expect(sql).not.toMatch(/\bdrop\s+table\b|\bdelete\s+from\b|\btruncate\b/i)
    expect(sql).not.toMatch(/\bupdate\s+public\.(merchant_providers|merchants)\b/i)

    // Documentation of the append-only guarantee stays in the file itself.
    expect(read("database/migrations/20260806120000_create_service_terms_acceptances.sql")).toContain(
      "append-only"
    )
  })

  it("keeps the original Bridge migration and webhook inbox intact", () => {
    const bridgeMigration = read(
      "database/migrations/20260805120000_create_bridge_provider_connections.sql"
    )
    expect(bridgeMigration).toContain("bridge_webhook_events")
    expect(bridgeMigration).toContain("merchant_providers_bridge_customer_uidx")
  })

  it("preserves the Bridge backend foundation", () => {
    for (const file of [
      "providers/bridge/client.ts",
      "providers/bridge/config.ts",
      "providers/bridge/adapter.ts",
      "providers/bridge/normalize.ts",
      "providers/bridge/verifyWebhook.ts",
      "providers/bridge/translateEvent.ts",
      "providers/bridge/idempotency.ts",
      "engine/bridgeConnect.ts",
      "database/merchantBridgeConnections.ts",
      "app/api/webhooks/bridge/route.ts",
    ]) {
      expect(existsSync(path.join(repoRoot, file))).toBe(true)
    }
  })

  it("retains raw-body webhook verification and dedup protections", () => {
    const engine = read("engine/bridgeConnect.ts")

    expect(engine).toContain("verifyBridgeWebhookSignature")
    expect(engine).toContain("claimBridgeWebhookEvent")
    expect(engine).toContain("out_of_order")
    // Verification still precedes parsing.
    expect(engine.indexOf("verifyBridgeWebhookSignature")).toBeLessThan(
      engine.indexOf("JSON.parse(args.rawBody)")
    )
  })

  it("has no merchant-facing enable/disable engine entry point", () => {
    const engine = read("engine/bridgeConnect.ts")

    expect(engine).not.toContain("setBridgeEnabledEngine")
    // The only activation override is administrator-scoped.
    expect(engine).toContain("setBridgeAdministrativeHoldEngine")
    expect(engine).toContain("adminId")
  })
})

describe("Administrator diagnostics", () => {
  it("requires an administrator and a merchant scope", () => {
    const route = read("app/api/admin/business-verification/route.ts")

    expect(route).toContain("requireAdminFromRequest")
    expect(route).toContain("merchantId is required")
  })

  it("exposes technical detail to administrators only", () => {
    const diagnostics = read("engine/bridgeAdminDiagnostics.ts")

    for (const field of [
      "bridgeCustomerId",
      "bridgeKycLinkId",
      "rawCustomerStatus",
      "endorsements",
      "lastSyncedAt",
      "autoActivatedAt",
      "activationBlockedReason",
      "consentTermsVersion",
    ]) {
      expect(diagnostics).toContain(field)
    }
  })

  it("never returns credentials or verification material", () => {
    const diagnostics = read("engine/bridgeAdminDiagnostics.ts")

    expect(diagnostics).not.toMatch(/BRIDGE_API_KEY|apiKey:|publicKey:/)
    // The hosted-URL FIELDS are never surfaced. `bridgeKycLinkId` is an
    // identifier, not a URL, and is expected in admin diagnostics.
    expect(diagnostics).not.toMatch(/\bkycUrl\b|\btosUrl\b/)
    expect(diagnostics).not.toMatch(/credentials\.(kyc_link|tos_link)\b/)
    expect(diagnostics).not.toContain("https://bridge")
  })
})

describe("Unrelated provider behavior is untouched", () => {
  it("leaves the Stripe Connect engine free of Bridge coupling", () => {
    expect(read("engine/stripeConnect.ts").toLowerCase()).not.toContain("bridge")
  })

  it("does not let a Stripe connected account imply verification", () => {
    const verification = read("engine/businessVerification.ts")
    expect(verification).not.toMatch(/stripeConnect|chargesEnabled|stripe_account_id/)
  })

  it("keeps the wallet page provisioning flow intact", () => {
    const page = read("app/dashboard/wallet-setup/page.tsx")

    expect(page).toContain("BusinessVerificationPanel")
    // Automatic Dynamic + Bitcoin provisioning must remain.
    expect(page).toContain("PineTree Wallet")
    expect(page).toContain("BusinessProfileRequirementBanner")
  })
})

describe("Constants referenced by the tests above", () => {
  it("uses fabricated provider identifiers only", () => {
    expect(FAKE_CUSTOMER_ID.startsWith("cust_")).toBe(true)
    expect(FAKE_KYC_LINK_ID.startsWith("kyc_")).toBe(true)
  })
})
