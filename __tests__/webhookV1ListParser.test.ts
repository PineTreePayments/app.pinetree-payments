import { describe, expect, it } from "vitest"
import { parseWebhookDeliveryListQuery } from "@/lib/api/v1/webhookDeliveryList"

describe("v1 webhook delivery list parsing", () => {
  it("parses cursor and filters", () => {
    const cursor = Buffer.from(
      JSON.stringify({ createdAt: "2026-06-12T00:00:00.000Z", id: "delivery-1" })
    ).toString("base64url")
    expect(
      parseWebhookDeliveryListQuery(
        `https://example.test/api/v1/webhook-deliveries?limit=25&status=failed&eventType=checkout.session.failed&cursor=${cursor}`
      )
    ).toMatchObject({
      limit: 25,
      status: "failed",
      eventType: "checkout.session.failed",
      cursor: { id: "delivery-1" },
    })
  })

  it("rejects invalid filters and cursors", () => {
    expect(() =>
      parseWebhookDeliveryListQuery(
        "https://example.test/api/v1/webhook-deliveries?status=unknown"
      )
    ).toThrowError(expect.objectContaining({ code: "invalid_filter" }))
    expect(() =>
      parseWebhookDeliveryListQuery(
        "https://example.test/api/v1/webhook-deliveries?cursor=bad"
      )
    ).toThrowError(expect.objectContaining({ code: "invalid_cursor" }))
  })
})
