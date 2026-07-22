import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { resolveWalletIdentity } from "@/lib/walletIdentity"

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8")
}

function compactSource(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\s+/g, " ")
}

describe("PineTree embedded wallet setup", () => {
  const provider = read("components/providers/PineTreeDynamicProvider.tsx")
  const layout = read("app/dashboard/layout.tsx")
  const page = read("app/dashboard/wallet-setup/page.tsx")
  const providerPage = read("app/dashboard/providers/page.tsx")
  const apiRoute = read("app/api/wallets/pinetree-profile/route.ts")
  const withdrawalApiRoute = read("app/api/wallets/pinetree-wallet/withdrawals/route.ts")
  const withdrawalPrepareRoute = read("app/api/wallets/pinetree-wallet/withdrawals/[id]/prepare/route.ts")
  const withdrawalSubmitRoute = read("app/api/wallets/pinetree-wallet/withdrawals/[id]/submit/route.ts")
  const withdrawalEngine = read("engine/withdrawals/walletWithdrawals.ts")
  const withdrawalSigner = read("providers/wallets/withdrawalSigner.ts")
  const dynamicSignerLookup = read("lib/wallets/dynamicSignerLookup.ts")
  const dynamicAuthConfig = read("lib/pinetreeDynamicAuth.ts")
  const merchantAuth = read("lib/api/merchantAuth.ts")
  const merchantsDb = read("database/merchants.ts")
  const dbHelper = read("database/pineTreeWalletProfiles.ts")
  const migration = read("database/migrations/20260622_create_pinetree_wallet_profile.sql")
  const dynamicEmailMigration = read("database/migrations/20260705_add_dynamic_email_to_pinetree_wallet_profiles.sql")
  const withdrawalProductionSchemaMigration = read("database/migrations/20260625_ensure_wallet_withdrawal_requests_production_schema.sql")
  // PineTree-managed Lightning backend files
  const lightningMigration = read("database/migrations/20260622_create_merchant_lightning_profiles.sql")
  const speedConnectMigration = read("database/migrations/20260623_add_speed_connect_fields_to_merchant_lightning_profiles.sql")
  const lightningDbHelper = read("database/merchantLightningProfiles.ts")
  const lightningApiRoute = read("app/api/wallets/lightning/pinetree-managed/route.ts")
  const setupDebugEventRoute = read("app/api/debug/pinetree-wallet/setup-event/route.ts")
  const businessProfileApiRoute = read("app/api/merchant/business-profile/route.ts")
  const businessOwnerProfileApiRoute = read("app/api/merchant/business-owner-profile/route.ts")

  it("keeps legacy email resolution out of the PineTree profile route", () => {
    expect(resolveWalletIdentity({
      merchantEmail: null,
      authEmail: "Owner@Example.com",
      bodyMerchantEmail: "owner@example.com",
      dynamicEmail: "owner@example.com",
    })).toEqual({
      ok: true,
      canonicalEmail: "owner@example.com",
      shouldBackfillMerchantEmail: true,
    })
    expect(apiRoute).not.toContain("backfillMerchantEmailIfMissing")
    expect(apiRoute).not.toContain('"[pinetree-wallets] merchant_email_backfilled"')
    expect(apiRoute).toContain("dynamicExternalUserId !== merchantId")
  })

  it("rejects conflicting merchant, auth, body, and wallet identity emails", () => {
    expect(resolveWalletIdentity({
      merchantEmail: "merchant@example.com",
      authEmail: "other@example.com",
    })).toEqual({ ok: false, code: "wallet_identity_conflict" })
    expect(resolveWalletIdentity({
      merchantEmail: "merchant@example.com",
      authEmail: "merchant@example.com",
      bodyMerchantEmail: "other@example.com",
    })).toEqual({ ok: false, code: "wallet_identity_conflict" })
    expect(resolveWalletIdentity({
      authEmail: "merchant@example.com",
      dynamicEmail: "other@example.com",
    })).toEqual({ ok: false, code: "wallet_identity_conflict" })
  })

  it("rejects only when no canonical account email can be resolved", () => {
    expect(resolveWalletIdentity({
      merchantEmail: null,
      authEmail: null,
      bodyMerchantEmail: "untrusted@example.com",
      dynamicEmail: "untrusted@example.com",
    })).toEqual({ ok: false, code: "wallet_identity_unavailable" })
    expect(apiRoute).not.toContain('"wallet_identity_unavailable"')
    expect(apiRoute).toContain('"dynamic_external_user_missing"')
    expect(apiRoute).toContain("retryable: true")
  })
  const lightningReadinessEngine = read("engine/pineTreeWalletReadiness.ts")
  // connect-return was deleted when merchant-facing Speed Connect was removed.
  // Tests below assert it is absent instead of reading it.
  const speedConnectReturnRouteExists = (() => {
    const fs = require("node:fs")
    const path = require("node:path")
    return fs.existsSync(path.join(process.cwd(), "app/api/wallets/lightning/speed/connect-return/route.ts"))
  })()
  const speedConnectedAccountHelper = read("providers/lightning/speedConnectedAccounts.ts")
  const speedClient = read("providers/lightning/speedClient.ts")
  const speedAdapter = read("providers/lightning/speedAdapter.ts")
  const paymentsRoute = read("app/api/payments/route.ts")
  const packageJson = JSON.parse(read("package.json")) as { dependencies: Record<string, string> }

  // -------------------------------------------------------------------------
  // Infrastructure wiring
  // -------------------------------------------------------------------------

  it("loads wallet infrastructure only around the authenticated dashboard", () => {
    expect(layout).toContain("<PineTreeDynamicProvider>")
    expect(layout).toContain("</PineTreeDynamicProvider>")
    expect(layout).toContain('/dashboard/wallet-setup')
    expect(provider).toContain("NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID")
    expect(provider).toContain('appName: "PineTree Wallet"')
    expect(provider).toContain("getPineTreeDynamicAuthConfig")
    expect(dynamicAuthConfig).toContain("NEXT_PUBLIC_PINETREE_DYNAMIC_EMAIL_FALLBACK")
    expect(dynamicAuthConfig).toContain("generic login/signup sheet")
  })

  it("registers EVM, Solana, and Bitcoin wallet connectors without Spark", () => {
    expect(provider).toContain("EthereumWalletConnectors")
    expect(provider).toContain("SolanaWalletConnectors")
    expect(provider).toContain("BitcoinWalletConnectors")
    expect(provider).not.toContain("SparkWalletConnectors")
  })

  // -------------------------------------------------------------------------
  // Merchant wallet ownership — DB profile as source of truth
  // -------------------------------------------------------------------------

  it("presents one merchant PineTree Wallet profile", () => {
    expect(page).toContain("<h1 className={dashboardPageTitleClass}>Merchant Wallet</h1>")
    expect(page).not.toContain('title="MERCHANT WALLET"')
    expect(page).not.toContain(">PineTree Wallet</h1>")
    expect(page).toContain(">PineTree Wallet</h2>")
    expect(page).not.toContain("One merchant wallet profile")
    expect(page).toContain("Create PineTree Wallet")
    expect(page).toContain("Open PineTree Wallet")
    expect(page).not.toContain("Sign up with Dynamic")
  })

  it("keeps merchant email checks out of externally authenticated profile ownership", () => {
    expect(page).toContain("setMerchantEmail(canonicalMerchantEmail)")
    expect(page).toContain("extractDynamicUserEmail(user)")
    expect(page).not.toContain("Using your PineTree account email: {merchantEmail}")
    expect(page).not.toContain("PineTree account email: {identityMismatchError?.merchantEmail ?? merchantEmail}")
    expect(apiRoute).toContain("const canonicalMerchant = await getMerchantById(auth.merchantId)")
    expect(apiRoute).toContain("const fallbackMerchant = await getMerchantByAuthUserId(authUserId)")
    expect(apiRoute).toContain("dynamicExternalUserId !== merchantId")
    expect(apiRoute).not.toContain("resolveWalletIdentity")
    expect(apiRoute).not.toContain("bodyMerchantEmail")
    expect(dbHelper).toContain("dynamic_email: string | null")
    expect(dynamicEmailMigration).toContain("ADD COLUMN IF NOT EXISTS dynamic_email TEXT")
  })

  it("resolves wallet profile merchant identity from auth-owned merchant, not client or email identity", () => {
    expect(merchantAuth).toContain("authUserId: authData.user.id")
    expect(merchantsDb).toContain("user_id")
    expect(merchantsDb).toContain("owner_user_id")
    expect(merchantsDb).toContain("getMerchantByAuthUserId")
    expect(apiRoute).toContain("resolveProfileMerchant(auth)")
    expect(apiRoute).toContain("getMerchantById(auth.merchantId)")
    expect(apiRoute).toContain("getMerchantByAuthUserId(authUserId)")
    expect(apiRoute).toContain("requestMerchantId = normalizedString(body.merchant_id)")
    expect(apiRoute).not.toContain("merchantId = requestMerchantId")
    expect(apiRoute).not.toContain("merchantId === authUserId")
  })

  it("fresh canonical merchant can load a missing PineTree wallet profile as not_created", () => {
    expect(apiRoute).toContain("const canonicalMerchant = await getMerchantById(auth.merchantId)")
    expect(apiRoute).toContain("canonicalMerchantResolved: true")
    expect(apiRoute).toContain('status: profile ? profile.status : "not_created"')
    expect(apiRoute).toContain("profile,")
    expect(apiRoute).toContain("wallet_profile_get_missing")
  })

  it("GET and POST share the same profile merchant resolver and do not require user_id when canonical resolution works", () => {
    const postRoute = apiRoute.slice(apiRoute.indexOf("export async function POST"), apiRoute.indexOf("/**\n * GET"))
    const getRoute = apiRoute.slice(apiRoute.indexOf("export async function GET"))
    expect(postRoute).toContain("resolveProfileMerchant(auth)")
    expect(getRoute).toContain("resolveProfileMerchant(auth)")
    expect(apiRoute).toContain("const canonicalMerchant = await getMerchantById(auth.merchantId)")
    expect(apiRoute).toContain("if (canonicalMerchant) {")
    const canonicalBlock = apiRoute.slice(
      apiRoute.indexOf("if (canonicalMerchant) {"),
      apiRoute.indexOf("const fallbackMerchant = await getMerchantByAuthUserId(authUserId)")
    )
    expect(canonicalBlock).not.toContain("user_id")
    expect(canonicalBlock).not.toContain("owner_user_id")
  })

  it("logs safe boolean diagnostics for profile auth failures", () => {
    expect(apiRoute).toContain('wallet_profile_get_auth_failed')
    expect(apiRoute).toContain("function walletProfileAuthDiagnostics")
    expect(apiRoute).toContain("authUserPresent: boolean")
    expect(apiRoute).toContain("canonicalMerchantResolved: boolean")
    expect(apiRoute).toContain("fallbackMerchantResolved: boolean")
    expect(apiRoute).toContain("merchantOwnershipConfirmed: boolean")
    expect(apiRoute).toContain("status: number")
  })

  it("compares Dynamic externalUserId to merchant id and keeps identity errors distinct from address conflicts", () => {
    expect(page).toContain("getDynamicExternalUserId(user)")
    expect(page).toContain("dynamic_user_id: user.userId")
    expect(page).toContain("dynamic_external_user_id: dynamicExternalUserId")
    expect(apiRoute).toContain("normalizedString(body.dynamic_external_user_id)")
    expect(apiRoute).toContain("dynamicUserId: \"dynamic_user_id\" in body ? dynamicUserId : undefined")
    expect(apiRoute).toContain("dynamicExternalUserId !== merchantId")
    expect(apiRoute).toContain('error: "merchant_not_resolved"')
    expect(apiRoute).toContain('error: reason')
    expect(apiRoute).toContain('reason = requestedMerchantExists ? "merchant_not_owned_by_auth_user" : "merchant_not_resolved"')
    expect(apiRoute).toContain('error: "dynamic_external_user_missing"')
    expect(apiRoute).toContain('error: "dynamic_external_user_merchant_mismatch"')
    expect(apiRoute).toContain('"base_owned_by_other_merchant"')
    expect(apiRoute).toContain('"solana_owned_by_other_merchant"')
    expect(apiRoute).not.toContain('error: "wallet_identity_conflict"')
  })

  it("logs merchant identity diagnostics as safe booleans only", () => {
    const diagnosticsFn = apiRoute.slice(
      apiRoute.indexOf("function profileIdentityDiagnostics"),
      apiRoute.indexOf("async function resolveProfileMerchant")
    )
    const diagnosticsBuild = apiRoute.slice(
      apiRoute.indexOf("const baseIdentityDiagnostics ="),
      apiRoute.indexOf("if (!merchantId)")
    )
    expect(diagnosticsFn).toContain("authUserPresent: boolean")
    expect(diagnosticsFn).toContain("merchantResolved: boolean")
    expect(diagnosticsFn).toContain("merchantBelongsToAuthUser: boolean")
    expect(diagnosticsFn).toContain("requestMerchantIdPresent: boolean")
    expect(diagnosticsFn).toContain("requestMerchantMatchesResolvedMerchant: boolean")
    expect(diagnosticsFn).toContain("dynamicExternalUserIdPresent: boolean")
    expect(diagnosticsFn).toContain("dynamicExternalUserMatchesResolvedMerchant: boolean")
    expect(diagnosticsFn).toContain("profileOwnershipChecksReached: boolean")
    expect(diagnosticsBuild).toContain("Boolean(authUserId)")
    expect(diagnosticsBuild).toContain("Boolean(merchantId)")
    expect(diagnosticsBuild).not.toContain("email")
    expect(diagnosticsBuild).not.toContain("address")
    expect(diagnosticsBuild).not.toContain("token")
  })

  it("non-external Dynamic sessions still block a different Dynamic email before profile POST", () => {
    expect(page).toContain("if (!dynamicSessionExternallyBound && merchantEmail && dynamicUserEmail && dynamicUserEmail !== merchantEmail)")
    expect(page).toContain("return null")
    expect(apiRoute).not.toContain("bodyMerchantEmail")
    expect(apiRoute).toContain('error: "dynamic_external_user_merchant_mismatch"')
    expect(apiRoute).not.toContain("dynamicEmail: body.dynamic_email")
  })

  it("loads the merchant wallet profile from the DB before deciding Create vs Open", () => {
    // Must call /api/wallets/pinetree-profile, not derive state purely from Dynamic session
    expect(page).toContain("/api/wallets/pinetree-profile")
    // Profile state drives the CTA: hasWallet (from DB) not hasAnyAddress (from Dynamic)
    expect(page).toContain("hasWallet")
    expect(page).toContain("profileState")
    // Merchant-profile-derived readiness flags
    expect(page).toContain("profileAddresses")
  })

  it("treats a missing DB wallet profile as new unless a setup marker needs resume", () => {
    expect(page).toContain("if (!json.profile) {")
    expect(page).toContain('emitWalletSetupStageDiagnostic("wallet_create_resume_detected", "resume_missing_profile")')
    expect(page).toContain('setWalletCreationStep("provisioning_wallet")')
    expect(page).toContain('setWalletCreationStep("idle")')
    expect(page).toContain('status: setupStarted ? "resume_missing_profile" : "new_wallet_required"')
    expect(page).toContain('if (profileState.kind === "none" || !profileHasDynamicAddresses) return "create_wallet"')
    expect(page).not.toContain('if (setupStarted && json.profile?.status !== "ready")')
  })

  it("loads merchant profile by PineTree merchant auth without requiring Dynamic auth", () => {
    expect(apiRoute).toContain("const auth = await requireMerchantAuthFromRequest(req)")
    expect(apiRoute).toContain("resolveProfileMerchant(auth)")
    expect(apiRoute).toContain("const profile = await getPineTreeWalletProfile(merchantId)")
    expect(page).toContain('fetch("/api/wallets/pinetree-profile"')
    expect(page).toContain("headers: { Authorization: `Bearer ${token}` }")
    const getRoute = apiRoute.slice(apiRoute.indexOf("export async function GET"), apiRoute.indexOf("/**\n * POST"))
    expect(getRoute).not.toContain("dynamic_user_id")
  })

  it("existing ready wallet profile shows Connected without a Dynamic user session", () => {
    expect(page).toContain("const hasReadyBaseAndSolanaProfile =")
    expect(page).toContain('if (dynamicProfileReady || hasReadyBaseAndSolanaProfile) return "ready"')
    expect(page).toContain('walletSetupPrimaryState === "ready" ? "Connected" :')
    const openWalletFn = page.slice(
      page.indexOf("async function handleOpenWallet()"),
      page.indexOf("async function beginWalletSetupRepair")
    )
    expect(openWalletFn).toContain("if (hasReadyBaseAndSolanaProfile)")
    expect(openWalletFn).toContain("setWalletOpen(true)")
    expect(openWalletFn).toContain('logWalletCreationStep("waiting_for_dynamic_auth"')
  })

  it("withdrawal signing still requires restored Dynamic signer access", () => {
    expect(page).toContain("const dynamicRuntime = await ensureDynamicWalletRuntimeReady(")
    expect(page).toContain("sendDynamicPreparedWithdrawal(prepared as WithdrawalPrepareResponse, dynamicRuntime.wallets, dynamicRuntime.primaryWallet, {")
    expect(page).toContain("findDynamicWalletForSource(wallets, primaryWallet, prepared.sourceAddress, prepared.rail)")
    expect(page).toContain("pineTreeSignerReconnectMessage")
    expect(page).toContain("Reconnect PineTree Wallet to verify secure signing access.")
  })

  it("Dynamic email fallback is temporary and guarded by PineTree identity checks", () => {
    expect(dynamicAuthConfig).toContain("NEXT_PUBLIC_PINETREE_DYNAMIC_EMAIL_FALLBACK")
    expect(dynamicAuthConfig).toContain('rawMode === "external_jwt"')
    expect(dynamicAuthConfig).toContain('rawMode === "dynamic_email_fallback"')
    expect(dynamicAuthConfig).toContain('rawEmailFallback === "true"')
    expect(dynamicAuthConfig).toContain("assertCanOpenDynamicEmailFallbackAuth")
    expect(page).toContain("const dynamicEmailFallbackAllowed =")
    expect(page).toContain("shouldOpenDynamicEmailFallbackAuth(dynamicAuthConfig)")
    expect(page).toContain("blockDynamicEmailFallbackAuth")
    expect(page).toContain("[pinetree-wallets] dynamic_email_fallback_blocked")
    expect(page).toContain("[pinetree-wallets] dynamic_auth_config_invalid")
    expect(dynamicAuthConfig).toContain("PineTree Wallet verification is not configured correctly. Please contact support.")
    expect(page).toContain("dynamicUserEmail !== merchantEmail")
    expect(apiRoute).not.toContain("resolveWalletIdentity")
  })

  it("email fallback disabled without external_jwt shows only a wallet debug warning", () => {
    expect(dynamicAuthConfig).toContain("emailFallbackMisconfigured: !externalJwtConfigured && !emailFallbackEnabled")
    expect(dynamicAuthConfig).toContain("missing_auth_mode")
    expect(dynamicAuthConfig).toContain("invalid_auth_mode")
    expect(dynamicAuthConfig).toContain("email_fallback_not_explicitly_enabled")
    expect(dynamicAuthConfig).toContain("pineTreeDynamicEmailFallbackMisconfiguredWarning")
    expect(dynamicAuthConfig).toContain("Dynamic email fallback is disabled, but PineTree external JWT auth is not configured.")
    expect(page).toContain("const showDynamicAuthMisconfigurationWarning =")
    expect(page).toContain("showProfileSyncDebugPanel && dynamicAuthConfig.emailFallbackMisconfigured")
    expect(page).toContain("pineTreeDynamicEmailFallbackMisconfiguredWarning")
  })

  it("wallet debug mode exposes external JWT auth attempt diagnostics", () => {
    expect(page).toContain("externalJwtEnabled")
    expect(page).toContain("externalJwtIssuerConfigured")
    expect(page).toContain("externalJwtAudienceConfigured")
    expect(page).toContain("externalJwtJwksDerivedFromSigningKey")
    expect(page).toContain("kidConfigured")
    expect(page).toContain("signingKeyConfigured")
    expect(page).toContain("externalJwtEndpointStatus")
    expect(page).toContain("externalJwtErrorCode")
    expect(page).toContain("dynamicExternalAuthAttempted")
    expect(page).toContain("dynamicExternalAuthSucceeded")
    expect(page).toContain("nodeEnv: {dynamicAuthConfig.nodeEnv}")
    expect(page).toContain("clientAuthModeRaw")
    expect(page).toContain("clientAuthModeResolved")
    expect(page).toContain("clientEmailFallbackRaw")
    expect(page).toContain("clientEmailFallbackEnabledResolved")
    expect(page).toContain("clientAuthInvalidReason")
    expect(page).toContain("buildFingerprint")
    expect(page).toContain("publicAppUrl")
    expect(page).toContain("lastWalletAuthAttemptState")
    expect(page).toContain("lastExternalJwtRouteStatus")
    expect(page).toContain("lastExternalJwtFailureCode")
    expect(page).toContain("dynamicEmailFallbackBlocked")
    expect(page).toContain("Wallet auth diagnostics")
    expect(page).toContain("merchantEmailPresent")
    expect(page).not.toContain('merchantEmail: {merchantEmail || "missing"}')
    expect(page).not.toContain("merchantId: {merchantId || \"missing\"}")
    expect(page).not.toContain("dynamicEmailDetected: {dynamicUserEmail || \"missing\"}")
  })

  it("external_jwt mode attempts Dynamic external auth and bypasses the email fallback modal", () => {
    expect(page).toContain("useExternalAuth")
    expect(page).toContain("signInWithExternalJwt")
    expect(dynamicAuthConfig).toContain("export async function requestPineTreeDynamicExternalJwtAuth")
    expect(dynamicAuthConfig).toContain("/api/wallets/dynamic/external-jwt")
    expect(dynamicAuthConfig).toContain("PineTree Supabase user/session")
    expect(dynamicAuthConfig).toContain("PineTree backend issues/verifies JWT for Dynamic")
    expect(dynamicAuthConfig).toContain("Dynamic session initializes for the same PineTree externalUser subject")
    expect(dynamicAuthConfig).toContain("embedded wallet signer restores without merchant typing a second email")
    const openFallbackFn = page.slice(
      page.indexOf("const openDynamicEmailFallbackAuth = useCallback"),
      page.indexOf("const scheduleDynamicEmailFallbackAuth = useCallback")
    )
    expect(openFallbackFn).toContain("if (pineTreeControlledDynamicAuthAvailable)")
    expect(openFallbackFn).toContain("requestPineTreeDynamicExternalJwtAuth(token, { walletDebug: walletSyncDebugQueryEnabled })")
    expect(openFallbackFn).toContain("signInWithExternalJwt({")
    expect(openFallbackFn).toContain("[pinetree-dynamic-auth] external_jwt_client")
    expect(openFallbackFn).toContain("signInWithExternalJwtCalled")
    expect(openFallbackFn).toContain("signInWithExternalJwtSucceeded")
    expect(openFallbackFn).toContain("externalJwt: payload.externalJwt")
    expect(openFallbackFn).toContain("externalUserId: payload.externalUserId")
    expect(openFallbackFn).toContain("setPendingSync(true)")
    expect(openFallbackFn).toContain('logWalletCreationStep("dynamic_authenticated"')
    expect(openFallbackFn).toContain("return false")
    expect(openFallbackFn).toContain("assertCanOpenDynamicEmailFallbackAuth(dynamicAuthConfig)")
    const externalJwtBlock = openFallbackFn.slice(
      openFallbackFn.indexOf("if (pineTreeControlledDynamicAuthAvailable)"),
      openFallbackFn.indexOf("if (!shouldOpenDynamicEmailFallbackAuth(dynamicAuthConfig))")
    )
    expect(externalJwtBlock).not.toContain("setShowAuthFlow(true)")
  })

  it("external_jwt mode logs external auth attempt before any Dynamic email auth path", () => {
    const openFallbackFn = page.slice(
      page.indexOf("const openDynamicEmailFallbackAuth = useCallback"),
      page.indexOf("const scheduleDynamicEmailFallbackAuth = useCallback")
    )

    expect(openFallbackFn).toContain("console.info(\"[pinetree-dynamic-auth] external_jwt_client\"")
    expect(openFallbackFn).toContain("externalJwtAttempted: true")
    expect(openFallbackFn).toContain("endpointStatus")
    expect(openFallbackFn).toContain("endpointErrorCode")
    const externalJwtBlock = openFallbackFn.slice(
      openFallbackFn.indexOf("if (pineTreeControlledDynamicAuthAvailable)"),
      openFallbackFn.indexOf("if (!shouldOpenDynamicEmailFallbackAuth(dynamicAuthConfig))")
    )
    expect(externalJwtBlock).not.toContain("setShowAuthFlow(true)")
  })

  it("emits wallet_dynamic_jwt_response_received right after a successful JWT fetch", () => {
    const openFallbackFn = page.slice(
      page.indexOf("const openDynamicEmailFallbackAuth = useCallback"),
      page.indexOf("const scheduleDynamicEmailFallbackAuth = useCallback")
    )
    const payloadIdx = openFallbackFn.indexOf("const payload = await requestPineTreeDynamicExternalJwtAuth(")
    const responseReceivedIdx = openFallbackFn.indexOf('emitWalletSetupDebugEvent("wallet_dynamic_jwt_response_received"')
    expect(payloadIdx).toBeGreaterThan(-1)
    expect(responseReceivedIdx).toBeGreaterThan(payloadIdx)
    const emitCall = openFallbackFn.slice(responseReceivedIdx, responseReceivedIdx + 260)
    expect(emitCall).toContain("ok: true")
    expect(emitCall).toContain("tokenPresent: Boolean(payload.externalJwt)")
    expect(emitCall).toContain("expiresAtPresent: Boolean(payload.expiresAt)")
  })

  it("missing JWT/token in the response is classified as jwt_missing_token and never calls Dynamic sign-in", () => {
    const openFallbackFn = page.slice(
      page.indexOf("const openDynamicEmailFallbackAuth = useCallback"),
      page.indexOf("const scheduleDynamicEmailFallbackAuth = useCallback")
    )
    const missingTokenIdx = openFallbackFn.indexOf('signinFailureReason = "jwt_missing_token"')
    const signInCalledIdx = openFallbackFn.indexOf("signInWithExternalJwtCalled = true")
    expect(missingTokenIdx).toBeGreaterThan(-1)
    expect(signInCalledIdx).toBeGreaterThan(missingTokenIdx)
    const guardBlock = openFallbackFn.slice(
      openFallbackFn.indexOf("if (!payload.externalJwt || !payload.externalUserId) {"),
      missingTokenIdx + 300
    )
    expect(guardBlock).toContain("throw Object.assign(new Error(\"dynamic_external_jwt_failed\"), { status: 502 })")
  })

  it("calls Dynamic signInWithExternalJwt with the SDK v4.90 argument shape ({ externalJwt, externalUserId })", () => {
    const openFallbackFn = page.slice(
      page.indexOf("const openDynamicEmailFallbackAuth = useCallback"),
      page.indexOf("const scheduleDynamicEmailFallbackAuth = useCallback")
    )
    expect(openFallbackFn).toContain("dynamicProfile = await signInWithExternalJwt({")
    expect(openFallbackFn).toContain("externalJwt: payload.externalJwt")
    expect(openFallbackFn).toContain("externalUserId: payload.externalUserId")
  })

  it("proves response.externalUserId matches JWT sub before calling Dynamic", () => {
    const openFallbackFn = page.slice(
      page.indexOf("const openDynamicEmailFallbackAuth = useCallback"),
      page.indexOf("const scheduleDynamicEmailFallbackAuth = useCallback")
    )
    const guardIdx = openFallbackFn.indexOf("if (!subjectAnalysis.externalUserIdPresent || !subjectAnalysis.externalUserIdMatchesSubject)")
    const callIdx = openFallbackFn.indexOf("dynamicProfile = await signInWithExternalJwt({")
    expect(guardIdx).toBeGreaterThan(-1)
    expect(callIdx).toBeGreaterThan(guardIdx)
    expect(openFallbackFn).toContain("clientExternalUserIdMatchesSubject = subjectAnalysis.externalUserIdMatchesSubject")
    expect(openFallbackFn).toContain('new Error("dynamic_external_user_id_mismatch")')
    expect(openFallbackFn).toContain("clientUsedRouteExternalUserId = true")
  })

  it("uses response.externalUserId directly and does not reconstruct it from email, merchant, or user state", () => {
    const openFallbackFn = page.slice(
      page.indexOf("const openDynamicEmailFallbackAuth = useCallback"),
      page.indexOf("const scheduleDynamicEmailFallbackAuth = useCallback")
    )
    const signInCall = openFallbackFn.slice(
      openFallbackFn.indexOf("dynamicProfile = await signInWithExternalJwt({"),
      openFallbackFn.indexOf("})", openFallbackFn.indexOf("dynamicProfile = await signInWithExternalJwt({")) + 2
    )
    expect(signInCall).toContain("externalUserId: payload.externalUserId")
    expect(signInCall).not.toContain("merchantEmail")
    expect(signInCall).not.toContain("dynamicUserEmail")
    expect(signInCall).not.toContain("merchantId")
    expect(signInCall).not.toContain("user.")
  })

  it("does not immediately fail when signInWithExternalJwt resolves without a profile - it polls refreshDynamicUser for a bounded window first", () => {
    const openFallbackFn = page.slice(
      page.indexOf("const openDynamicEmailFallbackAuth = useCallback"),
      page.indexOf("const scheduleDynamicEmailFallbackAuth = useCallback")
    )
    const returnedIdx = openFallbackFn.indexOf('emitWalletSetupDebugEvent("wallet_dynamic_signin_returned"')
    const noProfileIdx = openFallbackFn.indexOf('if (!dynamicProfile) {', returnedIdx)
    const pollBlock = openFallbackFn.slice(noProfileIdx, noProfileIdx + 800)
    expect(pollBlock).toContain("const pollTimeoutMs = 4000")
    expect(pollBlock).toContain("while (!dynamicProfile && Date.now() - pollStartedAt < pollTimeoutMs)")
    expect(pollBlock).toContain("dynamicProfile = await refreshDynamicUser().catch(() => undefined)")
    // The poll happens before the terminal failure check - it is not an immediate throw.
    const terminalFailureIdx = openFallbackFn.indexOf('signinFailureReason = "dynamic_user_not_available_after_signin"')
    expect(terminalFailureIdx).toBeGreaterThan(noProfileIdx + pollBlock.indexOf("pollTimeoutMs"))
  })

  it("signInWithExternalJwt throwing is caught, classified via classifyDynamicSignInError, and never left unhandled", () => {
    const openFallbackFn = page.slice(
      page.indexOf("const openDynamicEmailFallbackAuth = useCallback"),
      page.indexOf("const scheduleDynamicEmailFallbackAuth = useCallback")
    )
    const signInTryIdx = openFallbackFn.indexOf("dynamicProfile = await signInWithExternalJwt({")
    const catchIdx = openFallbackFn.indexOf("} catch (signInError) {", signInTryIdx)
    expect(catchIdx).toBeGreaterThan(signInTryIdx)
    const catchBlock = openFallbackFn.slice(catchIdx, catchIdx + 1600)
    expect(catchBlock).toContain("const classified = classifyDynamicSignInError(signInError)")
    expect(catchBlock).toContain("signinFailureReason = classified.reason")
    expect(catchBlock).toContain("signinMessageHint = classified.messageHint")
    expect(catchBlock).toContain("signinProviderCode = classified.providerCode")
    expect(catchBlock).toContain("signinSafeProviderMessage = classified.safeProviderMessage")
    expect(catchBlock).toContain("throw signInError")
    // A retryable classification (blocked storage/keychain, SDK not ready, network
    // blip) gets one bounded retry with a state refresh first, not an immediate throw.
    expect(catchBlock).toContain("const canRetry = signInAttempt < maxSignInAttempts && DYNAMIC_SIGNIN_RETRYABLE_HINTS.has(classified.messageHint)")
    expect(catchBlock).toContain("await refreshDynamicUser().catch(() => undefined)")
    // The final classification (and only emission point for wallet_dynamic_signin_failed)
    // happens once in the outer catch, not duplicated at every throw/retry site.
    expect(openFallbackFn).toContain('emitWalletSetupDebugEvent("wallet_dynamic_signin_failed", {')
    expect((openFallbackFn.match(/wallet_dynamic_signin_failed/g) || []).length).toBe(1)
  })

  it("classifyDynamicSignInError never returns raw error.message or stack, only safe short fields", () => {
    const classifierFn = page.slice(
      page.indexOf("function classifyDynamicSignInError("),
      page.indexOf("// A thrown signInWithExternalJwt is retried once")
    )
    expect(classifierFn).not.toContain("message: rawMessage")
    expect(classifierFn).not.toContain("stack")
    expect(classifierFn).toContain("errorName: errorName ? errorName.slice(0, 40) : undefined")
    expect(classifierFn).toContain("errorCode: errorCode ? errorCode.slice(0, 40) : undefined")
    expect(classifierFn).toContain("providerCode: providerCode ? providerCode.slice(0, 40) : undefined")
    expect(classifierFn).toContain("safeProviderMessage,")
    expect(classifierFn).toContain("messageHint,")
    expect(page).toContain("SAFE_DYNAMIC_PROVIDER_MESSAGES")
    expect(classifierFn).toContain("safeDynamicProviderMessage")
    // messageHint is the safe classification derived from the message, not the message itself.
    expect(classifierFn).not.toContain("messageHint: rawMessage")
    expect(classifierFn).not.toContain("messageHint: message")
  })

  it("classifyDynamicSignInError maps JWT/audience/issuer/kid/JWKS/env/storage/network errors to the documented safe enum hints", () => {
    for (const hint of [
      "invalid_jwt",
      "jwt_verification_failed",
      "invalid_audience",
      "invalid_issuer",
      "invalid_kid",
      "jwks_fetch_failed",
      "jwks_key_not_found",
      "environment_mismatch",
      "project_environment_mismatch",
      "external_auth_not_enabled",
      "missing_external_user_id",
      "invalid_argument_shape",
      "network_error",
      "popup_or_storage_blocked",
      "sdk_not_ready",
      "unknown_dynamic_signin_throw",
      "external_auth_rejected",
    ]) {
      expect(page).toContain(hint)
    }
  })

  it("classifies Dynamic's InvalidExternalAuthError (code invalid_external_auth_error) as external_auth_rejected", () => {
    // Confirmed from the installed SDK's clientErrorMapper: an APIError with
    // code "invalid_external_auth" from Dynamic's backend is converted to
    // InvalidExternalAuthError (name) / "invalid_external_auth_error" (code).
    // This means Dynamic's backend was reached and rejected the JWT - most
    // likely an issuer mismatch or BYOA not enabled for this environment,
    // since aud is optional per Dynamic's own docs.
    const classifierFn = page.slice(
      page.indexOf("function classifyDynamicSignInError("),
      page.indexOf("// A thrown signInWithExternalJwt is retried once")
    )
    expect(classifierFn).toContain('errorName === "InvalidExternalAuthError"')
    expect(classifierFn).toContain('errorCode === "invalid_external_auth_error"')
    expect(classifierFn).toContain('errorCode === "invalid_external_auth"')
    expect(classifierFn).toContain('messageHint = "external_auth_rejected"')
    // A genuine backend rejection is a config problem, not a transient one -
    // it must not be in the auto-retry set (retrying would just get rejected again).
    expect(page).toContain("const DYNAMIC_SIGNIN_RETRYABLE_HINTS = new Set([")
    const retryableSetSrc = page.slice(
      page.indexOf("const DYNAMIC_SIGNIN_RETRYABLE_HINTS = new Set(["),
      page.indexOf("])", page.indexOf("const DYNAMIC_SIGNIN_RETRYABLE_HINTS = new Set(["))
    )
    expect(retryableSetSrc).not.toContain("external_auth_rejected")
  })

  it("Create Wallet and Try Again share one orchestrator that starts core Dynamic and Speed tasks concurrently", () => {
    const createFn = page.slice(
      page.indexOf("function handleCreateWallet()"),
      page.indexOf("async function createPineTreeWalletSetup(")
    )
    expect(createFn).toContain("void createPineTreeWalletSetup({ retry: false })")
    const retryFn = page.slice(
      page.indexOf("function handleRetryWalletSetup()"),
      page.indexOf("async function handleResetPineTreeWalletSetup()")
    )
    expect(retryFn).toContain("void createPineTreeWalletSetup({ retry: true })")
    // Neither task waits for the other: both start inside one Promise.allSettled,
    // so the Speed route is called immediately on Create Wallet, and a Speed
    // rejection can never short-circuit core Dynamic wallet creation.
    const orchestratorFn = page.slice(
      page.indexOf("async function createPineTreeWalletSetup("),
      page.indexOf("async function startCoreDynamicWallet(")
    )
    expect(orchestratorFn).toContain("await Promise.allSettled([")
    expect(orchestratorFn).toContain("startCoreDynamicWallet(options),")
    expect(orchestratorFn).toContain("provisionSpeedLightning(),")
    expect(orchestratorFn).toContain('emitWalletSetupDebugEvent("wallet_setup_orchestrator_started"')
    expect(orchestratorFn).toContain('emitWalletSetupDebugEvent("wallet_setup_orchestrator_settled"')
  })

  it("blocks PineTree Wallet creation before Dynamic, profile POST, timers, or Speed when Business Profile is incomplete", () => {
    const createFn = page.slice(
      page.indexOf("function handleCreateWallet()"),
      page.indexOf("// Single orchestrator for Create PineTree Wallet and Try Again.")
    )
    const orchestratorFn = page.slice(
      page.indexOf("async function createPineTreeWalletSetup("),
      page.indexOf("// Kicks off core Dynamic wallet setup")
    )
    const coreFn = page.slice(
      page.indexOf("async function startCoreDynamicWallet("),
      page.indexOf("// Automatic Speed/Lightning provisioning")
    )
    const speedFn = page.slice(
      page.indexOf("async function provisionSpeedLightning("),
      page.indexOf("function handleUsePineTreeAccountEmail()")
    )
    const blockerFn = page.slice(
      page.indexOf("function blockWalletSetupForBusinessProfile("),
      page.indexOf("function beginWalletProvisioningAttempt(")
    )
    const createButtonDisabledIndex = page.indexOf("disabled={businessProfileGateBlocking || syncing || logoutPending || walletCreationInProgress}")
    const createButtonBranch = page.slice(
      page.lastIndexOf("<button", createButtonDisabledIndex),
      page.indexOf("</button>", createButtonDisabledIndex)
    )

    expect(page).toContain('fetch("/api/settings"')
    expect(page).toContain("businessProfileGateReady")
    expect(page).toContain("businessProfileGateBlocking")
    expect(page).toContain("businessProfileCompleteForResume")
    expect(page).toContain("wallet_create_resume_blocked_business_profile_required")
    expect(createFn.indexOf("blockWalletSetupForBusinessProfile")).toBeGreaterThan(-1)
    expect(createFn.indexOf("blockWalletSetupForBusinessProfile")).toBeLessThan(createFn.indexOf("void createPineTreeWalletSetup"))
    expect(orchestratorFn).toContain('blockWalletSetupForBusinessProfile(options.retry ? "retry_pinetree_wallet" : "create_pinetree_wallet")')
    expect(orchestratorFn.indexOf("blockWalletSetupForBusinessProfile")).toBeLessThan(orchestratorFn.indexOf("wallet_setup_orchestrator_started"))
    expect(coreFn).toContain("if (!beginWalletProvisioningAttempt")
    expect(speedFn).toContain('wallet_speed_setup_skipped_business_profile_required')
    expect(blockerFn).toContain('setWalletCreationStep("idle")')
    expect(blockerFn).toContain("setPendingSync(false)")
    expect(blockerFn).toContain("clearWalletSetupInProgress()")
    expect(blockerFn).toContain("walletSetupStartInFlightRef.current = null")
    expect(createButtonBranch).toContain("Create PineTree Wallet")
    expect(createButtonBranch).toContain("disabled={businessProfileGateBlocking || syncing || logoutPending || walletCreationInProgress}")
    expect(createButtonBranch).toContain("businessProfileGateBlocking ? \"Create PineTree Wallet\"")
    expect(createButtonBranch).toContain("bg-[#0052FF]")
    expect(createButtonBranch).not.toContain("Complete Business Profile")
    expect(createButtonBranch.indexOf("businessProfileGateBlocking ? \"Create PineTree Wallet\"")).toBeLessThan(createButtonBranch.indexOf("logoutPending || walletCreationInProgress ? \"Creating PineTree Wallet...\""))
  })

  it("keeps pre-creation merchants with Speed ready in create-wallet state instead of Needs attention", () => {
    const derivedState = page.slice(
      page.indexOf("// Derived state - wallet profile"),
      page.indexOf("// walletStatus is derived from walletSetupPrimaryState")
    )
    const resolverBody = page.slice(
      page.indexOf("const walletSetupPrimaryState = useMemo<WalletSetupPrimaryState>(() => {"),
      page.indexOf("return \"idle\"\n  }, [")
    )
    const setupCardStart = page.indexOf('{showWalletSetupCard ? (')
    const setupCard = page.slice(setupCardStart, page.indexOf("</article>", setupCardStart))

    expect(derivedState).toContain("railReadiness?.bitcoin_lightning.walletProvisioned ??")
    expect(derivedState).toContain('lightningProfileState.kind === "loaded" && lightningProfileState.profile.status === "ready"')
    expect(derivedState).toContain("const hasWallet = profileState.kind === \"loaded\" && (baseReady || solanaReady)")
    expect(derivedState).not.toContain("baseReady || solanaReady || btcPayoutReady || bitcoinReady")
    expect(resolverBody).toContain('if (profileState.kind === "none" || !profileHasDynamicAddresses) return "create_wallet"')
    expect(resolverBody).not.toContain('lightningProfileState.profile.status === "needs_attention"')
    expect(page).toContain('walletSetupPrimaryState === "create_wallet" ? "Create wallet" :')
    expect(page).toContain("directWalletOpenAttemptedRef")
    expect(page).toContain('if (!hasWallet || walletSetupPrimaryState !== "ready" || walletOpen || walletOpening) return')
    expect(page).toContain("void handleOpenWallet()")
    expect(setupCard).not.toContain("hasWallet ? (")
    expect(setupCard).not.toContain("Open PineTree Wallet")
    expect(setupCard).toContain("Create PineTree Wallet")
    expect(setupCard).toContain("disabled={businessProfileGateBlocking || syncing || logoutPending || walletCreationInProgress}")
  })

  it("clicking Create still starts the core orchestrator before any Speed outcome can block it", () => {
    const createFn = page.slice(
      page.indexOf("function handleCreateWallet()"),
      page.indexOf("// Single orchestrator for Create PineTree Wallet and Try Again.")
    )
    const orchestratorFn = page.slice(
      page.indexOf("async function createPineTreeWalletSetup("),
      page.indexOf("// Kicks off core Dynamic wallet setup")
    )
    const coreFn = page.slice(
      page.indexOf("async function startCoreDynamicWallet("),
      page.indexOf("// Automatic Speed/Lightning provisioning")
    )

    expect(createFn).toContain('emitWalletSetupDebugEvent("wallet_create_clicked"')
    expect(createFn).toContain("void createPineTreeWalletSetup({ retry: false })")
    expect(orchestratorFn).toContain('emitWalletSetupDebugEvent("wallet_setup_orchestrator_started"')
    expect(orchestratorFn).toContain("await Promise.allSettled([")
    expect(orchestratorFn).toContain("startCoreDynamicWallet(options),")
    expect(orchestratorFn).toContain("provisionSpeedLightning(),")
    expect(coreFn).toContain('emitWalletSetupDebugEvent("wallet_core_setup_started"')
  })

  it("renders an event-driven four-stage wallet creation progress panel", () => {
    const progressModel = page.slice(
      page.indexOf("type WalletSetupProgressStage ="),
      page.indexOf("function walletSetupFailureMessage(")
    )
    const progressComponent = page.slice(
      page.indexOf("function WalletSetupProgress("),
      page.indexOf("function walletSetupFailureMessage(")
    )
    const progressRender = page.slice(
      page.indexOf("{walletSetupProgressActive ? ("),
      page.indexOf("{dynamicVerificationPromptReason ? (")
    )
    const openingScheduler = page.slice(
      page.indexOf("function schedulePineTreeWalletModalOpenAfterProgress("),
      page.indexOf("function runRailSyncOnceForProfile(")
    )
    const progressLabels = page.slice(
      page.indexOf("const walletSetupProgressStages"),
      page.indexOf("function walletSetupProgressStageForStep(")
    )

    expect(progressModel).toContain('| "preparing"')
    expect(progressModel).toContain('| "connections"')
    expect(progressModel).toContain('| "finalizing"')
    expect(progressModel).toContain('| "opening"')
    expect(progressLabels).toContain('label: "Preparing secure wallet"')
    expect(progressLabels).toContain('label: "Setting up wallet connections"')
    expect(progressLabels).toContain('label: "Finalizing wallet"')
    expect(progressLabels).toContain('label: "Opening PineTree Wallet"')
    expect(progressLabels).toContain("dotIndex: 0")
    expect(progressLabels).toContain("dotIndex: 3")
    expect(progressLabels).not.toContain("Base")
    expect(progressLabels).not.toContain("Solana")
    expect(progressLabels).not.toContain("Bitcoin")
    expect(progressLabels).not.toContain("Speed")

    expect(progressModel).toContain("const walletSetupProgressSubtitleRotationMs = 5_000")
    expect(progressComponent).toContain("window.setInterval")
    expect(progressComponent).toContain("window.clearInterval")
    expect(progressComponent).toContain("setSubtitleIndex")
    expect(progressComponent).not.toContain("setWalletCreationStep")
    expect(progressComponent).not.toContain("setWalletSetupStage")
    expect(progressComponent).toContain("motion-safe:animate-pulse")
    expect(progressComponent).toContain("motion-safe:animate-spin")
    expect(progressComponent).toContain("motion-reduce:animate-none")
    expect(progressComponent).toContain("motion-reduce:transition-none")
    expect(progressComponent).toContain("overflow-hidden")
    expect(progressComponent).toContain("min-w-0")
    expect(progressComponent).toContain("break-words")
    expect(progressComponent).toContain("mt-5 w-full max-w-xl overflow-hidden rounded-xl")
    expect(progressComponent).toContain("border border-blue-100/80 bg-blue-50/80 px-4 py-4")
    expect(progressComponent).toContain("shadow-[0_12px_32px_rgba(0,82,255,0.08)]")
    expect(progressComponent).toContain("sm:px-5 sm:py-5")
    expect(progressComponent).toContain("gap-3.5")
    expect(progressComponent).toContain("h-3 w-3 shrink-0 rounded-full")
    expect(progressComponent).toContain("transition-all duration-300")
    expect(progressComponent).toContain("shadow-[0_0_0_5px_rgba(0,82,255,0.14),0_0_20px_rgba(0,82,255,0.18)]")
    expect(progressComponent).toContain("drop-shadow-[0_0_8px_rgba(0,82,255,0.22)]")
    expect(progressComponent).toContain("text-sm font-semibold leading-5 text-blue-950")
    expect(progressComponent).toContain('aria-label="PineTree Wallet setup progress"')

    expect(progressModel).toContain('input.walletCreationStep === "dynamic_authenticated"')
    expect(progressModel).toContain('input.walletCreationStep === "provisioning_wallet"')
    expect(progressModel).toContain('input.walletCreationStep === "syncing_pinetree_profile"')
    expect(progressModel).toContain('input.walletCreationStep === "profile_synced"')
    expect(progressModel).toContain("if (input.walletSetupOpeningAfterCreate) return \"opening\"")
    expect(progressModel).not.toContain("Date.now()")
    expect(progressModel).not.toContain("setTimeout")

    expect(progressRender).toContain("<WalletSetupProgress")
    expect(progressRender).toContain("stage={walletSetupProgressStage}")
    expect(progressRender).toContain("active={walletSetupProgressActive}")
    expect(page).toContain("walletCreationStep !== \"failed\" &&")
    expect(page).toContain("walletCreationStep !== \"timeout\"")
    expect(page).toContain("clearScheduledWalletOpenAfterCreate()")
    expect(compactSource(page)).toContain("return () => { clearScheduledWalletOpenAfterCreate() }")
    expect(openingScheduler).toContain("setWalletSetupOpeningAfterCreate(true)")
    expect(openingScheduler).toContain("window.setTimeout")
    expect(openingScheduler).toContain("walletSetupOpeningDelayMs")
    expect(openingScheduler).toContain("openPineTreeWalletModalOnce(stage)")
    expect(page).toContain("schedulePineTreeWalletModalOpenAfterProgress(\"profile_ready_after_create\")")
  })

  it("Bitcoin provisioning never throws into or fails core wallet setup", () => {
    const speedFn = page.slice(
      page.indexOf("async function provisionSpeedLightning("),
      page.indexOf("function handleUsePineTreeAccountEmail()")
    )
    expect(speedFn).toContain('fetch("/api/wallets/lightning/pinetree-managed"')
    expect(speedFn).toContain('emitWalletSetupDebugEvent("wallet_speed_setup_started", {})')
    expect(speedFn).toContain('emitWalletSetupDebugEvent("wallet_speed_setup_skipped_business_profile_required", {})')
    expect(speedFn).toContain('emitWalletSetupDebugEvent("wallet_bitcoin_setup_success", {})')
    expect(speedFn).toContain('emitWalletSetupDebugEvent("wallet_bitcoin_setup_pending", {})')
    expect(speedFn).toContain('emitWalletSetupDebugEvent("wallet_bitcoin_setup_failed"')
    expect(speedFn).toContain('return "failed"')
    // Its failure paths only return a status - they never record a core setup
    // failure, flip the core creation step, or clear pendingSync.
    expect(speedFn).not.toContain("recordWalletSetupFailure")
    expect(speedFn).not.toContain('setWalletCreationStep("failed")')
    expect(speedFn).not.toContain("setPendingSync")
    expect(speedFn).not.toContain("throw")
  })

  it("external_auth_rejected suspects stale external identity conflict and never opens Dynamic native auth", () => {
    const openFallbackFn = page.slice(
      page.indexOf("const openDynamicEmailFallbackAuth = useCallback"),
      page.indexOf("const scheduleDynamicEmailFallbackAuth = useCallback")
    )
    const branchIdx = openFallbackFn.indexOf('if (signinMessageHint === "external_auth_rejected") {')
    expect(branchIdx).toBeGreaterThan(-1)
    const branch = openFallbackFn.slice(branchIdx, openFallbackFn.indexOf('logWalletCreationStep("failed", { reason: "dynamic_external_jwt_rejected" })', branchIdx))
    expect(branch).toContain('emitWalletSetupDebugEvent("wallet_dynamic_external_jwt_rejected", {})')
    expect(branch).toContain('emitWalletSetupDebugEvent("wallet_dynamic_external_identity_conflict_suspected"')
    expect(branch).toContain("jwtContractValid: true")
    expect(branch).toContain("emailClaimIncluded")
    expect(branch).toContain("externalUserBindingValid: true")
    expect(branch).toContain("dynamicRejected: true")
    expect(branch).toContain('emitWalletSetupDebugEvent("wallet_dynamic_native_fallback_suppressed"')
    expect(branch).toContain('recordWalletSetupFailure("dynamic_external_jwt_rejected", "failed"')
    expect(branch).not.toContain("const nativeFallbackRecoveryAllowed =")
    expect(branch).not.toContain('emitWalletSetupDebugEvent("wallet_dynamic_native_fallback_started", {})')
    expect(branch).not.toContain("setShowAuthFlow(true)")
  })

  it("native fallback completion resumes core setup automatically and emits wallet_dynamic_native_user_detected", () => {
    expect(page).toContain("if (!user || !nativeFallbackPendingRef.current) return")
    expect(page).toContain('emitWalletSetupDebugEvent("wallet_dynamic_native_user_detected", {})')
    expect(page).toContain("setCoreSetupNeedsUserAuth(false)")
  })

  it("an existing Dynamic user skips external JWT and goes straight to embedded wallet provisioning", () => {
    const coreFn = page.slice(
      page.indexOf("async function startCoreDynamicWallet("),
      page.indexOf("async function provisionSpeedLightning(")
    )
    const userBranchIdx = coreFn.indexOf("if (sdkHasLoaded && user) {", coreFn.indexOf("if (hasStaleDynamicSession && user) {"))
    const externalJwtIdx = coreFn.indexOf('openDynamicEmailFallbackAuth("create_pinetree_wallet")')
    expect(userBranchIdx).toBeGreaterThan(-1)
    expect(externalJwtIdx).toBeGreaterThan(userBranchIdx)
  })

  it("combined readiness maps core and lightning outcomes without lightning demoting a ready core wallet", () => {
    const readinessEffect = page.slice(
      page.indexOf("// syncWalletReadiness: combine the core wallet and Speed/Lightning task outcomes"),
      page.indexOf("const walletRailRows = useMemo")
    )
    expect(readinessEffect).toContain("if (!coreWalletProfileReady) return")
    expect(readinessEffect).toContain('? "wallet_setup_ready"')
    expect(readinessEffect).toContain('? "wallet_setup_lightning_needs_attention"')
    expect(readinessEffect).toContain(': "wallet_setup_pending_lightning"')
    // Core failure has its own event, emitted from the failed-state effect, so a
    // succeeded Speed task never hides a core failure.
    expect(page).toContain('emitWalletSetupDebugEvent("wallet_setup_failed_core"')
  })

  it("native fallback keeps normal merchant UI simple with a Continue setup action", () => {
    expect(page).toContain('coreSetupNeedsUserAuth ? "Continue setup" : walletSetupFailureRecoveryLabel(walletSetupFailureReason)')
    expect(page).toContain('return "Creating PineTree Wallet..."')
    // Merchant-facing copy helpers never mention JWT/BYOA/Speed internals.
    const noticeCopyFn = page.slice(
      page.indexOf("function walletSetupNoticeCopy("),
      page.indexOf("function walletSetupPrimaryNoticeTone(") > -1
        ? page.indexOf("function walletSetupPrimaryNoticeTone(")
        : page.indexOf("function walletSetupNoticeCopy(") + 800
    )
    expect(noticeCopyFn).not.toContain("BYOA")
    expect(noticeCopyFn).not.toContain("JWT")
    expect(noticeCopyFn).not.toContain("Speed")
  })

  it("wallet_dynamic_jwt_authenticated fires before pendingSync flips true, so wallet create/restore only starts after auth succeeds", () => {
    const openFallbackFn = page.slice(
      page.indexOf("const openDynamicEmailFallbackAuth = useCallback"),
      page.indexOf("const scheduleDynamicEmailFallbackAuth = useCallback")
    )
    const authenticatedIdx = openFallbackFn.indexOf('emitWalletSetupDebugEvent("wallet_dynamic_jwt_authenticated"')
    const pendingSyncIdx = openFallbackFn.indexOf("setPendingSync(true)")
    expect(authenticatedIdx).toBeGreaterThan(-1)
    expect(pendingSyncIdx).toBeGreaterThan(authenticatedIdx)
  })

  it("never sends a JWT, token, email, or raw Dynamic error to the debug event route", () => {
    const openFallbackFn = page.slice(
      page.indexOf("const openDynamicEmailFallbackAuth = useCallback"),
      page.indexOf("const scheduleDynamicEmailFallbackAuth = useCallback")
    )
    // Every emitWalletSetupDebugEvent(...) call site's immediate argument window - wide
    // enough to cover the largest call here, narrow enough to not spill into unrelated code.
    const emitStartIndexes: number[] = []
    let searchFrom = 0
    while (true) {
      const idx = openFallbackFn.indexOf("emitWalletSetupDebugEvent(", searchFrom)
      if (idx === -1) break
      emitStartIndexes.push(idx)
      searchFrom = idx + 1
    }
    expect(emitStartIndexes.length).toBeGreaterThan(0)
    for (const idx of emitStartIndexes) {
      const call = openFallbackFn.slice(idx, idx + 260)
      expect(call).not.toContain("payload.externalJwt,")
      expect(call).not.toContain("payload.externalUserId,")
      expect(call).not.toContain("signInError.message")
      expect(call).not.toContain("merchantEmail")
      expect(call).not.toContain("dynamicUserEmail")
    }
  })

  it("external auth failure shows PineTree-controlled copy", () => {
    expect(dynamicAuthConfig).toContain("pineTreeDynamicConfigurationErrorMessage")
    expect(dynamicAuthConfig).toContain("PineTree Wallet verification is not configured correctly. Please contact support.")
    expect(page).toContain("pineTreeDynamicConfigurationErrorMessage")
    expect(page).toContain('"dynamic_external_jwt_failed"')
  })

  it("external_jwt mode does not render manual wallet email entry copy", () => {
    expect(page).not.toContain("Enter Dynamic email")
    expect(page).not.toContain("Enter wallet email")
    expect(page).not.toContain("Use a different wallet email")
    expect(page).not.toContain("Log in or sign up")
  })

  it("fallback Dynamic auth is gated by PineTree-branded wallet verification copy", () => {
    const createFn = page.slice(
      page.indexOf("function handleCreateWallet()"),
      page.indexOf("function handleUsePineTreeAccountEmail()")
    )
    expect(page).toContain('type WalletCreationStep =')
    expect(page).toContain('| "verification_required"')
    expect(page).toContain('if (step === "verification_required") return "Verification required"')
    expect(page).toContain("const requestDynamicVerificationPrompt = useCallback")
    expect(createFn).toContain('if (pineTreeControlledDynamicAuthAvailable) {')
    expect(createFn).toContain('openDynamicEmailFallbackAuth("create_pinetree_wallet")')
    expect(createFn).toContain('requestDynamicVerificationPrompt("create_pinetree_wallet")')
    expect(page).toContain("For security, we need to verify access to your PineTree Wallet before enabling wallet creation and withdrawals.")
    expect(page).toContain("Verify PineTree Wallet access")
    expect(page).not.toContain("Using your PineTree account email: {merchantEmail}")
  })

  it("cancelled Dynamic verification clears pending setup instead of spinning forever", () => {
    expect(page).toContain('useDynamicEvents("authFlowCancelled"')
    expect(page).toContain('console.info("[pinetree-wallets] dynamic_auth_cancelled"')
    expect(page).toContain("setDynamicVerificationPromptReason(null)")
    expect(page).toContain("setPendingSync(false)")
    expect(page).toContain('recordWalletSetupFailure("dynamic_auth_cancelled", "failed"')
    expect(page).toContain('logWalletCreationStep("failed", { reason: "dynamic_auth_cancelled" })')
  })

  it("shows Create PineTree Wallet when no profile exists, not the Dynamic session state", () => {
    // The Create vs Open decision is driven by 'hasWallet' which comes from profileState (DB),
    // not from the raw Dynamic useUserWallets() data
    expect(page).toContain("hasWallet")
    expect(page).toContain('{ kind: "none" }')
    // A new merchant (profileState.kind === "none") should see Create, not the stale Dynamic wallet
    expect(page).toContain("Create PineTree Wallet")
    expect(page).toContain("Open PineTree Wallet")
    // The old pattern that exposed raw Dynamic session state as the CTA guard is removed
    expect(page).not.toContain('{hasAnyAddress ? "Open PineTree Wallet" : "Create PineTree Wallet"}')
  })

  it("only shows wallet addresses that are linked to the current PineTree merchant profile", () => {
    // Addresses rendered in the modal come from DB-backed profile state.
    expect(page).toContain("profileAddresses.base")
    expect(page).toContain("profileAddresses.solana")
    expect(page).toContain("bitcoinPayoutEntries")
    expect(page).toContain("profile.btc_address")
    // Lightning readiness comes from the separate lightningProfile, not from profileAddresses
    expect(page).toContain("lightningProfileState")
    expect(page).toContain("lightningProfile")
    // Raw Dynamic wallet addresses (dynamicNetworkAddresses) are used only for syncing, not for display
    expect(page).toContain("dynamicNetworkAddresses")
    expect(page).not.toContain("networkAddresses.base")
    expect(page).not.toContain("networkAddresses.solana")
  })

  it("detects and blocks a stale Dynamic session from a different PineTree account", () => {
    // dynamicSessionMatchesProfile accepts the externalUser merchant binding stored on the profile.
    expect(page).toContain("dynamicSessionMatchesProfile")
    expect(page).toContain("profile.dynamic_user_id")
    expect(page).toContain("user.userId")
    expect(page).toContain("profile.dynamic_user_id === dynamicExternalUserId")
    // hasStaleDynamicSession guards Create so it doesn't silently reuse the old session
    expect(page).toContain("hasStaleDynamicSession")
    // Reconnect copy is shown to the merchant instead of the old setup-incomplete warning.
    expect(page).toContain("Verify wallet access to continue using secure PineTree Wallet signing.")
    expect(page).toContain("Reconnect PineTree Wallet")
  })

  it("clears a stale Dynamic session before creating a wallet for a new merchant", () => {
    // logoutPending flow: detect stale session → call handleLogOut → wait → open auth flow
    expect(page).toContain("logoutPending")
    expect(page).toContain("handleLogOut")
    expect(page).toContain('logoutPending ? "Creating PineTree Wallet..." : "Try Again"')
  })

  it("wallet status shows Connected from a ready DB profile and keeps signer readiness separate", () => {
    // baseReady and solanaReady come from normalized readiness with DB-backed address fallback
    expect(page).toContain("const baseReady = railReadiness?.base.walletProvisioned ?? profileAddresses.base.length > 0")
    expect(page).toContain("const solanaReady = railReadiness?.solana.walletProvisioned ?? profileAddresses.solana.length > 0")
    expect(page).toContain("const baseSignerReady = Boolean(")
    expect(page).toContain("const solanaSignerReady = Boolean(")
    expect(page).toContain('findDynamicApprovalWalletForSource(wallets as unknown[], primaryWallet, "base", profile.base_address)')
    expect(page).toContain('findDynamicApprovalWalletForSource(wallets as unknown[], primaryWallet, "solana", profile.solana_address)')
    // Bitcoin withdrawal availability is driven by Speed account readiness only -
    // never by the legacy default-payout-destination flag.
    expect(page).toContain("railReadiness?.bitcoin_lightning.walletProvisioned ??")
    expect(page).not.toContain("btcPayoutReady")
    expect(page).not.toContain("const bitcoinReady = bitcoinPayoutEntries.length > 0")
    expect(page).toContain('const coreWalletProfileReady = profile?.status === "ready" && baseReady && solanaReady')
    expect(page).toContain('const dynamicProfileReady = coreWalletProfileReady && baseSignerReady && solanaSignerReady')
    expect(page).toContain('if (dynamicProfileReady || hasReadyBaseAndSolanaProfile) return "ready"')
    expect(page).toContain('walletSetupPrimaryState === "ready" ? "Connected" :')
    expect(page).toContain('if (repairOrSetupIncomplete) return "reconnect_needed"')
    expect(page).toContain('walletSetupPrimaryState === "reconnect_needed" ? "Reconnect needed" :')
  })

  it("syncs Dynamic wallet addresses to the merchant profile on creation only when explicitly triggered", () => {
    // pendingSync is the guard: only set when the merchant explicitly clicks Create
    expect(page).toContain("pendingSync")
    expect(page).toContain("syncProfileFromDynamic")
    expect(page).toContain("extractDynamicWalletAddresses")
    expect(page).toContain("getDynamicWalletSearchList(wallets as unknown[], primaryWallet)")
    // POST to pinetree-profile route includes dynamic_user_id to lock the profile to this session
    expect(page).toContain("dynamic_user_id")
    expect(page).toContain("dynamic_user_id: user.userId")
    // Core profile sync does not start a second client-side Lightning provisioning request.
    expect(page).not.toContain("autoEnableLightning")
    expect(page).not.toContain("syncPineTreeManagedLightning")
  })

  it("tracks wallet creation steps and times out instead of waiting forever", () => {
    expect(page).toContain("type WalletCreationStep")
    // Stage-aware overall deadline: sized to the sum of one hydration attempt, up to
    // two sequential chain creates, and one post-create hydration re-check (74s), plus
    // a grace period, landing within the 75-90s total core-setup budget.
    expect(page).toContain("const walletCreationTimeoutMs =")
    expect(page).toContain("dynamicChainCreateTimeoutMs * 2 +")
    expect(page).toContain("const walletProvisioningFinalRefreshGraceMs = 15_000")
    expect(page).toContain("walletProvisioningRetryIntervalMs = 1_800")
    expect(page).toContain('logWalletCreationStep("waiting_for_dynamic_auth")')
    expect(page).toContain('logWalletCreationStep("provisioning_wallet"')
    expect(page).toContain('setWalletCreationStep("timeout")')
    expect(page).toContain("Wallet setup is taking longer than expected. Please try again.")
    expect(page).toContain('return "Try Again"')
  })

  it("shows one merchant-safe creation state without provisioning details or email", () => {
    expect(page).toContain('return "Creating PineTree Wallet..."')
    expect(page).toContain('"Wallet setup is taking longer than expected. Please try again."')
    expect(page).toContain('return "Try Again"')
    expect(page).not.toContain("Securing Base and Solana wallet addresses")
    expect(page).not.toContain("Using your PineTree account email:")
    expect(page).not.toContain("PineTree account email: {identityMismatchError")
  })

  it("returns the ready wallet profile before background provider provisioning finishes", () => {
    expect(apiRoute).toContain("scheduleWalletReadiness(profile)")
    expect(apiRoute).toContain('const setupStatus = profile.status === "ready" ? "ready" : "pending"')
    expect(apiRoute).toContain("after(async () => {")
    expect(apiRoute).not.toContain("await ensureManagedLightningForMerchant(merchantId)")
    expect(apiRoute).toContain("BACKGROUND_PROVISIONING_TIMEOUT_MS = 12_000")
    expect(apiRoute).toContain('step: "core_profile_saved"')
    expect(apiRoute).toContain('step: "provider_sync_complete"')
    expect(apiRoute).not.toContain('step: "lightning_ensure_start"')
    expect(apiRoute).not.toContain('step: "lightning_ensure_complete"')
    expect(apiRoute).not.toContain("wallet_lightning_background_started")
  })

  it("Business Profile save only persists profile data and never provisions Speed or Lightning", () => {
    expect(businessProfileApiRoute).toContain("saveMerchantBusinessProfile(merchantId, body)")
    expect(businessProfileApiRoute).toContain("return NextResponse.json({ profile })")
    expect(businessProfileApiRoute).not.toContain("ensureManagedLightningForMerchant")
    expect(businessProfileApiRoute).not.toContain("/api/wallets/lightning/pinetree-managed")
    expect(businessProfileApiRoute).not.toContain("wallet_speed_setup_started")
    expect(businessProfileApiRoute).not.toContain("wallet_lightning_auto_provision_complete")

    expect(businessOwnerProfileApiRoute).toContain("updateMerchantBusinessOwnerProfile")
    expect(businessOwnerProfileApiRoute).not.toContain("ensureManagedLightningForMerchant")
    expect(businessOwnerProfileApiRoute).not.toContain("lightning")
  })

  it("automatically repairs a missing or stale DB profile once Dynamic already has both addresses", () => {
    // Case C: Dynamic session/addresses already present on page load (no click needed) but
    // the DB profile is missing/incomplete — repair must fire on its own, gated so it never loops.
    expect(page).toContain("const staleProfileAutoRepairAttemptRef = useRef<string | null>(null)")
    const autoRepairEffect = page.slice(
      page.indexOf("// --- Stale DB recovery (Case C):"),
      page.indexOf("// Single prioritized state resolver.")
    )
    expect(autoRepairEffect).toContain("if (!sdkHasLoaded || !user || pendingSync || repairInProgress) return")
    expect(autoRepairEffect).toContain("if (profileState.kind === \"loading\") return")
    expect(autoRepairEffect).toContain("if (hasReadyBaseAndSolanaProfile) return")
    expect(autoRepairEffect).toContain("if (emailMismatchActive || emailUnverifiedActive) return")
    expect(autoRepairEffect).toContain("if (!dynamicSessionMatchesProfile) return")
    expect(autoRepairEffect).toContain('console.info("[pinetree-wallets] wallet_sync_start"')
    expect(autoRepairEffect).toContain('console.info("[pinetree-wallets] wallet_dynamic_addresses_detected"')
    expect(autoRepairEffect).toContain("setPendingSync(true)")
    expect(autoRepairEffect).toContain("markWalletSetupInProgress()")
  })

  it("keeps wallet readiness independent of signer hydration and logs it as non-blocking", () => {
    // Case D/E: a saved profile with both addresses is ready even before Dynamic signer
    // objects hydrate; missing signers are logged, never treated as a creation failure.
    expect(page).toContain('console.info("[pinetree-wallets] wallet_core_ready", {})')
    expect(page).toContain("if (coreWalletProfileReady && !dynamicEmbeddedSignersReady)")
    expect(page).toContain('console.info("[pinetree-wallets] wallet_signers_missing_non_blocking", {})')
  })

  it("rejects a conflicting wallet address instead of silently overwriting a saved profile", () => {
    expect(apiRoute).toContain("function profileHasReadyCoreIdentity")
    expect(apiRoute).toContain("const existingReadyProfile = profileHasReadyCoreIdentity(existingProfile)")
    expect(apiRoute).toContain("baseAddressOwnedByAnotherMerchant")
    expect(apiRoute).toContain("solanaAddressOwnedByAnotherMerchant")
    expect(apiRoute).toContain("protected_existing_profile")
    expect(apiRoute).toContain("error: conflictType")
    expect(apiRoute).toContain("conflictType")
    expect(apiRoute).toContain('status: "needs_review"')
    expect(apiRoute).toContain("retryable: false")
    expect(apiRoute).toContain("wallet_profile_identity_check_failed")
    expect(apiRoute).toContain("wallet_profile_post_existing_incomplete_repaired")
    expect(apiRoute).toContain("wallet_profile_post_idempotent_success")
    expect(page).toContain("function isWalletAddressConflictResponse(value: unknown)")
    expect(page).toContain("isWalletAddressConflictResponse(responseBody)")
    expect(page).toContain(
      "PineTree found an older wallet setup for this account. Please retry after the previous test wallet is cleared."
    )
  })

  it("logs safe, low-cardinality wallet sync instrumentation without secrets or raw addresses", () => {
    const expectedEvents = [
      "wallet_sync_start",
      "wallet_dynamic_addresses_detected",
      "wallet_profile_get_start",
      "wallet_profile_get_success",
      "wallet_profile_get_missing",
      "wallet_profile_get_error",
      "wallet_profile_post_start",
      "wallet_profile_post_success",
      "wallet_profile_post_conflict",
      "wallet_profile_post_existing_incomplete_repaired",
      "wallet_profile_post_idempotent_success",
      "wallet_profile_identity_check_failed",
      "wallet_profile_post_error",
      "wallet_core_ready",
      "wallet_signers_missing_non_blocking",
      "wallet_provider_sync_background_started",
      "wallet_provider_sync_background_failed",
      "wallet_dynamic_sdk_loaded",
      "wallet_dynamic_jwt_requested",
      "wallet_dynamic_jwt_authenticated",
      "wallet_dynamic_create_or_restore_started",
      "wallet_dynamic_create_or_restore_complete",
      "wallet_dynamic_create_embedded_wallet_started",
      "wallet_dynamic_create_embedded_wallet_complete",
      "wallet_dynamic_wallets_refresh_started",
      "wallet_dynamic_wallets_refresh_complete",
      "wallet_dynamic_wallets_detected_count",
      "wallet_dynamic_base_address_detected",
      "wallet_dynamic_solana_address_detected",
      "wallet_dynamic_missing_required_addresses",
      "wallet_profile_sync_eligible",
      "wallet_profile_sync_skipped_reason",
      "wallet_profile_post_attempting",
      "wallet_create_dynamic_auth_complete",
      "wallet_create_runtime_hydration_started",
      "wallet_create_runtime_hydration_complete",
      "wallet_create_addresses_detected",
      "wallet_create_profile_sync_started",
      "wallet_create_profile_sync_complete",
      "wallet_create_rail_sync_started",
      "wallet_create_rail_sync_complete",
      "wallet_create_modal_opened",
      "wallet_create_resume_detected",
      "wallet_create_resume_profile_sync_started",
      "wallet_create_resume_complete",
      "wallet_setup_orchestrator_started",
      "wallet_core_setup_started",
      "wallet_speed_setup_started",
      "wallet_dynamic_external_jwt_rejected",
      "wallet_dynamic_external_identity_conflict_suspected",
      "wallet_dynamic_native_user_detected",
      "wallet_core_profile_post_started",
      "wallet_core_profile_post_success",
      "wallet_bitcoin_setup_success",
      "wallet_bitcoin_setup_pending",
      "wallet_bitcoin_setup_failed",
      "wallet_setup_orchestrator_settled",
      "wallet_setup_ready",
      "wallet_setup_pending_lightning",
      "wallet_setup_failed_core",
      "wallet_setup_lightning_needs_attention",
    ]
    const combined = `${page}\n${apiRoute}\n${setupDebugEventRoute}`
    for (const event of expectedEvents) {
      expect(combined).toContain(event)
    }
  })

  it("logs which required address is missing without ever logging a raw address", () => {
    const detectionEffect = page.slice(
      page.indexOf("console.info(\"[pinetree-wallets] wallet_dynamic_wallets_detected_count\""),
      page.indexOf("const detectionStartedAt = pendingWalletProvisionStartedAtRef.current")
    )
    expect(detectionEffect).toContain("missingBase: !baseAddress")
    expect(detectionEffect).toContain("missingSolana: !solanaAddress")
    // Only booleans/reason strings are logged here, never the extracted address value itself.
    expect(detectionEffect).not.toContain("address: baseAddress")
    expect(detectionEffect).not.toContain("address: solanaAddress")
    expect(detectionEffect).not.toMatch(/(?<!!)baseAddress\s*,\s*\n/)
    expect(detectionEffect).not.toMatch(/(?<!!)solanaAddress\s*,\s*\n/)
  })

  it("profile POST is attempted only once both addresses are detected, not on partial detection", () => {
    const detectionEffect = page.slice(
      page.indexOf("console.info(\"[pinetree-wallets] wallet_dynamic_wallets_detected_count\""),
      page.indexOf("function inferWalletSetupFailureReason()")
    )
    const missingGuardIdx = detectionEffect.indexOf("if (!baseAddress || !solanaAddress) {")
    const eligibleIdx = detectionEffect.indexOf("wallet_profile_sync_eligible")
    const syncCallIdx = detectionEffect.indexOf("await syncProfileFromDynamic()")
    expect(missingGuardIdx).toBeGreaterThan(-1)
    expect(eligibleIdx).toBeGreaterThan(missingGuardIdx)
    expect(syncCallIdx).toBeGreaterThan(eligibleIdx)
    // The partial-detection branch returns before reaching sync-eligible or the POST call.
    const partialBranch = detectionEffect.slice(missingGuardIdx, detectionEffect.indexOf("return", missingGuardIdx))
    expect(partialBranch).not.toContain("wallet_profile_sync_eligible")
  })

  it("mirrors the wallet_dynamic_* diagnostics server-side with a fire-and-forget beacon", () => {
    // console.info alone never reaches Vercel logs from a mobile browser - every
    // wallet_dynamic_* checkpoint needs a server-visible emitWalletSetupDebugEvent sibling.
    expect(page).toContain("function emitWalletSetupDebugEvent(event: string, details?: WalletSetupDebugDetails)")
    expect(page).toContain("function isWalletDebugEventsEnabled()")
    expect(page).toContain('fetch("/api/debug/pinetree-wallet/setup-event"')
    expect(page).toContain("keepalive: true")
    const emitFn = page.slice(
      page.indexOf("function emitWalletSetupDebugEvent("),
      page.indexOf("function beginWalletProvisioningAttempt(")
    )
    // Never blocks wallet creation: the fetch is fired without being awaited.
    expect(emitFn).toContain("void fetch(")
    expect(emitFn).toContain(".catch(() => undefined)")
    // Never throws into the UI.
    expect(emitFn).toContain("try {")
    expect(emitFn).toContain("} catch {")
  })

  it("emits wallet_create_clicked and wallet_retry_clicked", () => {
    const createFn = page.slice(
      page.indexOf("function handleCreateWallet()"),
      page.indexOf("function handleUsePineTreeAccountEmail()")
    )
    expect(createFn).toContain('emitWalletSetupDebugEvent("wallet_create_clicked"')
    const retryFn = page.slice(
      page.indexOf("function handleRetryWalletSetup()"),
      page.indexOf("function handleWithdrawalAssetSelect")
    )
    expect(retryFn).toContain('emitWalletSetupDebugEvent("wallet_retry_clicked"')
  })

  it("emits wallet_dynamic_wallets_detected_count as a plain count, never a raw wallet list", () => {
    expect(page).toContain('emitWalletSetupDebugEvent("wallet_dynamic_wallets_detected_count"')
    expect(page).toContain("count: dynamicWalletRuntimeCount")
  })

  it("emits wallet_dynamic_missing_required_addresses with only booleans and a reason", () => {
    expect(page).toContain('emitWalletSetupDebugEvent("wallet_dynamic_missing_required_addresses"')
    expect(page).toContain("missingBase: !baseAddress")
    expect(page).toContain("missingSolana: !solanaAddress")
    expect(page).toContain('emitWalletSetupDebugEvent("wallet_profile_sync_skipped_reason", { reason: missingReason })')
  })

  it("emits wallet_profile_post_attempting immediately before the profile POST fetch", () => {
    const syncFn = page.slice(
      page.indexOf("const syncProfileFromDynamic = useCallback"),
      page.indexOf("// --- Post-reconnect wallet match check ---")
    )
    const emitIdx = syncFn.indexOf('emitWalletSetupDebugEvent("wallet_profile_post_attempting"')
    const fetchIdx = syncFn.indexOf('fetch("/api/wallets/pinetree-profile"')
    expect(emitIdx).toBeGreaterThan(-1)
    expect(fetchIdx).toBeGreaterThan(emitIdx)
    expect(syncFn).toContain('emitWalletSetupDebugEvent("wallet_profile_post_response"')
  })

  it("dedupes an identical in-flight profile POST from repeated Dynamic hydration effects", () => {
    const syncFn = page.slice(
      page.indexOf("const syncProfileFromDynamic = useCallback"),
      page.indexOf("// --- Post-reconnect wallet match check ---")
    )
    expect(page).toContain("const profilePostInFlightKeyRef = useRef<string | null>(null)")
    expect(syncFn).toContain("const profilePostKey = [")
    expect(syncFn).toContain("if (profilePostInFlightKeyRef.current === profilePostKey)")
    expect(syncFn).toContain("wallet_profile_post_deduped_in_flight")
    expect(syncFn).toContain("profilePostInFlightKeyRef.current = profilePostKey")
    expect(syncFn).toContain("profilePostInFlightKeyRef.current = null")
  })

  it("setup stage diagnostics expose only safe progression booleans", () => {
    expect(page).toContain("type WalletSetupStageDiagnosticEvent =")
    expect(page).toContain("function buildWalletSetupStageDiagnostics(stage: string): WalletSetupDebugDetails")
    for (const field of [
      "setupAttemptActive",
      "profileExists",
      "profileReady",
      "hasBaseAddress",
      "hasSolanaAddress",
      "refreshInFlight",
      "profilePostInFlight",
      "railSyncInFlight",
      "modalAlreadyOpened",
      "stage",
    ]) {
      expect(page).toContain(field)
    }
    const diagnosticFn = page.slice(
      page.indexOf("function buildWalletSetupStageDiagnostics"),
      page.indexOf("function emitWalletSetupStageDiagnostic")
    )
    expect(diagnosticFn).not.toContain("merchantEmail")
    expect(diagnosticFn).not.toContain("dynamicUserEmail")
    expect(diagnosticFn).not.toContain("accessToken")
  })

  it("create setup kickoff guard clears after the orchestrator hands off to effects", () => {
    const createFn = page.slice(
      page.indexOf("async function createPineTreeWalletSetup("),
      page.indexOf("// Kicks off core Dynamic wallet setup")
    )
    expect(createFn).toContain("try {")
    expect(createFn).toContain("Promise.allSettled")
    expect(createFn).toContain("finally {")
    expect(createFn).toContain("walletSetupStartInFlightRef.current = null")
  })

  it("gates the wallet setup event log panel behind walletDebug=1 and shows only safe values", () => {
    expect(page).toContain("showProfileSyncDebugPanel && lastDebugEvents.length > 0")
    expect(page).toContain("Wallet setup event log")
    expect(page).not.toContain("lastDebugEvents.length > 0 ? null :")
  })

  it("normal merchant UI still shows only Creating PineTree Wallet / Try Again copy", () => {
    expect(page).toContain('return "Creating PineTree Wallet..."')
    expect(page).toContain('return "Try Again"')
    // The event-log panel exists in source but is gated behind ?walletDebug=1, same as
    // every other diagnostics block on this page - it never renders in the default UI.
    const panelIdx = page.indexOf("Wallet setup event log")
    const gateIdx = page.lastIndexOf("showProfileSyncDebugPanel && lastDebugEvents.length > 0", panelIdx)
    expect(gateIdx).toBeGreaterThan(-1)
    expect(panelIdx - gateIdx).toBeLessThan(400)
  })

  it("saves detected core wallet addresses without waiting for browser signers", () => {
    const coreSaveEffect = page.slice(
      page.indexOf("if (!pendingSync || !sdkHasLoaded || !user || pendingProfileSyncAttemptRef.current) return"),
      page.indexOf("function inferWalletSetupFailureReason()")
    )

    expect(coreSaveEffect).toContain('reason: "waiting_for_dynamic_addresses"')
    expect(coreSaveEffect).toContain("await syncProfileFromDynamic()")
    expect(coreSaveEffect).not.toContain("waiting_for_dynamic_addresses_or_signers")
    expect(page).toContain('const coreWalletProfileReady = profile?.status === "ready" && baseReady && solanaReady')
  })

  it("does not render a persistent synced banner after profile sync succeeds", () => {
    expect(page).toContain('if (step === "profile_synced") return ""')
    expect(page).not.toContain('if (step === "profile_synced") return "Wallet ready"')
    expect(page).not.toContain("PineTree Wallet synced.")
  })

  it("retry clears local setup state and restarts embedded wallet polling without deleting rows", () => {
    const retryFn = page.slice(
      page.indexOf("function handleRetryWalletSetup()"),
      page.indexOf("async function handleResetPineTreeWalletSetup()")
    )
    expect(retryFn).toContain("setPendingSync(false)")
    expect(retryFn).toContain("setLogoutPending(false)")
    expect(retryFn).toContain("setShowAuthFlow(false)")
    // Retry routes through the shared orchestrator, whose retry branch restarts
    // embedded wallet polling (or reopens PineTree-controlled auth when no user).
    expect(retryFn).toContain("void createPineTreeWalletSetup({ retry: true })")
    const coreFn = page.slice(
      page.indexOf("async function startCoreDynamicWallet("),
      page.indexOf("async function provisionSpeedLightning(")
    )
    expect(coreFn).toContain('refreshDynamicWalletRuntime("retry_embedded_wallet_setup"')
    expect(coreFn).toContain('openDynamicEmailFallbackAuth("retry_embedded_wallet_setup_missing_dynamic_user")')
    expect(page).not.toContain("delete Dynamic")
  })

  it("logs only safe wallet creation diagnostics in debug mode", () => {
    expect(page).toContain("safeWalletSetupDiagnostics")
    expect(page).toContain("dynamic_user_exists")
    expect(page).toContain("wallet_count")
    expect(page).toContain("wallet_addresses_present")
    expect(page).toContain("profile_sync_response_status")
    const safeDiagnosticsFn = page.slice(
      page.indexOf("function safeWalletSetupDiagnostics("),
      page.indexOf("function toRecord(value: unknown)")
    )
    expect(safeDiagnosticsFn).not.toContain("dynamic_jwt")
    expect(safeDiagnosticsFn).not.toContain("session_token")
    expect(page).not.toContain("DYNAMIC_EXTERNAL_JWT_PRIVATE_KEY")
    expect(page).not.toContain("DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64")
    expect(page).not.toContain("recoveryPhrase")
  })

  it("gates the Dynamic auth mode diagnostic to development only and never logs secrets", () => {
    expect(provider).toContain('if (process.env.NODE_ENV === "production") return')
    const providerDiagnosticEffect = provider.slice(
      provider.indexOf("useEffect(() => {\n    if (process.env.NODE_ENV"),
      provider.indexOf("}, [dynamicAuthConfig.emailFallbackEnabled")
    )
    expect(providerDiagnosticEffect).toContain("dynamic_environment_config")
    expect(providerDiagnosticEffect).toContain("pineTreeDynamicAuthMode: dynamicAuthConfig.mode")
    expect(providerDiagnosticEffect).toContain("pineTreeDynamicEmailFallbackEnabled: dynamicAuthConfig.emailFallbackEnabled")
    expect(providerDiagnosticEffect).toContain("pineTreeDynamicExternalJwtConfigured: dynamicAuthConfig.externalJwtConfigured")

    expect(page).toContain("dynamic_auth_diagnostic")
    const pageDiagnosticEffect = page.slice(
      page.indexOf("// Dev-only wallet auth diagnostic"),
      page.indexOf("// --- SDK load timeout ---")
    )
    expect(pageDiagnosticEffect).toContain('if (process.env.NODE_ENV === "production") return')
    expect(pageDiagnosticEffect).toContain("authMode: dynamicAuthConfig.mode")
    expect(pageDiagnosticEffect).toContain("emailFallbackEnabled: dynamicAuthConfig.emailFallbackEnabled")
    expect(pageDiagnosticEffect).toContain("externalJwtEndpointConfigured: dynamicAuthConfig.externalJwtConfigured")
    expect(pageDiagnosticEffect).toContain("merchantEmailPresent: Boolean(merchantEmail)")
    // Only presence booleans - never the raw email, JWT, signing key, wallet address, or merchant id.
    expect(pageDiagnosticEffect).not.toContain("merchantEmail,")
    expect(pageDiagnosticEffect).not.toContain("externalJwt:")
    expect(pageDiagnosticEffect).not.toContain("merchantId")
  })

  it("Dynamic profile sync sends only Dynamic user, Base, and Solana addresses", () => {
    expect(page).toContain("dynamic_user_id: user.userId")
    expect(page).toContain("base_address: baseAddress")
    expect(page).toContain("solana_address: solanaAddress")
    expect(page).not.toContain("btc_address: bitcoinAddress")
    expect(page).not.toContain("bitcoin_onchain_address: bitcoinAddress")
  })

  it("does not render a separate wallet-address refresh control in the modal", () => {
    // Refresh is gated by canRefresh — only enabled when Dynamic session matches the saved profile
    expect(page).toContain("dynamicSessionMatchesProfile")
    expect(page).not.toContain("Refresh wallet addresses")
    expect(page).not.toContain('aria-label="Refresh wallet addresses"')
    expect(page).not.toContain("Refresh Base/Solana addresses")
    expect(page).not.toContain('aria-label="Refresh Base and Solana addresses"')
    expect(page).not.toContain("handleRefreshAddresses")
    // Refresh calls the same sync path — POST to pinetree-profile
    expect(page).toContain("syncProfileFromDynamic")
  })

  // -------------------------------------------------------------------------
  // UI cleanliness — external wallets hidden
  // -------------------------------------------------------------------------

  it("does not show external wallet choices or Dynamic branding in merchant wallet setup", () => {
    for (const forbidden of [
      "Connect external wallet",
      "Connect Wallet",
      "MetaMask",
      "Coinbase Wallet",
      "Phantom",
      "Solflare",
      "Trust Wallet",
      "View all wallets",
    ]) {
      expect(page).not.toContain(forbidden)
    }
    expect(page).not.toContain(">Dynamic<")
    expect(page).not.toContain("Sign in with Dynamic")
    expect(page).not.toContain("Powered by Dynamic")
  })

  it("keeps raw address details off the main setup summary", () => {
    expect(page).toContain("Wallet address")
    expect(page).toContain("profileAddresses.base")
    expect(page).toContain("profileAddresses.solana")
    expect(page).toContain("bitcoinPayoutEntries")
    expect(page).not.toContain('<ReceiveRow label="Bitcoin Lightning/Spark address"')
    expect(page).not.toContain("Powered by PineTree")
    expect(page).not.toContain("Network addresses")
    expect(page).not.toContain("PineTree Base Wallet")
    expect(page).not.toContain("PineTree Solana Wallet")
  })

  it("opens a PineTree wallet modal with wallet-style sections", () => {
    expect(page).toContain("setWalletOpen(true)")
    expect(page).toContain('role="dialog"')
    expect(page).toContain('aria-modal="true"')
    expect(page).toContain('label: "Overview"')
    expect(page).toContain('label: "Balances"')
    expect(page).toContain('label: "Withdraw"')
    expect(page).not.toContain('label: "Wallets"')
    expect(page).toContain('label: "Activity"')
    expect(page).not.toContain('label: "Receive"')
  })

  it("prioritizes Base, Solana, and Bitcoin", () => {
    expect(page).toContain("const walletRailRows = useMemo<WalletRailRow[]>(() => [")
    expect(page).toContain('label: "Base" as const')
    expect(page).toContain('label: "Solana" as const')
    expect(page).toContain('label: "Bitcoin" as const')
    expect(page).not.toContain("PineTree Bitcoin wallet")
  })

  it("front-card rail chips only show configured and enabled rails", () => {
    expect(page).toContain("function EnabledRailChips")
    expect(page).toContain("const enabledRows = rows.filter((row) => row.enabled && row.configured)")
    expect(page).toContain('aria-label="Enabled payment rails"')
    expect(page).toContain("Manage rails in Providers")
    expect(page).toContain("configured: baseReady, enabled: enabledRails.base")
    expect(page).toContain("configured: solanaReady, enabled: enabledRails.solana")
    expect(page).toContain("configured: bitcoinReady,")
    expect(page).toContain("enabled: enabledRails.bitcoin,")
  })

  it("marks the merchant wallet Connected when the saved Base/Solana profile is ready", () => {
    expect(page).toContain('const coreWalletProfileReady = profile?.status === "ready" && baseReady && solanaReady')
    expect(page).toContain('if (dynamicProfileReady || hasReadyBaseAndSolanaProfile) return "ready"')
    expect(page).toContain('walletSetupPrimaryState === "ready" ? "Connected" :')
    expect(page).toContain('walletSetupPrimaryState === "reconnect_needed" ? "Reconnect needed" :')
    expect(page).not.toContain("Bitcoin Lightning is being prepared through PineTree")
    expect(page).not.toContain("Bitcoin address pending")
  })

  it("uses provider status vocabulary when a wallet address is missing", () => {
    expect(page).toContain('repairInProgress ? "Repairing" :')
    expect(page).toContain('"Not connected"')
    expect(page).not.toContain('"Setup pending"')
    expect(page).not.toContain('const lightningPending = lightningProfile?.status === "pending"')
    expect(page).not.toContain("lightningRetryable")
  })

  it("does not use Not created or Not configured wallet status copy in the PineTree Wallet UI", () => {
    expect(page).not.toContain('"Not created"')
    expect(page).not.toContain('"Not configured"')
    expect(page).not.toContain('"Address syncing"')
  })

  it("shows wallet addresses in the Balances asset detail instead of a separate Wallets tab", () => {
    expect(page).toContain("Wallet address")
    expect(page).toContain('aria-label="Copy wallet address"')
    expect(page).toContain('selectedAsset.rail === "base"')
    expect(page).toContain('selectedAsset.rail === "solana"')
    expect(page).toContain("bitcoinPayoutEntries[0]?.address")
    expect(page).not.toContain("function ReceiveRow")
    expect(page).not.toContain("function WalletRows")
    expect(page).not.toContain('<ReceiveRow label="Bitcoin Lightning/Spark address"')
    expect(page).not.toContain("Powered by PineTree")
    expect(page).not.toContain("Bitcoin payouts route to your PineTree Bitcoin wallet")
    expect(page).not.toContain("Bitcoin receiving is managed automatically by PineTree.")
    expect(page).not.toContain("Bitcoin address pending")
    expect(page).not.toContain("Preparing Bitcoin Lightning")
    expect(page).not.toContain("Enable Bitcoin Lightning")
    expect(page).not.toContain('"Disabled"')
    expect(page).not.toContain(">Setup pending</p>")
  })

  it("uses a clean merchant wallet hierarchy without redundant descriptive copy", () => {
    expect(page).toContain("<h1 className={dashboardPageTitleClass}>Merchant Wallet</h1>")
    expect(page).toContain(">PineTree Wallet</h2>")
    expect(page).not.toContain(">PineTree Wallet</h1>")
    expect(page).not.toContain("Create and open your merchant wallet.")
    expect(page).not.toContain("One merchant wallet for receiving funds and managing payments.")
    expect(page).toContain("<EnabledRailChips rows={walletRailRows} />")
  })

  it("overview shows wallet summary balances instead of duplicating receive addresses", () => {
    expect(page).toContain("function WalletOverviewSummary")
    expect(page).toContain(">TOTAL BALANCE</p>")
    expect(page).toContain(">WALLET SUMMARY</p>")
    expect(page).toContain("formatWalletTotalBalance(sync?.totalUsd, syncing)")
    expect(page).toContain("Pending sync")
    expect(page).toContain("Last synced")
    expect(page).toContain("visibleRows.map((row)")
    expect(page).not.toContain("Recent activity")
    const overviewSource = page.slice(
      page.indexOf("function WalletOverviewSummary("),
      page.indexOf("function AssetSelectDropdown(")
    )
    expect(overviewSource).not.toContain("Bitcoin Lightning payout")
    expect(page).not.toContain("Settlement addresses")
    expect(page).not.toContain("address: profileAddresses.base[0]?.address")
    expect(page).not.toContain("RailStatusCard")
    expect(page).not.toContain(">Available</p>")
    expect(page).not.toContain("Balances will update as wallet activity is indexed.")
  })

  it("balances tab uses a selected asset dropdown without fake unsynced zeroes", () => {
    expect(page).toContain("function BalanceRows")
    expect(page).toContain("AssetSelectDropdown")
    expect(page).toContain("dropdownOptions")
    expect(page).toContain("balanceOptions")
    expect(page).not.toContain("allAssets.map((row, index)")
    expect(page).not.toContain("ChevronRight")
    expect(page).toContain("Wallet address")
    expect(page).not.toContain('["Deposit", "Withdraw", "History"].map')
    expect(page).not.toContain("Managed by Speed")
    expect(page).not.toContain("Powered by Speed")
    expect(page).toContain("formatBalance(row.balance, row.asset)")
    expect(page).toContain("No balances yet")
    expect(page).toContain("Received funds will appear here after payments settle.")
    expect(page).not.toContain("Base balance")
    expect(page).not.toContain("Solana balance")
    expect(page).not.toContain("Bitcoin balance")
    expect(page).not.toContain("Not available yet")
  })

  // -------------------------------------------------------------------------
  // Withdrawal scaffold — no real fund movement
  // -------------------------------------------------------------------------

  it("shows Dynamic approval copy only when wallet signing is available", () => {
    expect(page).toContain("Approve withdrawal")
    expect(page).toContain("dynamicApprovalAvailableForWithdrawal")
    expect(page).toContain("findDynamicApprovalWalletForSource")
    expect(page).toContain("dynamicWalletSupportsRail")
    expect(dynamicSignerLookup).toContain("resolveDynamicSolanaSignAndSendCapability")
    expect(page).toContain("signAndSendTransaction")
    expect(page).toContain("signPsbt")
    expect(page).toContain("/api/wallets/pinetree-wallet/withdrawals/${encodeURIComponent(withdrawalId)}/prepare")
    expect(page).toContain("/api/wallets/pinetree-wallet/withdrawals/${encodeURIComponent(withdrawalId)}/submit")
  })

  it("keeps dev-only withdrawal fallback diagnostics for Dynamic approval issues", () => {
    expect(page).toContain("Withdrawal diagnostics")
    expect(page).toContain("railEnabled")
    expect(page).toContain("walletAddressExists")
    expect(page).toContain("savedSourceAddress")
    expect(page).toContain("matchingDynamicWallet")
    expect(page).toContain("browserWalletAddresses")
    expect(page).toContain("dynamicMethodAvailable")
    expect(page).toContain("addressMismatch")
    expect(page).toContain("fallbackReason")
    expect(page).toContain('"dynamic_wallet_unavailable"')
    expect(page).toContain('"dynamic_method_unavailable"')
    expect(page).toContain('"address_mismatch"')
  })

  it("uses separate withdrawal screens instead of stacked review and submit panels", () => {
    expect(page).toContain('type WithdrawalScreen = "form" | "review" | "approving" | "submitted" | "failed"')
    expect(page).toContain('if (screen === "review" && review)')
    expect(page).toContain('if (screen === "approving")')
    expect(page).toContain('if (screen === "submitted" && submitResult)')
    expect(page).toContain('if (screen === "failed")')
    expect(page).not.toContain("const primaryActionLabel")
    expect(page).not.toContain("onClick={primaryAction}")
  })

  it("withdrawal screen progresses through review, approving, submitted, and failed states", () => {
    expect(page).toContain("Review withdrawal")
    expect(page).toContain("\"Approve withdrawal\"")
    expect(page).toContain("Approving withdrawal")
    expect(page).toContain("Confirm this withdrawal in PineTree Wallet.")
    expect(page).toContain("Withdrawal failed")
    expect(page).toContain("Done")
    expect(page).toContain("\"Processing\"")
    expect(page).toContain('setWithdrawalScreen("review")')
    expect(page).toContain('setWithdrawalScreen("approving")')
    expect(page).toContain('setWithdrawalScreen("submitted")')
    expect(page).toContain('setWithdrawalScreen("failed")')
  })

  it("blocks retry copy and CTA for unknown post-dispatch Bitcoin withdrawal outcomes", () => {
    expect(page).toContain("Withdrawal outcome is being verified. Do not retry this withdrawal while PineTree reviews the provider result.")
    expect(page).toContain("const withdrawalOutcomePending = approvalError === withdrawalStatusUnknownMessage")
    expect(page).toContain('review && !withdrawalOutcomePending')
    expect(page).toContain('presented.code === "STATUS_UNKNOWN" ? withdrawalStatusUnknownMessage : presented.message')
    expect(page).toContain('["REQUIRES_ACTION", "ACTION_REQUIRED"].includes')
    expect(page).toContain("Withdrawal outcome pending")
  })

  it("keeps accepted Speed processing withdrawals on the normal submitted screen", () => {
    expect(page).toContain('merchantStatus: "Processing"')
    expect(page).toContain("Your Bitcoin Lightning withdrawal was submitted.")
    expect(page).toContain('setWithdrawalScreen("submitted")')
    expect(page.indexOf('["REQUIRES_ACTION", "ACTION_REQUIRED"].includes')).toBeLessThan(
      page.indexOf("Your Bitcoin Lightning withdrawal was submitted.")
    )
  })

  it("routes non-Dynamic wallet sends to a signer-unavailable failure instead of manual review", () => {
    expect(page).toContain("Submit withdrawal request")
    expect(page).toContain("if (review.review.approvalMethod === \"dynamic_browser\")")
    expect(page).toContain("This withdrawal cannot be signed in this browser session.")
    expect(page).not.toContain("action: \"submit\"")
    expect(page).not.toContain("withdrawal_id: withdrawalId")
  })

  it("hides the editable form and review screen after withdrawal submission", () => {
    expect(page).toContain('if (screen === "submitted" && submitResult)')
    expect(page).toContain("Withdrawal submitted")
    expect(page).toContain("Transaction reference:")
    expect(page).toContain("Done")
    expect(page).not.toContain("{review && !submitResult ? (")
  })

  it("shows selected asset availability and USD value in the Withdraw tab", () => {
    expect(page).toContain("selectedWithdrawalBalance")
    expect(page).toContain("findWithdrawalBalance(walletSync, withdrawalRail, withdrawalAsset)")
    expect(page).toContain("Available")
    expect(page).toContain("formatCryptoAmount(selectedBalanceAmount, asset)")
    expect(page).toContain("formatUsd(selectedBalance.usdValue)")
  })

  it("shows a Max button that fills a verified canonical max amount", () => {
    expect(page).toContain("Max")
    expect(page).toContain("function handleMaxWithdrawalAmount()")
    expect(page).toContain("selectedWithdrawalBalance?.availableToWithdraw")
    expect(page).toContain("Available-to-withdraw could not be verified. Refresh before withdrawing.")
    expect(page).toContain("onMaxAmount={handleMaxWithdrawalAmount}")
  })

  it("blocks review when amount exceeds known available balance or selected balance is zero", () => {
    expect(page).toContain("Amount exceeds available balance.")
    expect(page).toContain("No available balance for this asset.")
    expect(page).toContain("amountNumber > availableBalance")
    expect(page).toContain("BigInt(amountSats) > BigInt(availableSats)")
    expect(page).toContain("BigInt(availableSats) <= BigInt(0)")
  })

  it("allows unknown balances with a verification note", () => {
    expect(page).toContain("Balance indexing pending")
    expect(page).toContain("Balance will be verified before processing.")
  })

  it("does not show developer-facing signer disabled copy in the withdrawal UI", () => {
    expect(page).not.toContain(["Signing", "not enabled yet"].join(" "))
    expect(page).not.toContain(["Withdrawal signing", "not enabled"].join(" "))
    expect(page).not.toContain(["signing", "not enabled"].join(" "))
    expect(page).not.toContain(["cannot", "sign"].join(" "))
    expect(page).not.toContain(["broadcast", "disabled"].join(" "))
    expect(page).not.toContain(["provider signer", "unavailable"].join(" "))
    expect(page).not.toContain("Withdrawals coming soon")
    expect(page).not.toContain("Withdrawals disabled")
  })

  it("does not retain stale disabled signer copy anywhere in withdrawal source", () => {
    const withdrawalSource = [
      page,
      withdrawalApiRoute,
      withdrawalPrepareRoute,
      withdrawalSubmitRoute,
      withdrawalEngine,
      withdrawalSigner,
      read("providers/wallets/bitcoinNetworkProvider.ts"),
    ].join("\n")
    expect(withdrawalSource).not.toContain(["Withdrawal signing", "not enabled"].join(" "))
    expect(withdrawalSource).not.toContain(["Signing", "not enabled"].join(" "))
    expect(withdrawalSource).not.toContain(["Cannot", "sign"].join(" "))
    expect(withdrawalSource).not.toContain(["Broadcast", "disabled"].join(" "))
    expect(withdrawalSource).not.toContain(["Provider signer", "unavailable"].join(" "))
  })

  it("shows honest disabled withdrawal copy when no wallet source address is available", () => {
    expect(page).toContain("const noWithdrawableAssets = assetOptions.length === 0")
    expect(page).toContain("Withdrawals are being finalized. Receiving funds is available now.")
    expect(page).not.toContain("No PineTree Wallet source address is available for withdrawals.")
    expect(page).not.toContain("Create or connect a PineTree Wallet address before withdrawing.")
  })

  it("keeps the withdrawal form shell without redesigning the controls", () => {
    expect(page).toContain("AssetSelectDropdown")
    expect(page).toContain("assetOptions.map((option)")
    expect(page).toContain("onAssetSelect(r as WithdrawalRail, a as WithdrawalAsset)")
    expect(page).not.toContain("Choose a PineTree Wallet asset, then review before approval.")
    expect(page).not.toContain("Choose an enabled PineTree Wallet asset")
    expect(page).toContain('aria-label="Destination address"')
    expect(page).toContain('aria-label="Withdrawal amount"')
    expect(page).toContain("Review withdrawal")
    const reviewButton = page.slice(
      page.indexOf("onClick={onReview}"),
      page.indexOf('{reviewing ? "Reviewing..."')
    )
    expect(reviewButton).toContain("inline-flex h-11 min-w-[12rem]")
    expect(reviewButton).toContain("px-6")
    expect(reviewButton).not.toContain("w-full")
    expect(reviewButton).not.toContain("Reconnect PineTree Wallet")
    expect(page).toContain("/api/wallets/pinetree-wallet/withdrawals")
    expect(page).not.toContain("Withdrawal coming soon")
    expect(page).not.toContain("Withdrawal disabled")
    // The Review button is disabled — no API calls for withdrawal execution
    expect(page).not.toContain("/api/wallets/settlement")
    expect(page).not.toContain("/api/wallets/send-sessions")
  })

  it("does not treat idle withdrawal form validation as wallet disconnection", () => {
    const formShell = page.slice(
      page.indexOf("function WithdrawalFormShell("),
      page.indexOf("function formatUsd(")
    )
    const blockingMessage = formShell.slice(
      formShell.indexOf("const blockingMessage ="),
      formShell.indexOf("if (screen === \"review\"")
    )
    const reviewButton = formShell.slice(
      formShell.indexOf("onClick={onReview}"),
      formShell.indexOf("{process.env.NODE_ENV")
    )

    expect(formShell).not.toContain("missingRuntimeSigner")
    expect(blockingMessage).toContain("Enter a destination address to review.")
    expect(blockingMessage).toContain("Enter an amount to review.")
    expect(blockingMessage).toContain("No available balance for this asset.")
    expect(blockingMessage).not.toContain("pineTreeSignerReconnectMessage")
    expect(reviewButton).toContain("onClick={onReview}")
    expect(reviewButton).toContain('{reviewing ? "Reviewing..." : "Review withdrawal"}')
    expect(reviewButton).not.toContain("Reconnect PineTree Wallet")
  })

  it("defers browser signer resolution until review or after prepare returns the authoritative source", () => {
    const diagnostics = page.slice(
      page.indexOf("const withdrawalDiagnostics = useMemo"),
      page.indexOf("const lightningPayoutSummary = useMemo")
    )
    const reviewHandler = page.slice(
      page.indexOf("async function handleReviewWithdrawal()"),
      page.indexOf("function handleMaxWithdrawalAmount()")
    )
    const submitHandler = page.slice(
      page.indexOf("async function handleSubmitWithdrawal"),
      page.indexOf("// ---------------------------------------------------------------------------\n  // Early returns")
    )

    expect(diagnostics).toContain("const shouldResolveWithdrawalSigner = Boolean(withdrawalReview) && usesDynamicSigner")
    expect(diagnostics).toContain("const matchingWallet = shouldResolveWithdrawalSigner")
    expect(reviewHandler.indexOf("if (!destination)")).toBeLessThan(reviewHandler.indexOf("findDynamicApprovalWalletForSource"))
    expect(reviewHandler.indexOf("if (!amount)")).toBeLessThan(reviewHandler.indexOf("findDynamicApprovalWalletForSource"))
    expect(reviewHandler.indexOf("No available balance for this asset.")).toBeLessThan(reviewHandler.indexOf("findDynamicApprovalWalletForSource"))
    const prepareIndex = submitHandler.indexOf("wallet_withdrawal_prepare_requested")
    const signerIndex = submitHandler.indexOf("sendDynamicPreparedWithdrawal(prepared as WithdrawalPrepareResponse")
    expect(prepareIndex).toBeGreaterThan(-1)
    expect(signerIndex).toBeGreaterThan(prepareIndex)
    expect(submitHandler).not.toContain('refreshDynamicWalletRuntime("withdrawal_submit_before_signing"')
    expect(submitHandler).not.toContain("findDynamicApprovalWalletForSource(walletsRef.current, primaryWalletRef.current")
  })

  // 2026-07-21 production incident: a Solana review POST returned 200
  // (signerCanSign/canSubmit true, approvalMethod dynamic_browser) but
  // prepare/submit were never called, and no error was ever recorded -
  // proving handleSubmitWithdrawal (or its pre-flight signer lookup) threw
  // or returned silently in the browser before any fetch ever fired.
  it("never silently returns or throws uncaught before prepare/submit - every blocking branch is visible and diagnosed", () => {
    const submitHandler = page.slice(
      page.indexOf("async function handleSubmitWithdrawal"),
      page.indexOf("// ---------------------------------------------------------------------------\n  // Early returns")
    )
    const reviewHandler = page.slice(
      page.indexOf("async function handleReviewWithdrawal()"),
      page.indexOf("function handleMaxWithdrawalAmount()")
    )

    // The top-of-function token/request-id guard used to be a bare `return`
    // - completely silent, no error, no log, no network request ever sent.
    expect(submitHandler).not.toMatch(/if \(!token \|\| !withdrawalId\) return\b/)
    expect(submitHandler).toContain('const emitSubmitBlocked = (reason: string) => {')
    for (const reason of [
      "CHECKBOX_NOT_CONFIRMED",
      "SUBMIT_ALREADY_RUNNING",
      "TOKEN_MISSING",
      "REVIEW_MISSING",
      "REQUEST_ID_MISSING",
      "APPROVAL_METHOD_INVALID",
      "RAIL_MISMATCH",
      "ASSET_MISMATCH",
    ]) {
      expect(submitHandler).toContain(reason)
    }
    expect(submitHandler).toContain("wallet_withdrawal_submit_entered")
    expect(submitHandler).toContain("wallet_withdrawal_prepare_requested")
    expect(submitHandler.indexOf("wallet_withdrawal_prepare_requested")).toBeLessThan(
      submitHandler.indexOf("sendDynamicPreparedWithdrawal(prepared as WithdrawalPrepareResponse")
    )
    expect(submitHandler).toContain('stage: "dynamic_post_prepare"')

    // handleReviewWithdrawal's own Dynamic-signer pre-check + fetch must
    // likewise be wrapped so an uncaught throw shows a visible error instead
    // of leaving the merchant stuck on the form with no feedback.
    expect(reviewHandler).toContain('emitWalletSetupDebugEvent("wallet_withdrawal_submit_unhandled_error", {')
    expect(reviewHandler).toContain('stage: "review"')

    // Correlation ID threading + stage beacons, so the next live attempt is
    // traceable end-to-end (browser click -> review -> prepare -> sign -> submit)
    // purely from server-side Vercel logs.
    expect(submitHandler).toContain('"X-PineTree-Withdrawal-Correlation": correlationId')
    expect(submitHandler).toContain("wallet_withdrawal_approve_clicked")
    expect(submitHandler).toContain("wallet_withdrawal_prepare_requested")
    expect(submitHandler).toContain("wallet_withdrawal_prepare_returned")
    expect(submitHandler).toContain("wallet_withdrawal_signature_started")
    expect(submitHandler).toContain("wallet_withdrawal_signature_returned")
    expect(page).toContain("DYNAMIC_SIGNATURE_RECEIVED")
    expect(submitHandler).toContain("wallet_withdrawal_submit_requested")
    expect(submitHandler).toContain("wallet_withdrawal_submit_returned")
    expect(submitHandler).toContain("DYNAMIC_SUBMIT_COMPLETED")
    expect(submitHandler).toContain("wallet_withdrawal_speed_submit_requested")
    expect(submitHandler).toContain("wallet_withdrawal_speed_submit_returned")
  })

  it("the review screen explains why the primary action button is disabled instead of leaving it silently greyed out", () => {
    expect(page).toContain("Confirm the acknowledgment above to enable withdrawal approval.")
    expect(page).toContain("Ready to approve withdrawal.")
    expect(page).toContain("This withdrawal can&apos;t be approved right now")
  })

  it("maps raw schema/cache withdrawal errors to merchant-safe copy via the shared presentation module", () => {
    const errorPresentation = read("engine/withdrawals/withdrawalErrorPresentation.ts")
    expect(page).toContain("sanitizeWithdrawalErrorForMerchant")
    expect(page).toContain("sanitizeWithdrawalSubmitErrorForMerchant")
    expect(page).toContain("presentWithdrawalErrorClient")
    expect(errorPresentation).toContain("schema cache")
    expect(errorPresentation).toContain("amount_decimal")
    expect(errorPresentation).toContain("INTERNAL_LEAK_PATTERN")
    expect(withdrawalApiRoute).toContain("presentWithdrawalError")
  })

  it("withdrawal request DB scaffold exists with review fields and safe statuses", () => {
    const withdrawalMigration =
      migration +
      read("database/migrations/20260625_expand_wallet_withdrawal_requests.sql") +
      read("database/migrations/20260625_add_dynamic_withdrawal_payload_fields.sql") +
      withdrawalProductionSchemaMigration
    expect(withdrawalMigration).toContain("wallet_withdrawal_requests")
    expect(withdrawalMigration).toContain("merchant_id")
    expect(withdrawalMigration).toContain("wallet_profile_id")
    expect(withdrawalMigration).toContain("rail")
    expect(withdrawalMigration).toContain("asset")
    expect(withdrawalMigration).toContain("destination_address")
    expect(withdrawalMigration).toContain("amount_decimal")
    expect(withdrawalMigration).toContain("status")
    expect(withdrawalMigration).toContain("provider")
    expect(withdrawalMigration).toContain("provider_reference")
    expect(withdrawalMigration).toContain("tx_hash")
    expect(withdrawalMigration).toContain("unsigned_transaction_payload")
    expect(withdrawalMigration).toContain("signed_payload")
    expect(withdrawalMigration).toContain("approval_method")
    expect(withdrawalMigration).toContain("chain_id")
    expect(withdrawalMigration).toContain("token_contract")
    expect(withdrawalMigration).toContain("token_mint")
    expect(withdrawalMigration).toContain("review_payload")
    expect(withdrawalMigration).toContain("error_message")
    expect(withdrawalMigration).toContain("updated_at")
    expect(withdrawalMigration).toContain("'review_required'")
    expect(withdrawalMigration).toContain("'blocked'")
  })

  it("production repair migration is idempotent and refreshes the schema cache", () => {
    expect(withdrawalProductionSchemaMigration).toContain("ADD COLUMN IF NOT EXISTS asset")
    expect(withdrawalProductionSchemaMigration).toContain("ADD COLUMN IF NOT EXISTS amount_decimal")
    expect(withdrawalProductionSchemaMigration).toContain("ADD COLUMN IF NOT EXISTS tx_hash")
    expect(withdrawalProductionSchemaMigration).toContain("ADD COLUMN IF NOT EXISTS unsigned_transaction_payload")
    expect(withdrawalProductionSchemaMigration).toContain("ADD COLUMN IF NOT EXISTS signed_payload")
    expect(withdrawalProductionSchemaMigration).toContain("ADD COLUMN IF NOT EXISTS approval_method")
    expect(withdrawalProductionSchemaMigration).toContain("ADD COLUMN IF NOT EXISTS chain_id")
    expect(withdrawalProductionSchemaMigration).toContain("ADD COLUMN IF NOT EXISTS token_contract")
    expect(withdrawalProductionSchemaMigration).toContain("ADD COLUMN IF NOT EXISTS token_mint")
    expect(withdrawalProductionSchemaMigration).toContain("ADD COLUMN IF NOT EXISTS error_message")
    expect(withdrawalProductionSchemaMigration).toContain("ADD COLUMN IF NOT EXISTS updated_at")
    expect(withdrawalProductionSchemaMigration).toContain("NOTIFY pgrst, 'reload schema'")
  })

  it("withdrawal API does not expose provider secrets to the browser", () => {
    expect(withdrawalApiRoute).toContain("submitWalletWithdrawalRequest")
    expect(withdrawalPrepareRoute).toContain("prepareDynamicWalletWithdrawal")
    expect(withdrawalSubmitRoute).toContain("completeDynamicWalletWithdrawal")
    expect(withdrawalApiRoute).not.toContain("FIREBLOCKS_API_KEY")
    expect(withdrawalApiRoute).not.toContain("FIREBLOCKS_API_SECRET")
    expect(withdrawalApiRoute).not.toContain("PRIVATE_KEY")
    expect(withdrawalApiRoute).not.toContain("process.env")
    expect(withdrawalPrepareRoute).not.toContain("DYNAMIC_API_KEY")
    expect(withdrawalPrepareRoute).not.toContain("DYNAMIC_API_SECRET")
    expect(withdrawalPrepareRoute).not.toContain("PRIVATE_KEY")
    expect(withdrawalSubmitRoute).not.toContain("DYNAMIC_API_KEY")
    expect(withdrawalSubmitRoute).not.toContain("DYNAMIC_API_SECRET")
    expect(withdrawalSubmitRoute).not.toContain("PRIVATE_KEY")
  })

  it("prefers Dynamic browser approval without enabling backend Dynamic secrets", () => {
    expect(withdrawalSigner).toContain("dynamicBrowserWithdrawalSigner")
    expect(withdrawalSigner).toContain("NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID")
    expect(withdrawalSigner).toContain("Dynamic is the preferred execution path")
    expect(withdrawalSigner).toContain("throw new Error(\"Dynamic browser approval requires merchant wallet signing\")")
    expect(withdrawalSigner).not.toContain("DYNAMIC_API_KEY")
    expect(withdrawalSigner).not.toContain("DYNAMIC_API_SECRET")
  })

  it("server builds constrained Dynamic payloads from the saved merchant wallet profile", () => {
    expect(withdrawalEngine).toContain("profile.id !== request.wallet_profile_id")
    expect(withdrawalEngine).toContain("getSourceAddressForRail(profile, validated.rail)")
    expect(withdrawalEngine).toContain("BASE_USDC_TOKEN_ADDRESS")
    expect(withdrawalEngine).toContain("SOLANA_USDC_MINT")
    expect(withdrawalEngine).toContain("createTransferCheckedInstruction")
    expect(withdrawalEngine).toContain("SystemProgram.transfer")
    expect(withdrawalEngine).toContain("status: \"processing\"")
    expect(withdrawalEngine).not.toContain("status: \"confirmed\"")
  })

  it("Solana Dynamic approval remains reachable and unavailable Solana fails without signing", () => {
    expect(page).toContain("dynamicApprovalAvailableForWithdrawal")
    expect(page).toContain("kind: \"solana_transaction\"")
    expect(page).toContain("transactionBase64")
    expect(dynamicSignerLookup).toContain("resolveDynamicSolanaSignAndSendCapability")
    expect(page).toContain("const dynamicSubmission = await sendDynamicPreparedWithdrawal")
    expect(page).toContain("if (review.review.approvalMethod === \"dynamic_browser\")")
    expect(page).toContain("Unable to sign this withdrawal. Please try again.")
    expect(page).not.toContain("action: \"submit\"")
  })

  it("legacy Dynamic BTC withdrawal approval is explicitly gated and not the normal merchant-facing Bitcoin path", () => {
    const bitcoinProvider = read("providers/wallets/bitcoinNetworkProvider.ts")
    expect(withdrawalEngine).toContain("isDynamicBtcLegacyEnabled")
    expect(withdrawalEngine).toContain("Bitcoin wallet approval is not available yet.")
    expect(withdrawalSigner).toContain("isDynamicBtcLegacyEnabled()")
    expect(withdrawalEngine).toContain("kind: \"bitcoin_psbt\"")
    expect(withdrawalEngine).toContain("buildBitcoinWithdrawalPsbt")
    expect(withdrawalEngine).toContain("finalizeAndBroadcastBitcoinPsbt")
    expect(page).toContain("signPsbt")
    expect(bitcoinProvider).toContain("BITCOIN_UTXO_PROVIDER")
    expect(bitcoinProvider).toContain("BITCOIN_ESPLORA_BASE_URL")
    expect(bitcoinProvider).toContain("BITCOIN_BROADCAST_ENABLED")
    // Speed connected-account withdrawal is now the default, real Bitcoin
    // path (providers/wallets/bitcoinWithdrawalDestination.ts +
    // speedConnectedAccountWithdrawalSigner) - speedPayoutAvailable reflects
    // genuine signer readiness, never a hardcoded/fabricated value.
    expect(withdrawalEngine).toContain("input.rail === \"bitcoin\" && !input.requiresSourceAddress ? input.signerCanSign : false")
    expect(withdrawalSigner).toContain("speedConnectedAccountWithdrawalSigner")
    expect(withdrawalEngine).not.toContain("nwc")
    expect(withdrawalEngine).not.toContain("spark")
  })

  // -------------------------------------------------------------------------
  // DB profile schema and helper
  // -------------------------------------------------------------------------

  it("pinetree_wallet_profiles migration creates the correct table shape", () => {
    expect(migration).toContain("pinetree_wallet_profiles")
    expect(migration).toContain("merchant_id")
    expect(migration).toContain("dynamic_user_id")
    expect(migration).toContain("base_address")
    expect(migration).toContain("solana_address")
    expect(migration).toContain("bitcoin_lightning_address")
    expect(migration).toContain("bitcoin_onchain_address")
    expect(migration).toContain("status")
    expect(migration).toContain("created_at")
    expect(migration).toContain("updated_at")
    // One profile per merchant
    expect(migration).toContain("UNIQUE")
  })

  it("DB helper exposes getPineTreeWalletProfile and upsertPineTreeWalletProfile", () => {
    expect(dbHelper).toContain("getPineTreeWalletProfile")
    expect(dbHelper).toContain("upsertPineTreeWalletProfile")
    expect(dbHelper).toContain("merchantId")
    expect(dbHelper).toContain("dynamic_user_id")
    expect(dbHelper).toContain("pinetree_wallet_profiles")
  })

  it("DB helper derives profile status from address presence without trusting Dynamic session", () => {
    expect(dbHelper).toContain("deriveProfileStatus")
    expect(dbHelper).toContain('"not_created"')
    expect(dbHelper).toContain('"needs_attention"')
    expect(dbHelper).toContain('"ready"')
  })

  // -------------------------------------------------------------------------
  // API route
  // -------------------------------------------------------------------------

  it("pinetree-profile API route authenticates via merchant JWT before reading or writing", () => {
    expect(apiRoute).toContain("requireMerchantAuthFromRequest")
    expect(apiRoute).toContain("GET")
    expect(apiRoute).toContain("POST")
    expect(apiRoute).toContain("merchantId")
    expect(apiRoute).toContain("getPineTreeWalletProfile")
    expect(apiRoute).toContain("upsertPineTreeWalletProfile")
  })

  it("pinetree-profile API returns actionable 409 before wallet profile creation when Business Profile is incomplete", () => {
    const postRoute = apiRoute.slice(
      apiRoute.indexOf("export async function POST"),
      apiRoute.indexOf("/**\n * GET")
    )
    expect(postRoute).toContain("await assertMerchantBusinessProfileComplete(merchantId)")
    expect(postRoute).toContain('code: "business_profile_required"')
    expect(postRoute).toContain('message: BUSINESS_PROFILE_REQUIRED_MESSAGE')
    expect(postRoute).toContain("retryable: false")
    expect(postRoute).toContain("{ status: 409 }")
    const gateIndex = postRoute.indexOf("await assertMerchantBusinessProfileComplete(merchantId)")
    const profileCreationUpsertIndex = postRoute.indexOf("const profile = await upsertPineTreeWalletProfile({", gateIndex)
    expect(gateIndex).toBeLessThan(postRoute.indexOf("findPineTreeWalletProfileByAddress"))
    expect(gateIndex).toBeLessThan(profileCreationUpsertIndex)
    expect(gateIndex).toBeLessThan(postRoute.indexOf("scheduleWalletReadiness(profile)"))
  })

  it("pinetree-profile API does not run BTC provisioning during Base/Solana profile sync", () => {
    expect(apiRoute).toContain("provisionMerchantBitcoinAddress")
    expect(apiRoute).toContain("existingProfile")
    expect(apiRoute).toContain("hasBtcAddressInput && normalizedBtcAddress")
    expect(apiRoute).toContain("dynamicBtcAddress: normalizedBtcAddress")
    expect(apiRoute).toContain("btcWalletProvisioningStatus: bitcoinProvisioning?.status")
    expect(apiRoute).toContain("btcWalletProvisioningError: bitcoinProvisioning ? bitcoinProvisioning.error || null : undefined")
  })

  it("pinetree-profile API does not overwrite an existing btc_address with null", () => {
    expect(apiRoute).toContain('const btcAddressAlreadyExists = bitcoinProvisioning?.status === "already_exists"')
    expect(apiRoute).toContain("btcAddress: btcAddressIsReady && !btcAddressAlreadyExists ? provisionedBtcAddress : undefined")
  })

  // -------------------------------------------------------------------------
  // Error / config states
  // -------------------------------------------------------------------------

  it("handles missing configuration, unavailable SDK, and profile load errors", () => {
    expect(provider).toContain("if (!environmentId)")
    expect(provider).toContain("WalletInfrastructureErrorBoundary")
    expect(page).toContain('kind="missing-env"')
    expect(page).toContain('kind="sdk"')
    expect(page).toContain('{ kind: "error" }')
    expect(page).toContain('"Not connected"')
    expect(page).toContain('"Connected"')
    expect(page).toContain('"Needs attention"')
    expect(page).toContain('status="Loading"')
    expect(page).not.toContain("Wallet activity will appear here.")
    expect(page).not.toContain("syncing is not enabled yet")
  })

  // -------------------------------------------------------------------------
  // POS / checkout isolation — must not be affected
  // -------------------------------------------------------------------------

  it("does not expose wallet infrastructure as a merchant provider", () => {
    expect(providerPage).not.toMatch(/provider=["']dynamic["']/i)
    expect(providerPage).not.toMatch(/name=["']Dynamic["']/)
  })

  it("wallet setup page only calls wallet APIs and provider rail enablement, not POS or checkout APIs", () => {
    expect(page).toContain("/api/wallets/pinetree-profile")
    expect(page).toContain("/api/wallets/pinetree/sync")
    expect(page).toContain("/api/wallets/lightning/pinetree-managed")
    expect(page).toContain("/api/providers")
    expect(page).not.toContain("/api/wallets/settlement")
    expect(page).not.toContain("/api/wallets/send-sessions")
    expect(page).not.toContain("/api/pos")
    expect(page).not.toContain("/api/dashboard/checkout")
  })

  it("removes external wallet controls from this page", () => {
    expect(page).not.toContain("Advanced wallet options")
    expect(page).not.toContain("Connect external wallet")
  })

  it("filters Dynamic wallet setup to embedded PineTree wallet options only", () => {
    expect(provider).toContain("walletsFilter: filterPineTreeMerchantWalletOptions")
    expect(provider).toContain("isEmbeddedWallet")
    expect(provider).toContain('"dynamicwaas"')
    expect(provider).toContain('"turnkey"')
    for (const blocked of [
      '"metamask"',
      '"coinbase"',
      '"walletconnect"',
      '"phantom"',
      '"solflare"',
      '"trust"',
    ]) {
      expect(provider).toContain(blocked)
    }
  })

  it("declares the required SDK packages", () => {
    for (const dependency of [
      "@dynamic-labs/sdk-react-core",
      "@dynamic-labs/ethereum",
      "@dynamic-labs/solana",
      "@dynamic-labs/bitcoin",
    ]) {
      expect(packageJson.dependencies[dependency]).toBe("^4.92.4")
    }
    expect(provider).not.toContain("@dynamic-labs/spark")
  })

  // -------------------------------------------------------------------------
  // PineTree-managed Lightning backend (Session 2)
  // -------------------------------------------------------------------------

  it("loads lightning profile in parallel with the wallet profile", () => {
    expect(page).toContain("/api/wallets/lightning/pinetree-managed")
    expect(page).toContain("lightningProfileState")
    expect(page).toContain("LightningProfileState")
    // Both fetched in a single Promise.all so neither blocks the other
    expect(page).toContain("Promise.all")
  })

  it("Bitcoin display readiness is not derived from a Dynamic Spark address", () => {
    // Readiness is driven by the DB record, not any Spark address returned by Dynamic
    expect(page).toContain("railReadiness?.bitcoin_lightning.walletProvisioned")
    expect(page).toContain("function WalletOverviewSummary")
    // No old pattern that checked Spark address length
    expect(page).not.toContain("profileAddresses.lightning.length > 0")
    expect(page).not.toContain("lightningAddress.length")
  })

  it("PineTree Wallet can be created with Base/Solana active while BTC payout sync is internal", () => {
    // hasWallet is true once Base or Solana is active — Lightning pending does not block it
    expect(page).toContain("const hasWallet = profileState.kind")
    expect(page).toContain("baseReady || solanaReady")
    expect(page).not.toContain("baseReady || solanaReady || btcPayoutReady || bitcoinReady")
    // lightningPending is a valid state for an active wallet
    expect(page).not.toContain("lightningPending")
    expect(page).not.toContain("lightningRetryable")
  })

  it("syncs PineTree-managed Bitcoin automatically and does not render a merchant CTA", () => {
    expect(page).not.toContain("Enable Bitcoin Lightning")
    expect(page).not.toContain("handleEnableLightning")
    expect(apiRoute).toContain("scheduleWalletReadiness(profile)")
    // Uses a POST fetch to the internal route — no redirect to Speed sign-up
    expect(page).toContain("/api/wallets/lightning/pinetree-managed")
    expect(page).not.toContain("speed.com")
    expect(page).not.toContain("tryspeed.com")
    expect(page).not.toContain("router.push")
  })

  it("does not render Bitcoin setup pending copy or retry controls", () => {
    expect(page).not.toContain("Bitcoin address pending")
    expect(page).not.toContain("Bitcoin Lightning is being prepared through PineTree")
    expect(page).not.toContain("Base and Solana can be used while PineTree prepares Bitcoin")
    expect(page).not.toContain("PineTree is enabling your Lightning rail")
    expect(page).not.toContain("lightningRetryable")
  })

  it("does not ask the merchant to sign up for Speed, paste keys, or connect NWC", () => {
    expect(page).not.toContain("Sign up for Speed")
    expect(page).not.toContain("TrySpeed")
    expect(page).not.toContain("speed.com")
    expect(page).not.toContain("Connect NWC")
    expect(page).not.toContain("Connect Spark")
    expect(page).not.toContain("Spark setup")
    expect(page).not.toContain("nostr+walletconnect")
    expect(page).not.toContain("Paste your")
    expect(page).not.toContain("Speed API key")
    expect(page).not.toContain("Bitcoin payouts route to your PineTree Bitcoin wallet")
    expect(page).not.toContain("Bitcoin payments are handled automatically by PineTree")
    expect(page).not.toContain("Bitcoin receiving is managed automatically by PineTree")
  })

  it("does not expose Speed API keys or secrets to the browser", () => {
    expect(page).not.toContain("SPEED_API_KEY")
    expect(page).not.toContain("SPEED_SECRET")
    expect(page).not.toContain("speed_secret")
    // The lightning API route response only contains a safe profile shape, not secrets
    expect(lightningApiRoute).toContain("safeLightningProfile")
    expect(lightningReadinessEngine).toContain("SPEED_API_KEY_present")
    expect(lightningApiRoute).not.toContain("speed_account_secret")
    expect(lightningApiRoute).not.toContain("sk_live_")
    expect(lightningApiRoute).not.toContain("sk_test_")
    // API route comments confirm security intent
    expect(lightningApiRoute).toContain("No Speed API keys or secrets are returned to the browser")
    expect(speedConnectedAccountHelper).not.toContain("NEXT_PUBLIC_SPEED")
  })

  it("merchant_lightning_profiles migration creates the correct table shape", () => {
    expect(lightningMigration).toContain("merchant_lightning_profiles")
    expect(lightningMigration).toContain("merchant_id")
    expect(lightningMigration).toContain("provider")
    expect(lightningMigration).toContain("status")
    expect(lightningMigration).toContain("speed_connected_account_id")
    expect(lightningMigration).toContain("speed_connect_setup_url")
    expect(lightningMigration).toContain("provider_response_summary")
    expect(lightningMigration).toContain("provider_error_message")
    expect(lightningMigration).toContain("setup_source")
    expect(lightningMigration).toContain("UNIQUE")
    expect(speedConnectMigration).toContain("speed_connect_setup_url")
    expect(speedConnectMigration).toContain("provider_response_summary")
    expect(speedConnectMigration).toContain("provider_error_message")
  })

  it("lightning DB helper exposes readiness derivation and safe mutation functions only", () => {
    expect(lightningDbHelper).toContain("deriveLightningReadiness")
    expect(lightningDbHelper).toContain("getMerchantLightningProfile")
    expect(lightningDbHelper).toContain("markMerchantLightningPending")
    expect(lightningDbHelper).toContain("markMerchantLightningReady")
    // Readiness comes from profile.status
    expect(lightningDbHelper).toContain('"pending"')
    expect(lightningDbHelper).toContain('"ready"')
    // No secrets stored here
    expect(lightningDbHelper).not.toContain("SPEED_API_KEY")
  })

  it("pinetree-managed lightning API route requires merchant JWT and returns profile only", () => {
    expect(lightningApiRoute).toContain("requireMerchantIdFromRequest")
    expect(lightningApiRoute).toContain("GET")
    expect(lightningApiRoute).toContain("POST")
    expect(lightningApiRoute).toContain("getMerchantLightningProfile")
    expect(lightningApiRoute).toContain("isSpeedPlatformTreasurySweepEnabled")
    expect(lightningApiRoute).toContain("btc_address_present")
    expect(lightningApiRoute).toContain("btc_payout_enabled")
    // POST delegates provisioning to the shared ensure-function rather than
    // calling the merchant-facing invite-link Speed Connect helper directly.
    expect(lightningApiRoute).toContain("ensureManagedLightningForMerchant")
    expect(lightningApiRoute).not.toContain("createOrLinkSpeedConnectedAccountForMerchant")
  })

  it("Speed connected-account helper is server-side and uses documented Speed Connect account links", () => {
    expect(speedConnectedAccountHelper).toContain("createOrLinkSpeedConnectedAccountForMerchant")
    expect(speedConnectedAccountHelper).toContain("CreateOrLinkSpeedConnectedAccountInput")
    expect(speedConnectedAccountHelper).toContain("merchant_id")
    expect(speedConnectedAccountHelper).toContain("business_name")
    expect(speedConnectedAccountHelper).toContain("merchant_email")
    expect(speedConnectedAccountHelper).toContain("pinetree_reference_id")
    expect(speedConnectedAccountHelper).toContain("speed_connected_account_id")
    expect(speedConnectedAccountHelper).toContain("speed_connected_account_status")
    expect(speedConnectedAccountHelper).toContain("setup_url")
    expect(speedConnectedAccountHelper).toContain("provider_response_summary")
    expect(speedConnectedAccountHelper).toContain("error_message")
    expect(speedConnectedAccountHelper).toContain("createSpeedConnectAccountLink")
    expect(speedConnectedAccountHelper).toContain("listSpeedConnectedAccounts")
    expect(speedConnectedAccountHelper).toContain("retrieveSpeedConnectedAccount")
    expect(speedConnectedAccountHelper).toContain("invite_account_link")
    expect(speedConnectedAccountHelper).not.toContain("/accounts")
    expect(speedConnectedAccountHelper).not.toContain("/sub-merchants")
  })

  it("Speed Connect env vars are server-only and minimal", () => {
    expect(speedConnectedAccountHelper).toContain("SPEED_CONNECT_ENABLED")
    expect(speedConnectedAccountHelper).toContain("SPEED_CONNECT_RETURN_URL")
    expect(speedConnectedAccountHelper).toContain("speed_api_key_missing")
    expect(speedConnectedAccountHelper).not.toContain("NEXT_PUBLIC_SPEED_CONNECT")
    expect(page).not.toContain("SPEED_CONNECT_ENABLED")
    expect(page).not.toContain("SPEED_CONNECT_RETURN_URL")
  })

  it("Speed client exposes documented Connect methods through server-side Speed auth", () => {
    expect(speedClient).toContain("SPEED_API_KEY")
    expect(speedClient).toContain("SPEED_API_BASE_URL")
    expect(speedClient).toContain("createSpeedConnectAccountLink")
    expect(speedClient).toContain("/connect/generate/account-link")
    expect(speedClient).toContain("retrieveSpeedConnectedAccount")
    expect(speedClient).toContain("/connect/${encodeURIComponent(id)}")
    expect(speedClient).toContain("listSpeedConnectedAccounts")
    expect(speedClient).toContain('"/connect"')
  })

  it("managed Custom Connect persists Speed acct_ and ca_ identifiers separately", () => {
    expect(lightningReadinessEngine).toContain("function speedAccountId(value?: string | null): string | null {")
    expect(lightningReadinessEngine).toContain('return id.startsWith("acct_") ? id : null')
    expect(lightningReadinessEngine).toContain("function speedRelationshipId(value?: string | null): string | null {")
    expect(lightningReadinessEngine).toContain('return id.startsWith("ca_") ? id : null')
    expect(lightningReadinessEngine).toContain("const createdAccountId = speedAccountId(speedSetup.speed_account_id)")
    expect(lightningReadinessEngine).toContain("const createdRelationshipId = speedRelationshipId(speedSetup.speed_connected_account_relationship_id)")
    expect(lightningReadinessEngine).toContain("speedConnectedAccountId: createdAccountId || createdRelationshipId")
    expect(lightningReadinessEngine).toContain("speedConnectedAccountRelationshipId: createdRelationshipId")
    expect(lightningReadinessEngine).toContain("speedAccountId: createdAccountId")
    expect(lightningReadinessEngine).toContain("managedAccountEmail: speedEmail")
  })

  it("managed Lightning POST records canonical treasury-sweep state without secrets", () => {
    expect(lightningReadinessEngine).toContain("[pinetree-managed-lightning] treasury_sweep_post_start")
    expect(lightningReadinessEngine).toContain("lightning_provider")
    expect(lightningReadinessEngine).toContain("settlement_mode")
    expect(lightningReadinessEngine).toContain("SPEED_API_KEY_present")
    expect(lightningReadinessEngine).toContain("SPEED_WEBHOOK_SECRET_present")
    expect(lightningReadinessEngine).toContain("SPEED_API_BASE_URL")
    expect(lightningReadinessEngine).toContain("final_saved_profile_status")
    expect(lightningReadinessEngine).toContain("speed_platform_config_missing")
  })

  it("merchant Lightning profile requires BTC address to be ready before status is ready", () => {
    expect(lightningReadinessEngine).toContain("const btcAddressReady = Boolean(walletProfile?.btc_address && walletProfile.btc_payout_enabled)")
    expect(lightningReadinessEngine).toContain("walletProfile?.btc_address && walletProfile.btc_payout_enabled")
    expect(lightningReadinessEngine).toContain("const status: MerchantLightningProfileStatus = !speedConfig.configured")
    expect(lightningReadinessEngine).toContain("!btcAddressReady")
    expect(lightningReadinessEngine).toContain('internal_readiness_issue: btcAddressReady ? null : "btc_address_missing"')
    expect(lightningReadinessEngine).not.toContain('"Bitcoin address pending for PineTree Wallet."')
  })

  it("Lightning stays pending when Speed returns only an invite/setup link", () => {
    expect(speedConnectedAccountHelper).toContain("speed_connect_invite_created")
    expect(speedConnectedAccountHelper).toContain("setupUrl")
    expect(speedConnectedAccountHelper).toContain('status: "pending"')
    expect(speedConnectedAccountHelper).toContain('source: "existing_connected_account"')
  })

  it("Lightning stays pending and does not fake ready on missing endpoint or missing account id", () => {
    expect(speedConnectedAccountHelper).toContain('return "pending"')
    expect(speedConnectedAccountHelper).toContain("speed_connect_disabled")
    expect(speedConnectedAccountHelper).toContain("speed_api_key_missing")
    expect(speedConnectedAccountHelper).toContain("speed_connect_return_url_missing")
    expect(speedConnectedAccountHelper).toContain("Speed connected account was not found")
    expect(lightningReadinessEngine).toContain('"btc_address_missing_internal"')
    expect(lightningReadinessEngine).toContain("function deriveSpeedIntakeStatus")
    expect(lightningReadinessEngine).toContain('if (input.speedAccountId && isActiveSpeedStatus(input.providerStatus)) return "ready"')
    expect(lightningReadinessEngine).toContain('if (input.fallback === "needs_attention") return "needs_attention"')
    expect(lightningReadinessEngine).toContain('return "pending"')
    expect(lightningReadinessEngine).toContain("providerStatus: normalizedSpeedStatus")
    expect(lightningReadinessEngine).toContain("speedAccountId: createdAccountId")
    expect(lightningReadinessEngine).toContain("fallback: speedSetup.readiness")
  })

  it("syncs PineTree Wallet Lightning fields from the managed Lightning profile", () => {
    expect(lightningReadinessEngine).toContain('bitcoinLightningProvider: "speed"')
    expect(lightningReadinessEngine).toContain('bitcoinLightningReceiveMode: "invoice"')
    expect(lightningReadinessEngine).toContain("bitcoinLightningStatus: lightningProfile.status")
    expect(dbHelper).toContain("bitcoinLightningReceiveMode")
  })

  it("Speed Connect return route is removed (canonical treasury-sweep mode, no merchant Speed OAuth)", () => {
    // The connect-return route was part of the merchant-facing Speed Connect OAuth flow.
    // In canonical mode, Lightning is managed through PineTree's platform account, so this
    // merchant-facing OAuth callback route has been intentionally deleted.
    expect(speedConnectReturnRouteExists).toBe(false)
  })

  it("existing POS and checkout payment creation remain unchanged", () => {
    expect(speedClient).toContain("createSpeedLightningPayment")
    expect(speedAdapter).toContain("createLightningInvoice")
    expect(speedAdapter).toContain("resolveMerchantSpeedAccount")
    expect(speedAdapter).toContain("resolveSpeedHeaderAccountId")
    expect(paymentsRoute).toContain("getSafeSpeedCustomerErrorMessage")
    expect(page).not.toContain("/api/payments")
    expect(page).not.toContain("createSpeedLightningPayment")
  })

  it("legacy merchant-facing Speed Connect route is removed (canonical mode only)", () => {
    // The Speed Connect merchant account setup flow has been replaced by the
    // canonical PineTree treasury-sweep mode. The route is intentionally deleted.
    const fs = require("node:fs")
    const path = require("node:path")
    expect(
      fs.existsSync(path.join(process.cwd(), "app/api/wallets/lightning/speed/connect/route.ts"))
    ).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Withdrawal approval state machine — Task 3
  // -------------------------------------------------------------------------

  it("UI never renders both a withdrawal error and Approve withdrawal simultaneously", () => {
    // Approval errors render on the failed screen, away from the review screen button.
    expect(page).toContain('if (screen === "failed")')
    expect(page).toContain("withdrawalApprovalError")
    expect(page).toContain('setWithdrawalScreen("failed")')
  })

  it("valid Solana review with Dynamic approvalMethod shows Approve withdrawal button", () => {
    expect(page).toContain('if (screen === "review" && review)')
    expect(page).toContain("\"Approve withdrawal\"")
    expect(page).toContain("Confirm the withdrawal details before approving.")
  })

  it("clicking Approve calls the prepare route before signing", () => {
    // handleSubmitWithdrawal routes to prepare first when approvalMethod is dynamic_browser
    expect(page).toContain("if (review.review.approvalMethod === \"dynamic_browser\")")
    expect(page).toContain("/api/wallets/pinetree-wallet/withdrawals/${encodeURIComponent(withdrawalId)}/prepare")
    // prepare is fetched with POST before sendDynamicPreparedWithdrawal is called
    const submitFn = page.slice(page.indexOf("async function handleSubmitWithdrawal"), page.indexOf("// ---------------------------------------------------------------------------\n  // Early returns"))
    const prepareIndex = submitFn.indexOf("/prepare")
    const signingIndex = submitFn.indexOf("sendDynamicPreparedWithdrawal")
    expect(prepareIndex).toBeGreaterThan(-1)
    expect(signingIndex).toBeGreaterThan(prepareIndex)
  })

  it("Solana prepared transaction calls Dynamic signAndSendTransaction", () => {
    // sendDynamicPreparedWithdrawal handles the solana_transaction payload kind
    expect(page).toContain("signAndSendTransaction")
    expect(page).toContain("transactionBase64")
    expect(page).toContain("kind: \"solana_transaction\"")
    expect(dynamicSignerLookup).toContain("resolveDynamicSolanaSignAndSendCapability")
    // The transaction bytes are deserialised from the server-built base64 payload
    expect(page).toContain("deserializePreparedSolanaTransaction(prepared)")
  })

  it("returned tx hash from signing is sent to the submit route", () => {
    // After signing succeeds, the hash is POSTed to the submit endpoint
    expect(page).toContain("/api/wallets/pinetree-wallet/withdrawals/${encodeURIComponent(withdrawalId)}/submit")
    expect(page).toContain("tx_hash: dynamicSubmission.txHash || \"\"")
    expect(page).toContain("provider_reference: dynamicSubmission.providerReference || dynamicSubmission.txHash || \"\"")
  })

  it("successful Dynamic signing sets the withdrawal to Processing status", () => {
    // completeDynamicWalletWithdrawal stores status: "processing" after a valid txHash
    expect(withdrawalEngine).toContain("status: \"processing\"")
    expect(withdrawalEngine).toContain("merchantStatus: \"Processing\"")
    expect(withdrawalEngine).toContain("txHash")
    // Confirmed status is never set without a real on-chain result
    expect(withdrawalEngine).not.toContain("status: \"confirmed\"")
  })

  it("UI shows transaction reference after successful Dynamic approval", () => {
    // After submit succeeds, the page renders the withdrawalSubmitResult with a reference
    expect(page).toContain("Transaction reference:")
    expect(page).toContain("submitResult.request.provider_reference")
    expect(page).toContain("Withdrawal submitted")
    expect(page).toContain("setWithdrawalSubmitResult(submitted as WithdrawalSubmitResponse)")
  })

  it("missing Dynamic signer does not show Approve withdrawal", () => {
    // When no matching wallet is found at signing time, sendDynamicPreparedWithdrawal throws
    // and the catch block moves to the failed screen — the review button cannot coexist with the error.
    expect(page).toContain("Reconnect PineTree Wallet to verify secure signing access.")
    expect(page).toContain("sanitizeWithdrawalSubmitErrorForMerchant(error instanceof Error ? error.message : undefined)")
    expect(page).toContain('setWithdrawalScreen("failed")')
    expect(page).not.toContain("// Signing failure (Dynamic path) reaches here. Clear the stale review")
  })

  it("merchant rejection gets explicit no-funds-moved withdrawal copy", () => {
    expect(page).toContain("Withdrawal authorization was canceled. No funds were sent.")
    expect(page).toContain("user rejected|user denied|rejected by user|approval rejected|request rejected|denied transaction")
  })

  it("Bitcoin withdrawal availability never falls back to the legacy default-payout-destination flag", () => {
    const bitcoinReadyDecl = page.slice(
      page.indexOf("const bitcoinReady ="),
      page.indexOf("const coreWalletProfileReady =")
    )
    expect(bitcoinReadyDecl).not.toContain("btc_payout_enabled")
    expect(bitcoinReadyDecl).not.toContain("btcPayoutReady")
    expect(bitcoinReadyDecl).toContain("railReadiness?.bitcoin_lightning.walletProvisioned")
    expect(page).not.toContain("btcPayoutReady")
  })

  it("review signer gate gives Base/Solana one bounded hydration retry before failing, and never applies to Bitcoin", () => {
    const reviewHandler = page.slice(
      page.indexOf("async function handleReviewWithdrawal()"),
      page.indexOf("function handleMaxWithdrawalAmount()")
    )
    expect(reviewHandler).toContain("usesDynamicSignerForReview")
    expect(reviewHandler).toContain('await refreshDynamicWalletRuntime("withdrawal_review_before_signer_check", { requireApprovalWallet: true })')
    // The retry must be gated on usesDynamicSignerForReview (base/solana only) - Bitcoin
    // returns above (client-side synthetic review) well before this gate is ever reached.
    const retryIndex = reviewHandler.indexOf("await refreshDynamicWalletRuntime(\"withdrawal_review_before_signer_check\"")
    const bitcoinReturnIndex = reviewHandler.indexOf('if (withdrawalRail === "bitcoin") {')
    expect(bitcoinReturnIndex).toBeGreaterThan(-1)
    expect(bitcoinReturnIndex).toBeLessThan(retryIndex)
  })

  it("withdrawal error taxonomy includes signer/session/authorization-specific codes", () => {
    const errorsFile = read("engine/wallet/walletErrors.ts")
    const presentationFile = read("engine/withdrawals/withdrawalErrorPresentation.ts")
    for (const code of ["WALLET_NOT_CONNECTED", "SIGNER_NOT_AVAILABLE", "AUTHORIZATION_REJECTED", "STATUS_UNKNOWN", "WITHDRAWAL_FAILED", "UNSUPPORTED_RAIL"]) {
      expect(errorsFile).toContain(`"${code}"`)
      expect(presentationFile).toContain(`${code}:`)
    }
  })

  it("missing Dynamic signer fails instead of creating a manual review request", () => {
    expect(page).toContain("\"Submit withdrawal request\"")
    expect(page).toContain('setWithdrawalApprovalError("This withdrawal cannot be signed in this browser session.")')
    expect(page).not.toContain("action: \"submit\"")
    expect(page).not.toContain("withdrawal_id: withdrawalId")
  })

  it("stale withdrawal review is cleared when amount, address, rail, or asset changes", () => {
    // handleWithdrawalAssetSelect clears review
    expect(page).toContain("function handleWithdrawalAssetSelect(")
    expect(page).toContain("setWithdrawalRail(nextRail)")
    expect(page).toContain("setWithdrawalAsset(nextAsset)")
    // All change handlers clear stale review
    const assetSelect = page.slice(
      page.indexOf("function handleWithdrawalAssetSelect("),
      page.indexOf("async function handleReviewWithdrawal(")
    )
    expect(assetSelect).toContain("setWithdrawalReview(null)")
    // handleReviewWithdrawal also clears review at the top of each new review
    expect(page).toContain("setWithdrawalReview(null)")
  })

  it("Base ETH withdrawal uses the EVM Dynamic path with an evm_transaction payload", () => {
    expect(withdrawalEngine).toContain("kind: \"evm_transaction\"")
    // ETH transfer sends value directly to the destination
    expect(withdrawalEngine).toContain("SystemProgram.transfer")
    // Engine dispatches evm_transaction for Base
    const engineBase = withdrawalEngine.slice(
      withdrawalEngine.indexOf("kind: \"evm_transaction\""),
      withdrawalEngine.indexOf("kind: \"evm_transaction\"") + 300
    )
    expect(engineBase).toContain("evm_transaction")
  })

  it("Base USDC withdrawal uses EVM path with token contract address", () => {
    // Token transfers encode the ERC-20 contract address and transfer calldata
    expect(withdrawalEngine).toContain("BASE_USDC_TOKEN_ADDRESS")
    expect(withdrawalEngine).toContain("to: BASE_USDC_TOKEN_ADDRESS")
    expect(withdrawalEngine).toContain("tokenContract: prepared.rail === \"base\" && prepared.asset === \"USDC\" ? BASE_USDC_TOKEN_ADDRESS : null")
    // prepare stores the token_contract for client-side verification
    expect(withdrawalProductionSchemaMigration).toContain("token_contract")
  })

  it("provider disabled state does not block withdrawal when source address exists", () => {
    // Withdrawal availability is driven by address presence (walletConnected / configured),
    // not by whether a payment provider is enabled for that rail.
    // Note: rail display chips DO use row.enabled && row.configured — that is intentional.
    // Only the withdrawable-asset calculation must use configured alone.
    expect(page).toContain("const noWithdrawableAssets = assetOptions.length === 0")
    expect(page).toContain("withdrawalWalletRows")
    // The withdrawable-assets useMemo filters by configured (address present) not enabled
    const withdrawableSection = page.slice(
      page.indexOf("const withdrawableAssetOptions = useMemo"),
      page.indexOf("const withdrawableAssetOptions = useMemo") + 400
    )
    expect(withdrawableSection).toContain(".filter((row) => row.configured)")
    expect(withdrawableSection).not.toContain("row.enabled")
  })

  it("no confirmed status is ever set without a real chain confirmation", () => {
    const allWithdrawalSource = [withdrawalEngine, withdrawalApiRoute, withdrawalPrepareRoute, withdrawalSubmitRoute].join("\n")
    expect(allWithdrawalSource).not.toContain("status: \"confirmed\"")
    // Processing is the terminal client-visible state; confirmed is set only by webhooks
    expect(withdrawalEngine).toContain("status: \"processing\"")
    expect(withdrawalEngine).toContain("merchantStatus: \"Processing\"")
  })

  it("prepare and submit routes never return provider secrets or raw transaction payloads to the browser", () => {
    // Prepare returns only the unsigned payload kind + fields the client needs to sign
    expect(withdrawalPrepareRoute).not.toContain("DYNAMIC_API_KEY")
    expect(withdrawalPrepareRoute).not.toContain("DYNAMIC_API_SECRET")
    expect(withdrawalPrepareRoute).not.toContain("PRIVATE_KEY")
    expect(withdrawalPrepareRoute).not.toContain("process.env")
    expect(withdrawalSubmitRoute).not.toContain("DYNAMIC_API_KEY")
    expect(withdrawalSubmitRoute).not.toContain("DYNAMIC_API_SECRET")
    expect(withdrawalSubmitRoute).not.toContain("PRIVATE_KEY")
    expect(withdrawalSubmitRoute).not.toContain("process.env")
    // The debug logging in the page only logs safe metadata — no secrets
    expect(page).toContain("console.info(\"[pinetree-withdrawals] approval_state\"")
    expect(page).not.toContain("DYNAMIC_EXTERNAL_JWT_PRIVATE_KEY")
    expect(page).not.toContain("DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64")
    expect(page).not.toContain("DYNAMIC_API_KEY")
  })

  // -------------------------------------------------------------------------
  // Withdrawal execution: Dynamic signing paths — Task 4
  // -------------------------------------------------------------------------

  it("Dynamic Solana signing uses a shared active-account helper that preserves this binding", () => {
    // Method extraction (const fn = obj.method; fn()) loses 'this' in strict mode.
    // signAndSendTransaction on TurnkeySolanaWalletConnector calls this.walletUiUtils, so
    // 'this' must remain the connector object — inline ?. calls guarantee that.
    expect(page).toContain("signDynamicSolanaTransactionWithActiveAccount(")
    expect(dynamicSignerLookup).toContain("capability.signAndSendTransaction(transaction)")
    expect(dynamicSignerLookup).toContain("resolveDynamicSolanaSignAndSendCapability(wallet)")
    expect(dynamicSignerLookup).toContain("txResult = await withTimeout(")
    expect(page).not.toContain("const signAndSendTransaction = wallet.signAndSendTransaction")
  })

  it("Dynamic Solana signer normalizes string, object, and nested return shapes", () => {
    // TurnkeySolanaWalletConnector.signAndSendTransaction returns a string.
    // ISolana (injected wallets like Phantom) returns { signature: string }.
    // Both must be normalised to a plain hash string before submitting.
    expect(dynamicSignerLookup).toContain("export function normalizeDynamicSolanaSignature")
    expect(dynamicSignerLookup).toContain('"signature"')
    expect(dynamicSignerLookup).toContain('"txHash"')
    expect(dynamicSignerLookup).toContain('"transactionSignature"')
    expect(dynamicSignerLookup).toContain('for (const key of ["result", "response", "data"])')
  })

  it("wallet not found in Dynamic session shows reconnect error and logs signer_not_found", () => {
    // When wallets[] from useUserWallets() contains no wallet matching the saved DB address,
    // we emit a safe diagnostic log and throw a reconnect-guidance error — not the generic copy.
    expect(page).toContain("console.info(\"[pinetree-withdrawals] signer_not_found\"")
    expect(page).toContain("Reconnect PineTree Wallet to verify secure signing access.")
    expect(page).toContain("dynamicWalletCount:")
    expect(page).toContain("hasAnyDynamicWallet")
  })

  it("Dynamic Base EVM signing calls getWalletClient inline and dispatches sendTransaction", () => {
    // getWalletClient must be called through the wallet/connector owner so 'this' is preserved
    // (TurnkeyEVMWalletConnector.getWalletClient reads this.turnkeyAddress).
    expect(page).toContain("await wallet.getWalletClient?.(chainIdStr)")
    expect(page).toContain("await wallet.connector?.getWalletClient?.(chainIdStr)")
    expect(page).toContain("client.sendTransaction({")
    expect(page).toContain("BigInt(prepared.payload.value)")
  })

  it("missing Base wallet client throws signing-unavailable error instead of falling back to manual review", () => {
    // When getWalletClient returns undefined or a client without sendTransaction,
    // the EVM path throws an actionable signing error — not a pending-review request.
    expect(page).toContain("if (!client?.sendTransaction)")
    expect(page).toContain("Unable to sign this withdrawal. Please try again.")
    expect(page).not.toContain("action: \"submit\"")
  })

  it("sanitizer passes through session reconnect errors and blocks internal signer copy", () => {
    // Both session-not-active and session-mismatch errors must reach the UI for merchant guidance.
    expect(page).toContain("if (raw.includes(\"PineTree Wallet is not active in this browser session\")) return pineTreeSignerReconnectMessage")
    expect(page).toContain("if (raw.includes(\"different PineTree Wallet session\")) return raw")
    expect(page).toContain("if (raw === pineTreeSignerReconnectMessage) return raw")
    // The old generic signer passthrough is removed — use the new actionable messages instead.
    expect(page).not.toContain("if (raw === \"PineTree Wallet signer is not available for this asset yet.\") return raw")
  })

  // -------------------------------------------------------------------------
  // Withdrawal reconnect recovery — Task 5
  // -------------------------------------------------------------------------

  it("failed screen with session failure shows Open PineTree Wallet and Edit withdrawal", () => {
    // isSignerSessionError drives which primary button appears on the failed screen.
    expect(page).toContain("isSignerSessionError")
    expect(page).toContain("pineTreeSignerReconnectMessage")
    expect(page).toContain("different PineTree Wallet session")
    // Primary reconnect button on the failed screen
    expect(page).toContain("isSignerSessionError && onOpenWallet")
    // Edit withdrawal is always the secondary button
    expect(page).toContain("Edit withdrawal")
  })

  it("Open PineTree Wallet action clears failed state and preserves withdrawal form values", () => {
    // handleWithdrawalReconnect resets the screen to form so the preserved values (rail/asset/
    // destination/amount) are visible when the merchant navigates back to the Withdraw tab.
    expect(page).toContain("function handleWithdrawalReconnect()")
    expect(page).toContain("setWithdrawalScreen(\"form\")")
    expect(page).toContain("setWithdrawalReview(null)")
    expect(page).toContain("setWithdrawalApprovalError(\"\")")
    // Form values (rail, asset, destination, amount) are NOT cleared in reconnect
    const reconnectFn = page.slice(
      page.indexOf("function handleWithdrawalReconnect()"),
      page.indexOf("function handleCreateWallet()")
    )
    expect(reconnectFn).not.toContain("setWithdrawalRail")
    expect(reconnectFn).not.toContain("setWithdrawalAsset")
    expect(reconnectFn).not.toContain("setWithdrawalDestination")
    expect(reconnectFn).not.toContain("setWithdrawalAmount")
  })

  it("reconnect handler calls syncProfileFromDynamic to resync wallet profile", () => {
    // After clearing the error state, the handler resyncs in case the wallet reconnected.
    expect(page).toContain("void syncProfileFromDynamic()")
    const reconnectFn = page.slice(
      page.indexOf("function handleWithdrawalReconnect()"),
      page.indexOf("function handleCreateWallet()")
    )
    expect(reconnectFn).toContain("syncProfileFromDynamic")
  })

  it("reconnect handler suppresses Dynamic auth flow for already-ready wallets", () => {
    // When no Dynamic wallets are active (wallets[] empty, no primaryWallet), the handler
    // opens the temporary Dynamic email fallback and then waits
    // for wallets to update — it does NOT just navigate to the overview tab.
    const reconnectFn = page.slice(
      page.indexOf("function handleWithdrawalReconnect()"),
      page.indexOf("function handleCreateWallet()")
    )
    expect(reconnectFn).toContain("if (providerSheetGateStateRef.current.walletReady) {")
    expect(reconnectFn).toContain('openDynamicEmailFallbackAuth("withdrawal_reconnect", {')
    expect(reconnectFn).toContain("signatureRequired: false")
    expect(page).toContain("wallet_provider_sheet_open_suppressed")
  })

  it("no Wallet approval pill appears in withdrawal review or failure screens", () => {
    expect(page).not.toContain("Wallet approval")
    expect(page).not.toContain("wallet-approval")
    expect(page).not.toContain("approval pill")
  })

  it("no PineTree Wallet signer is not available merchant-facing copy remains in page", () => {
    // The old generic error string is gone; session errors use specific reconnect-guidance copy.
    expect(page).not.toContain("PineTree Wallet signer is not available for this asset yet.")
    // Actionable errors that replaced it must be present
    expect(page).toContain("Reconnect PineTree Wallet to verify secure signing access.")
    expect(page).toContain("different PineTree Wallet session")
    expect(page).toContain("Unable to sign this withdrawal. Please try again.")
  })

  it("address mismatch shows a distinct session-mismatch error distinct from session-not-found", () => {
    // When Dynamic wallets are present but none match the saved DB address (different account),
    // the error is distinct from the no-wallets case, guiding the merchant to restore access.
    expect(page).toContain("This browser is connected to a different PineTree Wallet session.")
    expect(page).toContain("hasAnyDynamicWallet")
    // Both error paths share the same signer_not_found log key for diagnostics
    expect(page).toContain("matchingWalletFound: false")
    expect(page).toContain("dynamicWalletCount:")
    expect(page).toContain("payloadKind:")
  })

  // -------------------------------------------------------------------------
  // Withdrawal reconnect recovery — Task 6
  // -------------------------------------------------------------------------

  it("reconnect refreshes Dynamic wallets before matching source address", () => {
    // When no wallets are active, the handler sets withdrawalReconnectPending and a useEffect
    // watches wallets + primaryWallet; once non-empty, it runs address matching and clears
    // pending — so the retry always uses the freshest wallet list from the Dynamic SDK.
    expect(page).toContain("withdrawalReconnectPending")
    expect(page).toContain("setWithdrawalReconnectPending")
    expect(page).toContain("withdrawalReconnectSourceRef")
    // useEffect watches wallets and primaryWallet for the reconnect path
    expect(page).toContain("reconnect_after")
  })

  it("signer lookup searches all Dynamic wallets, not just primaryWallet", () => {
    // findDynamicWalletForSource deduplicates candidates[] and primaryWallet into a single
    // search list so that wallets in either source can match the saved DB source address.
    expect(dynamicSignerLookup).toContain("[primaryWallet, ...candidates]")
    expect(dynamicSignerLookup).toContain("getDynamicWalletSearchList(candidates, primaryWallet, rail).find")
  })

  it("Solana address matching uses exact string comparison after shared lowercase normalisation", () => {
    // Both the stored address and the Dynamic wallet address are lowercased before comparison.
    // A Solana address like 'CdKwuF...' lowercases identically from both sides, so the match
    // is correct; no separate case-sensitive path is needed.
    expect(dynamicSignerLookup).toContain('if (rail === "base") return address.toLowerCase()')
    expect(dynamicSignerLookup).toContain("dynamicWalletAddressesMatch(address, sourceAddress, rail)")
    expect(dynamicSignerLookup).toContain("normalizedCandidate === normalizedSource")
  })

  it("EVM address matching is case-insensitive via shared lowercase normalisation", () => {
    // EVM addresses from different sources may differ in case ('0xAbCd' vs '0xabcd').
    // Both sides are lowercased before comparison so a checksum-cased DB address matches
    // a lowercase Dynamic wallet address and vice versa.
    expect(dynamicSignerLookup).toContain('if (rail === "base") return address.toLowerCase()')
    expect(dynamicSignerLookup).toContain("dynamicWalletAddressesMatch(address, sourceAddress, rail)")
    expect(dynamicSignerLookup).toContain("normalizedCandidate === normalizedSource")
  })

  it("reconnect with wallets loaded but address mismatch respects the ready-state provider gate", () => {
    // When handleWithdrawalReconnect runs and Dynamic wallets are already loaded but none
    // match the DB source address, it opens the temporary fallback and lets the reconnect
    // effect validate the refreshed wallet list.
    const reconnectFn = page.slice(
      page.indexOf("async function handleWithdrawalReconnect()"),
      page.indexOf("function handleCreateWallet()")
    )
    expect(reconnectFn).toContain("if (providerSheetGateStateRef.current.walletReady) {")
    expect(reconnectFn).toContain("setWithdrawalReconnectPending(true)")
    expect(reconnectFn).toContain('scheduleDynamicEmailFallbackAuth("withdrawal_reconnect", {')
    expect(reconnectFn).toContain("explicitUserAction: true")
    expect(page).toContain("This browser is connected to a different PineTree Wallet session. Restore the PineTree Wallet used for this merchant, then try again.")
  })

  it("signer_lookup diagnostic logs wallet count and address prefixes before matching", () => {
    // The signer_lookup event is emitted (gated by walletCreationDebugEnabled) before the
    // wallet search so that diagnostics capture the exact state seen during signing.
    expect(page).toContain("\"[pinetree-withdrawals] signer_lookup\"")
    expect(page).toContain("dynamicWalletAddressPrefixes")
    expect(page).toContain("sourceAddressPrefix")
    expect(page).toContain("hasPrimaryWallet")
  })

  it("no pending review fallback: PineTree Wallet Solana/Base withdrawals always use dynamic_browser path", () => {
    // There is no client-side fallback to action: "submit" for Solana or Base withdrawals.
    // Signing failures surface as errors, not silent fallbacks to manual review.
    expect(page).not.toContain("action: \"submit\"")
  })
})
