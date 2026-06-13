import { describe, expect, it } from "vitest"
import PineTree, {
  APIConnectionError,
  AuthenticationError,
  IdempotencyConflictError,
  InvalidRequestError,
  PermissionError,
  PineTree as NamedPineTree,
  PineTreeError,
  PineTreeWebhookHeaders,
  PineTreeWebhookVersion,
  WebhookVerificationError,
} from "../src"

describe("public package exports", () => {
  it("exports the client, error classes, and webhook constants", () => {
    expect(PineTree).toBe(NamedPineTree)
    expect(new PineTree("pt_live_test")).toBeInstanceOf(NamedPineTree)
    expect([
      PineTreeError,
      AuthenticationError,
      PermissionError,
      InvalidRequestError,
      APIConnectionError,
      IdempotencyConflictError,
      WebhookVerificationError,
    ]).toHaveLength(7)
    expect(PineTreeWebhookHeaders.signature).toBe("PineTree-Signature")
    expect(PineTreeWebhookVersion).toBe("2026-06-12")
  })
})
