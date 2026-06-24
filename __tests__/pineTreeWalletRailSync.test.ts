import fs from "node:fs"
import path from "node:path"
import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/database/supabase", () => ({ supabase: {}, supabaseAdmin: null }))

// ---------------------------------------------------------------------------
// Mock DB helpers and engine
// ---------------------------------------------------------------------------

const mockGetProfile = vi.fn()
const mockGetSyncs = vi.fn()
const mockUpsertSync = vi.fn()
const mockSaveProvider = vi.fn()

vi.mock("@/database/pineTreeWalletProfiles", () => ({
  getPineTreeWalletProfile: (...args: unknown[]) => mockGetProfile(...args),
}))

vi.mock("@/database/pineTreeWalletRailSyncs", () => ({
  getWalletRailSyncs: (...args: unknown[]) => mockGetSyncs(...args),
  upsertWalletRailSync: (...args: unknown[]) => mockUpsertSync(...args),
}))

vi.mock("@/engine/providersDashboard", () => ({
  saveProviderEngine: (...args: unknown[]) => mockSaveProvider(...args),
}))

import { syncPineTreeWalletRailsEngine } from "@/engine/pineTreeWalletRailSync"

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8")
}

// ---------------------------------------------------------------------------
// syncPineTreeWalletRailsEngine
// ---------------------------------------------------------------------------

describe("syncPineTreeWalletRailsEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpsertSync.mockResolvedValue({})
    mockSaveProvider.mockResolvedValue(undefined)
  })

  it("skips all rails when no PineTree Wallet profile exists", async () => {
    mockGetProfile.mockResolvedValue(null)

    const result = await syncPineTreeWalletRailsEngine("merchant-1")

    expect(result.rails).toHaveLength(3)
    expect(result.rails.every((r) => r.status === "skipped")).toBe(true)
    expect(mockSaveProvider).not.toHaveBeenCalled()
  })

  it("skips a rail when address is not provisioned in the profile", async () => {
    mockGetProfile.mockResolvedValue({
      solana_address: null,
      base_address: "0xbaseaddress",
      btc_address: null,
    })
    mockGetSyncs.mockResolvedValue([])

    const result = await syncPineTreeWalletRailsEngine("merchant-1")

    const solanaRail = result.rails.find((r) => r.rail === "solana")
    const baseRail = result.rails.find((r) => r.rail === "base")

    expect(solanaRail?.status).toBe("skipped")
    expect(solanaRail?.reason).toBe("Address not provisioned")
    expect(baseRail?.status).toBe("synced")
  })

  it("syncs a rail when address is new (no prior sync record)", async () => {
    mockGetProfile.mockResolvedValue({
      solana_address: "solana-addr-abc",
      base_address: "0xbaseaddr",
      btc_address: "bc1merchantbtc",
    })
    mockGetSyncs.mockResolvedValue([])

    const result = await syncPineTreeWalletRailsEngine("merchant-1")

    expect(mockSaveProvider).toHaveBeenCalledTimes(3)
    expect(mockSaveProvider).toHaveBeenCalledWith(expect.objectContaining({
      merchantId: "merchant-1",
      provider: "solana",
      walletAddress: "solana-addr-abc",
      walletType: "PINETREE",
    }))
    expect(mockSaveProvider).toHaveBeenCalledWith(expect.objectContaining({
      provider: "base",
      walletAddress: "0xbaseaddr",
    }))
    expect(mockSaveProvider).toHaveBeenCalledWith(expect.objectContaining({
      provider: "lightning_speed",
      walletAddress: "bc1merchantbtc",
      walletType: "PINETREE_BTC",
    }))

    expect(result.rails.every((r) => r.status === "synced")).toBe(true)
    expect(mockUpsertSync).toHaveBeenCalledTimes(3)
  })

  it("skips a rail when address matches the last synced address (idempotent)", async () => {
    mockGetProfile.mockResolvedValue({
      solana_address: "solana-addr-abc",
      base_address: "0xbaseaddr",
      btc_address: "bc1merchantbtc",
    })
    mockGetSyncs.mockResolvedValue([
      { rail: "solana", synced_address: "solana-addr-abc" },
      { rail: "base", synced_address: "0xbaseaddr" },
      { rail: "bitcoin_lightning", synced_address: "bc1merchantbtc" },
    ])

    const result = await syncPineTreeWalletRailsEngine("merchant-1")

    expect(mockSaveProvider).not.toHaveBeenCalled()
    expect(result.rails.every((r) => r.status === "skipped" && r.reason === "Already synced")).toBe(true)
  })

  it("re-syncs a rail when address has changed", async () => {
    mockGetProfile.mockResolvedValue({
      solana_address: "solana-addr-NEW",
      base_address: null,
      btc_address: null,
    })
    mockGetSyncs.mockResolvedValue([
      { rail: "solana", synced_address: "solana-addr-OLD" },
    ])

    const result = await syncPineTreeWalletRailsEngine("merchant-1")

    expect(mockSaveProvider).toHaveBeenCalledOnce()
    const solanaRail = result.rails.find((r) => r.rail === "solana")
    expect(solanaRail?.status).toBe("synced")
    expect(solanaRail?.address).toBe("solana-addr-NEW")
  })

  it("records failed status when saveProviderEngine throws", async () => {
    mockGetProfile.mockResolvedValue({
      solana_address: "solana-addr-abc",
      base_address: null,
      btc_address: null,
    })
    mockGetSyncs.mockResolvedValue([])
    mockSaveProvider.mockRejectedValue(new Error("DB write failed"))

    const result = await syncPineTreeWalletRailsEngine("merchant-1")

    const solanaRail = result.rails.find((r) => r.rail === "solana")
    expect(solanaRail?.status).toBe("failed")
    expect(solanaRail?.reason).toBe("DB write failed")
    expect(mockUpsertSync).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// DB helper — upsert uses correct conflict key
// ---------------------------------------------------------------------------

describe("pineTreeWalletRailSyncs DB helper", () => {
  const helper = read("database/pineTreeWalletRailSyncs.ts")

  it("upserts on merchant_id,rail conflict", () => {
    expect(helper).toContain('"merchant_id,rail"')
  })

  it("exports getWalletRailSyncs and upsertWalletRailSync", () => {
    expect(helper).toContain("export async function getWalletRailSyncs")
    expect(helper).toContain("export async function upsertWalletRailSync")
  })
})

// ---------------------------------------------------------------------------
// Rail sync engine structure checks
// ---------------------------------------------------------------------------

describe("pineTreeWalletRailSync engine", () => {
  const engine = read("engine/pineTreeWalletRailSync.ts")

  it("imports saveProviderEngine from providersDashboard", () => {
    expect(engine).toContain("saveProviderEngine")
    expect(engine).toContain("providersDashboard")
  })

  it("marks rails as PINETREE wallet type", () => {
    expect(engine).toContain("PINETREE")
    expect(engine).toContain("PINETREE_BTC")
  })

  it("syncs Bitcoin Lightning through the Speed provider row", () => {
    expect(engine).toContain("SPEED_PROVIDER_NAME")
    expect(engine).toContain('rail: "bitcoin_lightning"')
    expect(engine).toContain("profile.btc_address")
  })

  it("exports syncPineTreeWalletRailsEngine", () => {
    expect(engine).toContain("export async function syncPineTreeWalletRailsEngine")
  })
})

describe("provider save preserves merchant enablement", () => {
  const providerEngine = read("engine/providersDashboard.ts")

  it("preserves existing enabled state for wallet-derived Solana/Base rails", () => {
    expect(providerEngine).toContain('.select("enabled")')
    expect(providerEngine).toContain("enabled = existingProvider ? Boolean(existingProvider.enabled) : true")
  })

  it("preserves existing enabled state for wallet-derived Speed Lightning", () => {
    expect(providerEngine).toContain('.select("credentials,status,enabled")')
    expect(providerEngine).toContain("enabled = existingSpeed ? Boolean(existingSpeed.enabled) : true")
  })
})

// ---------------------------------------------------------------------------
// API route wires through to engine
// ---------------------------------------------------------------------------

describe("rail sync API route", () => {
  const route = read("app/api/wallets/pinetree-wallet/rail-sync/route.ts")

  it("calls syncPineTreeWalletRailsEngine", () => {
    expect(route).toContain("syncPineTreeWalletRailsEngine")
  })

  it("requires merchant auth", () => {
    expect(route).toContain("requireMerchantIdFromRequest")
  })
})
