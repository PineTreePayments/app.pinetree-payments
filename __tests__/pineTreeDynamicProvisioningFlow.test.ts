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
      page.indexOf("function handleOpenWallet()"),
      page.indexOf("async function beginWalletSetupRepair")
    )
    expect(openWalletFn).toContain('console.info("[pinetree-wallets] open_wallet_sync_requested"')
    expect(openWalletFn).toContain("setPendingSync(true)")
    expect(openWalletFn).toContain('refreshDynamicWalletRuntime("open_wallet_sync_profile"')
    expect(page).toContain('console.info("[pinetree-wallets] profile_sync_request"')
    expect(page).toContain("payload: body")
    expect(page).toContain('console.info("[pinetree-wallets] profile_sync_response"')
    expect(page).toContain("profileEndpointResponse")
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
    expect(page).toContain("const showProfileSyncDebugPanel = walletCreationDebugEnabled || walletSyncDebugQueryEnabled")
    expect(page).toContain("{showProfileSyncDebugPanel && profileSyncDiagnostics.updatedAt ?")
    expect(page).not.toContain("{profileSyncDiagnostics.updatedAt ?")
    expect(page).toContain('params.get("pinetree_wallet_debug") === "true"')
  })

  it("raw profile and provider sync JSON is not rendered in merchant UI", () => {
    expect(page).not.toContain("JSON.stringify(profileSyncDiagnostics.profileEndpointResponse")
    expect(page).not.toContain("<pre className=\"mt-2 max-h-32")
  })

  it("ready Dynamic profile renders Ready without requiring Lightning to finish", () => {
    expect(page).toContain('const dynamicProfileReady = profile?.status === "ready" && baseReady && solanaReady && baseSignerReady && solanaSignerReady')
    expect(page).toContain('const walletStatus = repairInProgress ? "Repairing" : walletProvisioningInProgress ? "Provisioning" : dynamicProfileReady ? "Ready"')
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
    expect(page).toContain('const walletStatus = repairInProgress ? "Repairing" : walletProvisioningInProgress ? "Provisioning" : dynamicProfileReady ? "Ready"')
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
    expect(page).toContain('const showProvisioningRetryOnly = (walletCreationStep === "timeout" && Boolean(user)) || Boolean(identityMismatchError)')
    expect(page).toContain(") : showProvisioningRetryOnly ? null : (")
  })

  it("Create PineTree Wallet uses the PineTree merchant email as wallet identity", () => {
    expect(page).toContain("setMerchantEmail(canonicalMerchantEmail)")
    expect(page).toContain("normalizeIdentityEmail(sessionUser.email)")
    expect(page).toContain("Using your PineTree account email: {merchantEmail}")
    expect(page).toContain("dynamicUserEmail = useMemo(() => extractDynamicUserEmail(user), [user])")
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
    expect(page).toContain("const walletCreationMessage = identityMismatchError ? \"\" : walletCreationStepMessage(walletCreationStep)")
    expect(page).toContain("Use the same email as your PineTree account to create your PineTree Wallet.")
    expect(page).toContain("PineTree account email: {identityMismatchError.merchantEmail}")
    expect(page).toContain("Sign out of the current Dynamic session, then enter your PineTree account email if Dynamic asks again.")
  })

  it("Create PineTree Wallet is hidden while a mismatched Dynamic session is active", () => {
    expect(page).toContain("const showProvisioningRetryOnly = (walletCreationStep === \"timeout\" && Boolean(user)) || Boolean(identityMismatchError)")
    expect(page).toContain("{identityMismatchError ? (")
    expect(page).toContain("Use PineTree account email")
    const ctaBlock = page.slice(
      page.indexOf("{identityMismatchError ? ("),
      page.indexOf(") : hasWallet || repairFailedIncomplete ? (")
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
    const retryFn = page.slice(
      page.indexOf("function handleRetryWalletSetup()"),
      page.indexOf("function handleWithdrawalAssetSelect")
    )
    expect(retryFn).toContain("if (identityMismatchError || (walletIdentityError && user))")
    expect(retryFn).toContain("handleUsePineTreeAccountEmail()")
  })

  it("client maps API dynamic_email_mismatch response to identity mismatch UI", () => {
    expect(page).toContain("function getDynamicEmailMismatchResponse(value: unknown): IdentityMismatchError | null")
    expect(page).toContain('if (row.error !== "dynamic_email_mismatch") return null')
    expect(page).toContain("const mismatchResponse = getDynamicEmailMismatchResponse(responseBody)")
    expect(page).toContain("setIdentityMismatchError(mismatchResponse)")
    expect(page).toContain('skippedReason: "dynamic_email_mismatch"')
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
