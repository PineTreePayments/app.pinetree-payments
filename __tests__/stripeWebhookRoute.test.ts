import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const { processWebhook, loadProviders } = vi.hoisted(() => ({
  processWebhook: vi.fn(),
  loadProviders: vi.fn()
}))

vi.mock("@/engine/eventProcessor", () => ({ processWebhook }))
vi.mock("@/engine/loadProviders", () => ({ loadProviders }))

import { POST } from "@/app/api/webhooks/stripe/route"

describe("Stripe webhook route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadProviders.mockResolvedValue(undefined)
    processWebhook.mockResolvedValue(undefined)
  })

  it("rejects malformed JSON", async () => {
    const request = new NextRequest("https://example.test/api/webhooks/stripe", {
      method: "POST",
      body: "{not-json"
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
    expect(processWebhook).not.toHaveBeenCalled()
  })

  it("rejects invalid signatures from the engine", async () => {
    processWebhook.mockRejectedValue(new Error("Webhook verification failed"))
    const request = new NextRequest("https://example.test/api/webhooks/stripe", {
      method: "POST",
      body: JSON.stringify({ type: "payment_intent.succeeded" }),
      headers: {
        "Stripe-Signature": "bad"
      }
    })

    const response = await POST(request)
    expect(response.status).toBe(401)
  })

  it("passes raw body and Stripe-Signature through to the engine", async () => {
    const rawBody = JSON.stringify({ type: "payment_intent.succeeded" })
    const request = new NextRequest("https://example.test/api/webhooks/stripe", {
      method: "POST",
      body: rawBody,
      headers: {
        "Stripe-Signature": "t=123,v1=abc"
      }
    })

    const response = await POST(request)
    expect(response.status).toBe(200)
    expect(processWebhook).toHaveBeenCalledWith(expect.objectContaining({
      provider: "stripe",
      payload: { type: "payment_intent.succeeded" },
      rawBody,
      headers: expect.objectContaining({
        "stripe-signature": "t=123,v1=abc"
      })
    }))
  })
})

