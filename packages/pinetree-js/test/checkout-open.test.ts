import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import PineTree, { CheckoutInitializationError, CheckoutSessionError } from "../src"

const sessionResponse = {
  id: "sess_abc123",
  object: "checkout.session",
  status: "open",
  checkoutUrl: "https://app.pinetree-payments.com/checkout/tok_abc",
  reference: "order-1",
  paymentId: null,
  amount: 2500,
  currency: "USD",
  customer: { email: null },
  metadata: {},
  supportedRails: ["base", "solana"],
  successUrl: null,
  cancelUrl: null,
  createdAt: "2026-06-13T12:00:00.000Z",
  expiresAt: "2026-06-14T12:00:00.000Z",
}

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 201,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

function errorResponse(status: number, body: unknown) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

describe("checkout.open()", () => {
  const mockFetch = vi.fn()
  const mockAssign = vi.fn()

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch)
    vi.stubGlobal("location", { assign: mockAssign })
    mockFetch.mockReset()
    mockAssign.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("POSTs to /api/v1/browser/checkout/sessions", async () => {
    mockFetch.mockResolvedValue(okResponse(sessionResponse))
    const client = new PineTree("pk_live_testkey")
    await client.checkout.open({ amount: 2500, currency: "USD", redirect: false })
    expect(mockFetch).toHaveBeenCalledOnce()
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("/api/v1/browser/checkout/sessions")
    const init = mockFetch.mock.calls[0][1] as RequestInit
    expect(init.method).toBe("POST")
  })

  it("sends the X-PineTree-Public-Key header", async () => {
    mockFetch.mockResolvedValue(okResponse(sessionResponse))
    const client = new PineTree("pk_live_testkey")
    await client.checkout.open({ amount: 2500, redirect: false })
    const init = mockFetch.mock.calls[0][1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers["X-PineTree-Public-Key"]).toBe("pk_live_testkey")
  })

  it("passes requested rails to the browser checkout API", async () => {
    mockFetch.mockResolvedValue(okResponse(sessionResponse))
    const client = new PineTree("pk_live_testkey")
    await client.checkout.open({
      amount: 2500,
      rails: ["base", "solana"],
      redirect: false,
    })
    const init = mockFetch.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(init.body))).toMatchObject({
      rails: ["base", "solana"],
    })
  })

  it("returns CheckoutSessionResult with sessionId, status, checkoutUrl", async () => {
    mockFetch.mockResolvedValue(okResponse(sessionResponse))
    const client = new PineTree("pk_live_testkey")
    const result = await client.checkout.open({ amount: 2500, redirect: false })
    expect(result.sessionId).toBe("sess_abc123")
    expect(result.status).toBe("open")
    expect(result.checkoutUrl).toBe("https://app.pinetree-payments.com/checkout/tok_abc")
    expect(result.reference).toBe("order-1")
    expect(result.paymentId).toBeNull()
  })

  it("calls location.assign with checkoutUrl by default", async () => {
    mockFetch.mockResolvedValue(okResponse(sessionResponse))
    const client = new PineTree("pk_live_testkey")
    await client.checkout.open({ amount: 2500 })
    expect(mockAssign).toHaveBeenCalledWith(sessionResponse.checkoutUrl)
  })

  it("does not call location.assign when redirect is false", async () => {
    mockFetch.mockResolvedValue(okResponse(sessionResponse))
    const client = new PineTree("pk_live_testkey")
    await client.checkout.open({ amount: 2500, redirect: false })
    expect(mockAssign).not.toHaveBeenCalled()
  })

  it("throws CheckoutInitializationError on 401", async () => {
    mockFetch.mockResolvedValue(
      errorResponse(401, {
        error: {
          type: "authentication_error",
          code: "invalid_public_key",
          message: "The provided public key is invalid or has been disabled.",
        },
      })
    )
    const client = new PineTree("pk_live_badkey")
    await expect(client.checkout.open({ amount: 2500 })).rejects.toThrow(
      CheckoutInitializationError
    )
  })

  it("throws CheckoutSessionError on 400 with error body", async () => {
    mockFetch.mockResolvedValue(
      errorResponse(400, {
        error: {
          type: "invalid_request_error",
          code: "invalid_amount",
          message: "amount must be greater than zero.",
        },
      })
    )
    const client = new PineTree("pk_live_testkey")
    const err = await client.checkout.open({ amount: -1 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CheckoutSessionError)
    expect((err as CheckoutSessionError).code).toBe("invalid_amount")
  })

  it("throws CheckoutSessionError on network error", async () => {
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"))
    const client = new PineTree("pk_live_testkey")
    await expect(client.checkout.open({ amount: 2500 })).rejects.toThrow(CheckoutSessionError)
  })

  it("uses a custom baseUrl when provided", async () => {
    mockFetch.mockResolvedValue(okResponse(sessionResponse))
    const client = new PineTree({
      publicKey: "pk_live_testkey",
      baseUrl: "http://localhost:3000",
    })
    await client.checkout.open({ amount: 2500, redirect: false })
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("http://localhost:3000")
    expect(url).toContain("/api/v1/browser/checkout/sessions")
  })
})
