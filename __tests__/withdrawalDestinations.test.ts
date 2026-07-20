import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createWithdrawalDestination: vi.fn(),
  deleteWithdrawalDestination: vi.fn(),
  getWithdrawalDestination: vi.fn(),
  listWithdrawalDestinations: vi.fn(),
  countWithdrawalDestinationsForRail: vi.fn(),
}))

vi.mock("@/database/merchantWithdrawalDestinations", () => ({
  createWithdrawalDestination: mocks.createWithdrawalDestination,
  deleteWithdrawalDestination: mocks.deleteWithdrawalDestination,
  getWithdrawalDestination: mocks.getWithdrawalDestination,
  listWithdrawalDestinations: mocks.listWithdrawalDestinations,
  countWithdrawalDestinationsForRail: mocks.countWithdrawalDestinationsForRail,
  MAX_DESTINATIONS_PER_MERCHANT_RAIL: 25,
}))

import {
  listMerchantWithdrawalDestinations,
  removeWithdrawalDestination,
  saveWithdrawalDestination,
} from "@/engine/withdrawals/withdrawalDestinations"

const MAINNET_SEGWIT = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"
const MAINNET_BOLT11 = "lnbc10u1p3xnhl2sp5jctpcz4nkfjzaqwsjssjfw0abcdefghijklmnopqrstuvwxyz"

describe("Withdrawal destination address book", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.BITCOIN_NETWORK = "mainnet"
    mocks.countWithdrawalDestinationsForRail.mockResolvedValue(0)
    mocks.createWithdrawalDestination.mockImplementation(async (input) => ({
      id: "dest_1",
      merchant_id: input.merchantId,
      rail: input.rail,
      asset: input.asset,
      method: input.method,
      destination_address: input.destinationAddress,
      label: input.label || "",
      is_default: Boolean(input.isDefault),
      created_at: "2026-07-20T00:00:00Z",
      updated_at: "2026-07-20T00:00:00Z",
    }))
  })

  it("saves a Bitcoin on-chain address tagged with method 'onchain'", async () => {
    const destination = await saveWithdrawalDestination("merchant_1", {
      rail: "bitcoin",
      asset: "BTC",
      destinationAddress: MAINNET_SEGWIT,
      label: "Cold storage",
    })

    expect(destination.method).toBe("onchain")
    expect(mocks.createWithdrawalDestination).toHaveBeenCalledWith(
      expect.objectContaining({ rail: "bitcoin", method: "onchain", destinationAddress: MAINNET_SEGWIT })
    )
  })

  it("saves a Lightning BOLT11 invoice tagged with method 'lightning'", async () => {
    const destination = await saveWithdrawalDestination("merchant_1", {
      rail: "bitcoin",
      asset: "BTC",
      destinationAddress: MAINNET_BOLT11,
    })

    expect(destination.method).toBe("lightning")
  })

  it("rejects an invalid Bitcoin destination before it ever reaches the database", async () => {
    await expect(saveWithdrawalDestination("merchant_1", {
      rail: "bitcoin",
      asset: "BTC",
      destinationAddress: "not-a-valid-destination",
    })).rejects.toThrow("Enter a valid Bitcoin address, Lightning Address, or Lightning invoice.")
    expect(mocks.createWithdrawalDestination).not.toHaveBeenCalled()
  })

  it("saves a Base address with no method (non-Bitcoin rails never carry a method)", async () => {
    const destination = await saveWithdrawalDestination("merchant_1", {
      rail: "base",
      asset: "USDC",
      destinationAddress: "0x1234567890abcdef1234567890abcdef12345678",
    })

    expect(destination.method).toBeNull()
  })

  it("rejects an invalid Solana address", async () => {
    await expect(saveWithdrawalDestination("merchant_1", {
      rail: "solana",
      asset: "SOL",
      destinationAddress: "not-valid",
    })).rejects.toThrow("Destination address is invalid for the selected rail.")
  })

  it("enforces the per-rail saved destination limit", async () => {
    mocks.countWithdrawalDestinationsForRail.mockResolvedValue(25)

    await expect(saveWithdrawalDestination("merchant_1", {
      rail: "bitcoin",
      asset: "BTC",
      destinationAddress: MAINNET_SEGWIT,
    })).rejects.toThrow("Saved destination limit reached for this rail.")
  })

  it("lists destinations scoped by rail and method (rail-aware address book)", async () => {
    mocks.listWithdrawalDestinations.mockResolvedValue([])

    await listMerchantWithdrawalDestinations("merchant_1", { rail: "bitcoin", method: "lightning" })

    expect(mocks.listWithdrawalDestinations).toHaveBeenCalledWith("merchant_1", { rail: "bitcoin", method: "lightning" })
  })

  it("deletes a destination that belongs to the merchant", async () => {
    mocks.getWithdrawalDestination.mockResolvedValue({ id: "dest_1", merchant_id: "merchant_1" })

    await removeWithdrawalDestination("merchant_1", "dest_1")

    expect(mocks.deleteWithdrawalDestination).toHaveBeenCalledWith("merchant_1", "dest_1")
  })

  it("throws 404 when deleting a destination that doesn't exist for this merchant", async () => {
    mocks.getWithdrawalDestination.mockResolvedValue(null)

    await expect(removeWithdrawalDestination("merchant_1", "dest_missing")).rejects.toThrow(
      "Saved destination not found."
    )
    expect(mocks.deleteWithdrawalDestination).not.toHaveBeenCalled()
  })
})
