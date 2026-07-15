import { describe, expect, it, vi } from "vitest"
import type { AssistantRailSummary } from "@/lib/help/pinetreeAssistantContext"

// route.ts transitively imports the real DB/engine layer (via
// lib/help/pinetreeAssistantContext.ts) purely to build GET's response -
// derivePosMethodDebugFlags itself touches none of it. Stub these out so
// importing the route module for this pure-function test never tries to
// construct a real Supabase client.
vi.mock("@/database", () => ({ supabase: {}, supabaseAdmin: {} }))
vi.mock("@/database/merchantWallets", () => ({ getMerchantWallets: vi.fn() }))
vi.mock("@/engine/paymentIntents", () => ({ getMerchantAvailableNetworks: vi.fn() }))
vi.mock("@/engine/checkoutLinks", () => ({ listCheckoutLinksEngine: vi.fn() }))
vi.mock("@/lib/api/merchantAuth", () => ({
  requireMerchantIdFromRequest: vi.fn(),
  getRouteErrorStatus: vi.fn(),
}))

const { derivePosMethodDebugFlags } = await import("@/app/api/help/assistant/context-debug/route")

function railSummary(overrides: Partial<AssistantRailSummary> & { rail: string }): AssistantRailSummary {
  return {
    provider: overrides.rail,
    connected: true,
    enabled: true,
    availableForPos: true,
    availableForCheckout: true,
    sourceSignals: [],
    ...overrides,
  }
}

describe("derivePosMethodDebugFlags", () => {
  it("regression: a merchant with only Stripe enabled reports card available, never crypto available", () => {
    const flags = derivePosMethodDebugFlags([railSummary({ rail: "stripe" })])
    expect(flags.cardEnabled).toBe(true)
    expect(flags.cryptoEnabled).toBe(false)
  })

  it("a merchant with only Shift4 enabled reports card available, never crypto available", () => {
    const flags = derivePosMethodDebugFlags([railSummary({ rail: "shift4" })])
    expect(flags.cardEnabled).toBe(true)
    expect(flags.cryptoEnabled).toBe(false)
  })

  it("a merchant with only Fluid Pay enabled reports card available, never crypto available", () => {
    const flags = derivePosMethodDebugFlags([railSummary({ rail: "fluidpay" })])
    expect(flags.cardEnabled).toBe(true)
    expect(flags.cryptoEnabled).toBe(false)
  })

  it("a merchant with only Solana enabled reports crypto available, never card available", () => {
    const flags = derivePosMethodDebugFlags([railSummary({ rail: "solana" })])
    expect(flags.cryptoEnabled).toBe(true)
    expect(flags.cardEnabled).toBe(false)
  })

  it("a merchant with only Base enabled reports crypto available, never card available", () => {
    const flags = derivePosMethodDebugFlags([railSummary({ rail: "base" })])
    expect(flags.cryptoEnabled).toBe(true)
    expect(flags.cardEnabled).toBe(false)
  })

  it("a merchant with only Speed (Lightning) enabled reports crypto available, never card available", () => {
    const flags = derivePosMethodDebugFlags([railSummary({ rail: "lightning_speed" })])
    expect(flags.cryptoEnabled).toBe(true)
    expect(flags.cardEnabled).toBe(false)
  })

  it("a merchant with both Stripe and Speed enabled reports both card and crypto available, correctly separated", () => {
    const flags = derivePosMethodDebugFlags([
      railSummary({ rail: "stripe" }),
      railSummary({ rail: "lightning_speed" }),
    ])
    expect(flags.cardEnabled).toBe(true)
    expect(flags.cryptoEnabled).toBe(true)
  })

  it("a rail that is not availableForPos does not count, even if it's a recognized card/crypto provider", () => {
    const flags = derivePosMethodDebugFlags([
      railSummary({ rail: "stripe", availableForPos: false }),
      railSummary({ rail: "solana", availableForPos: false }),
    ])
    expect(flags.cardEnabled).toBe(false)
    expect(flags.cryptoEnabled).toBe(false)
  })

  it("an unrecognized provider id counts toward neither bucket", () => {
    const flags = derivePosMethodDebugFlags([railSummary({ rail: "walletconnect" })])
    expect(flags.cardEnabled).toBe(false)
    expect(flags.cryptoEnabled).toBe(false)
  })

  it("is case-insensitive on the rail id", () => {
    const flags = derivePosMethodDebugFlags([railSummary({ rail: "STRIPE" })])
    expect(flags.cardEnabled).toBe(true)
    expect(flags.cryptoEnabled).toBe(false)
  })

  it("returns both false for an empty rail list", () => {
    expect(derivePosMethodDebugFlags([])).toEqual({ cardEnabled: false, cryptoEnabled: false })
  })
})
