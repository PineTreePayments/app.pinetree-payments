import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getMerchantProviders: vi.fn(),
  getMerchantAvailableNetworks: vi.fn()
}))

vi.mock("@/database/merchants", () => ({
  getMerchantProviders: mocks.getMerchantProviders
}))

vi.mock("@/engine/paymentIntents", () => ({
  getMerchantAvailableNetworks: mocks.getMerchantAvailableNetworks
}))

import { getPosMethodReadinessEngine } from "@/engine/posMethodReadiness"

const activeStripe = {
  provider: "stripe",
  status: "active",
  enabled: true,
  credentials: {
    stripe_account_id: "acct_123",
    charges_enabled: true
  }
}

describe("POS card method readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getMerchantAvailableNetworks.mockResolvedValue([])
  })

  it("makes Card available for an active Stripe Connect account", async () => {
    mocks.getMerchantProviders.mockResolvedValue([activeStripe])
    await expect(getPosMethodReadinessEngine("merchant_1")).resolves.toMatchObject({ card: true })
  })

  it("keeps Card unavailable when Stripe is disabled", async () => {
    mocks.getMerchantProviders.mockResolvedValue([{ ...activeStripe, enabled: false }])
    await expect(getPosMethodReadinessEngine("merchant_1")).resolves.toMatchObject({ card: false })
  })

  it("keeps Card unavailable when Stripe charges are disabled", async () => {
    mocks.getMerchantProviders.mockResolvedValue([{
      ...activeStripe,
      credentials: { ...activeStripe.credentials, charges_enabled: false }
    }])
    await expect(getPosMethodReadinessEngine("merchant_1")).resolves.toMatchObject({ card: false })
  })

  it("only exposes crypto rails returned by checkout availability filtering", async () => {
    mocks.getMerchantProviders.mockResolvedValue([])
    mocks.getMerchantAvailableNetworks.mockResolvedValue(["base"])

    await expect(getPosMethodReadinessEngine("merchant_1")).resolves.toMatchObject({
      crypto: true,
      cryptoAvailable: true,
      availableCryptoRails: ["base"],
      unavailableCryptoRails: ["solana", "bitcoin_lightning"]
    })
  })
})
