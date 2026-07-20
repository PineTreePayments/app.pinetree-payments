import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireMerchantId: vi.fn(),
  listMerchantWithdrawalDestinations: vi.fn(),
  saveWithdrawalDestination: vi.fn(),
  removeWithdrawalDestination: vi.fn(),
}))

vi.mock("@/lib/api/merchantAuth", () => ({
  requireMerchantIdFromRequest: mocks.requireMerchantId,
  getRouteErrorStatus: (error: unknown) =>
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: number }).status) || 500
      : 500,
}))

vi.mock("@/engine/withdrawals/withdrawalDestinations", () => ({
  listMerchantWithdrawalDestinations: mocks.listMerchantWithdrawalDestinations,
  saveWithdrawalDestination: mocks.saveWithdrawalDestination,
  removeWithdrawalDestination: mocks.removeWithdrawalDestination,
}))

import { GET, POST } from "@/app/api/wallets/pinetree-wallet/withdrawal-destinations/route"
import { DELETE } from "@/app/api/wallets/pinetree-wallet/withdrawal-destinations/[id]/route"

function authedRequest(method: string, url: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { Authorization: "Bearer dashboard-token", "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

function unauthenticatedRequest(method: string, url: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
  })
}

describe("withdrawal-destinations API routes require authentication and are merchant-scoped", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("GET without a bearer token returns 401 and never calls the engine", async () => {
    mocks.requireMerchantId.mockRejectedValue(Object.assign(new Error("Missing bearer token"), { status: 401 }))

    const res = await GET(unauthenticatedRequest("GET", "https://app.test/api/wallets/pinetree-wallet/withdrawal-destinations"))

    expect(res.status).toBe(401)
    expect(mocks.listMerchantWithdrawalDestinations).not.toHaveBeenCalled()
  })

  it("POST without a bearer token returns 401 and never calls the engine", async () => {
    mocks.requireMerchantId.mockRejectedValue(Object.assign(new Error("Missing bearer token"), { status: 401 }))

    const res = await POST(unauthenticatedRequest("POST", "https://app.test/api/wallets/pinetree-wallet/withdrawal-destinations", {
      rail: "bitcoin", asset: "BTC", destination_address: "merchant@speed.app",
    }))

    expect(res.status).toBe(401)
    expect(mocks.saveWithdrawalDestination).not.toHaveBeenCalled()
  })

  it("DELETE without a bearer token returns 401 and never calls the engine", async () => {
    mocks.requireMerchantId.mockRejectedValue(Object.assign(new Error("Missing bearer token"), { status: 401 }))

    const res = await DELETE(
      unauthenticatedRequest("DELETE", "https://app.test/api/wallets/pinetree-wallet/withdrawal-destinations/dest_1"),
      { params: Promise.resolve({ id: "dest_1" }) }
    )

    expect(res.status).toBe(401)
    expect(mocks.removeWithdrawalDestination).not.toHaveBeenCalled()
  })

  it("GET scopes the list call to the authenticated merchant id resolved server-side - never a client-supplied id", async () => {
    mocks.requireMerchantId.mockResolvedValue("merchant_authenticated")
    mocks.listMerchantWithdrawalDestinations.mockResolvedValue([])

    await GET(authedRequest("GET", "https://app.test/api/wallets/pinetree-wallet/withdrawal-destinations?rail=bitcoin&merchant_id=someone-elses-id"))

    expect(mocks.listMerchantWithdrawalDestinations).toHaveBeenCalledWith(
      "merchant_authenticated",
      expect.objectContaining({ rail: "bitcoin" })
    )
  })

  it("POST scopes the save to the authenticated merchant id", async () => {
    mocks.requireMerchantId.mockResolvedValue("merchant_authenticated")
    mocks.saveWithdrawalDestination.mockResolvedValue({ id: "dest_1" })

    await POST(authedRequest("POST", "https://app.test/api/wallets/pinetree-wallet/withdrawal-destinations", {
      rail: "bitcoin", asset: "BTC", destination_address: "merchant@speed.app",
    }))

    expect(mocks.saveWithdrawalDestination).toHaveBeenCalledWith("merchant_authenticated", expect.objectContaining({
      destinationAddress: "merchant@speed.app",
    }))
  })

  it("DELETE scopes removal to the authenticated merchant id, never trusting a body/query merchant id", async () => {
    mocks.requireMerchantId.mockResolvedValue("merchant_authenticated")
    mocks.removeWithdrawalDestination.mockResolvedValue(undefined)

    await DELETE(
      authedRequest("DELETE", "https://app.test/api/wallets/pinetree-wallet/withdrawal-destinations/dest_1"),
      { params: Promise.resolve({ id: "dest_1" }) }
    )

    expect(mocks.removeWithdrawalDestination).toHaveBeenCalledWith("merchant_authenticated", "dest_1")
  })
})
