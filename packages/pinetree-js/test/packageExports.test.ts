import { describe, expect, it } from "vitest"
import PineTree, {
  PineTree as NamedPineTree,
  PineTreeBrowserError,
  CheckoutInitializationError,
  CheckoutSessionError,
  WEBHOOK_SCHEMA,
  WEBHOOK_SCHEMA_HEADER,
  LEGACY_SCHEMA_HEADER,
} from "../src"

describe("public package exports", () => {
  it("exports PineTree as both default and named export", () => {
    expect(PineTree).toBe(NamedPineTree)
    expect(new PineTree("pk_live_test")).toBeInstanceOf(NamedPineTree)
    expect(WEBHOOK_SCHEMA).toBe("payments-v1")
    expect(WEBHOOK_SCHEMA_HEADER).toBe("PineTree-Event-Schema")
    expect(LEGACY_SCHEMA_HEADER).toBe("PineTree-Webhook-Version")
  })

  it("exports all browser error classes", () => {
    expect([
      PineTreeBrowserError,
      CheckoutInitializationError,
      CheckoutSessionError,
    ]).toHaveLength(3)
  })

  it("error classes extend PineTreeBrowserError which extends Error", () => {
    expect(new PineTreeBrowserError("test")).toBeInstanceOf(Error)
    expect(new CheckoutInitializationError("test")).toBeInstanceOf(PineTreeBrowserError)
    expect(new CheckoutInitializationError("test")).toBeInstanceOf(Error)
    expect(new CheckoutSessionError("test")).toBeInstanceOf(PineTreeBrowserError)
    expect(new CheckoutSessionError("test")).toBeInstanceOf(Error)
  })
})
