import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { WalletApiRouteError } from "@/engine/wallet/walletErrors"

const mocks = vi.hoisted(() => ({
  requireMerchantIdFromRequest: vi.fn(),
}))

vi.mock("@/lib/api/merchantAuth", () => ({
  requireMerchantIdFromRequest: mocks.requireMerchantIdFromRequest,
}))

describe("wallet API route envelope correlation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireMerchantIdFromRequest.mockResolvedValue("merchant-1")
  })

  it("preserves normalized error code/status/message and includes correlationId", async () => {
    const { withWalletMerchant } = await import("@/lib/api/walletApiRoute")
    const req = new NextRequest("https://app.test/api/wallets/withdrawals", { method: "POST" })
    const response = await withWalletMerchant(
      req,
      async () => {
        throw new WalletApiRouteError("INVALID_DESTINATION", "Enter a valid destination address.", false)
      },
      { correlationId: "5424ca86" }
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      correlationId: "5424ca86",
      error: {
        code: "INVALID_DESTINATION",
        message: "Enter a valid destination address.",
        retryable: false,
      },
    })
  })
})
