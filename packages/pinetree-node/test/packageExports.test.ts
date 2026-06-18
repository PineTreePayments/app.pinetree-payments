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
  WEBHOOK_SCHEMA,
  WEBHOOK_SCHEMA_HEADER,
  LEGACY_SCHEMA_HEADER,
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
    expect(PineTreeWebhookHeaders.schema).toBe("PineTree-Event-Schema")
    expect(PineTreeWebhookHeaders.version).toBe("PineTree-Webhook-Version")
    expect(PineTreeWebhookVersion).toBe("payments-v1")
    expect(WEBHOOK_SCHEMA).toBe(PineTreeWebhookVersion)
    expect(WEBHOOK_SCHEMA_HEADER).toBe("PineTree-Event-Schema")
    expect(LEGACY_SCHEMA_HEADER).toBe("PineTree-Webhook-Version")
  })
})
