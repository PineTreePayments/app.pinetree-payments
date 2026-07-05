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
    expect(page).toContain("base_address: baseAddress")
    expect(page).toContain("solana_address: solanaAddress")
    expect(profileRoute).toContain('dynamicUserId: "dynamic_user_id" in body')
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
    expect(page).toContain('const walletStatus = repairInProgress ? "Repairing" : dynamicProfileReady ? "Ready"')
    expect(page).not.toContain('const walletStatus = repairInProgress ? "Repairing" : allPrimaryRailsConnected ? "Ready"')
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
