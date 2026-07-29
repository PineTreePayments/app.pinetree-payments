import { describe, expect, it } from "vitest"
import { mapInternalCheckoutSessionStatus } from "@/engine/publicCheckoutSessionStatus"

describe("public checkout session status mapping", () => {
  it.each([
    ["CREATED", "open"],
    ["PENDING", "open"],
    ["PROCESSING", "processing"],
    ["CONFIRMED", "paid"],
    ["FAILED", "failed"],
    ["EXPIRED", "expired"],
    ["INCOMPLETE", "incomplete"],
    ["disabled", "canceled"],
  ])("maps %s to %s", (internal, expected) => {
    expect(mapInternalCheckoutSessionStatus(internal)).toBe(expected)
  })
})
