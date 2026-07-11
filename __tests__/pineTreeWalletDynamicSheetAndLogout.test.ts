import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8")
}

const page = read("app/dashboard/wallet-setup/page.tsx")
const eventRoute = read("app/api/debug/pinetree-wallet/setup-event/route.ts")

describe("Safe Dynamic wallet-creation error classification is wired into the Base failure event (Part B)", () => {
  it("wallet_dynamic_base_create_failed uses the new classifier and the exact requested field shape", () => {
    const implFn = page.slice(
      page.indexOf("const refreshDynamicWalletRuntimeImpl = useCallback"),
      page.indexOf("// Single-flight wrapper")
    )
    expect(page).toContain('import { classifyDynamicWalletCreationError } from "@/lib/wallets/dynamicWalletCreationError"')
    expect(implFn).toContain("const diagnostic = buildDynamicChainCreateFailureDiagnostic({")
    const builderFn = page.slice(
      page.indexOf("function buildDynamicChainCreateFailureDiagnostic"),
      page.indexOf("function logDynamicWalletClassificationSummary")
    )
    for (const field of [
      "operation",
      "sdkMethod",
      "requestedChain",
      "requestedChainId",
      "errorName",
      "errorCode",
      "errorType",
      "providerStatus",
      "safeReason",
      "authSheetOpen",
      "dynamicUserPresent",
      "waasEnabled",
      "baseNetworkEnabled",
      "runtimeWalletCount",
      "hasBaseCredential",
      "hasBaseRuntimeWallet",
      "hasSolanaCredential",
      "hasSolanaRuntimeWallet",
    ]) {
      expect(builderFn).toContain(field)
    }
    // Never logs a full error object, stack, or arbitrary message.
    expect(builderFn).not.toContain("error.stack")
    expect(builderFn).not.toContain("error.message")
    expect(builderFn).not.toContain("params.error,")
  })

  it("logs a dev-only capabilities snapshot without any identity fields", () => {
    expect(page).toContain("wallet_dynamic_wallet_creation_capabilities")
    for (const field of [
      "createWalletAccountAvailable",
      "createEmbeddedWalletAvailable",
      "initializeWaasAvailable",
      "configuredEvmNetworkPresent",
      "configuredBaseNetworkPresent",
      "configuredSolanaNetworkPresent",
    ]) {
      expect(page).toContain(field)
    }
  })

  it("logs a debug-only per-wallet classification summary with no address/id fields", () => {
    const summaryFn = page.slice(
      page.indexOf("function logDynamicWalletClassificationSummary"),
      page.indexOf("// Dedupes the background rail-sync call")
    )
    for (const field of [
      "connectorKey",
      "chainFamily",
      "networkCount",
      "supportsEvm",
      "supportsBase",
      "supportsSolana",
      "embedded",
      "acceptedAsBase",
      "acceptedAsSolana",
      "rejectionReason",
    ]) {
      expect(summaryFn).toContain(field)
    }
    expect(summaryFn).not.toContain(".address")
    expect(summaryFn).not.toContain("walletId")
  })
})

describe("Dynamic sheet lifecycle is tracked via real SDK events, not just the showAuthFlow boolean (Part E)", () => {
  it("subscribes to authFlowOpen/authFlowClose to track a real open-time signal", () => {
    expect(page).toContain('useDynamicEvents("authFlowOpen", () => {')
    expect(page).toContain('useDynamicEvents("authFlowClose", () => {')
    expect(page).toContain("dynamicAuthSheetOpenedAtRef.current = Date.now()")
    expect(page).toContain("dynamicAuthSheetOpenedAtRef.current = null")
  })

  it("completed information capture (a Dynamic user present at close time) emits sheet_completed", () => {
    const closeHandler = page.slice(
      page.indexOf('useDynamicEvents("authFlowClose", () => {'),
      page.indexOf('useDynamicEvents("logout", () => {')
    )
    expect(closeHandler).toContain("wallet_dynamic_sheet_closed")
    expect(closeHandler).toContain("if (user) {")
    expect(closeHandler).toContain("wallet_dynamic_sheet_completed")
  })

  it("a stale showAuthFlow=true (older than dynamicAuthSheetStaleMs) is cleared for timeout-suppression purposes", () => {
    const helperFn = page.slice(
      page.indexOf("function isDynamicAuthSheetConsideredOpen"),
      page.indexOf("function chainCreateGuardActive")
    )
    expect(helperFn).toContain("const stale = Date.now() - openedAt > dynamicAuthSheetStaleMs")
    expect(helperFn).toContain("wallet_dynamic_sheet_stale_state_cleared")
    expect(helperFn).toContain("return !stale")
    expect(page).toContain("const dynamicAuthSheetStaleMs = 90_000")
    // All three timeout-suppression call sites use the staleness-aware helper now,
    // not the raw boolean directly.
    expect(page).not.toContain("dynamicAuthSheetOpen: Boolean(showAuthFlow)")
    const occurrences = page.split("dynamicAuthSheetOpen: isDynamicAuthSheetConsideredOpen()").length - 1
    expect(occurrences).toBe(3)
  })

  it("new sheet-lifecycle events are whitelisted for the server-visible beacon", () => {
    for (const event of [
      "wallet_dynamic_sheet_opened",
      "wallet_dynamic_sheet_completed",
      "wallet_dynamic_sheet_closed",
      "wallet_dynamic_sheet_stale_state_cleared",
    ]) {
      expect(eventRoute).toContain(`"${event}"`)
    }
  })
})

describe("Log out from the Dynamic sheet now does something visible (Part F)", () => {
  const logoutHandler = page.slice(
    page.indexOf('useDynamicEvents("logout", () => {'),
    page.indexOf("const blockDynamicEmailFallbackAuth = useCallback")
  )

  it("subscribes to Dynamic's own 'logout' event, which fires for both handleLogOut() and Dynamic's internal Log out control", () => {
    expect(page).toContain('useDynamicEvents("logout", () => {')
  })

  it("visibly closes the sheet regardless of whether a setup attempt was active", () => {
    expect(logoutHandler).toContain("setShowAuthFlow(false)")
    expect(logoutHandler).toContain("setShowDynamicUserProfile(false)")
  })

  it("cancels the active setup attempt and clears the persisted in-progress marker, without touching the PineTree/Supabase session", () => {
    expect(logoutHandler).toContain("setPendingSync(false)")
    expect(logoutHandler).toContain("clearWalletSetupInProgress()")
    expect(logoutHandler).toContain("markWalletSetupCancelled()")
    expect(logoutHandler).not.toContain("supabase")
    expect(logoutHandler).not.toContain("router.push")
    expect(logoutHandler).not.toContain("/login")
  })

  it("emits the required logout/cancellation events without logging identity", () => {
    for (const event of [
      "wallet_dynamic_logout_started",
      "wallet_dynamic_logout_complete",
      "wallet_setup_cancelled_from_dynamic",
    ]) {
      expect(logoutHandler).toContain(event)
    }
    expect(logoutHandler).not.toContain("user.email")
    expect(logoutHandler).not.toContain("user.userId")
  })

  it("new logout/cancellation events are whitelisted for the server-visible beacon", () => {
    for (const event of [
      "wallet_dynamic_logout_started",
      "wallet_dynamic_logout_complete",
      "wallet_dynamic_logout_failed",
      "wallet_setup_cancelled_from_dynamic",
    ]) {
      expect(eventRoute).toContain(`"${event}"`)
    }
  })

  it("existing full-logout paths (mismatch recovery) still sign out of Supabase and are untouched by this fix", () => {
    expect(page).toContain("function handleUsePineTreeAccountEmail()")
    const fullLogoutFn = page.slice(
      page.indexOf("function handleUsePineTreeAccountEmail()"),
      page.indexOf("function handleRetryWalletSetup()")
    )
    expect(fullLogoutFn).toContain("void handleLogOut()")
  })
})

describe("Explicit cancellation prevents automatic resume after reload (Part G)", () => {
  it("declares a cancellation marker distinct from the in-progress marker", () => {
    expect(page).toContain('const walletSetupCancelledStoragePrefix = "pinetree_wallet_setup_cancelled:"')
    expect(page).toContain("function markWalletSetupCancelled() {")
    expect(page).toContain("function clearWalletSetupCancelled() {")
    expect(page).toContain("function setupCancelledInThisBrowser() {")
  })

  it("the mount-time resume check treats an explicitly-cancelled setup as not started", () => {
    const mountEffect = page.slice(
      page.indexOf("const setupKey = walletSetupStorageKeyForMerchant(sessionUser.id)"),
      page.indexOf("if (json.profile?.status === \"ready\")")
    )
    expect(mountEffect).toContain("const explicitlyCancelled = Boolean(cancelledKey && window.localStorage.getItem(cancelledKey) === \"true\")")
    expect(mountEffect).toContain('const setupStarted = window.localStorage.getItem(setupKey) === "true" && !explicitlyCancelled')
  })

  it("a new explicit Create/Retry click clears the cancellation marker so the merchant can always retry", () => {
    const kickoffFn = page.slice(
      page.indexOf("function beginWalletProvisioningAttempt"),
      page.indexOf("async function copyAddress")
    )
    expect(kickoffFn).toContain("clearWalletSetupCancelled()")
  })
})
