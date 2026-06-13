import { afterEach, describe, expect, it, vi } from "vitest"
import {
  getHostedCheckoutTerminalEvent,
  postHostedCheckoutEvent,
} from "@/lib/checkout/hostedCheckoutEvents"

describe("hosted checkout postMessage bridge", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    ["CONFIRMED", { event: "complete", status: "paid" }],
    ["FAILED", { event: "failed", status: "failed" }],
    ["EXPIRED", { event: "expired", status: "expired" }],
    ["CANCELED", { event: "canceled", status: "canceled" }],
    ["INCOMPLETE", { event: "canceled", status: "canceled" }],
  ])("maps %s to a browser lifecycle event", (status, expected) => {
    expect(getHostedCheckoutTerminalEvent(status)).toEqual(expected)
  })

  it("posts the sanitized versioned payload to parent and opener", () => {
    const parentPostMessage = vi.fn()
    const openerPostMessage = vi.fn()
    const browserWindow = {
      parent: { postMessage: parentPostMessage },
      opener: { closed: false, postMessage: openerPostMessage },
    }
    vi.stubGlobal("window", browserWindow)

    const result = postHostedCheckoutEvent("sess_123", "complete", "paid")

    expect(result).toEqual({
      source: "pinetree-checkout",
      version: 1,
      event: "complete",
      sessionId: "sess_123",
      status: "paid",
    })
    expect(Object.keys(result!)).toEqual([
      "source",
      "version",
      "event",
      "sessionId",
      "status",
    ])
    expect(parentPostMessage).toHaveBeenCalledWith(result, "*")
    expect(openerPostMessage).toHaveBeenCalledWith(result, "*")
  })
})
