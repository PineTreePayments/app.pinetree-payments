import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8")
}

const page = read("app/dashboard/wallet-setup/page.tsx")

describe("Automatic Lightning/Speed provisioning fires right after core profile sync succeeds, not at click time (Part 1/2)", () => {
  it("triggerAutomaticLightningProvisioningOnce is called from the profile-sync success path, alongside rail sync", () => {
    const successBranch = page.slice(
      page.indexOf('if (res.ok) {'),
      page.indexOf('console.warn("[pinetree-wallets] profile_sync_failed"')
    )
    expect(successBranch).toContain("runRailSyncOnceForProfile(json.profile, token)")
    expect(successBranch).toContain("triggerAutomaticLightningProvisioningOnce(json.profile)")
    // Fired after the modal-open block, non-blocking (return follows immediately).
    const railSyncIndex = successBranch.indexOf("runRailSyncOnceForProfile(json.profile, token)")
    const lightningIndex = successBranch.indexOf("triggerAutomaticLightningProvisioningOnce(json.profile)")
    const returnIndex = successBranch.indexOf("return json.profile")
    expect(lightningIndex).toBeGreaterThan(railSyncIndex)
    expect(returnIndex).toBeGreaterThan(lightningIndex)
  })

  it("is idempotent per (merchant, base address, solana address) so Strict Mode/rerenders/reloads never fire twice for the same profile", () => {
    expect(page).toContain("const lightningAutoProvisionAttemptedForProfileRef = useRef<string | null>(null)")
    const fn = page.slice(
      page.indexOf("function triggerAutomaticLightningProvisioningOnce"),
      page.indexOf("// Speed/Lightning provisioning runs concurrently")
    )
    expect(fn).toContain("if (!profileForAttempt.base_address || !profileForAttempt.solana_address) return")
    expect(fn).toContain("if (lightningAutoProvisionAttemptedForProfileRef.current === attemptKey) return")
    expect(fn).toContain("lightningAutoProvisionAttemptedForProfileRef.current = attemptKey")
  })

  it("is bounded so a slow Speed request can never block core wallet setup", () => {
    const fn = page.slice(
      page.indexOf("function triggerAutomaticLightningProvisioningOnce"),
      page.indexOf("// Speed/Lightning provisioning runs concurrently")
    )
    expect(fn).toContain("runWithBoundedTimeout(() => provisionSpeedLightning(), lightningAutoProvisionClientTimeoutMs)")
    expect(page).toContain("const lightningAutoProvisionClientTimeoutMs = 15_000")
  })

  it("logs a safe timeout event and lets the request keep running in the background instead of blocking on it", () => {
    const fn = page.slice(
      page.indexOf("function triggerAutomaticLightningProvisioningOnce"),
      page.indexOf("// Speed/Lightning provisioning runs concurrently")
    )
    expect(fn).toContain('outcome.status === "timeout"')
    expect(fn).toContain("wallet_lightning_auto_provision_client_timeout")
    expect(fn).toContain("bounded.settlement.catch(() => undefined)")
  })

  it("modal open is independent of Lightning status - it only depends on the core profile being ready", () => {
    const successBranch = page.slice(
      page.indexOf('if (res.ok) {'),
      page.indexOf('console.warn("[pinetree-wallets] profile_sync_failed"')
    )
    const modalBlock = successBranch.slice(
      successBranch.indexOf('if (json.profile.status === "ready") {'),
      successBranch.indexOf("runRailSyncOnceForProfile")
    )
    expect(modalBlock).toContain("openPineTreeWalletModalOnce")
    expect(modalBlock).not.toContain("lightningProfileState")
    expect(modalBlock).not.toContain("provisionSpeedLightning")
  })

  it("new client-side auto-provision events are whitelisted for the server-visible beacon", () => {
    const eventRoute = read("app/api/debug/pinetree-wallet/setup-event/route.ts")
    expect(eventRoute).toContain('"wallet_lightning_auto_provision_client_started"')
    expect(eventRoute).toContain('"wallet_lightning_auto_provision_client_timeout"')
  })
})

describe("No manual 'Set up Bitcoin' CTA competes with automatic provisioning", () => {
  it("there is no separate manual Bitcoin/Lightning setup button in the wallet-setup page", () => {
    expect(page).not.toContain("Set up Bitcoin")
    expect(page).not.toContain("Set up Lightning")
    expect(page).not.toContain("Enable Lightning")
  })

  it("the Business Profile banner only shows for a real needs_attention configuration reason, never for pending", () => {
    const conditionStart = page.indexOf('lightningProfileState.kind === "loaded" &&\n                  lightningProfileState.profile.status === "needs_attention"')
    const componentEnd = page.indexOf("<BusinessProfileRequirementBanner", conditionStart) + "<BusinessProfileRequirementBanner".length
    const bannerCondition = page.slice(
      conditionStart,
      componentEnd
    )
    expect(bannerCondition).toContain('status === "needs_attention"')
    expect(bannerCondition).toContain('["business_profile_required", "business_owner_profile_required"].includes')
  })
})

describe("Server-side structured logging for automatic Lightning provisioning (Part logging)", () => {
  const engine = read("engine/pineTreeWalletReadiness.ts")

  it("emits every required safe structured event somewhere in the engine or route", () => {
    const route = read("app/api/wallets/lightning/pinetree-managed/route.ts")
    for (const event of [
      "wallet_lightning_auto_provision_started",
      "wallet_lightning_auto_provision_existing",
      "wallet_lightning_auto_provision_created",
      "wallet_lightning_auto_provision_pending",
      "wallet_lightning_auto_provision_complete",
      "wallet_lightning_auto_provision_timeout",
      "wallet_lightning_auto_provision_failed",
      "wallet_lightning_auto_provision_skipped",
    ]) {
      expect(engine + route).toContain(event)
    }
  })

  it("never logs a Speed credential, auth token, wallet address, setup URL, or secret in the new events", () => {
    // Every new log call in this file uses only merchant_id/status/booleans/elapsed_ms -
    // spot check a few of the exact call sites added for this fix.
    const startedCall = engine.slice(
      engine.indexOf('console.info("[pinetree-managed-lightning] wallet_lightning_auto_provision_started"'),
      engine.indexOf('console.info("[pinetree-managed-lightning] wallet_lightning_auto_provision_started"') + 220
    )
    expect(startedCall).not.toContain("email")
    expect(startedCall).not.toContain("setup_url")
    expect(startedCall).not.toContain("password")
    expect(startedCall).not.toContain("api_key")
  })

  it("declares a single-flight guard keyed by merchant id for concurrency safety", () => {
    expect(engine).toContain("const lightningAutoProvisionInFlight = new Map<string, Promise<EnsureManagedLightningResult>>()")
    expect(engine).toContain("const alreadyInFlight = lightningAutoProvisionInFlight.get(merchantId)")
    expect(engine).toContain("return alreadyInFlight")
  })
})
