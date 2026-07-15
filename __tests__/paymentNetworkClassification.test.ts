import { describe, expect, it, vi } from "vitest"
import type { WalletNetwork } from "@/engine/providerMappings"

/**
 * Direct unit coverage for the classification logic
 * engine/paymentIntents.ts's getMerchantAvailableNetworks() uses to decide
 * checkout/POS eligibility per network - proves each customer-facing
 * network maps to its own distinct provider connection, and that card
 * providers (Stripe/Shift4) and crypto rails (Solana/Base/Lightning) never
 * share a key.
 *
 * engine/paymentIntents.ts pulls in the full database/provider layer at
 * module load - stub it all out so importing walletNetworkToProviderKey/
 * isProviderAvailableForCheckout (pure functions, never touch these) does
 * not attempt to construct a real Supabase client.
 */
vi.mock("@/database", () => ({
  createPaymentIntent: vi.fn(),
  getPaymentIntentById: vi.fn(),
  markPaymentIntentSelected: vi.fn(),
  expirePaymentIntent: vi.fn(),
  getMerchantWallets: vi.fn(),
  getConnectedHostedCheckoutNetworks: vi.fn(),
  getPaymentById: vi.fn(),
}))
vi.mock("@/database/transactions", () => ({ getTransactionByPaymentId: vi.fn() }))
vi.mock("@/engine/createPayment", () => ({ createPayment: vi.fn(), buildCreatePaymentRequest: vi.fn() }))
vi.mock("@/engine/paymentStateActions", () => ({
  markPaymentIncomplete: vi.fn(),
  markPaymentIncompleteIfAbandoned: vi.fn(),
}))
vi.mock("@/engine/loadProviders", () => ({ loadProviders: vi.fn() }))
vi.mock("@/database/merchants", () => ({ getMerchantProviders: vi.fn() }))
// SPEED_PROVIDER_NAME is a plain string constant, but its module
// (database/merchantProviders.ts) also constructs a Supabase client at
// import time like every other database/* module in this repo - the value
// is fixed and documented ("lightning_speed") in
// project_speed_wallet_management_foundation memory / prior sessions, so
// it's hardcoded here rather than importing the real module.
const SPEED_PROVIDER_NAME = "lightning_speed"
vi.mock("@/database/merchantProviders", () => ({ SPEED_PROVIDER_NAME }))
vi.mock("@/database/pineTreeWalletProfiles", () => ({ getPineTreeWalletProfile: vi.fn() }))
vi.mock("@/providers/lightning/speedClient", () => ({ getPineTreeSpeedConfigStatus: vi.fn() }))
vi.mock("@/providers/cardProviderReadiness", () => ({ merchantProviderCanProcessPayments: vi.fn() }))
vi.mock("@/lib/pinetreeRailReadiness", () => ({
  buildPineTreeRailReadiness: vi.fn(),
  getPineTreeRailReadinessDiagnostics: vi.fn(),
}))

const { isProviderAvailableForCheckout, walletNetworkToProviderKey } = await import("@/engine/paymentIntents")

describe("walletNetworkToProviderKey", () => {
  it("maps stripe to its own provider key, distinct from every crypto rail", () => {
    expect(walletNetworkToProviderKey("stripe")).toBe("stripe")
  })

  it("maps shift4 to its own provider key", () => {
    expect(walletNetworkToProviderKey("shift4")).toBe("shift4")
  })

  it("maps solana and base to their own provider keys", () => {
    expect(walletNetworkToProviderKey("solana")).toBe("solana")
    expect(walletNetworkToProviderKey("base")).toBe("base")
  })

  it("maps bitcoin_lightning to the lightning provider key, never to stripe/shift4", () => {
    const key = walletNetworkToProviderKey("bitcoin_lightning")
    expect(key).toBe("lightning")
    expect(key).not.toBe("stripe")
    expect(key).not.toBe("shift4")
  })

  it("returns null for an unrecognized/infrastructure-only identifier (e.g. Dynamic, Fireblocks) - they are never a checkout network", () => {
    expect(walletNetworkToProviderKey("dynamic" as WalletNetwork)).toBeNull()
    expect(walletNetworkToProviderKey("fireblocks" as WalletNetwork)).toBeNull()
  })
})

describe("isProviderAvailableForCheckout", () => {
  it("Stripe connected and ready: stripe network is available, no crypto network becomes available as a side effect", () => {
    const enabled = new Set(["stripe"])
    expect(isProviderAvailableForCheckout("stripe", enabled)).toBe(true)
    expect(isProviderAvailableForCheckout("solana", enabled)).toBe(false)
    expect(isProviderAvailableForCheckout("base", enabled)).toBe(false)
    expect(isProviderAvailableForCheckout("bitcoin_lightning", enabled)).toBe(false)
  })

  it("Speed connected and ready: bitcoin_lightning is available via the canonical SPEED_PROVIDER_NAME key, stripe remains unavailable", () => {
    const enabled = new Set([SPEED_PROVIDER_NAME])
    expect(isProviderAvailableForCheckout("bitcoin_lightning", enabled)).toBe(true)
    expect(isProviderAvailableForCheckout("stripe", enabled)).toBe(false)
  })

  it("legacy lightning/lightning_nwc provider keys also unlock bitcoin_lightning", () => {
    expect(isProviderAvailableForCheckout("bitcoin_lightning", new Set(["lightning"]))).toBe(true)
    expect(isProviderAvailableForCheckout("bitcoin_lightning", new Set(["lightning_nwc"]))).toBe(true)
  })

  it("Stripe and Speed both connected: each network is independently available, neither implies the other", () => {
    const enabled = new Set(["stripe", SPEED_PROVIDER_NAME])
    expect(isProviderAvailableForCheckout("stripe", enabled)).toBe(true)
    expect(isProviderAvailableForCheckout("bitcoin_lightning", enabled)).toBe(true)
    expect(isProviderAvailableForCheckout("solana", enabled)).toBe(false)
    expect(isProviderAvailableForCheckout("base", enabled)).toBe(false)
  })

  it("Stripe and Base both connected: Card and USDC on Base are both available, Stripe never counts toward Base's availability", () => {
    const enabled = new Set(["stripe", "base"])
    expect(isProviderAvailableForCheckout("stripe", enabled)).toBe(true)
    expect(isProviderAvailableForCheckout("base", enabled)).toBe(true)
    expect(isProviderAvailableForCheckout("solana", enabled)).toBe(false)
    expect(isProviderAvailableForCheckout("bitcoin_lightning", enabled)).toBe(false)
  })

  it("Shift4 connected: shift4 network is available, does not unlock any crypto rail", () => {
    const enabled = new Set(["shift4"])
    expect(isProviderAvailableForCheckout("shift4", enabled)).toBe(true)
    expect(isProviderAvailableForCheckout("solana", enabled)).toBe(false)
    expect(isProviderAvailableForCheckout("base", enabled)).toBe(false)
    expect(isProviderAvailableForCheckout("bitcoin_lightning", enabled)).toBe(false)
  })

  it("Dynamic/Fireblocks-style infrastructure connections never make any checkout network available - they aren't in the enabled-provider key space this function checks", () => {
    // Even if "dynamic"/"fireblocks" somehow ended up in the enabled set,
    // no WalletNetwork maps to those keys, so they can never flip a
    // customer-facing payment method on.
    const enabled = new Set(["dynamic", "fireblocks"])
    expect(isProviderAvailableForCheckout("stripe", enabled)).toBe(false)
    expect(isProviderAvailableForCheckout("solana", enabled)).toBe(false)
    expect(isProviderAvailableForCheckout("base", enabled)).toBe(false)
    expect(isProviderAvailableForCheckout("bitcoin_lightning", enabled)).toBe(false)
  })

  it("no providers connected: nothing is available", () => {
    const enabled = new Set<string>()
    expect(isProviderAvailableForCheckout("stripe", enabled)).toBe(false)
    expect(isProviderAvailableForCheckout("solana", enabled)).toBe(false)
    expect(isProviderAvailableForCheckout("base", enabled)).toBe(false)
    expect(isProviderAvailableForCheckout("bitcoin_lightning", enabled)).toBe(false)
  })
})
