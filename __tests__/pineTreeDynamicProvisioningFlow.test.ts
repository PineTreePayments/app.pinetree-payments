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
    expect(page).toContain("const dynamicAddressSearchList = useMemo")
    expect(page).toContain("extractDynamicWalletAddresses(dynamicAddressSearchList as DynamicWalletAddressSource[])")
    expect(page).toContain('findDynamicApprovalWalletForSourceAsync(dynamicWalletSearchList as unknown[], primaryWallet, "base", baseAddress)')
    expect(page).toContain('findDynamicApprovalWalletForSourceAsync(dynamicWalletSearchList as unknown[], primaryWallet, "solana", solanaAddress)')
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
