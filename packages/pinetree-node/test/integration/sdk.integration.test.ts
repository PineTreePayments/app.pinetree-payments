import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  PineTree,
  WebhookVerificationError,
  type CheckoutSession,
} from "../../src"
import {
  createSignedWebhookFixture,
  integrationReference,
  loadIntegrationEnvironment,
} from "./helpers"

const environment = loadIntegrationEnvironment()
const describeIntegration = environment.enabled ? describe : describe.skip

describeIntegration("PineTree SDK integration", () => {
  if (!environment.enabled) {
    it("is skipped without an opt-in environment", () => {
      expect(environment.reason).toBeTruthy()
    })
    return
  }

  const { apiKey, baseUrl, paymentId, webhookSecret } = environment.config
  const pinetree = new PineTree({ apiKey, baseUrl, timeout: 30_000 })
  let createdSession: CheckoutSession
  const reference = integrationReference("retrieve-list")

  beforeAll(async () => {
    createdSession = await pinetree.checkout.sessions.create(
      {
        amount: 100,
        currency: "USD",
        reference,
        metadata: { source: "pinetree-node-integration" },
      },
      { idempotencyKey: integrationReference("create") }
    )
  })

  afterAll(async () => {
    if (createdSession?.status === "open") {
      await pinetree.checkout.sessions.cancel(createdSession.id)
    }
  })

  it("creates and retrieves a checkout session", async () => {
    expect(createdSession.object).toBe("checkout.session")
    expect(createdSession.reference).toBe(reference)

    const retrieved = await pinetree.checkout.sessions.retrieve(createdSession.id)
    expect(retrieved.id).toBe(createdSession.id)
    expect(retrieved.metadata).toMatchObject({
      source: "pinetree-node-integration",
    })
  })

  it("lists the created checkout session", async () => {
    const sessions = await pinetree.checkout.sessions.list({
      reference,
      limit: 10,
    })
    expect(sessions.object).toBe("list")
    expect(sessions.data.some((session) => session.id === createdSession.id)).toBe(true)
  })

  it("cancels an open checkout session", async () => {
    const session = await pinetree.checkout.sessions.create({
      amount: 100,
      currency: "USD",
      reference: integrationReference("cancel"),
    })
    expect(session.status).toBe("open")

    const canceled = await pinetree.checkout.sessions.cancel(session.id)
    expect(canceled.status).toBe("canceled")
  })

  it("expires an open checkout session", async () => {
    const session = await pinetree.checkout.sessions.create({
      amount: 100,
      currency: "USD",
      reference: integrationReference("expire"),
    })
    expect(session.status).toBe("open")

    const expired = await pinetree.checkout.sessions.expire(session.id)
    expect(expired.status).toBe("expired")
  })

  it.skipIf(!paymentId)("retrieves a configured public payment", async () => {
    const payment = await pinetree.payments.retrieve(paymentId!)
    expect(payment.id).toBe(paymentId)
    expect(payment.object).toBe("payment")
    expect(payment).not.toHaveProperty("providerPayload")
  })

  it("verifies local webhook fixtures and rejects tampering and stale timestamps", () => {
    const publicFixtureObject = {
      id: createdSession.id,
      object: createdSession.object,
      status: createdSession.status,
    }
    const fixture = createSignedWebhookFixture(publicFixtureObject, webhookSecret)
    expect(
      pinetree.webhooks.constructEvent(
        fixture.rawBody,
        fixture.headers,
        webhookSecret
      )
    ).toEqual(fixture.event)

    expect(() =>
      pinetree.webhooks.constructEvent(
        `${fixture.rawBody} `,
        fixture.headers,
        webhookSecret
      )
    ).toThrow(WebhookVerificationError)

    const stale = createSignedWebhookFixture(
      publicFixtureObject,
      webhookSecret,
      new Date(Date.now() - 10 * 60 * 1000).toISOString()
    )
    expect(() =>
      pinetree.webhooks.constructEvent(
        stale.rawBody,
        stale.headers,
        webhookSecret
      )
    ).toThrow(WebhookVerificationError)
  })
})
