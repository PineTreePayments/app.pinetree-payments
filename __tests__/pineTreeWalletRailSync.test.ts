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
const mockCheckSchema = vi.fn()
const mockSaveProvider = vi.fn()
const mockGetLightningProfile = vi.fn()

vi.mock("@/database/pineTreeWalletProfiles", () => ({
  getPineTreeWalletProfile: (...args: unknown[]) => mockGetProfile(...args),
}))

vi.mock("@/database/pineTreeWalletRailSyncs", () => ({
  checkWalletRailSyncSchemaContract: (...args: unknown[]) => mockCheckSchema(...args),
  getWalletRailSyncs: (...args: unknown[]) => mockGetSyncs(...args),
  isWalletRailSyncSchemaError: (error: unknown) => Boolean(error && typeof error === "object" && (error as { code?: string }).code === "database_schema_missing"),
  upsertWalletRailSync: (...args: unknown[]) => mockUpsertSync(...args),
}))

vi.mock("@/database/merchantLightningProfiles", () => ({
  deriveLightningReadiness: (profile: { status?: "ready" | "pending" | "needs_attention" } | null) => ({
    ready: profile?.status === "ready",
    pending: profile?.status === "pending",
    configured: Boolean(profile),
    needsAttention: profile?.status === "needs_attention",
    status: profile?.status ?? "not_configured",
  }),
  getMerchantLightningProfile: (...args: unknown[]) => mockGetLightningProfile(...args),
}))

vi.mock("@/engine/providersDashboard", () => ({
  saveProviderEngine: (...args: unknown[]) => mockSaveProvider(...args),
}))

import { RailSyncEngineError, syncPineTreeWalletRailsEngine } from "@/engine/pineTreeWalletRailSync"

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8")
}

// ---------------------------------------------------------------------------
// syncPineTreeWalletRailsEngine
// ---------------------------------------------------------------------------

describe("syncPineTreeWalletRailsEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "info").mockImplementation(() => undefined)
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    mockUpsertSync.mockResolvedValue({})
    mockCheckSchema.mockResolvedValue({ ok: true, code: "ok", missing: [], migration: null })
    mockSaveProvider.mockResolvedValue(undefined)
    mockGetLightningProfile.mockResolvedValue(null)
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

    expect(mockSaveProvider).toHaveBeenCalledTimes(2)
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

    expect(result.rails.find((r) => r.rail === "solana")?.status).toBe("synced")
    expect(result.rails.find((r) => r.rail === "base")?.status).toBe("synced")
    expect(result.rails.find((r) => r.rail === "bitcoin_lightning")?.status).toBe("skipped")
    expect(result.rails.find((r) => r.rail === "bitcoin_lightning")?.reason).toContain("Speed account status")
    expect(mockUpsertSync).toHaveBeenCalledTimes(2)
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
    ])

    const result = await syncPineTreeWalletRailsEngine("merchant-1")

    expect(mockSaveProvider).not.toHaveBeenCalled()
    expect(result.rails.find((r) => r.rail === "solana")?.reason).toBe("Already synced")
    expect(result.rails.find((r) => r.rail === "base")?.reason).toBe("Already synced")
    expect(result.rails.find((r) => r.rail === "bitcoin_lightning")?.reason).toContain("Speed account status")
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

  it("throws a structured database_error when saveProviderEngine throws", async () => {
    mockGetProfile.mockResolvedValue({
      solana_address: "solana-addr-abc",
      base_address: null,
      btc_address: null,
    })
    mockGetSyncs.mockResolvedValue([])
    mockSaveProvider.mockRejectedValue(new Error("DB write failed"))

    await expect(syncPineTreeWalletRailsEngine("merchant-1")).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(RailSyncEngineError)
      const railSyncError = error as RailSyncEngineError
      expect(railSyncError.stage).toBe("rail_sync_persist_started")
      expect(railSyncError.code).toBe("database_error")
      return true
    })
    expect(mockUpsertSync).not.toHaveBeenCalled()
  })

  it("a ready Base/Solana profile syncs successfully even when Lightning is not configured (no profile)", async () => {
    mockGetProfile.mockResolvedValue({
      solana_address: "solana-addr-abc",
      base_address: "0xbaseaddr",
      btc_address: null,
      status: "ready",
    })
    mockGetSyncs.mockResolvedValue([])
    mockGetLightningProfile.mockResolvedValue(null)

    const result = await syncPineTreeWalletRailsEngine("merchant-1")

    expect(result.rails.find((r) => r.rail === "solana")?.status).toBe("synced")
    expect(result.rails.find((r) => r.rail === "base")?.status).toBe("synced")
  })

  it("a ready Base/Solana profile syncs successfully when Lightning is needs_attention", async () => {
    mockGetProfile.mockResolvedValue({
      solana_address: "solana-addr-abc",
      base_address: "0xbaseaddr",
      btc_address: null,
      status: "ready",
    })
    mockGetSyncs.mockResolvedValue([])
    mockGetLightningProfile.mockResolvedValue({ status: "needs_attention" })

    const result = await syncPineTreeWalletRailsEngine("merchant-1")

    expect(result.rails.find((r) => r.rail === "solana")?.status).toBe("synced")
    expect(result.rails.find((r) => r.rail === "base")?.status).toBe("synced")
  })

  it("does not throw when the Lightning profile lookup itself fails - missing optional Lightning data is non-fatal", async () => {
    mockGetProfile.mockResolvedValue({
      solana_address: "solana-addr-abc",
      base_address: "0xbaseaddr",
      btc_address: null,
    })
    mockGetSyncs.mockResolvedValue([])
    mockGetLightningProfile.mockRejectedValue(new Error("lightning profile lookup failed"))

    const result = await syncPineTreeWalletRailsEngine("merchant-1")

    expect(result.rails.find((r) => r.rail === "solana")?.status).toBe("synced")
    expect(result.rails.find((r) => r.rail === "base")?.status).toBe("synced")
  })

  it("returns database_schema_missing when the rail-sync schema contract is missing", async () => {
    mockGetProfile.mockResolvedValue({
      solana_address: "solana-addr-abc",
      base_address: "0xbaseaddr",
      btc_address: null,
    })
    mockCheckSchema.mockRejectedValue({
      code: "database_schema_missing",
      missing: ["table:pinetree_wallet_rail_syncs"],
      migration: "database/migrations/20260623_create_pinetree_wallet_rail_syncs.sql",
    })

    await expect(syncPineTreeWalletRailsEngine("merchant-1")).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(RailSyncEngineError)
      const railSyncError = error as RailSyncEngineError
      expect(railSyncError.code).toBe("database_schema_missing")
      expect(railSyncError.missing).toEqual(["table:pinetree_wallet_rail_syncs"])
      return true
    })
    expect(mockSaveProvider).not.toHaveBeenCalled()
  })

  it("wraps a genuinely unexpected failure in RailSyncEngineError with a stage and code instead of a bare Error", async () => {
    mockGetProfile.mockRejectedValue(new Error("unexpected database outage"))

    await expect(syncPineTreeWalletRailsEngine("merchant-1")).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(RailSyncEngineError)
      const railSyncError = error as RailSyncEngineError
      expect(railSyncError.stage).toBe("rail_sync_failed")
      expect(railSyncError.code).toBe("unknown_error")
      return true
    })
  })

  it("repeated calls for the same unchanged profile are idempotent (no writes on the second call)", async () => {
    mockGetProfile.mockResolvedValue({
      solana_address: "solana-addr-abc",
      base_address: "0xbaseaddr",
      btc_address: null,
    })
    mockGetSyncs.mockResolvedValue([])

    await syncPineTreeWalletRailsEngine("merchant-1")
    expect(mockSaveProvider).toHaveBeenCalledTimes(2)

    mockSaveProvider.mockClear()
    mockGetSyncs.mockResolvedValue([
      { rail: "solana", synced_address: "solana-addr-abc" },
      { rail: "base", synced_address: "0xbaseaddr" },
    ])
    const second = await syncPineTreeWalletRailsEngine("merchant-1")

    expect(mockSaveProvider).not.toHaveBeenCalled()
    expect(second.rails.find((r) => r.rail === "solana")?.reason).toBe("Already synced")
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
  })

  it("does not infer Bitcoin Lightning readiness from btc_address", () => {
    expect(engine).toContain('rail: "bitcoin_lightning"')
    expect(engine).toContain("Lightning readiness is managed by Speed account status")
    expect(engine).not.toContain("profile.btc_address")
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

// ---------------------------------------------------------------------------
// API route behavior - uses the real engine with the same mocked DB helpers
// as the engine tests above, so a route-level failure exercises the actual
// RailSyncEngineError contract rather than a re-mocked engine.
// ---------------------------------------------------------------------------

vi.mock("@/lib/api/merchantAuth", () => ({
  requireMerchantIdFromRequest: vi.fn().mockResolvedValue("merchant-1"),
  getRouteErrorStatus: (error: unknown, fallback = 500) => {
    if (typeof error === "object" && error !== null && "status" in error) {
      const status = (error as { status?: unknown }).status
      if (typeof status === "number") return status
    }
    return fallback
  },
}))

describe("POST /api/wallets/pinetree-wallet/rail-sync", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "info").mockImplementation(() => undefined)
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    mockUpsertSync.mockResolvedValue({})
    mockCheckSchema.mockResolvedValue({ ok: true, code: "ok", missing: [], migration: null })
    mockSaveProvider.mockResolvedValue(undefined)
    mockGetLightningProfile.mockResolvedValue(null)
  })

  it("returns ok:true with the sync result for a successful sync", async () => {
    mockGetProfile.mockResolvedValue({
      solana_address: "solana-addr-abc",
      base_address: "0xbaseaddr",
      btc_address: null,
      status: "ready",
    })
    mockGetSyncs.mockResolvedValue([])

    const { POST } = await import("@/app/api/wallets/pinetree-wallet/rail-sync/route")
    const { NextRequest } = await import("next/server")
    const response = await POST(new NextRequest("https://app.test/api/wallets/pinetree-wallet/rail-sync", { method: "POST" }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body).toMatchObject({
      coreStatus: "ready",
      lightningStatus: "not_configured",
      syncedRails: ["solana", "base"],
      skippedRails: ["bitcoin_lightning"],
      warnings: [],
    })
    expect(JSON.stringify(body)).not.toContain("0xbaseaddr")
    expect(JSON.stringify(body)).not.toContain("solana-addr-abc")
  })

  it("returns 200 ok:true even when Lightning is needs_attention - never a 500 just because Lightning is unavailable", async () => {
    mockGetProfile.mockResolvedValue({
      solana_address: "solana-addr-abc",
      base_address: "0xbaseaddr",
      btc_address: null,
    })
    mockGetSyncs.mockResolvedValue([])
    mockGetLightningProfile.mockResolvedValue({ status: "needs_attention" })

    const { POST } = await import("@/app/api/wallets/pinetree-wallet/rail-sync/route")
    const { NextRequest } = await import("next/server")
    const response = await POST(new NextRequest("https://app.test/api/wallets/pinetree-wallet/rail-sync", { method: "POST" }))

    expect(response.status).toBe(200)
  })

  it("returns a structured ok:false with stage/code and a real 500 for a genuine database failure", async () => {
    mockGetProfile.mockRejectedValue(new Error("unexpected database outage"))

    const { POST } = await import("@/app/api/wallets/pinetree-wallet/rail-sync/route")
    const { NextRequest } = await import("next/server")
    const response = await POST(new NextRequest("https://app.test/api/wallets/pinetree-wallet/rail-sync", { method: "POST" }))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ ok: false, stage: "rail_sync_failed", code: "unknown_error" })
  })

  it("never leaks wallet addresses in a failure response", async () => {
    mockGetProfile.mockRejectedValue(new Error("outage touching 0xsecretaddress"))

    const { POST } = await import("@/app/api/wallets/pinetree-wallet/rail-sync/route")
    const { NextRequest } = await import("next/server")
    const response = await POST(new NextRequest("https://app.test/api/wallets/pinetree-wallet/rail-sync", { method: "POST" }))
    const raw = JSON.stringify(await response.json())

    expect(raw).not.toContain("0xsecretaddress")
  })

  it("is idempotent - calling it twice in a row for an unchanged profile produces the same successful shape both times", async () => {
    mockGetProfile.mockResolvedValue({
      solana_address: "solana-addr-abc",
      base_address: "0xbaseaddr",
      btc_address: null,
    })
    mockGetSyncs.mockResolvedValue([])

    const { POST } = await import("@/app/api/wallets/pinetree-wallet/rail-sync/route")
    const { NextRequest } = await import("next/server")
    const first = await POST(new NextRequest("https://app.test/api/wallets/pinetree-wallet/rail-sync", { method: "POST" }))
    expect(first.status).toBe(200)

    mockGetSyncs.mockResolvedValue([
      { rail: "solana", synced_address: "solana-addr-abc" },
      { rail: "base", synced_address: "0xbaseaddr" },
    ])
    const second = await POST(new NextRequest("https://app.test/api/wallets/pinetree-wallet/rail-sync", { method: "POST" }))
    expect(second.status).toBe(200)
    const secondBody = await second.json()
    expect(secondBody.ok).toBe(true)
  })
})
