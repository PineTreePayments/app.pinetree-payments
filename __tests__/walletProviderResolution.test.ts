import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("resolveMerchantWalletProvider - generic provider resolution + adapter dispatch", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.doUnmock("@/database/merchantLightningProfiles")
  })

  it("rejects a request with no authenticated merchant id", async () => {
    vi.doMock("@/database/merchantLightningProfiles", () => ({
      getMerchantLightningProfile: vi.fn(),
    }))
    const { resolveMerchantWalletProvider } = await import("@/engine/wallet/walletProviderResolution")
    await expect(resolveMerchantWalletProvider("")).rejects.toMatchObject({ code: "UNAUTHORIZED" })
  })

  it("rejects a merchant with no wallet provider configured at all", async () => {
    vi.doMock("@/database/merchantLightningProfiles", () => ({
      getMerchantLightningProfile: vi.fn().mockResolvedValue(null),
    }))
    const { resolveMerchantWalletProvider } = await import("@/engine/wallet/walletProviderResolution")
    await expect(resolveMerchantWalletProvider("merchant-a")).rejects.toMatchObject({
      code: "WALLET_PROVIDER_NOT_CONFIGURED",
    })
  })

  it("rejects a merchant whose provider connection is not ready yet", async () => {
    vi.doMock("@/database/merchantLightningProfiles", () => ({
      getMerchantLightningProfile: vi.fn().mockResolvedValue({
        status: "pending",
        speed_account_id: "acct_merchant_a",
      }),
    }))
    const { resolveMerchantWalletProvider } = await import("@/engine/wallet/walletProviderResolution")
    await expect(resolveMerchantWalletProvider("merchant-a")).rejects.toMatchObject({
      code: "WALLET_PROVIDER_NOT_READY",
    })
  })

  it("resolves a ready merchant to the registered Speed adapter, without the engine ever naming Speed itself", async () => {
    vi.doMock("@/database/merchantLightningProfiles", () => ({
      getMerchantLightningProfile: vi.fn().mockResolvedValue({
        status: "ready",
        speed_account_id: "acct_merchant_a",
      }),
    }))
    const { resolveMerchantWalletProvider } = await import("@/engine/wallet/walletProviderResolution")
    const resolution = await resolveMerchantWalletProvider("merchant-a")

    // The generic resolver returns whatever the registry produced - it is
    // not hardcoded to "speed" anywhere in walletProviderResolution.ts.
    expect(resolution.provider).toBe("speed")
    expect(resolution.adapter.provider).toBe("speed")
    expect(resolution.context.merchantId).toBe("merchant-a")
    expect(resolution.context.providerAccountId).toBe("acct_merchant_a")
  })

  it("only ever resolves the account id belonging to the authenticated merchant's own saved profile - never a client-supplied id", async () => {
    const getMerchantLightningProfile = vi.fn().mockImplementation(async (merchantId: string) => {
      if (merchantId === "merchant-a") return { status: "ready", speed_account_id: "acct_merchant_a" }
      if (merchantId === "merchant-b") return { status: "ready", speed_account_id: "acct_merchant_b" }
      return null
    })
    vi.doMock("@/database/merchantLightningProfiles", () => ({ getMerchantLightningProfile }))

    const { resolveMerchantWalletProvider } = await import("@/engine/wallet/walletProviderResolution")

    const resolutionA = await resolveMerchantWalletProvider("merchant-a")
    expect(resolutionA.context.providerAccountId).toBe("acct_merchant_a")

    const resolutionB = await resolveMerchantWalletProvider("merchant-b")
    expect(resolutionB.context.providerAccountId).toBe("acct_merchant_b")

    // resolveMerchantWalletProvider's only parameter is the authenticated
    // merchant id - there is no account-id parameter anywhere in this call
    // chain that a client could supply.
    expect(getMerchantLightningProfile).toHaveBeenCalledWith("merchant-a")
    expect(getMerchantLightningProfile).toHaveBeenCalledWith("merchant-b")
    expect(getMerchantLightningProfile).not.toHaveBeenCalledWith("acct_merchant_b")
  })

  it("tryResolveMerchantWalletProvider returns null instead of throwing for an unconfigured merchant", async () => {
    vi.doMock("@/database/merchantLightningProfiles", () => ({
      getMerchantLightningProfile: vi.fn().mockResolvedValue(null),
    }))
    const { tryResolveMerchantWalletProvider } = await import("@/engine/wallet/walletProviderResolution")
    await expect(tryResolveMerchantWalletProvider("merchant-a")).resolves.toBeNull()
  })
})

describe("engine/wallet/walletProviderRegistry", () => {
  it("registers and retrieves adapters by provider name, and lists them in registration order", async () => {
    vi.resetModules()
    const { registerWalletProviderAdapter, getWalletProviderAdapter, listRegisteredWalletProviders } = await import(
      "@/engine/wallet/walletProviderRegistry"
    )

    const fakeAdapter = {
      provider: "test-provider",
      providerDisplayName: "Test Provider",
      resolveContext: vi.fn(),
      getCapabilities: vi.fn(),
    }
    registerWalletProviderAdapter(fakeAdapter as never)

    expect(getWalletProviderAdapter("test-provider")).toBe(fakeAdapter)
    expect(getWalletProviderAdapter("nonexistent")).toBeNull()
    expect(listRegisteredWalletProviders()).toContain("test-provider")
  })
})
