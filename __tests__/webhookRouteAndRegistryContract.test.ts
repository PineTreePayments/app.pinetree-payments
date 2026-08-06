import crypto from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

/**
 * Route-level and registry-wide webhook security contracts.
 *
 * Kept separate from webhookVerificationFailClosed.test.ts because this file
 * exercises the REAL provider registry — it must not mock @/providers/registry.
 */

// ─── Generic provider route is retired ───────────────────────────────────────

describe("retired generic provider webhook route", () => {
  it("answers 410 Gone instead of processing the original forged request", async () => {
    const { POST } = await import("@/app/api/webhooks/provider/route")

    const response = await POST()
    expect(response.status).toBe(410)

    const body = (await response.json()) as { error?: string }
    expect(body.error).toBe("Gone")
  })

  it("cannot select an adapter from a request at all", async () => {
    // Structural proof: the handler takes no request parameter, so no header —
    // `x-provider` included — can reach adapter selection. Constructing the
    // original attack request and confirming the handler ignores it entirely.
    const { POST } = await import("@/app/api/webhooks/provider/route")
    expect(POST.length).toBe(0)

    const forged = new NextRequest("https://example.test/api/webhooks/provider", {
      method: "POST",
      body: JSON.stringify({
        reference: "11111111-2222-3333-4444-555555555555",
        confirmed: true,
        feeCaptureValidated: true,
      }),
      headers: { "x-provider": "solana" },
    })

    const handler = POST as unknown as (req?: unknown) => Promise<Response>
    const response = await handler(forged)
    expect(response.status).toBe(410)
  })

  it("rejects non-POST methods too", async () => {
    const { GET, PUT, PATCH, DELETE } = await import("@/app/api/webhooks/provider/route")
    for (const handler of [GET, PUT, PATCH, DELETE]) {
      const response = await handler()
      expect(response.status).toBe(410)
    }
  })
})

// ─── Registry-wide contract ──────────────────────────────────────────────────

describe("registered provider webhook contract", () => {
  it("gives every actively registered adapter a fail-closed verifier", async () => {
    await import("@/providers")
    const { getAllProviders } = await import("@/providers/registry")
    const registered = getAllProviders()

    const names = Object.keys(registered)
    expect(names.length).toBeGreaterThan(0)

    for (const [name, adapter] of Object.entries(registered)) {
      // No adapter may omit verification — the engine refuses that case, and an
      // adapter without it would have relied on the old permissive default.
      expect(typeof adapter.verifyWebhook, `${name} must define verifyWebhook`).toBe("function")

      // An unsigned payload must be refused: either false, or a throw for an
      // adapter that has no webhook contract at all.
      let outcome: "false" | "threw" | "accepted"
      try {
        outcome = adapter.verifyWebhook!({ forged: true }, "", "{}") === true ? "accepted" : "false"
      } catch {
        outcome = "threw"
      }
      expect(outcome, `${name} accepted an unsigned webhook`).not.toBe("accepted")
    }
  })

  it("does not register the retired Coinbase Commerce adapter by default", async () => {
    await import("@/providers")
    const { getProvider, getAllProviders } = await import("@/providers/registry")

    expect(Object.keys(getAllProviders())).not.toContain("coinbase")
    // Unregistered means unreachable: the registry throws rather than returning
    // an adapter a forged request could ride.
    expect(() => getProvider("coinbase")).toThrow(/not registered/i)
  })

  it("still registers the providers that have dedicated verified routes", async () => {
    await import("@/providers")
    const { getAllProviders } = await import("@/providers/registry")
    const names = Object.keys(getAllProviders())

    for (const expected of ["stripe", "shift4", "base", "solana"]) {
      expect(names, `${expected} should remain registered`).toContain(expected)
    }
  })
})

// ─── A real verification contract still succeeds ─────────────────────────────

describe("valid signatures are still accepted", () => {
  it("accepts a correctly signed Stripe webhook and rejects a tampered body", async () => {
    const { verifyWebhook } = await import("@/providers/stripe/verifyWebhook")

    const secret = "whsec_test_secret_for_unit_test"
    const rawBody = JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded" })
    const timestamp = Math.floor(Date.now() / 1000)
    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody}`, "utf8")
      .digest("hex")
    const signature = `t=${timestamp},v1=${expected}`

    // Genuine signature over the exact raw body → accepted.
    expect(verifyWebhook({ rawBody, signature, webhookSecret: secret })).toBe(true)

    // Same signature, body altered by one character → rejected.
    expect(
      verifyWebhook({ rawBody: rawBody.replace("evt_1", "evt_2"), signature, webhookSecret: secret })
    ).toBe(false)

    // Correct body, no secret configured → rejected, never accepted.
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "")
    vi.stubEnv("STRIPE_CONNECT_WEBHOOK_SECRET", "")
    expect(verifyWebhook({ rawBody, signature })).toBe(false)
    vi.unstubAllEnvs()
  })

  it("rejects a Speed webhook with no signature headers", async () => {
    const { verifySpeedWebhookSignature } = await import("@/providers/lightning/speedClient")
    expect(verifySpeedWebhookSignature("{}", {}, {})).toBe(false)
  })
})
