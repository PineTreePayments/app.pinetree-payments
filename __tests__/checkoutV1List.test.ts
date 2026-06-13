import { describe, expect, it } from "vitest"
import { parseCheckoutSessionListQuery } from "@/lib/api/v1/checkoutSessionList"

describe("v1 checkout session list filters", () => {
  it("parses filters and pagination cursor", () => {
    const cursor = Buffer.from(
      JSON.stringify({ createdAt: "2026-06-12T12:00:00.000Z", id: "session-2" })
    ).toString("base64url")
    const result = parseCheckoutSessionListQuery(
      `https://example.test/api/v1/checkout/sessions?limit=20&status=paid&reference=order-1&created_after=2026-06-01&created_before=2026-06-13&cursor=${cursor}`
    )
    expect(result).toMatchObject({
      limit: 20,
      status: "paid",
      reference: "order-1",
      cursor: { id: "session-2" },
    })
  })

  it("rejects invalid cursors", () => {
    expect(() =>
      parseCheckoutSessionListQuery(
        "https://example.test/api/v1/checkout/sessions?cursor=bad"
      )
    ).toThrowError(expect.objectContaining({ code: "invalid_cursor" }))
  })

  it("rejects unsupported statuses and invalid filters", () => {
    expect(() =>
      parseCheckoutSessionListQuery(
        "https://example.test/api/v1/checkout/sessions?status=unknown"
      )
    ).toThrowError(expect.objectContaining({ code: "unsupported_status" }))
    expect(() =>
      parseCheckoutSessionListQuery(
        "https://example.test/api/v1/checkout/sessions?limit=500"
      )
    ).toThrowError(expect.objectContaining({ code: "invalid_filter" }))
  })
})
