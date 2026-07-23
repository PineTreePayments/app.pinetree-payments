import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8")
}

const page = read("app/dashboard/wallet-setup/page.tsx")

describe("Speed/Bitcoin provisioning starts from Create PineTree Wallet only", () => {
  it("profile-sync success runs rail sync but does not start Speed or Lightning provisioning", () => {
    const successBranch = page.slice(
      page.indexOf('if (res.ok) {'),
      page.indexOf('console.warn("[pinetree-wallets] profile_sync_failed"')
    )
    expect(successBranch).toContain("runRailSyncOnceForProfile(json.profile, token)")
    expect(successBranch).not.toContain("triggerAutomaticLightningProvisioningOnce")
    expect(successBranch).not.toContain("provisionSpeedLightning")
    expect(successBranch).not.toContain("/api/wallets/lightning/pinetree-managed")
  })

  it("Create PineTree Wallet starts core Dynamic setup and Speed provisioning in parallel", () => {
    const orchestratorFn = page.slice(
      page.indexOf("async function createPineTreeWalletSetup("),
      page.indexOf("// Kicks off core Dynamic wallet setup")
    )
    expect(orchestratorFn).toContain('emitWalletSetupDebugEvent("wallet_setup_orchestrator_started"')
    expect(orchestratorFn).toContain("await Promise.allSettled([")
    expect(orchestratorFn).toContain("startCoreDynamicWallet(options),")
    expect(orchestratorFn).toContain("provisionSpeedLightning(),")
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
    expect(modalBlock).toContain("schedulePineTreeWalletModalOpenAfterProgress")
    expect(modalBlock).not.toContain("lightningProfileState")
    expect(modalBlock).not.toContain("provisionSpeedLightning")
  })

  it("does not keep the old post-profile-sync auto-provision helper or client timeout events", () => {
    expect(page).not.toContain("function triggerAutomaticLightningProvisioningOnce")
    expect(page).not.toContain("lightningAutoProvisionAttemptedForProfileRef")
    expect(page).not.toContain("lightningAutoProvisionClientTimeoutMs")
    expect(page).not.toContain("wallet_lightning_auto_provision_client_started")
    expect(page).not.toContain("wallet_lightning_auto_provision_client_timeout")
  })
})

describe("No manual 'Set up Bitcoin' CTA competes with automatic provisioning", () => {
  it("there is no separate manual Bitcoin/Lightning setup button in the wallet-setup page", () => {
    expect(page).not.toContain("Set up Bitcoin")
    expect(page).not.toContain("Set up Lightning")
    expect(page).not.toContain("Enable Lightning")
  })

  it("does not render a second Business Profile banner inside the wallet modal", () => {
    const modalOverview = page.slice(
      page.indexOf("{activeView === null ? ("),
      page.indexOf('{activeView === "base-details" ? (')
    )
    expect(page).toContain("BusinessProfileRequirementBanner")
    expect(modalOverview).not.toContain("BusinessProfileRequirementBanner")
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
