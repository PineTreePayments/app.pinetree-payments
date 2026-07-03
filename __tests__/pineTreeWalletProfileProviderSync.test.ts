import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"

const mocks = vi.hoisted(() => ({
  upserts: [] as Array<{ table: string; row: Record<string, unknown>; options?: Record<string, unknown> }>,
  existingLightning: null as { id: string } | null,
  upsertError: null as { message: string } | null,
  maybeSingleError: null as { message: string } | null,
}))

vi.mock("@/database/supabase", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      upsert: (row: Record<string, unknown>, options?: Record<string, unknown>) => {
        mocks.upserts.push({ table, row, options })
        return { error: mocks.upsertError }
      },
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: mocks.existingLightning,
              error: mocks.maybeSingleError,
            }),
          }),
        }),
      }),
    }),
  },
  supabase: null,
}))

import { syncPineTreeWalletProfileProviders } from "@/database/pineTreeWalletProfileProviderSync"

function profile(overrides: Partial<PineTreeWalletProfile> = {}): PineTreeWalletProfile {
  return {
    id: "profile_1",
    merchant_id: "merchant_1",
    dynamic_user_id: "dyn_1",
    base_address: "0x1111111111111111111111111111111111111111",
    solana_address: "So11111111111111111111111111111111111111112",
    bitcoin_lightning_address: null,
    bitcoin_onchain_address: null,
    bitcoin_lightning_status: "pending",
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
    status: "ready",
    created_at: "2026-07-03T00:00:00.000Z",
    updated_at: "2026-07-03T00:00:00.000Z",
    ...overrides,
  }
}

describe("PineTree Wallet profile provider sync", () => {
  beforeEach(() => {
    mocks.upserts = []
    mocks.existingLightning = null
    mocks.upsertError = null
    mocks.maybeSingleError = null
  })

  it("successful profile sync creates or updates Base merchant_provider as connected", async () => {
    await syncPineTreeWalletProfileProviders(profile())

    const base = mocks.upserts.find((entry) => entry.row.provider === "base")
    expect(base?.table).toBe("merchant_providers")
    expect(base?.options).toEqual({ onConflict: "merchant_id,provider" })
    expect(base?.row).toMatchObject({
      merchant_id: "merchant_1",
      provider: "base",
      status: "connected",
      enabled: true,
      credentials: {
        setup_source: "pinetree_wallet",
        settlement: "pinetree_wallet",
        address_source: "dynamic",
        base_address: "0x1111111111111111111111111111111111111111",
        wallet: "0x1111111111111111111111111111111111111111",
        wallet_type: "PINETREE",
      },
    })
  })

  it("successful profile sync creates or updates Solana merchant_provider as connected", async () => {
    await syncPineTreeWalletProfileProviders(profile())

    const solana = mocks.upserts.find((entry) => entry.row.provider === "solana")
    expect(solana?.table).toBe("merchant_providers")
    expect(solana?.options).toEqual({ onConflict: "merchant_id,provider" })
    expect(solana?.row).toMatchObject({
      merchant_id: "merchant_1",
      provider: "solana",
      status: "connected",
      enabled: true,
      credentials: {
        setup_source: "pinetree_wallet",
        settlement: "pinetree_wallet",
        address_source: "dynamic",
        solana_address: "So11111111111111111111111111111111111111112",
        wallet: "So11111111111111111111111111111111111111112",
        wallet_type: "PINETREE",
      },
    })
  })

  it("Lightning Speed stays pending and disabled when inserted by Base/Solana sync", async () => {
    await syncPineTreeWalletProfileProviders(profile())

    const lightning = mocks.upserts.find((entry) => entry.row.provider === "lightning_speed")
    expect(lightning?.row).toMatchObject({
      merchant_id: "merchant_1",
      provider: "lightning_speed",
      status: "pending",
      enabled: false,
      credentials: {
        setup_source: "pinetree_wallet",
        settlement: "pinetree_wallet",
        address_source: "speed",
      },
    })
  })

  it("does not overwrite an existing Lightning Speed row during Dynamic Base/Solana sync", async () => {
    mocks.existingLightning = { id: "speed_1" }

    const result = await syncPineTreeWalletProfileProviders(profile())

    expect(mocks.upserts.some((entry) => entry.row.provider === "lightning_speed")).toBe(false)
    expect(result).toContainEqual({
      provider: "lightning_speed",
      status: "skipped",
      reason: "Lightning provider row already exists",
    })
  })

  it("BTC fields are not created in provider credentials", async () => {
    await syncPineTreeWalletProfileProviders(profile({
      btc_address: null,
      btc_payout_enabled: false,
    }))

    for (const { row } of mocks.upserts) {
      const credentials = row.credentials as Record<string, unknown>
      expect(credentials).not.toHaveProperty("btc_address")
      expect(credentials).not.toHaveProperty("bitcoin_onchain_address")
      expect(credentials).not.toHaveProperty("btc_payout_enabled")
    }
  })

  it("clean profile plus Dynamic addresses results in ready profile rails and provider rows present", async () => {
    const result = await syncPineTreeWalletProfileProviders(profile({
      status: "ready",
      bitcoin_lightning_status: "pending",
      btc_address: null,
      btc_payout_enabled: false,
    }))

    expect(result).toEqual([
      { provider: "base", status: "upserted" },
      { provider: "solana", status: "upserted" },
      { provider: "lightning_speed", status: "upserted" },
    ])
    expect(mocks.upserts.map((entry) => entry.row.provider)).toEqual([
      "base",
      "solana",
      "lightning_speed",
    ])
  })

  it("skips Base and Solana provider rows until profile addresses exist", async () => {
    const result = await syncPineTreeWalletProfileProviders(profile({
      base_address: null,
      solana_address: null,
      status: "not_created",
    }))

    expect(mocks.upserts.map((entry) => entry.row.provider)).toEqual(["lightning_speed"])
    expect(result).toContainEqual({ provider: "base", status: "skipped", reason: "Missing Base address" })
    expect(result).toContainEqual({ provider: "solana", status: "skipped", reason: "Missing Solana address" })
  })
})
