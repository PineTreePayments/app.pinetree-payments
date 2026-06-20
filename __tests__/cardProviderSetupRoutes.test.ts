import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireMerchantId: vi.fn(),
  startSetup: vi.fn(),
  markReturned: vi.fn()
}))

vi.mock("@/lib/api/merchantAuth", () => ({
  requireMerchantIdFromRequest: mocks.requireMerchantId,
  getRouteErrorStatus: (error: unknown) =>
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: number }).status) || 500
      : 500
}))

vi.mock("@/engine/cardProviderSetup", () => ({
  isCardSetupProvider: (provider: string) => provider === "stripe" || provider === "fluidpay",
  startCardProviderSetup: mocks.startSetup,
  markCardProviderSetupReturned: mocks.markReturned
}))

import { POST as startSetup } from "@/app/api/providers/[provider]/start-setup/route"
import { POST as setupReturn } from "@/app/api/providers/[provider]/setup-return/route"

function request(url = "https://app.test/api/providers/stripe/start-setup") {
  return new NextRequest(url, {
    method: "POST",
    headers: { Authorization: "Bearer dashboard-token" }
  })
}

function params(provider: string) {
  return { params: Promise.resolve({ provider }) }
}

describe("card provider setup routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireMerchantId.mockResolvedValue("merchant_1")
    mocks.startSetup.mockResolvedValue({
      ok: true,
      url: "https://stripe.example/apply?return_url=https%3A%2F%2Fapp.test%2Fdashboard%2Fproviders%3Fprovider%3Dstripe%26setup%3Dreturned",
      applicationStatus: "pending"
    })
    mocks.markReturned.mockResolvedValue({ ok: true, applicationStatus: "pending" })
  })

  it("rejects unsupported providers", async () => {
    const response = await startSetup(request("https://app.test/api/providers/paypal/start-setup"), params("paypal"))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ ok: false, error: "Unsupported provider" })
    expect(mocks.startSetup).not.toHaveBeenCalled()
  })

  it("rejects unauthenticated merchants", async () => {
    const error = Object.assign(new Error("Unauthorized"), { status: 401 })
    mocks.requireMerchantId.mockRejectedValue(error)

    const response = await startSetup(request(), params("stripe"))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ ok: false, error: "Unauthorized" })
  })

  it("returns configured provider URL and creates a pending setup session", async () => {
    const response = await startSetup(request(), params("stripe"))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      url: "https://stripe.example/apply?return_url=https%3A%2F%2Fapp.test%2Fdashboard%2Fproviders%3Fprovider%3Dstripe%26setup%3Dreturned",
      applicationStatus: "pending"
    })
    expect(mocks.startSetup).toHaveBeenCalledWith({
      merchantId: "merchant_1",
      provider: "stripe",
      returnUrl: "https://app.test/dashboard/providers?provider=stripe&setup=returned"
    })
  })

  it("returns an error when setup URL is missing", async () => {
    mocks.startSetup.mockResolvedValue({ ok: false, error: "Setup link not configured yet." })

    const response = await startSetup(request(), params("fluidpay"))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ ok: false, error: "Setup link not configured yet." })
  })

  it("records setup return without approving the provider", async () => {
    const response = await setupReturn(
      request("https://app.test/api/providers/fluidpay/setup-return"),
      params("fluidpay")
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, applicationStatus: "pending" })
    expect(mocks.markReturned).toHaveBeenCalledWith({
      merchantId: "merchant_1",
      provider: "fluidpay"
    })
  })
})
