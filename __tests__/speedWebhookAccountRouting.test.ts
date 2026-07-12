import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Connected-account webhook events must route on the event's own top-level
 * account_id, matched against the merchant's saved Speed account_id - never
 * on request headers, and never a guessed payload shape. This is
 * identification/diagnostic only for now (see PAYMENT CREATION GAP - exactly
 * how Speed structures a connected-account payment body/metadata is still an
 * open provider-contract question), so it must never affect the webhook's
 * existing processing/response behavior.
 */

const mocks = vi.hoisted(() => ({
  processWebhook: vi.fn(),
  loadProviders: vi.fn(),
  getMerchantIdBySpeedAccountId: vi.fn(),
}))

vi.mock("@/engine/eventProcessor", () => ({ processWebhook: mocks.processWebhook }))
vi.mock("@/engine/loadProviders", () => ({ loadProviders: mocks.loadProviders }))
vi.mock("@/database/merchantLightningProfiles", () => ({
  getMerchantIdBySpeedAccountId: mocks.getMerchantIdBySpeedAccountId,
}))
vi.mock("@/database/merchantProviders", () => ({ SPEED_PROVIDER_NAME: "lightning_speed" }))

describe("POST /api/webhooks/speed - connected-account event routing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadProviders.mockResolvedValue(undefined)
    mocks.processWebhook.mockResolvedValue(undefined)
    vi.spyOn(console, "info").mockImplementation(() => undefined)
  })

  it("resolves the merchant by the event's top-level account_id for a connected-account payload", async () => {
    mocks.getMerchantIdBySpeedAccountId.mockResolvedValue("merchant-abc")
    const infoSpy = vi.spyOn(console, "info")

    const { POST } = await import("@/app/api/webhooks/speed/route")
    const body = JSON.stringify({ account_id: "acct_merchant", type: "payment.paid" })
    const response = await POST(
      new Request("https://app.test/api/webhooks/speed", { method: "POST", body }) as unknown as import("next/server").NextRequest
    )

    expect(mocks.getMerchantIdBySpeedAccountId).toHaveBeenCalledWith("acct_merchant")
    const identifiedCall = infoSpy.mock.calls.find((call) => call[0] === "[webhooks/speed] connected_account_event_identified")
    expect(identifiedCall?.[1]).toEqual({ accountIdPresent: true, merchantMatched: true })
    expect(response.status).toBe(200)
  })

  it("does not attempt account_id resolution for a platform-level event", async () => {
    const { POST } = await import("@/app/api/webhooks/speed/route")
    const body = JSON.stringify({ type: "payment.paid" })
    await POST(
      new Request("https://app.test/api/webhooks/speed", { method: "POST", body }) as unknown as import("next/server").NextRequest
    )

    expect(mocks.getMerchantIdBySpeedAccountId).not.toHaveBeenCalled()
  })

  it("still acknowledges the webhook even when no merchant matches the account_id", async () => {
    mocks.getMerchantIdBySpeedAccountId.mockResolvedValue(null)

    const { POST } = await import("@/app/api/webhooks/speed/route")
    const body = JSON.stringify({ account_id: "acct_unknown", type: "payment.paid" })
    const response = await POST(
      new Request("https://app.test/api/webhooks/speed", { method: "POST", body }) as unknown as import("next/server").NextRequest
    )

    expect(response.status).toBe(200)
    expect(mocks.processWebhook).toHaveBeenCalled()
  })
})
