import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/database/supabase", () => ({
  supabase: {},
  supabaseAdmin: null,
}))

import { provisionMerchantBitcoinAddress } from "@/engine/pineTreeBitcoinAddressProvisioning"
import type { PineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"

function profile(overrides: Partial<PineTreeWalletProfile>): PineTreeWalletProfile {
  return {
    id: "profile_1",
    merchant_id: "merchant_1",
    dynamic_user_id: null,
    base_address: null,
    solana_address: null,
    bitcoin_lightning_address: null,
    bitcoin_onchain_address: null,
    bitcoin_lightning_status: "not_configured",
    bitcoin_lightning_provider: null,
    bitcoin_lightning_receive_mode: "invoice",
    bitcoin_lightning_account_id: null,
    btc_address: null,
    btc_address_type: null,
    btc_wallet_provider: null,
    btc_wallet_provider_ref: null,
    btc_wallet_last_provisioned_at: null,
    btc_wallet_provisioning_status: null,
    btc_wallet_provisioning_error: null,
    btc_payout_enabled: false,
    btc_payout_verified_at: null,
    status: "not_created",
    created_at: "2026-06-24T00:00:00.000Z",
    updated_at: "2026-06-24T00:00:00.000Z",
    ...overrides,
  }
}

describe("PineTree Bitcoin address provisioning", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
    delete process.env.PINE_TREE_BTC_WALLET_PROVIDER
    delete process.env.FIREBLOCKS_API_KEY
    delete process.env.FIREBLOCKS_API_SECRET
    delete process.env.FIREBLOCKS_BASE_URL
    delete process.env.FIREBLOCKS_TEST_BTC_ADDRESS
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it("returns an existing saved address first without overwriting it", async () => {
    const result = await provisionMerchantBitcoinAddress({
      merchantId: "merchant_1",
      existingProfile: profile({
        btc_address: "bc1pexistingmerchantaddress",
        btc_address_type: "taproot",
        btc_wallet_provider: "manual_internal",
      }),
      dynamicBtcAddress: "bc1qdynamicaddress",
    })

    expect(result).toEqual(expect.objectContaining({
      btcAddress: "bc1pexistingmerchantaddress",
      btcAddressType: "taproot",
      btcWalletProvider: "manual_internal",
      status: "already_exists",
    }))
  })

  it("uses a Dynamic BTC address when no saved address exists", async () => {
    const result = await provisionMerchantBitcoinAddress({
      merchantId: "merchant_1",
      existingProfile: profile({}),
      dynamicBtcAddress: "bc1qdynamicmerchantaddress",
    })

    expect(result).toEqual(expect.objectContaining({
      btcAddress: "bc1qdynamicmerchantaddress",
      btcAddressType: "native_segwit",
      btcWalletProvider: "dynamic",
      status: "ready",
    }))
  })

  it("detects bc1p as taproot and bc1q as native_segwit", async () => {
    await expect(provisionMerchantBitcoinAddress({
      merchantId: "merchant_1",
      existingProfile: profile({}),
      dynamicBtcAddress: "bc1pdynamicmerchantaddress",
    })).resolves.toMatchObject({ btcAddressType: "taproot" })

    await expect(provisionMerchantBitcoinAddress({
      merchantId: "merchant_1",
      existingProfile: profile({}),
      dynamicBtcAddress: "bc1qdynamicmerchantaddress",
    })).resolves.toMatchObject({ btcAddressType: "native_segwit" })
  })

  it("returns missing_provider when no automated BTC wallet provider is configured", async () => {
    const result = await provisionMerchantBitcoinAddress({
      merchantId: "merchant_1",
      existingProfile: profile({}),
    })

    expect(result).toEqual(expect.objectContaining({
      btcAddress: null,
      btcWalletProvider: "none",
      status: "missing_provider",
      error: "No Bitcoin wallet provider configured",
    }))
  })

  it("records an internal provider error when Fireblocks is selected but unavailable", async () => {
    process.env.PINE_TREE_BTC_WALLET_PROVIDER = "fireblocks"

    const result = await provisionMerchantBitcoinAddress({
      merchantId: "merchant_1",
      existingProfile: profile({}),
    })

    expect(result).toEqual(expect.objectContaining({
      btcAddress: null,
      btcWalletProvider: "fireblocks",
      status: "provider_failed",
      error: "Fireblocks Bitcoin wallet provider is not configured",
    }))
  })

  it("uses the Fireblocks adapter result when the provider is configured", async () => {
    process.env.PINE_TREE_BTC_WALLET_PROVIDER = "fireblocks"
    process.env.FIREBLOCKS_API_KEY = "server-key"
    process.env.FIREBLOCKS_API_SECRET = "server-secret"
    process.env.FIREBLOCKS_BASE_URL = "https://api.fireblocks.example"
    process.env.FIREBLOCKS_TEST_BTC_ADDRESS = "bc1pfireblocksmerchantaddress"

    const result = await provisionMerchantBitcoinAddress({
      merchantId: "merchant_1",
      existingProfile: profile({}),
    })

    expect(result).toEqual(expect.objectContaining({
      btcAddress: "bc1pfireblocksmerchantaddress",
      btcAddressType: "taproot",
      btcWalletProvider: "fireblocks",
      status: "ready",
      providerRef: "fireblocks:merchant_1",
    }))
  })
})

