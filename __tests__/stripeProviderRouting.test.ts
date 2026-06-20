import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getMerchantDefaultProvider: vi.fn(),
  getMerchantProviders: vi.fn(),
  loadProviders: vi.fn()
}))

vi.mock("@/database/merchants", () => ({
  getMerchantDefaultProvider: mocks.getMerchantDefaultProvider,
  getMerchantProviders: mocks.getMerchantProviders
}))

vi.mock("@/engine/loadProviders", () => ({
  loadProviders: mocks.loadProviders
}))

vi.mock("@/database/merchantProviders", () => ({
  SPEED_PROVIDER_NAME: "lightning_speed"
}))

import { chooseBestAdapter, getAvailableNetworks } from "@/engine/providerSelector"
import { registerProvider } from "@/engine/providerRegistry"
import type { ProviderAdapter } from "@/types/provider"

const stripeTestAdapter: ProviderAdapter = {
  metadata: {
    adapterId: "stripe",
    displayName: "Stripe",
    supportedNetworks: ["stripe"],
    feeCaptureMethods: ["collection_then_settle"],
    capabilities: {
      webhooks: true
    }
  }
}

describe("Stripe provider routing gate", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadProviders.mockResolvedValue(undefined)
    mocks.getMerchantDefaultProvider.mockResolvedValue(null)
    registerProvider("stripe", stripeTestAdapter)
  })

  it("does not route Stripe unless onboarding is approved", async () => {
    mocks.getMerchantProviders.mockResolvedValue([
      {
        merchant_id: "merchant_1",
        provider: "stripe",
        status: "active",
        enabled: true,
        credentials: {
          application_status: "pending"
        }
      }
    ])

    await expect(chooseBestAdapter({
      merchantId: "merchant_1",
      network: "stripe",
      requestedAdapterId: "stripe"
    })).rejects.toThrow("Requested payment adapter is not connected: stripe")
  })

  it("routes approved Stripe providers", async () => {
    mocks.getMerchantProviders.mockResolvedValue([
      {
        merchant_id: "merchant_1",
        provider: "stripe",
        status: "active",
        enabled: true,
        credentials: {
          application_status: "approved"
        }
      }
    ])

    await expect(chooseBestAdapter({
      merchantId: "merchant_1",
      network: "stripe",
      requestedAdapterId: "stripe"
    })).resolves.toBe("stripe")

    await expect(getAvailableNetworks("merchant_1")).resolves.toContain("stripe")
  })
})
