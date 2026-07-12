import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createHmac } from "node:crypto"
import {
  extractSpeedWebhookAccountId,
  isSpeedConnectedAccountWebhookPayload,
  verifySpeedWebhookSignature,
} from "@/providers/lightning/speedClient"

const originalEnv = process.env

const ACCOUNT_SECRET = `wsec_${Buffer.from("account-level-secret").toString("base64")}`
const CONNECT_SECRET = `wsec_${Buffer.from("connected-account-secret").toString("base64")}`

function signRawBody(secret: string, webhookId: string, timestamp: string, rawBody: string) {
  const secretBytes = Buffer.from(secret.slice("wsec_".length), "base64")
  const signature = createHmac("sha256", secretBytes)
    .update(`${webhookId}.${timestamp}.${rawBody}`, "utf8")
    .digest("base64")
  return {
    "webhook-id": webhookId,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${signature}`,
  }
}

describe("Speed connected-account payload detection", () => {
  it("treats top-level account_id as a connected-account event", () => {
    expect(isSpeedConnectedAccountWebhookPayload({ account_id: "acct_123" })).toBe(true)
  })

  it("treats nested data.object.account_id as a connected-account event", () => {
    expect(
      isSpeedConnectedAccountWebhookPayload({ data: { object: { account_id: "acct_123" } } })
    ).toBe(true)
  })

  it("treats a payload with no account_id as an account-level event", () => {
    expect(isSpeedConnectedAccountWebhookPayload({ data: { object: { id: "pay_1" } } })).toBe(false)
    expect(isSpeedConnectedAccountWebhookPayload(null)).toBe(false)
  })
})

describe("extractSpeedWebhookAccountId", () => {
  it("prefers the top-level account_id, per the official webhook routing guidance", () => {
    expect(
      extractSpeedWebhookAccountId({ account_id: "acct_top_level", data: { object: { account_id: "acct_nested" } } })
    ).toBe("acct_top_level")
  })

  it("falls back to nested locations when no top-level account_id is present", () => {
    expect(extractSpeedWebhookAccountId({ data: { object: { account_id: "acct_nested" } } })).toBe("acct_nested")
    expect(
      extractSpeedWebhookAccountId({ event: { data: { object: { account_id: "acct_deep_nested" } } } })
    ).toBe("acct_deep_nested")
  })

  it("returns null for a platform-level event with no account_id anywhere", () => {
    expect(extractSpeedWebhookAccountId({ data: { object: { id: "pay_1" } } })).toBeNull()
    expect(extractSpeedWebhookAccountId(null)).toBeNull()
  })
})

describe("verifySpeedWebhookSignature", () => {
  beforeEach(() => {
    process.env = { ...originalEnv }
    process.env.SPEED_WEBHOOK_SECRET = ACCOUNT_SECRET
    process.env.SPEED_CONNECT_WEBHOOK_SECRET = CONNECT_SECRET
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it("verifies account-level events against SPEED_WEBHOOK_SECRET", () => {
    const rawBody = JSON.stringify({ type: "payment.paid", data: { object: { id: "pay_1" } } })
    const headers = signRawBody(ACCOUNT_SECRET, "msg_1", "1700000000", rawBody)
    const payload = JSON.parse(rawBody)

    expect(verifySpeedWebhookSignature(rawBody, headers, payload)).toBe(true)
  })

  it("rejects account-level events signed with the connect secret", () => {
    const rawBody = JSON.stringify({ type: "payment.paid", data: { object: { id: "pay_1" } } })
    const headers = signRawBody(CONNECT_SECRET, "msg_1", "1700000000", rawBody)
    const payload = JSON.parse(rawBody)

    expect(verifySpeedWebhookSignature(rawBody, headers, payload)).toBe(false)
  })

  it("verifies connected-account events against SPEED_CONNECT_WEBHOOK_SECRET", () => {
    const rawBody = JSON.stringify({
      type: "payment.paid",
      data: { object: { id: "pay_1", account_id: "acct_merchant_1" } },
    })
    const headers = signRawBody(CONNECT_SECRET, "msg_2", "1700000001", rawBody)
    const payload = JSON.parse(rawBody)

    expect(verifySpeedWebhookSignature(rawBody, headers, payload)).toBe(true)
  })

  it("rejects connected-account events signed with the account-level secret when connect secret is configured", () => {
    const rawBody = JSON.stringify({
      type: "payment.paid",
      data: { object: { id: "pay_1", account_id: "acct_merchant_1" } },
    })
    const headers = signRawBody(ACCOUNT_SECRET, "msg_2", "1700000001", rawBody)
    const payload = JSON.parse(rawBody)

    expect(verifySpeedWebhookSignature(rawBody, headers, payload)).toBe(false)
  })

  it("falls back to SPEED_WEBHOOK_SECRET with a warning when SPEED_CONNECT_WEBHOOK_SECRET is missing", () => {
    delete process.env.SPEED_CONNECT_WEBHOOK_SECRET
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    const rawBody = JSON.stringify({
      type: "payment.paid",
      data: { object: { id: "pay_1", account_id: "acct_merchant_1" } },
    })
    const headers = signRawBody(ACCOUNT_SECRET, "msg_3", "1700000002", rawBody)
    const payload = JSON.parse(rawBody)

    expect(verifySpeedWebhookSignature(rawBody, headers, payload)).toBe(true)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("SPEED_CONNECT_WEBHOOK_SECRET is not configured")
    )
  })

  it("rejects when both webhook secrets are missing", () => {
    delete process.env.SPEED_WEBHOOK_SECRET
    delete process.env.SPEED_CONNECT_WEBHOOK_SECRET

    const rawBody = JSON.stringify({ type: "payment.paid", data: { object: { id: "pay_1" } } })
    const headers = signRawBody(ACCOUNT_SECRET, "msg_4", "1700000003", rawBody)
    const payload = JSON.parse(rawBody)

    expect(verifySpeedWebhookSignature(rawBody, headers, payload)).toBe(false)
  })
})
