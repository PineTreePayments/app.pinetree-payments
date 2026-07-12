import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  resolveNativeAuthResumeAction,
  shouldRerunSpeedOnNativeAuthResume,
  shouldRunWalletProvisioningTimeout,
  walletProvisioningTimeoutSuppressionReason,
} from "@/lib/pinetreeWalletSetupResume"

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8")
}

const baseTimeoutCtx = {
  pendingSync: true,
  needsUserAuth: false,
  dynamicAuthSheetOpen: false,
  nativeFallbackPending: false,
  profilePostInFlight: false,
}

describe("PineTree Wallet native auth resume - timeout suppression", () => {
  it("runs the provisioning timeout only for an active unattended attempt", () => {
    expect(shouldRunWalletProvisioningTimeout(baseTimeoutCtx)).toBe(true)
    expect(shouldRunWalletProvisioningTimeout({ ...baseTimeoutCtx, pendingSync: false })).toBe(false)
  })

  it("external_auth_rejected parks setup in needs_user_auth without starting the timeout failure", () => {
    expect(shouldRunWalletProvisioningTimeout({ ...baseTimeoutCtx, needsUserAuth: true })).toBe(false)
    expect(walletProvisioningTimeoutSuppressionReason({ ...baseTimeoutCtx, needsUserAuth: true })).toBe("needs_user_auth")
  })

  it("suppresses the timeout while the Dynamic auth sheet is open", () => {
    expect(shouldRunWalletProvisioningTimeout({ ...baseTimeoutCtx, dynamicAuthSheetOpen: true })).toBe(false)
    expect(walletProvisioningTimeoutSuppressionReason({ ...baseTimeoutCtx, dynamicAuthSheetOpen: true })).toBe(
      "dynamic_auth_sheet_open"
    )
  })

  it("suppresses the timeout while a native fallback is pending completion", () => {
    expect(shouldRunWalletProvisioningTimeout({ ...baseTimeoutCtx, nativeFallbackPending: true })).toBe(false)
    expect(walletProvisioningTimeoutSuppressionReason({ ...baseTimeoutCtx, nativeFallbackPending: true })).toBe(
      "native_fallback_pending"
    )
  })

  it("suppresses the timeout while a profile POST is in flight", () => {
    expect(shouldRunWalletProvisioningTimeout({ ...baseTimeoutCtx, profilePostInFlight: true })).toBe(false)
    expect(walletProvisioningTimeoutSuppressionReason({ ...baseTimeoutCtx, profilePostInFlight: true })).toBe(
      "profile_post_in_flight"
    )
  })

  it("reports no suppression reason when the timeout is allowed to run", () => {
    expect(walletProvisioningTimeoutSuppressionReason(baseTimeoutCtx)).toBeNull()
    expect(walletProvisioningTimeoutSuppressionReason({ ...baseTimeoutCtx, pendingSync: false })).toBeNull()
  })
})

describe("PineTree Wallet native auth resume - resume action", () => {
  it("opens the existing wallet when a ready profile with both core addresses exists", () => {
    expect(resolveNativeAuthResumeAction({
      status: "ready",
      base_address: "0xabc",
      solana_address: "SoLaddr",
    })).toBe("open_existing_ready_wallet")
  })

  it("resumes core provisioning when no profile exists or the profile is incomplete", () => {
    expect(resolveNativeAuthResumeAction(null)).toBe("resume_core_provisioning")
    expect(resolveNativeAuthResumeAction({ status: "pending", base_address: "0xabc", solana_address: "SoL" })).toBe(
      "resume_core_provisioning"
    )
    expect(resolveNativeAuthResumeAction({ status: "ready", base_address: null, solana_address: "SoL" })).toBe(
      "resume_core_provisioning"
    )
    expect(resolveNativeAuthResumeAction({ status: "ready", base_address: "0xabc", solana_address: null })).toBe(
      "resume_core_provisioning"
    )
  })

  it("does not rerun Speed when a profile or in-flight attempt already exists", () => {
    expect(shouldRerunSpeedOnNativeAuthResume({ speedProvisionInFlight: true, lightningProfileKind: "none" })).toBe(false)
    expect(shouldRerunSpeedOnNativeAuthResume({ speedProvisionInFlight: false, lightningProfileKind: "loaded" })).toBe(false)
    expect(shouldRerunSpeedOnNativeAuthResume({ speedProvisionInFlight: false, lightningProfileKind: "loading" })).toBe(false)
    expect(shouldRerunSpeedOnNativeAuthResume({ speedProvisionInFlight: false, lightningProfileKind: "error" })).toBe(false)
    expect(shouldRerunSpeedOnNativeAuthResume({ speedProvisionInFlight: false, lightningProfileKind: "none" })).toBe(true)
  })
})

describe("PineTree Wallet native auth resume - page wiring", () => {
  const page = read("app/dashboard/wallet-setup/page.tsx")
  const eventRoute = read("app/api/debug/pinetree-wallet/setup-event/route.ts")

  it("gates both provisioning timeout timers on the suppression helper", () => {
    const occurrences = page.split("walletProvisioningTimeoutSuppressionReason(").length - 1
    // Scheduling guard in each of the two timer effects plus the fire-time re-check.
    expect(occurrences).toBeGreaterThanOrEqual(3)
    expect(page).toContain("wallet_setup_timeout_suppressed")
    expect(page).toContain("needsUserAuth: coreSetupNeedsUserAuth")
    // Sheet-open state now goes through a staleness-aware helper instead of the raw
    // showAuthFlow boolean directly (production showed showAuthFlow can remain true
    // indefinitely once Dynamic's own UI enters an internal error state).
    expect(page).toContain("dynamicAuthSheetOpen: isDynamicAuthSheetConsideredOpen()")
    expect(page).toContain("profilePostInFlight: Boolean(profilePostInFlightKeyRef.current)")
  })

  it("reads the Dynamic auth sheet state so an open sheet suppresses the timeout", () => {
    expect(page).toContain("showAuthFlow, setShowAuthFlow")
  })

  it("restarts the timeout timers from zero when auth-wait state changes", () => {
    // Both timer effects must re-run (and therefore re-arm with a fresh window)
    // when the merchant finishes or abandons Dynamic native auth.
    expect(page).toContain(
      "}, [pendingSync, finalProvisioningRefreshAttempted, coreSetupNeedsUserAuth, showAuthFlow, profileState, repairInProgress, refreshDynamicWalletRuntime, logWalletCreationStep])"
    )
    expect(page).toContain(
      "}, [pendingSync, finalProvisioningRefreshAttempted, coreSetupNeedsUserAuth, showAuthFlow, profileState, repairInProgress, recordWalletSetupFailure])"
    )
  })

  it("clears needs_user_auth and resets the timeout window when the native user is detected", () => {
    const resumeEffect = page.slice(
      page.indexOf('emitWalletSetupDebugEvent("wallet_native_auth_resume_started"'),
      page.indexOf('emitWalletSetupDebugEvent("wallet_native_auth_resume_core_started"')
    )
    expect(page).toContain("wallet_dynamic_native_user_detected")
    expect(resumeEffect).toContain("pendingWalletProvisionStartedAtRef.current = null")
    expect(resumeEffect).toContain("setWalletSetupFailureReason(null)")
    expect(resumeEffect).toContain("setProvisioningRetryExhausted(false)")
    expect(resumeEffect).toContain("setFinalProvisioningRefreshAttempted(false)")
    expect(resumeEffect).toContain("setPendingSync(true)")
    expect(resumeEffect).toContain("markWalletSetupInProgress()")
    expect(resumeEffect).toContain('emitWalletSetupDebugEvent("wallet_native_auth_resume_timeout_reset", {})')
    // The clear of the parked auth state stays directly before the resume block.
    const detectBlock = page.slice(
      page.indexOf('console.info("[pinetree-wallets] wallet_dynamic_native_user_detected"') - 400,
      page.indexOf('emitWalletSetupDebugEvent("wallet_native_auth_resume_started"')
    )
    expect(detectBlock).toContain("setCoreSetupNeedsUserAuth(false)")
    expect(detectBlock).toContain("nativeFallbackPendingRef.current = false")
  })

  it("resumes core provisioning automatically without another Try Again click", () => {
    expect(page).toContain('refreshDynamicWalletRuntime("native_auth_resume_embedded_wallet_provisioning"')
    expect(page).toContain('emitWalletSetupDebugEvent("wallet_native_auth_resume_core_started", {})')
  })

  it("checks for an existing profile after native auth and opens a ready wallet instead of recreating", () => {
    expect(page).toContain('emitWalletSetupDebugEvent("wallet_native_auth_resume_profile_get_started", {})')
    expect(page).toContain('resolveNativeAuthResumeAction(existingProfile) === "open_existing_ready_wallet"')
    const existingReadyBlock = page.slice(
      page.indexOf('emitWalletSetupDebugEvent("wallet_native_auth_resume_profile_existing_ready"'),
      page.indexOf('emitWalletSetupDebugEvent("wallet_native_auth_resume_core_started"')
    )
    expect(existingReadyBlock).toContain("setWalletOpen(true)")
    expect(existingReadyBlock).toContain("setPendingSync(false)")
    expect(existingReadyBlock).toContain("wallet_wallet_page_opened_after_create")
  })

  it("guards the Speed rerun on native auth resume behind the shared helper", () => {
    expect(page).toContain("shouldRerunSpeedOnNativeAuthResume({")
    expect(page).toContain("speedProvisionInFlight: speedProvisionInFlightRef.current")
    expect(page).toContain("lightningProfileKind: lightningProfileState.kind")
  })

  it("schedules the wallet open and emits create-success events after a successful core profile save", () => {
    const readySaveBlock = page.slice(
      page.indexOf('emitWalletSetupDebugEvent("wallet_core_profile_post_success"'),
      page.indexOf("// Fire rail sync in the background")
    )
    expect(readySaveBlock).toContain('emitWalletSetupDebugEvent("wallet_core_create_success"')
    expect(readySaveBlock).toContain("autoOpenWalletAfterCreateRef.current")
    expect(readySaveBlock).toContain(
      'schedulePineTreeWalletModalOpenAfterProgress("profile_ready_after_create")'
    )
    expect(page).toContain("setWalletOpen(true)")
    expect(page).toContain('emitWalletSetupDebugEvent("wallet_wallet_page_opened_after_create", {})')
  })

  it("only auto-opens the wallet for merchant-initiated attempts, never page-load auto-repair", () => {
    // beginWalletProvisioningAttempt (create/retry) and the native-auth resume set
    // the flag; the stale-profile auto-repair effect must not.
    const autoRepairEffect = page.slice(
      page.indexOf('console.info("[pinetree-wallets] wallet_sync_start", { reason: "stale_profile_auto_repair" })'),
      page.indexOf('logWalletCreationStep("wallets_detected", { reason: "stale_profile_auto_repair" })')
    )
    expect(autoRepairEffect).not.toContain("autoOpenWalletAfterCreateRef.current = true")
    expect(page).toContain("autoOpenWalletAfterCreateRef.current = true")
  })

  it("does not park external-JWT-rejected setup in native auth", () => {
    const rejectedBlock = page.slice(
      page.indexOf('emitWalletSetupDebugEvent("wallet_dynamic_external_jwt_rejected", {})'),
      page.indexOf('setShowAuthFlow(true)')
    )
    expect(rejectedBlock).not.toContain("nativeFallbackPendingRef.current = true")
    expect(rejectedBlock).not.toContain("setCoreSetupNeedsUserAuth(true)")
    expect(rejectedBlock).not.toContain("setPendingSync(true)")
  })

  it("keeps an already-authenticated Dynamic user skipping external JWT during create", () => {
    // startCoreDynamicWallet: an existing Dynamic user goes straight to embedded
    // wallet provisioning + profile save - the same path the native-auth resume uses.
    expect(page).toContain('beginWalletProvisioningAttempt("opening_dynamic", "create_authenticated_dynamic_user")')
  })

  it("whitelists every native-auth resume beacon event server-side", () => {
    for (const event of [
      "wallet_native_auth_resume_started",
      "wallet_native_auth_resume_timeout_reset",
      "wallet_native_auth_resume_profile_get_started",
      "wallet_native_auth_resume_profile_existing_ready",
      "wallet_native_auth_resume_core_started",
      "wallet_core_create_success",
      "wallet_wallet_page_opened_after_create",
      "wallet_setup_timeout_suppressed",
    ]) {
      expect(eventRoute).toContain(`"${event}"`)
    }
  })
})
