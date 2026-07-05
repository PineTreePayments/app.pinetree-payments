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
    expect(page).toContain("This wallet sign-in does not match your PineTree account email.")
    expect(page).toContain("Use your PineTree account email: {identityMismatchError?.merchantEmail ?? merchantEmail}")
    expect(page).toContain("Switch PineTree Wallet sign-in")
  })

  it("Create PineTree Wallet is hidden while a mismatched Dynamic session is active", () => {
    expect(page).toContain('const showProvisioningRetryOnly = walletSetupPrimaryState === "failed" && Boolean(user)')
    expect(page).toContain('{walletSetupPrimaryState === "email_mismatch" || walletSetupPrimaryState === "email_unverified" ? (')
    expect(page).toContain("Switch PineTree Wallet sign-in")
    const ctaBlock = page.slice(
      page.indexOf('{walletSetupPrimaryState === "email_mismatch" || walletSetupPrimaryState === "email_unverified" ? ('),
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

  it("walletSetupPrimaryState resolves in priority order: ready > reconnect > email mismatch > email unverified > stale session > provisioning > repair > failed", () => {
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
      'if (repairOrSetupIncomplete) return "repair_needed"',
      'if (walletCreationStep === "failed" || walletCreationStep === "timeout") return "failed"',
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
    expect(bannerChain).toContain(') : walletSetupPrimaryState === "repair_needed" ? (')
    expect(bannerChain).toContain(") : null}")
  })

  it("ready profile suppresses the generic failed/timeout message, Try again, and every problem banner", () => {
    expect(page).toContain(
      '(walletSetupPrimaryState === "provisioning" || walletSetupPrimaryState === "failed")\n      ? walletCreationStepMessage(walletCreationStep)\n      : ""'
    )
    const messageBlock = page.slice(
      page.indexOf("{walletCreationMessage ? ("),
      page.indexOf("{/* Temporary diagnostics")
    )
    expect(messageBlock).toContain("Try again")
    // dynamicProfileReady resolves to "ready" first, so none of the later branches
    // (reconnect/mismatch/unverified/repair/failed) can ever also be true.
    expect(page).toContain('if (dynamicProfileReady) return "ready"')
  })

  it("ready profile suppresses showProvisioningRetryOnly", () => {
    expect(page).toContain('const showProvisioningRetryOnly = walletSetupPrimaryState === "failed" && Boolean(user)')
  })

  it("ready profile suppresses the temporary diagnostics panel outside of the debug flag", () => {
    expect(page).toContain('showProfileSyncDebugPanel && walletSetupPrimaryState === "failed"')
  })

  it("ready profile still shows Base/Solana chips and Open PineTree Wallet", () => {
    expect(page).toContain("<EnabledRailChips rows={walletRailRows} />")
    expect(page).toContain(
      '{walletSetupPrimaryState === "repair_needed" ? "Finish PineTree Wallet setup" : "Open PineTree Wallet"}'
    )
    const ctaBlock = page.slice(
      page.indexOf('{walletSetupPrimaryState === "email_mismatch" || walletSetupPrimaryState === "email_unverified" ? ('),
      page.indexOf(") : showProvisioningRetryOnly ? null : (")
    )
    expect(ctaBlock).toContain("hasWallet || repairFailedIncomplete ? (")
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
    expect(page).toContain("This wallet sign-in does not match your PineTree account email.")
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
    const repairIndex = resolverBody.indexOf('if (repairOrSetupIncomplete) return "repair_needed"')
    expect(mismatchIndex).toBeGreaterThan(-1)
    expect(repairIndex).toBeGreaterThan(mismatchIndex)
    // The Repair button only renders inside the repair_needed branch of the CTA chain,
    // which the email_mismatch/email_unverified branch precedes and short-circuits.
    const ctaChain = page.slice(
      page.indexOf('{walletSetupPrimaryState === "email_mismatch" || walletSetupPrimaryState === "email_unverified" ? ('),
      page.indexOf(") : showProvisioningRetryOnly ? null : (")
    )
    const repairButtonIndex = ctaChain.indexOf("Repair PineTree Wallet setup")
    expect(repairButtonIndex).toBeGreaterThan(-1)
    expect(ctaChain).toContain('walletSetupPrimaryState === "repair_needed" ? (')
  })

  it("saved ready profile with no Dynamic session shows reconnect-needed, not setup incomplete", () => {
    const resolverBody = page.slice(
      page.indexOf("const walletSetupPrimaryState = useMemo<WalletSetupPrimaryState>(() => {"),
      page.indexOf("return \"idle\"\n  }, [")
    )
    const reconnectIndex = resolverBody.indexOf('if (hasReadyBaseAndSolanaProfile && !user) return "reconnect_needed"')
    const repairIndex = resolverBody.indexOf('if (repairOrSetupIncomplete) return "repair_needed"')
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
    expect(ctaChain).toContain('walletSetupPrimaryState === "repair_needed" ? "Finish PineTree Wallet setup" : "Open PineTree Wallet"')
  })

  it("badge distinguishes Reconnect needed and Wrong sign-in from Setup incomplete, and rail chips render independently of the badge", () => {
    expect(page).toContain('walletSetupPrimaryState === "reconnect_needed" ? "Reconnect needed" :')
    expect(page).toContain('walletSetupPrimaryState === "email_mismatch" ? "Wrong sign-in" :')
    expect(page).toContain('walletSetupPrimaryState === "email_unverified" ? "Wrong sign-in" :')
    expect(page).toContain('walletSetupPrimaryState === "repair_needed" ? "Setup incomplete" :')
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
      page.indexOf(') : walletSetupPrimaryState === "repair_needed" ? (')
    )
    expect(unverifiedBanner).toContain("handleUsePineTreeAccountEmail")
    expect(unverifiedBanner).toContain("Use PineTree account email")
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
