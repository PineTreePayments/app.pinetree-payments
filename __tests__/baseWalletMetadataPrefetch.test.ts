import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regression coverage for moving the Base wallet list off the checkout
 * critical path. Previously, GET /api/walletconnect/base-wallets required a
 * pairingUri and was only ever called once the customer had already tapped
 * "Connect with WalletConnect" (which itself could only appear after
 * pairingUri existed) — putting a full network round trip directly between
 * the customer opening the wallet picker and seeing any wallets. Wallet
 * metadata (names/icons/enabled/mobileLink) is not payment-specific and the
 * server already caches the underlying WalletConnect Explorer lookup for
 * 12h, so it can be prefetched as soon as the checkout page is ready to
 * accept a Base selection and cached for the rest of the browser session —
 * buildWalletHref() then computes each wallet's real deep link locally,
 * once a real pairingUri exists, with no further network call.
 */

const originalFetch = global.fetch

beforeEach(() => {
  vi.resetModules()
  global.fetch = originalFetch
})

describe("prefetchBaseWalletMetadata", () => {
  it("fetches metadata without a pairingUri query param", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ wallets: [{ id: "metamask", label: "MetaMask", mobileLink: "metamask://" }] }),
    })
    global.fetch = fetchSpy as unknown as typeof fetch

    const { prefetchBaseWalletMetadata } = await import("@/lib/payment/baseWallets")
    await prefetchBaseWalletMetadata()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url] = fetchSpy.mock.calls[0]
    expect(String(url)).toBe("/api/walletconnect/base-wallets")
    expect(String(url)).not.toContain("pairingUri")
  })

  it("dedups concurrent callers into a single network request", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ wallets: [{ id: "metamask", label: "MetaMask", mobileLink: "metamask://" }] }),
    })
    global.fetch = fetchSpy as unknown as typeof fetch

    const { prefetchBaseWalletMetadata } = await import("@/lib/payment/baseWallets")
    const [a, b, c] = await Promise.all([
      prefetchBaseWalletMetadata(),
      prefetchBaseWalletMetadata(),
      prefetchBaseWalletMetadata(),
    ])

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it("caches across sequential calls within the browser session — a second call after the first resolves does not re-fetch", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ wallets: [{ id: "metamask", label: "MetaMask", mobileLink: "metamask://" }] }),
    })
    global.fetch = fetchSpy as unknown as typeof fetch

    const { prefetchBaseWalletMetadata } = await import("@/lib/payment/baseWallets")
    await prefetchBaseWalletMetadata()
    await prefetchBaseWalletMetadata()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("falls back to the local static wallet list on a network failure, without throwing", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch

    const { prefetchBaseWalletMetadata } = await import("@/lib/payment/baseWallets")
    const wallets = await prefetchBaseWalletMetadata()

    expect(Array.isArray(wallets)).toBe(true)
    expect(wallets.length).toBeGreaterThan(0)
  })

  it("a failed fetch does not poison the cache — a later call retries against the network", async () => {
    const fetchSpy = vi.fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ wallets: [{ id: "metamask", label: "MetaMask", mobileLink: "metamask://" }] }),
      })
    global.fetch = fetchSpy as unknown as typeof fetch

    const { prefetchBaseWalletMetadata } = await import("@/lib/payment/baseWallets")
    const first = await prefetchBaseWalletMetadata()
    const second = await prefetchBaseWalletMetadata()

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(first.length).toBeGreaterThan(0) // local fallback
    expect(second[0].id).toBe("metamask") // real network data on retry
  })
})

describe("buildWalletHref", () => {
  it("computes a wallet's deep link purely from cached metadata + a pairingUri, with no network call", async () => {
    const { buildWalletHref } = await import("@/lib/payment/baseWallets")
    const href = buildWalletHref({ mobileLink: "metamask://" }, "wc:abc123@2?relay-protocol=irn&symKey=deadbeef")
    expect(href).toContain("metamask://")
    expect(href).toContain("wc%3Aabc123")
  })

  it("returns an empty href when no mobileLink is available", async () => {
    const { buildWalletHref } = await import("@/lib/payment/baseWallets")
    const href = buildWalletHref({ mobileLink: "" }, "wc:abc123@2")
    expect(href).toBe("")
  })
})
