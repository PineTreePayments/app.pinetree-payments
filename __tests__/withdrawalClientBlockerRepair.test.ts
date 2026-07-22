import { beforeEach, describe, expect, it, vi } from "vitest"
import { WalletApiRouteError } from "@/engine/wallet/walletErrors"

/**
 * 2026-07-21 production incident: Vercel logs proved a Solana review POST
 * returned 200 with signerCanSign/canSubmit true and approvalMethod
 * "dynamic_browser", but prepare/submit were never called - and for Bitcoin,
 * /api/wallets/withdrawals was never called at all. One hypothesis was a
 * response-shape mismatch between what a route returns and what the client
 * parses (e.g. route returns {request, review} while the client expects
 * {ok, data: {request, review}}, or vice versa).
 *
 * These tests exercise the real route handlers (not just source strings) to
 * settle that hypothesis with actual JSON output, and confirm the two
 * withdrawal route families genuinely use different (and correctly
 * different) envelopes: the Dynamic review/prepare/submit routes return a
 * flat body, while the generic /api/wallets/* boundary (used for Bitcoin)
 * always wraps in {ok, data}/{ok, error} via withWalletMerchant. The client
 * types in app/dashboard/wallet-setup/page.tsx must match whichever route it
 * actually calls.
 */

describe("withdrawal route response shapes match the client's expectations", () => {
  const requireMerchantIdFromRequest = vi.fn()
  const getRouteErrorStatus = vi.fn()
  const createWalletWithdrawalReview = vi.fn()
  const submitWalletWithdrawalRequest = vi.fn()
  const updateWalletWithdrawalRequestCanonicalFields = vi.fn()
  const submitCanonicalWithdrawal = vi.fn()
  const prepareDynamicWalletWithdrawal = vi.fn()
  const completeDynamicWalletWithdrawal = vi.fn()
  const scheduleWalletWithdrawalMaintenance = vi.fn()
  const createWalletWithdrawal = vi.fn()
  const updateWalletOperationCanonicalFields = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    requireMerchantIdFromRequest.mockResolvedValue("merchant_1")
    getRouteErrorStatus.mockReturnValue(500)
    updateWalletWithdrawalRequestCanonicalFields.mockImplementation(async (_m, id: string) => ({ id }))
    updateWalletOperationCanonicalFields.mockResolvedValue(undefined)

    vi.doMock("@/lib/api/merchantAuth", () => ({ requireMerchantIdFromRequest, getRouteErrorStatus }))
    vi.doMock("@/engine/withdrawals/walletWithdrawals", () => ({
      createWalletWithdrawalReview,
      submitWalletWithdrawalRequest,
      prepareDynamicWalletWithdrawal,
      completeDynamicWalletWithdrawal,
      normalizeWithdrawalRail: (v: string) => (["base", "solana", "bitcoin"].includes(v) ? v : null),
      normalizeWithdrawalAsset: (v: string) => (["ETH", "USDC", "SOL", "BTC"].includes(v) ? v : null),
    }))
    vi.doMock("@/database/walletWithdrawalRequests", () => ({
      updateWalletWithdrawalRequestCanonicalFields,
    }))
    vi.doMock("@/engine/withdrawals/canonicalWithdrawal", () => ({ submitCanonicalWithdrawal }))
    vi.doMock("@/lib/api/walletWithdrawalMaintenance", () => ({ scheduleWalletWithdrawalMaintenance }))
    vi.doMock("@/engine/wallet/walletOperations", () => ({ createWalletWithdrawal }))
    vi.doMock("@/database/merchantWalletOperations", () => ({ updateWalletOperationCanonicalFields }))
  })

  it("the review route returns a FLAT {request, review, canSubmit} body, not {ok, data}", async () => {
    createWalletWithdrawalReview.mockResolvedValue({
      request: { id: "wd-1", status: "review_required" },
      review: { rail: "solana", asset: "USDC", approvalMethod: "dynamic_browser", message: "ok" },
      canSubmit: true,
    })

    const { POST } = await import("@/app/api/wallets/pinetree-wallet/withdrawals/route")
    const req = {
      headers: new Headers({ "x-pinetree-withdrawal-correlation": "corr-1" }),
      json: async () => ({ rail: "solana", asset: "USDC", destination_address: "SomeAddr", amount_decimal: "1" }),
    }
    const res = await POST(req as never)
    const body = await res.json()

    // Must NOT be wrapped - the client (WithdrawalReviewResponse type) reads
    // json.request/json.review/json.canSubmit directly off the root object.
    expect(body.ok).toBeUndefined()
    expect(body.data).toBeUndefined()
    expect(body.request).toEqual(expect.objectContaining({ id: "wd-1" }))
    expect(body.review).toEqual(expect.objectContaining({ approvalMethod: "dynamic_browser" }))
    expect(body.canSubmit).toBe(true)
  })

  it("the prepare route returns a FLAT body with payload/sourceAddress at the root", async () => {
    prepareDynamicWalletWithdrawal.mockResolvedValue({
      request: { id: "wd-1", status: "pending" },
      approvalMethod: "dynamic_browser",
      provider: "dynamic",
      rail: "solana",
      asset: "USDC",
      sourceAddress: "SomeSolanaAddress",
      payload: { kind: "solana_transaction", network: "solana", from: "SomeSolanaAddress", transactionBase64: "abc" },
    })

    const { POST } = await import("@/app/api/wallets/pinetree-wallet/withdrawals/[id]/prepare/route")
    const req = { headers: new Headers({ "x-pinetree-withdrawal-correlation": "corr-1" }) }
    const res = await POST(req as never, { params: Promise.resolve({ id: "wd-1" }) })
    const body = await res.json()

    expect(body.ok).toBeUndefined()
    expect(body.data).toBeUndefined()
    expect(body.payload).toEqual(expect.objectContaining({ kind: "solana_transaction" }))
    expect(body.sourceAddress).toBe("SomeSolanaAddress")
  })

  it("the submit route returns a FLAT body with merchantStatus/request at the root", async () => {
    completeDynamicWalletWithdrawal.mockResolvedValue({
      request: { id: "wd-1", status: "processing", tx_hash: "sig123" },
      merchantStatus: "Processing",
      message: "Withdrawal submitted.",
    })

    const { POST } = await import("@/app/api/wallets/pinetree-wallet/withdrawals/[id]/submit/route")
    const req = {
      headers: new Headers({ "x-pinetree-withdrawal-correlation": "corr-1" }),
      json: async () => ({ tx_hash: "sig123", provider_reference: "sig123" }),
    }
    const res = await POST(req as never, { params: Promise.resolve({ id: "wd-1" }) })
    const body = await res.json()

    expect(body.ok).toBeUndefined()
    expect(body.merchantStatus).toBe("Processing")
    expect(body.request).toEqual(expect.objectContaining({ id: "wd-1" }))
  })

  it("the Bitcoin/Speed route DOES wrap in {ok, data: {operation}} - the client's WalletWithdrawalResponse type must match this, not the flat Dynamic shape", async () => {
    createWalletWithdrawal.mockResolvedValue({
      operation: { id: "op-1", status: "PROCESSING", txHash: null },
      capabilityAvailable: true,
    })

    const { POST } = await import("@/app/api/wallets/withdrawals/route")
    // The Bitcoin route reads its body via lib/api/walletApiRoute.ts's
    // readWalletJsonBody (req.text() + a real content-type check), unlike the
    // Dynamic routes above which call req.json() directly - a plain mock
    // object isn't enough here, use a real Request.
    const req = new Request("http://localhost/api/wallets/withdrawals", {
      method: "POST",
      headers: {
        "idempotency-key": "idem-1",
        "x-pinetree-withdrawal-correlation": "corr-1",
        "content-type": "application/json",
      },
      body: JSON.stringify({ asset: "SATS", amount_decimal: "1000", destination: "bc1qtest" }),
    })
    const res = await POST(req as never)
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.operation).toEqual(expect.objectContaining({ id: "op-1", status: "PROCESSING" }))
  })

  it("the Bitcoin/Speed route emits SPEED_ROUTE_FAILED with the propagated substage before returning an error envelope", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    createWalletWithdrawal.mockImplementation(async (_merchantId, input) => {
      input.diagnostics.setSubstage("send_request")
      input.diagnostics.setProviderAccountId("acct_live_abc123")
      throw new WalletApiRouteError("INVALID_DESTINATION", "Enter a valid Bitcoin destination.", false)
    })

    const { POST } = await import("@/app/api/wallets/withdrawals/route")
    const req = new Request("http://localhost/api/wallets/withdrawals", {
      method: "POST",
      headers: {
        "idempotency-key": "idem-1",
        "x-pinetree-withdrawal-correlation": "corr-1",
        "content-type": "application/json",
      },
      body: JSON.stringify({ asset: "SATS", amount_decimal: "1000", destination: "merchant@example.com" }),
    })
    const res = await POST(req as never)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toEqual(expect.objectContaining({
      ok: false,
      correlationId: "corr-1",
      error: expect.objectContaining({ code: "INVALID_DESTINATION", retryable: false }),
    }))
    expect(warn).toHaveBeenCalledWith(
      "[pinetree-withdrawals] SPEED_ROUTE_FAILED",
      expect.objectContaining({
        correlationId: "corr-1",
        merchantId: "merchant_1",
        substage: "send_request",
        normalizedErrorCode: "INVALID_DESTINATION",
        httpStatus: 400,
        providerAccountSuffix: "abc123",
      })
    )
    warn.mockRestore()
  })
})
