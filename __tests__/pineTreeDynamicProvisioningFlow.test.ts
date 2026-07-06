import fs from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { buildPineTreeRailReadiness } from "@/lib/pinetreeRailReadiness"

vi.mock("@/database/supabase", () => ({ supabase: {}, supabaseAdmin: null }))

import { deriveProfileStatus } from "@/database/pineTreeWalletProfiles"

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8")
}

const page = read("app/dashboard/wallet-setup/page.tsx")
const profileRoute = read("app/api/wallets/pinetree-profile/route.ts")
const resetSetupRoute = read("app/api/debug/pinetree-wallet/reset-setup/route.ts")
const dynamicProvider = read("components/providers/PineTreeDynamicProvider.tsx")
const walletProfileDb = read("database/pineTreeWalletProfiles.ts")
const railSync = read("engine/pineTreeWalletRailSync.ts")

const pendingProviders = [
  { provider: "solana", enabled: true, status: "pending" },
  { provider: "base", enabled: true, status: "pending" },
  { provider: "lightning_speed", enabled: true, status: "pending" },
]

describe("PineTree Dynamic provisioning flow", () => {
  it("clean profile starts not_created", () => {
    expect(deriveProfileStatus({
      base_address: null,
      solana_address: null,
      bitcoin_lightning_status: "not_configured",
    })).toBe("not_created")
  })

  it("Dynamic provisioning saves Dynamic user id plus Base and Solana addresses", () => {
    expect(page).toContain("dynamic_user_id: user.userId")
    expect(page).toContain("dynamic_email: dynamicUserEmail")
    expect(page).toContain("merchant_email: merchantEmail")
    expect(page).toContain("base_address: baseAddress")
    expect(page).toContain("solana_address: solanaAddress")
    expect(profileRoute).toContain('dynamicUserId: "dynamic_user_id" in body')
    expect(profileRoute).toContain('dynamicEmail: "dynamic_email" in body')
    expect(profileRoute).toContain('baseAddress: "base_address" in body')
    expect(profileRoute).toContain('solanaAddress: "solana_address" in body')
  })

  it("opening PineTree Wallet logs sync checkpoints from browser to route", () => {
    expect(page).toContain("[pinetree-wallets] profile_sync_dynamic_state")
    expect(page).toContain("[pinetree-wallets] profile_sync_request")
    expect(page).toContain("[pinetree-wallets] profile_sync_success")
    expect(page).toContain("[pinetree-wallets] profile_sync_not_called")
    expect(profileRoute).toContain("[pinetree-wallets] profile_route_upsert_success")
    expect(profileRoute).toContain("dynamicUserIdPersisted")
    expect(profileRoute).toContain("baseAddressPersisted")
    expect(profileRoute).toContain("solanaAddressPersisted")
  })

  it("opening PineTree Wallet can sync from Dynamic WaaS credentials after runtime signers hydrate", () => {
    expect(page).toContain("const waasCredentialWalletSources = useMemo")
    expect(page).toContain("getWaasWalletsByCredentials().map")
    expect(page).toContain("const waasCredentialSignerWallets = useMemo")
    expect(page).toContain('getWaasWalletConnector(connectorChain)')
    expect(page).toContain("const dynamicAddressSearchList = useMemo")
    expect(page).toContain("extractDynamicWalletAddresses(dynamicAddressSearchList as DynamicWalletAddressSource[])")
    expect(page).toContain('findDynamicApprovalWalletForSourceAsync(dynamicWalletSearchList as unknown[], primaryWallet, "base", baseAddress)')
    expect(page).toContain('findDynamicApprovalWalletForSourceAsync(dynamicWalletSearchList as unknown[], primaryWallet, "solana", solanaAddress)')
  })

  it("Open PineTree Wallet starts browser-to-server profile sync and logs the exact result", () => {
    const openWalletFn = page.slice(
      page.indexOf("async function handleOpenWallet()"),
      page.indexOf("async function beginWalletSetupRepair")
    )
    expect(openWalletFn).toContain('console.info("[pinetree-wallets] open_wallet_sync_requested"')
    expect(openWalletFn).toContain("setPendingSync(true)")
    expect(openWalletFn).toContain('refreshDynamicWalletRuntime("open_wallet_sync_profile"')
    expect(openWalletFn).toContain("setWalletOpen(true)")
    expect(page).toContain('console.info("[pinetree-wallets] profile_sync_request"')
    expect(page).toContain("payload: body")
    expect(page).toContain('console.info("[pinetree-wallets] profile_sync_response"')
    expect(page).toContain("profileEndpointResponse")
  })

  it("first Open PineTree Wallet after Ready refreshes Dynamic runtime before opening the modal", () => {
    const openWalletFn = page.slice(
      page.indexOf("async function handleOpenWallet()"),
      page.indexOf("async function beginWalletSetupRepair")
    )
    const refreshIndex = openWalletFn.indexOf('await refreshDynamicWalletRuntime("open_wallet_sync_profile"')
    const waitIndex = openWalletFn.indexOf("await waitForOpenWalletReadiness()")
    const openIndex = openWalletFn.indexOf("setWalletOpen(true)")
    expect(refreshIndex).toBeGreaterThan(-1)
    expect(waitIndex).toBeGreaterThan(refreshIndex)
    expect(openIndex).toBeGreaterThan(waitIndex)
    expect(openWalletFn).toContain("setWalletOpening(true)")
    expect(openWalletFn).toContain("setWalletOpening(false)")
  })

  it("stale Dynamic runtime on first open retries once automatically before opening", () => {
    const openWalletFn = page.slice(
      page.indexOf("async function handleOpenWallet()"),
      page.indexOf("async function beginWalletSetupRepair")
    )
    expect(openWalletFn).toContain('console.info("[pinetree-wallets] open_wallet_runtime_retry"')
    expect(openWalletFn).toContain('await refreshDynamicWalletRuntime("open_wallet_sync_profile_retry"')
    expect(openWalletFn).toContain("const retryOpenReady = retryRefreshReady && (await waitForOpenWalletReadiness())")
  })

  it("successful open retry opens PineTree Wallet without showing Dynamic recovery", () => {
    const openWalletFn = page.slice(
      page.indexOf("async function handleOpenWallet()"),
      page.indexOf("async function beginWalletSetupRepair")
    )
    const retryReadyIndex = openWalletFn.indexOf("const retryOpenReady = retryRefreshReady && (await waitForOpenWalletReadiness())")
    const failureIndex = openWalletFn.indexOf("if (!retryOpenReady)")
    const openIndex = openWalletFn.lastIndexOf("setWalletOpen(true)")
    expect(retryReadyIndex).toBeGreaterThan(-1)
    expect(failureIndex).toBeGreaterThan(retryReadyIndex)
    expect(openIndex).toBeGreaterThan(failureIndex)
    expect(page).not.toContain("Let's try that again")
    expect(page).not.toContain("setup didn't finish all the way")
  })

  it("failed open runtime retry maps to PineTree-controlled Reconnect needed", () => {
    const openWalletFn = page.slice(
      page.indexOf("async function handleOpenWallet()"),
      page.indexOf("async function beginWalletSetupRepair")
    )
    expect(openWalletFn).toContain("setOpenWalletReconnectNeeded(true)")
    expect(openWalletFn).toContain('recordWalletSetupFailure("dynamic_auth_missing", "failed"')
    expect(page).toContain('if (openWalletReconnectNeeded) return "reconnect_needed"')
    expect(page).toContain("Reconnect PineTree Wallet")
  })

  it("Open PineTree Wallet runtime refresh does not call external link/connect wallet flow", () => {
    const openWalletFn = page.slice(
      page.indexOf("async function handleOpenWallet()"),
      page.indexOf("async function beginWalletSetupRepair")
    )
    expect(openWalletFn).not.toContain("connectWallet(")
    expect(openWalletFn).not.toContain("linkWallet(")
    expect(openWalletFn).not.toContain("setShowDynamicUserProfile(true)")
  })

  it("Ready state remains visible while Opening PineTree Wallet runs", () => {
    expect(page).toContain('walletSetupPrimaryState === "ready" ? "Ready" :')
    expect(page).toContain('{walletOpening ? "Opening PineTree Wallet..." : "Open PineTree Wallet"}')
    expect(page).not.toContain('walletOpening ? "Opening" : walletSetupPrimaryState === "ready"')
  })

  it("successful profile sync clears Saving as soon as the profile is ready", () => {
    const successBranch = page.slice(
      page.indexOf('if (res.ok) {'),
      page.indexOf('console.warn("[pinetree-wallets] profile_sync_failed"')
    )
    expect(successBranch).toContain('if (json.profile.status === "ready")')
    expect(successBranch).toContain("setSyncing(false)")
    expect(successBranch).toContain("setPendingSync(false)")
    expect(successBranch).toContain("void syncPineTreeManagedLightning()")
    expect(successBranch).not.toContain("await syncPineTreeManagedLightning()")
  })

  it("debug panel is hidden in the default merchant UI", () => {
    expect(page).toContain("const showProfileSyncDebugPanel = walletSyncDebugQueryEnabled")
    expect(page).toContain("{showProfileSyncDebugPanel && profileSyncDiagnostics.updatedAt ?")
    expect(page).not.toContain("{profileSyncDiagnostics.updatedAt ?")
    expect(page).toContain('params.get("walletDebug") === "1"')
    expect(page).toContain('params.get("pinetree_wallet_debug") === "true"')
  })

  it("raw profile and provider sync JSON is not rendered in merchant UI", () => {
    expect(page).not.toContain("JSON.stringify(profileSyncDiagnostics.profileEndpointResponse")
    expect(page).not.toContain("<pre className=\"mt-2 max-h-32")
  })

  it("ready Dynamic profile renders Ready without requiring Lightning to finish", () => {
    expect(page).toContain('const dynamicProfileReady = profile?.status === "ready" && baseReady && solanaReady && baseSignerReady && solanaSignerReady')
    expect(page).toContain('if (dynamicProfileReady) return "ready"')
    expect(page).toContain('walletSetupPrimaryState === "ready" ? "Ready" :')
    expect(page).not.toContain('const walletStatus = repairInProgress ? "Repairing" : allPrimaryRailsConnected ? "Ready"')
  })

  it("first-time Dynamic auth with delayed wallet addresses stays in provisioning, not setup incomplete", () => {
    expect(page).toContain('| "provisioning_wallet"')
    expect(page).toContain('if (step === "provisioning_wallet") return "Creating your PineTree Wallet..."')
    expect(page).toContain("Securing Base and Solana wallet addresses... This usually takes a few seconds.")
    expect(page).toContain("const walletProvisioningInProgress =")
    expect(page).toContain("const walletSetupIncomplete = hasWallet && dbOnlyWalletProfile && !walletProvisioningInProgress")
    expect(page).toContain("const repairOrSetupIncomplete = (repairFailedIncomplete || walletSetupIncomplete) && !walletProvisioningInProgress")
  })

  it("delayed Base/Solana hydration retries before saving the profile and then clears Preparing/Saving", () => {
    expect(page).toContain("walletProvisioningRetryIntervalMs = 1_800")
    expect(page).toContain("window.setInterval(() => {")
    expect(page).toContain('reason: "dynamic_wallet_hydration_retry"')
    expect(page).toContain('findDynamicApprovalWalletForSourceAsync(dynamicWalletSearchList as unknown[], primaryWallet, "base", baseAddress)')
    expect(page).toContain('findDynamicApprovalWalletForSourceAsync(dynamicWalletSearchList as unknown[], primaryWallet, "solana", solanaAddress)')
    expect(page).toContain('reason: "waiting_for_dynamic_addresses_or_signers"')
    expect(page).toContain("await syncProfileFromDynamic({ autoEnableLightning: true, requireBaseAndSolanaSigners: true })")
    expect(page).toContain('if (json.profile.status === "ready")')
    expect(page).toContain("setSyncing(false)")
    expect(page).toContain("setPendingSync(false)")
  })

  it("missing signer warning is deferred during first-time provisioning and only restored after saved-profile retry exhaustion", () => {
    const timeoutBlock = page.slice(
      page.indexOf("const savedDynamicProfileBeforeProvisioning ="),
      page.indexOf("// --- After Dynamic logout")
    )
    expect(timeoutBlock).toContain("setProvisioningRetryExhausted(true)")
    expect(timeoutBlock).toContain("setRepairFailedIncomplete(repairInProgress || savedDynamicProfileBeforeProvisioning)")
    expect(timeoutBlock).toContain("profileState.profile.dynamic_user_id && profileState.profile.base_address && profileState.profile.solana_address")
  })

  it("Base/Solana connected chips render after delayed hydration is saved", () => {
    expect(page).toContain('walletSetupPrimaryState === "ready" ? "Ready" :')
    expect(page).toContain("setProfileState({ kind: \"loaded\", profile: json.profile })")
    expect(page).toContain("void fetch(\"/api/wallets/pinetree-wallet/rail-sync\"")
    expect(page).toContain("configured: baseReady, enabled: enabledRails.base")
    expect(page).toContain("configured: solanaReady, enabled: enabledRails.solana")
    expect(page).toContain("<EnabledRailChips rows={walletRailRows} />")
  })

  it("first-time Dynamic verification does not use an external link/connect wallet flow", () => {
    const dynamicContextLine = page.slice(
      page.indexOf("const { user, sdkHasLoaded"),
      page.indexOf("} = useDynamicContext()") + "} = useDynamicContext()".length
    )
    expect(dynamicContextLine).not.toContain("connectWallet")
    expect(dynamicContextLine).not.toContain("linkWallet")
    expect(page).toContain("createEmbeddedWallet")
    expect(page).toContain("createWalletAccount")
  })

  it("Create PineTree Wallet does not open Dynamic auth again once Dynamic user is authenticated", () => {
    const createFn = page.slice(
      page.indexOf("function handleCreateWallet()"),
      page.indexOf("function handleRetryWalletSetup()")
    )
    expect(createFn).toContain('refreshDynamicWalletRuntime("create_embedded_wallet_setup"')
    expect(createFn).toContain("if (sdkHasLoaded && user) {")
    expect(createFn).toContain("return\n    }\n    setShowAuthFlow(true)")
  })

  it("Try again during first-time provisioning restarts PineTree polling instead of link-new-wallet auth", () => {
    const retryFn = page.slice(
      page.indexOf("function handleRetryWalletSetup()"),
      page.indexOf("function handleWithdrawalAssetSelect")
    )
    expect(retryFn).toContain('reason: "restart_embedded_wallet_runtime_polling"')
    expect(retryFn).toContain('refreshDynamicWalletRuntime("retry_embedded_wallet_setup"')
    expect(retryFn).toContain("} else {\n        setShowAuthFlow(true)")
  })

  it("no timeout message appears before a final runtime refresh attempt", () => {
    expect(page).toContain("walletProvisioningFinalRefreshGraceMs = 6_000")
    expect(page).toContain("setFinalProvisioningRefreshAttempted(true)")
    expect(page).toContain('refreshDynamicWalletRuntime("final_embedded_wallet_runtime_refresh_before_timeout"')
    const firstTimeoutEffect = page.slice(
      page.indexOf("if (!pendingSync || finalProvisioningRefreshAttempted) return"),
      page.indexOf("useEffect(() => {\n    if (!pendingSync || !finalProvisioningRefreshAttempted) return")
    )
    expect(firstTimeoutEffect).not.toContain('setWalletCreationStep("timeout")')
    const graceTimeoutEffect = page.slice(
      page.indexOf("if (!pendingSync || !finalProvisioningRefreshAttempted) return"),
      page.indexOf("// --- After Dynamic logout")
    )
    expect(graceTimeoutEffect).toContain('setWalletCreationStep("timeout")')
  })

  it("delayed hydration after modal close triggers final refresh and saves profile", () => {
    expect(page).toContain("window.addEventListener(\"focus\", refreshAfterDynamicModalChange)")
    expect(page).toContain("document.addEventListener(\"visibilitychange\", refreshAfterDynamicModalChange)")
    expect(page).toContain('reason: "dynamic_modal_closed_or_page_visible_runtime_recheck"')
    expect(page).toContain('refreshDynamicWalletRuntime("dynamic_modal_close_runtime_recheck"')
    expect(page).toContain("pendingProfileSyncAttemptRef.current = false")
  })

  it("ready profile clears timeout/error state even if timeout was previously pending", () => {
    const readyCleanupEffect = page.slice(
      page.indexOf("if (!dynamicProfileReady) return"),
      page.indexOf("// ---------------------------------------------------------------------------\n  // Actions")
    )
    expect(readyCleanupEffect).toContain("setPendingSync(false)")
    expect(readyCleanupEffect).toContain("setSyncing(false)")
    expect(readyCleanupEffect).toContain("setRepairFailedIncomplete(false)")
    expect(readyCleanupEffect).toContain("setProvisioningRetryExhausted(false)")
    expect(readyCleanupEffect).toContain("setFinalProvisioningRefreshAttempted(false)")
    expect(readyCleanupEffect).toContain('setWalletIdentityError("")')
    expect(readyCleanupEffect).toContain("clearWalletSetupInProgress()")
    expect(readyCleanupEffect).toContain('setWalletCreationStep("profile_synced")')
  })

  it("authenticated timeout state hides the Create button and leaves only PineTree retry", () => {
    expect(page).toContain('const showProvisioningRetryOnly = walletSetupPrimaryState === "failed" && Boolean(user)')
    expect(page).toContain(") : showProvisioningRetryOnly ? null : (")
  })

  it("Create PineTree Wallet uses the PineTree merchant email as wallet identity", () => {
    expect(page).toContain("setMerchantEmail(canonicalMerchantEmail)")
    expect(page).toContain("normalizeIdentityEmail(sessionUser.email)")
    expect(page).toContain("Using your PineTree account email: {merchantEmail}")
    expect(page).toContain("dynamicEmailExtraction = useMemo(() => extractDynamicUserEmail(user), [user])")
    expect(page).toContain("merchant_email: merchantEmail")
    expect(page).toContain("dynamic_email: dynamicUserEmail")
  })

  it("mismatched Dynamic email is rejected before saving a PineTree Wallet profile", () => {
    const identityGuard = page.slice(
      page.indexOf("if (merchantEmail && dynamicUserEmail && dynamicUserEmail !== merchantEmail)"),
      page.indexOf("const body: Record<string, unknown>")
    )
    expect(identityGuard).toContain("dynamic_email_mismatch")
    expect(identityGuard).toContain("Use the same email as your PineTree account to create your PineTree Wallet.")
    expect(identityGuard).toContain("setIdentityMismatchError({ merchantEmail, dynamicEmail: dynamicUserEmail })")
    expect(identityGuard).toContain("clearWalletSetupInProgress()")
    expect(identityGuard).toContain("return null")
    expect(profileRoute).toContain("profile_route_identity_mismatch")
    expect(profileRoute).toContain('error: "dynamic_email_mismatch"')
    expect(profileRoute).toContain("{ status: 409 }")
  })

  it("matching Dynamic email can save profile and is stored for audit/debugging", () => {
    expect(profileRoute).toContain("const merchantEmail = normalizeWalletIdentityEmail(merchant?.email)")
    expect(profileRoute).toContain("bodyMerchantEmail !== merchantEmail || dynamicEmail !== merchantEmail")
    expect(profileRoute).toContain('dynamicEmail: "dynamic_email" in body')
    expect(walletProfileDb).toContain("dynamic_email: string | null")
    expect(walletProfileDb).toContain("dynamic_email: input.dynamicEmail !== undefined")
  })

  it("mismatched Dynamic email shows explicit PineTree account email copy instead of generic timeout copy", () => {
    expect(page).toContain('walletSetupPrimaryState === "provisioning" || walletSetupPrimaryState === "failed")')
    expect(page).toContain("Use the same email as your PineTree account to create your PineTree Wallet.")
    expect(page).toContain("PineTree account email: {identityMismatchError?.merchantEmail ?? merchantEmail}")
    expect(page).toContain("Use PineTree account email")
  })

  it("Create PineTree Wallet is hidden while a mismatched Dynamic session is active", () => {
    expect(page).toContain('const showProvisioningRetryOnly = walletSetupPrimaryState === "failed" && Boolean(user)')
    expect(page).toContain('{walletSetupPrimaryState === "email_mismatch" || walletSetupPrimaryState === "email_unverified" ? (')
    expect(page).toContain("Use PineTree account email")
    const ctaBlock = page.slice(
      page.indexOf('{walletSetupPrimaryState === "email_mismatch" || walletSetupPrimaryState === "email_unverified" ? ('),
      page.indexOf(") : hasWallet ? (")
    )
    expect(ctaBlock).not.toContain("Create PineTree Wallet")
  })

  it("mismatch retry logs out Dynamic and clears the setup marker before restarting", () => {
    const recoveryFn = page.slice(
      page.indexOf("function handleUsePineTreeAccountEmail()"),
      page.indexOf("function handleRetryWalletSetup()")
    )
    expect(recoveryFn).toContain("clearWalletSetupInProgress()")
    expect(recoveryFn).toContain('reason: "restart_after_dynamic_email_mismatch"')
    expect(recoveryFn).toContain("setLogoutPending(true)")
    expect(recoveryFn).toContain("void handleLogOut()")
    expect(recoveryFn).toContain("markWalletSetupInProgress()")
    expect(recoveryFn).toContain("setIdentityMismatchError(null)")
    expect(recoveryFn).toContain("setIdentityUnverified(false)")
    const retryFn = page.slice(
      page.indexOf("function handleRetryWalletSetup()"),
      page.indexOf("function handleWithdrawalAssetSelect")
    )
    expect(retryFn).toContain("if (emailMismatchActive || emailUnverifiedActive || (walletIdentityError && user))")
    expect(retryFn).toContain("handleUsePineTreeAccountEmail()")
  })

  it("client maps API dynamic_email_mismatch response to identity mismatch UI", () => {
    expect(page).toContain("function getDynamicEmailMismatchResponse(value: unknown): IdentityMismatchError | null")
    expect(page).toContain('if (row.error !== "dynamic_email_mismatch") return null')
    expect(page).toContain("const mismatchResponse = getDynamicEmailMismatchResponse(responseBody)")
    expect(page).toContain("setIdentityMismatchError(mismatchResponse)")
    expect(page).toContain('skippedReason: "dynamic_email_mismatch"')
  })

  it("generic wallet setup failure copy is not rendered", () => {
    expect(page).not.toContain("Wallet setup could not finish. Please try again.")
    expect(page).not.toContain("Wallet setup is taking longer than expected. Please try again.")
    expect(page).toContain("function walletSetupFailureMessage(reason: WalletSetupFailureReason | null)")
  })

  it("failed and timeout states always record an explicit walletSetupFailureReason", () => {
    expect(page).toContain("const [walletSetupFailureReason, setWalletSetupFailureReason] = useState<WalletSetupFailureReason | null>(null)")
    expect(page).toContain("function inferWalletSetupFailureReason(): WalletSetupFailureReason")
    expect(page).toContain("recordWalletSetupFailure(inferWalletSetupFailureReason(), \"failed\"")
    expect(page).toContain("setWalletSetupFailureReason(failureReason)")
    expect(page).toContain('console.warn("[pinetree-wallets] setup_failed"')
  })

  it("explicit setup failure reasons map to merchant-facing copy", () => {
    expect(page).toContain('if (reason === "dynamic_auth_missing" || reason === "dynamic_auth_cancelled") return "PineTree Wallet sign-in did not complete."')
    expect(page).toContain('if (reason === "dynamic_email_mismatch") return "Use the same email as your PineTree account to create your PineTree Wallet."')
    expect(page).toContain('if (reason === "dynamic_email_missing" || reason === "dynamic_email_unverified") return "PineTree could not verify the wallet sign-in email."')
    expect(page).toContain('if (reason === "no_dynamic_wallets") return "Dynamic did not return embedded wallet addresses yet."')
    expect(page).toContain('if (reason === "base_address_missing" || reason === "solana_address_missing") return "PineTree could not find the required wallet address."')
    expect(page).toContain('if (reason === "base_signer_missing" || reason === "solana_signer_missing") return "PineTree found the wallet address, but the signer was not restored in this browser session."')
    expect(page).toContain('if (reason === "profile_sync_failed") return "PineTree could not save the wallet profile."')
    expect(page).toContain('if (reason === "provider_sync_failed") return "PineTree saved the wallet profile, but could not activate the payment rails."')
    expect(page).toContain('if (reason === "provisioning_timeout_unknown") return "Wallet setup timed out before PineTree could confirm wallet readiness."')
  })

  it("runtime timeout classifier maps concrete Dynamic readiness gaps", () => {
    const inferFn = page.slice(
      page.indexOf("function inferWalletSetupFailureReason(): WalletSetupFailureReason"),
      page.indexOf("useEffect(() => {\n    if (!pendingSync || finalProvisioningRefreshAttempted) return")
    )
    expect(inferFn).toContain('return "dynamic_email_missing"')
    expect(inferFn).toContain('return "dynamic_email_mismatch"')
    expect(inferFn).toContain('return "no_dynamic_wallets"')
    expect(inferFn).toContain('return "base_address_missing"')
    expect(inferFn).toContain('return "solana_address_missing"')
    expect(inferFn).toContain('return "base_signer_missing"')
    expect(inferFn).toContain('return "solana_signer_missing"')
    expect(inferFn).toContain('return "provisioning_timeout_unknown"')
  })

  it("profile and provider sync failures map to explicit failure reasons", () => {
    expect(page).toContain('recordWalletSetupFailure("profile_sync_failed", "syncing_profile"')
    expect(page).toContain('recordWalletSetupFailure("provider_sync_failed", "syncing_providers"')
    expect(page).toContain("const providerSyncStatus = getProviderSyncStatus(responseBody)")
    expect(page).toContain('if (providerSyncStatus === "failed")')
    expect(page).toContain('walletSetupPrimaryState === "save_needed" ? "Save needed" :')
    expect(page).toContain('walletSetupPrimaryState === "rail_sync_needed" ? "Rail sync needed" :')
  })

  it("Try Again recovery action is selected by failure reason", () => {
    const retryFn = page.slice(
      page.indexOf("function handleRetryWalletSetup()"),
      page.indexOf("function handleWithdrawalAssetSelect")
    )
    expect(retryFn).toContain('retryFailureReason === "dynamic_auth_missing"')
    expect(retryFn).toContain('retryFailureReason === "profile_sync_failed"')
    expect(retryFn).toContain('retryFailureReason === "provider_sync_failed"')
    expect(retryFn).toContain('refreshDynamicWalletRuntime("retry_embedded_wallet_setup"')
    expect(page).toContain("walletSetupFailureRecoveryLabel(walletSetupFailureReason)")
  })

  it("?walletDebug=1 shows safe diagnostics and default UI does not", () => {
    expect(page).toContain('params.get("walletDebug") === "1"')
    expect(page).toContain("const showProfileSyncDebugPanel = walletSyncDebugQueryEnabled")
    expect(page).toContain("attemptId: {walletSetupAttemptId}")
    expect(page).toContain("stage: {walletSetupStage}")
    expect(page).toContain("failureReason: {walletSetupFailureReason || \"none\"}")
    expect(page).toContain("dynamicUserIdPresent: {String(Boolean(profileSyncDiagnostics.dynamicUserId))}")
    expect(page).toContain("extractedBaseAddressPresent: {String(Boolean(profileSyncDiagnostics.extractedBaseAddress))}")
    expect(page).toContain("providerSyncStatus: {profileSyncDiagnostics.providerSyncStatus || \"none\"}")
    expect(page).not.toContain("JSON.stringify(profileSyncDiagnostics)")
  })

  it("Reconnect PineTree Wallet opens Dynamic auth only when no matching session exists yet", () => {
    const openWalletFn = page.slice(
      page.indexOf("async function handleOpenWallet()"),
      page.indexOf("async function beginWalletSetupRepair")
    )
    const noUserBranchStart = openWalletFn.indexOf("if (!user) {")
    const noUserBranchEnd = openWalletFn.indexOf("if (!sdkHasLoaded) {")
    expect(noUserBranchStart).toBeGreaterThan(-1)
    expect(noUserBranchEnd).toBeGreaterThan(noUserBranchStart)
    const noUserBranch = openWalletFn.slice(noUserBranchStart, noUserBranchEnd)
    expect(noUserBranch).toContain("setShowAuthFlow(true)")
    expect(noUserBranch).toContain("return")
    // Once a Dynamic session already exists, control never reaches the auth-opening
    // branch above - it falls straight through to the silent runtime refresh instead.
    const silentRefreshBranch = openWalletFn.slice(noUserBranchEnd)
    expect(silentRefreshBranch).not.toContain("setShowAuthFlow(true)")
    expect(silentRefreshBranch).toContain('await refreshDynamicWalletRuntime("open_wallet_sync_profile"')
    // The Reconnect PineTree Wallet button (reconnect_needed state) invokes this same
    // handler, so a genuinely missing session opens auth, and an existing one doesn't.
    const ctaBlock = page.slice(
      page.indexOf(') : walletSetupPrimaryState === "reconnect_needed" ? ('),
      page.indexOf(') : walletSetupPrimaryState === "failed" || walletSetupPrimaryState === "save_needed"')
    )
    expect(ctaBlock).toContain("onClick={handleOpenWallet}")
  })

  it("existing ready profile plus missing Dynamic session shows Reconnect needed", () => {
    const resolverBody = page.slice(
      page.indexOf("const walletSetupPrimaryState = useMemo<WalletSetupPrimaryState>(() => {"),
      page.indexOf("return \"idle\"\n  }, [")
    )
    expect(resolverBody).toContain('if (hasReadyBaseAndSolanaProfile && !user) return "reconnect_needed"')
    expect(page).toContain("Reconnect your PineTree Wallet to restore secure browser access.")
    expect(page).toContain("Reconnect PineTree Wallet")
  })

  it("existing ready profile plus wrong Dynamic session shows Wrong sign-in", () => {
    expect(page).toContain('walletSetupPrimaryState === "email_mismatch" ? "Wrong sign-in" :')
    expect(page).toContain("This browser is signed into a different wallet session.")
    const ctaBlock = page.slice(
      page.indexOf('{walletSetupPrimaryState === "email_mismatch" || walletSetupPrimaryState === "email_unverified" ? ('),
      page.indexOf(') : walletSetupPrimaryState === "reconnect_needed" ? (')
    )
    expect(ctaBlock).toContain("Switch PineTree Wallet sign-in")
  })

  it("saved addresses but missing signers maps to Reconnect needed, not Setup incomplete", () => {
    expect(page).toContain('if (repairOrSetupIncomplete) return "reconnect_needed"')
    expect(page).not.toContain('walletSetupPrimaryState === "repair_needed" ? "Setup incomplete" :')
    expect(page).toContain("Reconnect your PineTree Wallet to restore secure browser access.")
  })

  it("no copy anywhere reads like setup failed for a saved profile that just needs browser reconnect", () => {
    expect(page).not.toContain("Setup incomplete")
    expect(page).not.toContain("Repair PineTree Wallet setup")
    expect(page).not.toContain("wallet setup failed")
  })

  it("normal merchant notices do not render raw technical debug fields", () => {
    const noticeChain = page.slice(
      page.indexOf('{walletSetupPrimaryState === "reconnect_needed" ? ('),
      page.indexOf("{walletCreationMessage ? (")
    )
    for (const hidden of [
      "dynamic_user_id",
      "signer",
      "profileEndpoint",
      "providerSync",
      "mismatchCheck",
      "embedded wallet signers",
    ]) {
      expect(noticeChain).not.toContain(hidden)
    }
  })

  it("dev/admin reset action clears wallet setup state only", () => {
    expect(resetSetupRoute).toContain("requireAdminFromRequest")
    expect(resetSetupRoute).toContain('deleteForMerchant("pinetree_wallet_profiles", merchantId)')
    expect(resetSetupRoute).toContain('from("merchant_providers")')
    expect(resetSetupRoute).toContain('deleteForMerchant("wallet_balances", merchantId)')
    expect(resetSetupRoute).toContain('"base", "solana", "lightning_speed"')
    expect(resetSetupRoute).toContain('untouched: ["payments", "ledger", "transactions"]')
    expect(resetSetupRoute).not.toContain('from("payments")')
    expect(resetSetupRoute).not.toContain('from("ledger")')
    expect(resetSetupRoute).not.toContain('from("transactions")')
    expect(page).toContain("Reset PineTree Wallet setup")
    expect(page).toContain('fetch("/api/debug/pinetree-wallet/reset-setup"')
  })

  it("walletSetupPrimaryState resolves in priority order: ready > reconnect > wrong sign-in > save/rail sync > provisioning > failed > create", () => {
    const resolverBody = page.slice(
      page.indexOf("const walletSetupPrimaryState = useMemo<WalletSetupPrimaryState>(() => {"),
      page.indexOf("return \"idle\"\n  }, [")
    )
    const order = [
      'if (dynamicProfileReady) return "ready"',
      'if (hasReadyBaseAndSolanaProfile && !user) return "reconnect_needed"',
      'if (emailMismatchActive) return "email_mismatch"',
      'if (emailUnverifiedActive) return "email_unverified"',
      'if (!dynamicSessionMatchesProfile) return "reconnect_needed"',
      'if (walletProvisioningInProgress) return "provisioning"',
      'if (walletSetupFailureReason === "profile_sync_failed") return "save_needed"',
      'if (walletSetupFailureReason === "provider_sync_failed") return "rail_sync_needed"',
      'if (repairOrSetupIncomplete) return "reconnect_needed"',
      'if (walletCreationStep === "failed" || walletCreationStep === "timeout") return "failed"',
      'if (profileState.kind === "none") return "create_wallet"',
    ]
    let cursor = -1
    for (const line of order) {
      expect(resolverBody).toContain(line)
      const index = resolverBody.indexOf(line)
      expect(index).toBeGreaterThan(cursor)
      cursor = index
    }
  })

  it("exactly one problem card renders per walletSetupPrimaryState - never stacked", () => {
    // A single ternary chain keyed on walletSetupPrimaryState replaces what used to be
    // three independent, simultaneously-renderable conditionals (session mismatch,
    // repair-needed, identity chain) - so switching PineTree accounts in the same
    // browser (which used to trip all three at once) can only ever show one banner.
    expect(page).not.toContain("{!dynamicSessionMatchesProfile ? (")
    expect(page).not.toContain("{repairOrSetupIncomplete ? (")
    const bannerChain = page.slice(
      page.indexOf('{walletSetupPrimaryState === "reconnect_needed" ? ('),
      page.indexOf("{walletCreationMessage ? (")
    )
    expect(bannerChain).toContain(') : walletSetupPrimaryState === "email_mismatch" ? (')
    expect(bannerChain).toContain(') : walletSetupPrimaryState === "email_unverified" ? (')
    expect(bannerChain).toContain(') : walletSetupPrimaryState === "save_needed" || walletSetupPrimaryState === "rail_sync_needed" ? (')
    expect(bannerChain).toContain(") : null}")
  })

  it("ready profile suppresses the generic failed/timeout message and every problem banner", () => {
    expect(page).toContain(
      '(walletSetupPrimaryState === "provisioning" || walletSetupPrimaryState === "failed")\n      ? walletCreationStepMessage(walletCreationStep)\n      : ""'
    )
    const messageBlock = page.slice(
      page.indexOf("{walletCreationMessage ? ("),
      page.indexOf("{/* Safe diagnostics")
    )
    expect(messageBlock).not.toContain("Try again")
    // dynamicProfileReady resolves to "ready" first, so none of the later branches
    // (reconnect/mismatch/unverified/save/rail sync/failed) can ever also be true.
    expect(page).toContain('if (dynamicProfileReady) return "ready"')
  })

  it("ready profile suppresses showProvisioningRetryOnly", () => {
    expect(page).toContain('const showProvisioningRetryOnly = walletSetupPrimaryState === "failed" && Boolean(user)')
  })

  it("ready profile suppresses the diagnostics panel outside of the debug query param", () => {
    expect(page).toContain('showProfileSyncDebugPanel && walletSetupPrimaryState === "failed"')
    expect(page).toContain("Safe diagnostics, visible only with ?walletDebug=1")
  })

  it("ready profile still shows Base/Solana chips and Open PineTree Wallet", () => {
    expect(page).toContain("<EnabledRailChips rows={walletRailRows} />")
    const ctaBlock = page.slice(
      page.indexOf('{walletSetupPrimaryState === "email_mismatch" || walletSetupPrimaryState === "email_unverified" ? ('),
      page.indexOf(") : showProvisioningRetryOnly ? null : (")
    )
    expect(ctaBlock).toContain("hasWallet ? (")
    expect(ctaBlock).toContain("Open PineTree Wallet")
  })

  it("a stale failed/timeout step self-corrects once the profile is ready, instead of only clearing on the false->true transition", () => {
    const selfCorrectEffect = page.slice(
      page.indexOf("// Defense in depth: the effect above only fires"),
      page.indexOf("}, [dynamicProfileReady, walletCreationStep])") + "}, [dynamicProfileReady, walletCreationStep])".length
    )
    expect(selfCorrectEffect).toContain("if (!dynamicProfileReady) return")
    expect(selfCorrectEffect).toContain('if (walletCreationStep !== "failed" && walletCreationStep !== "timeout") return')
    expect(selfCorrectEffect).toContain('setWalletCreationStep("profile_synced")')
    expect(selfCorrectEffect).toContain("setIdentityMismatchError(null)")
    expect(selfCorrectEffect).toContain("setIdentityUnverified(false)")
  })

  it("mismatch warning (ready or not) only shows when the live Dynamic session actually conflicts with the merchant email", () => {
    expect(page).toContain("const liveEmailMismatch =")
    expect(page).toContain("Boolean(user) && Boolean(merchantEmail) && Boolean(dynamicUserEmail) && dynamicUserEmail !== merchantEmail")
    expect(page).toContain("const emailMismatchActive = Boolean(identityMismatchError) || liveEmailMismatch")
    expect(page).toContain("Use the same email as your PineTree account to create your PineTree Wallet.")
  })

  it("email mismatch outranks the saved-address missing-signer warning and the repair button", () => {
    // emailMismatchActive is checked before repairOrSetupIncomplete in the resolver, so a
    // profile with saved addresses but the wrong Dynamic session never shows "setup
    // incomplete" / Repair - it shows the mismatch card instead.
    const resolverBody = page.slice(
      page.indexOf("const walletSetupPrimaryState = useMemo<WalletSetupPrimaryState>(() => {"),
      page.indexOf("return \"idle\"\n  }, [")
    )
    const mismatchIndex = resolverBody.indexOf('if (emailMismatchActive) return "email_mismatch"')
    const repairIndex = resolverBody.indexOf('if (repairOrSetupIncomplete) return "reconnect_needed"')
    expect(mismatchIndex).toBeGreaterThan(-1)
    expect(repairIndex).toBeGreaterThan(mismatchIndex)
    const mismatchBranch = page.slice(
      page.indexOf('{walletSetupPrimaryState === "email_mismatch" || walletSetupPrimaryState === "email_unverified" ? ('),
      page.indexOf(') : walletSetupPrimaryState === "reconnect_needed" ? (')
    )
    expect(mismatchBranch).not.toContain("Repair PineTree Wallet setup")
    expect(mismatchBranch).toContain("Switch PineTree Wallet sign-in")
  })

  it("saved ready profile with no Dynamic session shows reconnect-needed, not setup incomplete", () => {
    const resolverBody = page.slice(
      page.indexOf("const walletSetupPrimaryState = useMemo<WalletSetupPrimaryState>(() => {"),
      page.indexOf("return \"idle\"\n  }, [")
    )
    const reconnectIndex = resolverBody.indexOf('if (hasReadyBaseAndSolanaProfile && !user) return "reconnect_needed"')
    const repairIndex = resolverBody.indexOf('if (repairOrSetupIncomplete) return "reconnect_needed"')
    expect(reconnectIndex).toBeGreaterThan(-1)
    expect(repairIndex).toBeGreaterThan(reconnectIndex)
    expect(page).toContain('walletSetupPrimaryState === "reconnect_needed" ? "Reconnect needed" :')
  })

  it("ready profile with a matching Dynamic session shows Ready and Open PineTree Wallet only", () => {
    expect(page).toContain('walletSetupPrimaryState === "ready" ? "Ready" :')
    const ctaChain = page.slice(
      page.indexOf('{walletSetupPrimaryState === "email_mismatch" || walletSetupPrimaryState === "email_unverified" ? ('),
      page.indexOf(") : showProvisioningRetryOnly ? null : (")
    )
    // When primaryState is "ready", every earlier CTA branch (mismatch/unverified/
    // reconnect) is false, so control falls through to hasWallet's plain Open button
    // with no Repair button alongside it.
    expect(ctaChain).toContain("Open PineTree Wallet")
    expect(ctaChain).toContain("Open PineTree Wallet")
  })

  it("badge distinguishes Reconnect needed, Wrong sign-in, Save needed, and Rail sync needed", () => {
    expect(page).toContain('walletSetupPrimaryState === "reconnect_needed" ? "Reconnect needed" :')
    expect(page).toContain('walletSetupPrimaryState === "email_mismatch" ? "Wrong sign-in" :')
    expect(page).toContain('walletSetupPrimaryState === "email_unverified" ? "Wrong sign-in" :')
    expect(page).toContain('walletSetupPrimaryState === "save_needed" ? "Save needed" :')
    expect(page).toContain('walletSetupPrimaryState === "rail_sync_needed" ? "Rail sync needed" :')
    expect(page).not.toContain('walletSetupPrimaryState === "repair_needed" ? "Setup incomplete" :')
    // EnabledRailChips is rendered unconditionally above the problem-card chain, so it
    // never depends on which (if any) problem state is active.
    const chipsIndex = page.indexOf("<EnabledRailChips rows={walletRailRows} />")
    const bannerChainIndex = page.indexOf('{walletSetupPrimaryState === "reconnect_needed" ? (')
    expect(chipsIndex).toBeGreaterThan(-1)
    expect(bannerChainIndex).toBeGreaterThan(chipsIndex)
  })

  it("Dynamic email extraction covers OAuth credentials, not just direct email-OTP sign-in", () => {
    const extractFn = page.slice(
      page.indexOf("function extractDynamicUserEmail"),
      page.indexOf("function walletSetupStorageKeyForMerchant")
    )
    expect(extractFn).toContain('return { email: directEmail, source: "user.email" }')
    expect(extractFn).toContain('return { email: credentialEmail, source: "verifiedCredentials.email" }')
    expect(extractFn).toContain("toRecord(credential).oauthEmails")
    expect(extractFn).toContain('return { email: normalized, source: "verifiedCredentials.oauthEmails" }')
    expect(extractFn).toContain("toRecord(credential).publicIdentifier")
    expect(extractFn).toContain('return { email: normalized, source: "verifiedCredentials.publicIdentifier" }')
    expect(extractFn).toContain("row.oauthAccounts")
    expect(extractFn).toContain('return { email: accountEmail, source: "oauthAccounts.email" }')
  })

  it("identity check runs before wallet address extraction, signer lookup, and the provisioning timeout", () => {
    const fnStart = page.indexOf("const syncProfileFromDynamic = useCallback(")
    const identityMismatchIndex = page.indexOf(
      "if (merchantEmail && dynamicUserEmail && dynamicUserEmail !== merchantEmail)",
      fnStart
    )
    const identityUnverifiedIndex = page.indexOf("if (!merchantEmail || !dynamicUserEmail) {", fnStart)
    const addressGuardIndex = page.indexOf("dynamicNetworkAddresses.base.length === 0 &&", fnStart)
    const signerLookupIndex = page.indexOf(
      'findDynamicApprovalWalletForSourceAsync(dynamicWalletSearchList as unknown[], primaryWallet, "base", baseAddress)',
      fnStart
    )
    const bodyIndex = page.indexOf("const body: Record<string, unknown>", fnStart)
    expect(fnStart).toBeGreaterThan(-1)
    expect(identityMismatchIndex).toBeGreaterThan(fnStart)
    expect(identityMismatchIndex).toBeLessThan(identityUnverifiedIndex)
    expect(identityUnverifiedIndex).toBeLessThan(addressGuardIndex)
    expect(addressGuardIndex).toBeLessThan(signerLookupIndex)
    expect(signerLookupIndex).toBeLessThan(bodyIndex)
  })

  it("authenticated Dynamic user with no detectable email triggers identity verification error, not generic timeout", () => {
    const fnBody = page.slice(
      page.indexOf("const syncProfileFromDynamic = useCallback("),
      page.indexOf("const body: Record<string, unknown>")
    )
    expect(fnBody).toContain("if (!merchantEmail || !dynamicUserEmail) {")
    expect(fnBody).toContain(
      '"We could not verify that this wallet sign-in matches your PineTree account email."'
    )
    expect(fnBody).toContain("setIdentityUnverified(true)")
    expect(fnBody).toContain(
      'const skippedReason = !merchantEmail ? "missing_pinetree_merchant_email" : "missing_dynamic_user_email"'
    )
    expect(fnBody).not.toContain('logWalletCreationStep("timeout"')
  })

  it("unverifiable Dynamic identity shows dedicated copy instead of the generic wallet timeout card", () => {
    expect(page).toContain(
      "We could not verify that this wallet sign-in matches your PineTree account email."
    )
    expect(page).toContain('Please sign in with your PineTree account email: {merchantEmail || "unknown"}')
    const unverifiedBanner = page.slice(
      page.indexOf(') : walletSetupPrimaryState === "email_unverified" ? ('),
      page.indexOf(') : walletSetupPrimaryState === "failed" ? (')
    )
    const identityCta = page.slice(
      page.indexOf('{walletSetupPrimaryState === "email_mismatch" || walletSetupPrimaryState === "email_unverified" ? ('),
      page.indexOf(') : walletSetupPrimaryState === "reconnect_needed" ? (')
    )
    expect(identityCta).toContain("handleUsePineTreeAccountEmail")
    expect(identityCta).toContain("Use PineTree account email")
  })

  it("identity gate effect stops pendingSync before embedded-wallet polling or the provisioning timeout can start", () => {
    const gateEffect = page.slice(
      page.indexOf("// --- Identity check gate:"),
      page.indexOf("// --- After wallet creation: retry Dynamic hydration")
    )
    expect(gateEffect).toContain("if (!pendingSync || !sdkHasLoaded || !user || !merchantEmail) return")
    expect(gateEffect).toContain("if (dynamicUserEmail && dynamicUserEmail === merchantEmail) return")
    expect(gateEffect).toContain("setPendingSync(false)")
    expect(gateEffect).toContain("setSyncing(false)")
    expect(gateEffect).toContain("clearWalletSetupInProgress()")
    expect(gateEffect).toContain("setIdentityMismatchError({ merchantEmail, dynamicEmail: dynamicUserEmail })")
    expect(gateEffect).toContain("setIdentityUnverified(true)")
    expect(gateEffect).toContain("mismatchCheckRan: true")
    expect(gateEffect).toContain("mismatchBlocked: true")

    const gateEffectIndex = page.indexOf("// --- Identity check gate:")
    const provisioningTimeoutEffectIndex = page.indexOf(
      'logWalletCreationStep("provisioning_wallet", { reason: "dynamic_auth_complete" })'
    )
    expect(gateEffectIndex).toBeGreaterThan(-1)
    expect(gateEffectIndex).toBeLessThan(provisioningTimeoutEffectIndex)
  })

  it("generic timeout step only fires through the pendingSync-gated timer, which the identity gate turns off", () => {
    const graceTimeoutEffect = page.slice(
      page.indexOf("if (!pendingSync || !finalProvisioningRefreshAttempted) return"),
      page.indexOf("// --- After Dynamic logout")
    )
    expect(graceTimeoutEffect).toContain("if (!pendingSync || !finalProvisioningRefreshAttempted) return")
    expect(graceTimeoutEffect).toContain('setWalletCreationStep("timeout")')
    const gateEffect = page.slice(
      page.indexOf("// --- Identity check gate:"),
      page.indexOf("// --- After wallet creation: retry Dynamic hydration")
    )
    expect(gateEffect).toContain("setPendingSync(false)")
  })

  it("generic failed/timeout card shows named diagnostics fields, not raw JSON", () => {
    expect(page).toContain("Setup diagnostics")
    expect(page).toContain('merchantEmail: {merchantEmail || "missing"}')
    expect(page).toContain('dynamicEmailDetected: {dynamicUserEmail || "missing"}')
    expect(page).toContain("dynamicAuthenticated: {String(Boolean(user))}")
    expect(page).toContain("dynamicUserIdPresent: {String(Boolean(user?.userId))}")
    expect(page).toContain('dynamicEmailSource: {dynamicEmailSource || "none"}')
    expect(page).toContain("mismatchCheckRan: {String(Boolean(profileSyncDiagnostics.mismatchCheckRan))}")
    expect(page).toContain("mismatchBlocked: {String(Boolean(profileSyncDiagnostics.mismatchBlocked))}")
    expect(page).not.toContain("JSON.stringify(profileSyncDiagnostics)")
  })

  it("reload during setup resumes provisioning instead of resetting to Create PineTree Wallet", () => {
    expect(page).toContain('walletSetupStoragePrefix = "pinetree_wallet_setup_in_progress:"')
    expect(page).toContain("window.localStorage.getItem(setupKey) === \"true\"")
    expect(page).toContain("setWalletCreationStep(\"provisioning_wallet\")")
    expect(page).toContain("markWalletSetupInProgress()")
    expect(page).toContain("clearWalletSetupInProgress()")
  })

  it("first-time setup and retry do not call Dynamic external wallet linking", () => {
    expect(dynamicProvider).toContain("detectNewWalletsForLinking: false")
    expect(page).not.toContain("connectWallet(")
    expect(page).not.toContain("linkWallet(")
    const retryFn = page.slice(
      page.indexOf("function handleRetryWalletSetup()"),
      page.indexOf("function handleWithdrawalAssetSelect")
    )
    expect(retryFn).toContain('refreshDynamicWalletRuntime("retry_embedded_wallet_setup"')
    expect(retryFn).not.toContain("setShowDynamicUserProfile(true)")
  })

  it("backend route logs merchant resolution and returns the updated merchant id", () => {
    expect(profileRoute).toContain('console.info("[pinetree-wallets] profile_route_post_received"')
    expect(profileRoute).toContain("merchantId,")
    expect(profileRoute).toContain("payload: body")
    expect(profileRoute).toContain("profileMerchantId: profile.merchant_id")
    expect(profileRoute).toContain("syncPineTreeWalletProfileProviders(profile)")
    expect(profileRoute).toContain("providerSync")
    expect(profileRoute).toContain("return NextResponse.json({ profile, merchantId, providerSync })")
  })

  it("profile sync upserts Dynamic Base/Solana provider rows without enabling Lightning readiness", () => {
    expect(profileRoute).toContain("syncPineTreeWalletProfileProviders")
    expect(profileRoute).toContain("providerSync")
    expect(profileRoute).not.toContain("btc_address: profile.btc_address")
  })

  it("profile becomes ready only after required Dynamic addresses exist", () => {
    expect(deriveProfileStatus({
      base_address: "0x1111111111111111111111111111111111111111",
      solana_address: null,
      bitcoin_lightning_status: "ready",
    })).toBe("needs_attention")

    expect(deriveProfileStatus({
      base_address: "0x1111111111111111111111111111111111111111",
      solana_address: "So11111111111111111111111111111111111111112",
      bitcoin_lightning_status: "not_configured",
    })).toBe("ready")

    expect(deriveProfileStatus({
      base_address: "0x1111111111111111111111111111111111111111",
      solana_address: "So11111111111111111111111111111111111111112",
      bitcoin_lightning_status: "pending",
    })).toBe("ready")
  })

  it("provider rows remain pending until current profile addresses exist", () => {
    const missingAddressReadiness = buildPineTreeRailReadiness({
      providers: pendingProviders,
      walletProfile: {
        base_address: null,
        solana_address: null,
      },
    })

    expect(missingAddressReadiness.base.paymentReady).toBe(false)
    expect(missingAddressReadiness.solana.paymentReady).toBe(false)
    expect(missingAddressReadiness.base.reasonCodes).toContain("missing_base_address")
    expect(missingAddressReadiness.solana.reasonCodes).toContain("missing_solana_address")

    const pendingProviderReadiness = buildPineTreeRailReadiness({
      providers: pendingProviders,
      walletProfile: {
        base_address: "0x1111111111111111111111111111111111111111",
        solana_address: "So11111111111111111111111111111111111111112",
      },
    })

    expect(pendingProviderReadiness.base.paymentReady).toBe(false)
    expect(pendingProviderReadiness.solana.paymentReady).toBe(false)
    expect(pendingProviderReadiness.base.reasonCodes).toContain("provider_not_connected")
    expect(pendingProviderReadiness.solana.reasonCodes).toContain("provider_not_connected")
    expect(railSync).toContain("Address not provisioned")
  })

  it("wallet balances do not make a rail ready by themselves", () => {
    const readiness = buildPineTreeRailReadiness({
      providers: [
        { provider: "solana", enabled: true, status: "connected" },
        { provider: "base", enabled: true, status: "connected" },
      ],
      walletProfile: null,
    })

    expect(readiness.solana.paymentReady).toBe(false)
    expect(readiness.base.paymentReady).toBe(false)
    expect(readiness.solana.reasonCodes).toContain("missing_wallet_profile")
    expect(readiness.base.reasonCodes).toContain("missing_wallet_profile")
  })

  it("POS and checkout crypto readiness requires current profile addresses", () => {
    const readiness = buildPineTreeRailReadiness({
      providers: [
        { provider: "solana", enabled: true, status: "connected" },
        { provider: "base", enabled: true, status: "connected" },
      ],
      walletProfile: {
        base_address: null,
        solana_address: null,
      },
    })

    expect(readiness.solana.paymentReady).toBe(false)
    expect(readiness.base.paymentReady).toBe(false)
    expect(readiness.solana.reasonCodes).toContain("missing_solana_address")
    expect(readiness.base.reasonCodes).toContain("missing_base_address")
  })

  it("BTC and Lightning are not created by Dynamic Base/Solana provisioning", () => {
    expect(page).not.toContain("btc_address: bitcoinAddress")
    expect(page).not.toContain("bitcoin_onchain_address: bitcoinAddress")
    expect(profileRoute).toContain("hasBtcAddressInput && normalizedBtcAddress")
    expect(railSync).toContain("Lightning readiness is managed by Speed account status")
    expect(railSync).not.toContain("profile.btc_address")
  })
})
