import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const { processWebhook, loadProviders } = vi.hoisted(() => ({
  processWebhook: vi.fn(),
  loadProviders: vi.fn(),
}))

vi.mock("@/engine/eventProcessor", () => ({ processWebhook }))
vi.mock("@/engine/loadProviders", () => ({ loadProviders }))

import { POST } from "@/app/api/webhooks/shift4/route"

describe("Shift4 webhook route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadProviders.mockResolvedValue(undefined)
    processWebhook.mockResolvedValue(undefined)
  })

  it("rejects malformed JSON", async () => {
    const request = new NextRequest("https://example.test/api/webhooks/shift4", {
      method: "POST",
      body: "{not-json",
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
    expect(processWebhook).not.toHaveBeenCalled()
  })

  it("rejects invalid signatures from the engine", async () => {
    processWebhook.mockRejectedValue(new Error("Webhook verification failed"))
    const request = new NextRequest("https://example.test/api/webhooks/shift4", {
      method: "POST",
      body: JSON.stringify({ type: "payment.captured" }),
    })

    const response = await POST(request)
    expect(response.status).toBe(401)
  })

  it("accepts verified Shift4 webhook payloads", async () => {
    const rawBody = JSON.stringify({ type: "payment.captured" })
    const request = new NextRequest("https://example.test/api/webhooks/shift4", {
      method: "POST",
      body: rawBody,
      headers: {
        "x-shift4-signature": "mock-signature"
      }
    })

    const response = await POST(request)
    expect(response.status).toBe(200)
    expect(processWebhook).toHaveBeenCalledWith(expect.objectContaining({
      provider: "shift4",
      payload: { type: "payment.captured" },
      rawBody
    }))
  })
})
