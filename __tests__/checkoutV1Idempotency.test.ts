import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  claimApiIdempotency,
  completeApiIdempotencyClaim,
  getApiIdempotencyClaim,
  releaseApiIdempotencyClaim,
} = vi.hoisted(() => ({
  claimApiIdempotency: vi.fn(),
  completeApiIdempotencyClaim: vi.fn(),
  getApiIdempotencyClaim: vi.fn(),
  releaseApiIdempotencyClaim: vi.fn(),
}))

vi.mock("@/database/apiIdempotencyClaims", () => ({
  claimApiIdempotency,
  completeApiIdempotencyClaim,
  getApiIdempotencyClaim,
  releaseApiIdempotencyClaim,
}))

import {
  buildCheckoutSessionIdempotency,
  claimCheckoutSessionIdempotency,
} from "@/engine/checkoutSessionIdempotency"

const response = {
  id: "session-1",
  object: "checkout.session",
  status: "open",
} as never

describe("durable checkout session idempotency", () => {
  beforeEach(() => vi.clearAllMocks())

  it("canonicalizes equivalent request bodies", async () => {
    const left = await buildCheckoutSessionIdempotency({
      key: "order-1",
      body: { amount: 10, metadata: { b: 2, a: 1 } },
    })
    const right = await buildCheckoutSessionIdempotency({
      key: "order-1",
      body: { metadata: { a: 1, b: 2 }, amount: 10 },
    })
    expect(left).toEqual(right)
  })

  it("returns the stored normalized response for a completed duplicate", async () => {
    claimApiIdempotency.mockResolvedValue({
      claimed: false,
      claim: {
        id: "claim-1",
        request_hash: "request-1",
        response_body: response,
      },
    })
    await expect(
      claimCheckoutSessionIdempotency({
        merchantId: "merchant-1",
        keyHash: "key-1",
        requestHash: "request-1",
      })
    ).resolves.toEqual({ state: "replay", response })
  })

  it("rejects the same key with a different request hash", async () => {
    claimApiIdempotency.mockResolvedValue({
      claimed: false,
      claim: {
        id: "claim-1",
        request_hash: "original",
        response_body: response,
      },
    })
    await expect(
      claimCheckoutSessionIdempotency({
        merchantId: "merchant-1",
        keyHash: "key-1",
        requestHash: "different",
      })
    ).resolves.toEqual({ state: "conflict" })
  })

  it("gives only the database claim winner permission to create", async () => {
    claimApiIdempotency.mockResolvedValue({
      claimed: true,
      claim: {
        id: "claim-1",
        request_hash: "request-1",
        response_body: null,
      },
    })
    await expect(
      claimCheckoutSessionIdempotency({
        merchantId: "merchant-1",
        keyHash: "key-1",
        requestHash: "request-1",
      })
    ).resolves.toEqual({ state: "claimed", claimId: "claim-1" })
  })
})
