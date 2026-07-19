import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const context = { merchantId: "merchant-1", speedAccountId: "acct_merchant_1" }

describe("Speed connected-account wallet HTTP boundary", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    process.env = {
      ...originalEnv,
      SPEED_API_KEY: "sk_test_secret",
      SPEED_WEBHOOK_SECRET: "wsec_test",
      SPEED_CONNECT_ENABLED: "true",
      SPEED_API_BASE_URL: "https://api.tryspeed.com",
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it("retrieves a non-zero balance with canonical merchant scoping and server auth", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      object: "balance",
      available: [{ amount: 2217713, target_currency: "SATS" }],
    }), { status: 200, headers: { "speed-request-id": "req_balance_1" } }))
    const { getConnectedAccountBalances } = await import("@/providers/lightning/speedWalletManagement")
    const result = await getConnectedAccountBalances(context)
    expect(result.available[0]).toEqual({ amount: 2217713, target_currency: "SATS" })
    const [, init] = fetchSpy.mock.calls[0]
    expect(new Headers(init?.headers).get("speed-account")).toBe("acct_merchant_1")
    expect(new Headers(init?.headers).get("authorization")).toMatch(/^Basic /)
    expect(JSON.stringify(init?.headers)).not.toContain("sk_test_secret")
  })

  it("accepts an unambiguous true zero without fabricating missing fields", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      object: "balance",
      available: [{ amount: 0, target_currency: "SATS" }],
    }), { status: 200 }))
    const { getConnectedAccountBalances } = await import("@/providers/lightning/speedWalletManagement")
    expect((await getConnectedAccountBalances(context)).available[0]?.amount).toBe(0)
  })

  it("rejects an empty available array rather than presenting an old cached balance as live", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      object: "balance",
      available: [],
    }), { status: 200 }))
    const { getConnectedAccountBalances } = await import("@/providers/lightning/speedWalletManagement")
    await expect(getConnectedAccountBalances(context)).rejects.toMatchObject({
      providerCode: "malformed_response",
      retryable: true,
    })
  })

  it("rejects malformed balance JSON instead of treating it as zero", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("{bad json", { status: 200 }))
    const { getConnectedAccountBalances, SpeedWalletProviderError } = await import("@/providers/lightning/speedWalletManagement")
    await expect(getConnectedAccountBalances(context)).rejects.toMatchObject({
      name: SpeedWalletProviderError.name,
      providerCode: "transport_error",
      retryable: true,
    })
  })

  it.each([
    [401, "authentication", false],
    [404, "validation", false],
    [429, "rate_limit", true],
    [503, "provider_unavailable", true],
  ] as const)("classifies HTTP %s safely", async (status, category, retryable) => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: { code: "provider_code", message: "denied" } }), { status }))
    const { getConnectedAccountBalances } = await import("@/providers/lightning/speedWalletManagement")
    await expect(getConnectedAccountBalances(context)).rejects.toMatchObject({ category, httpStatus: status, retryable })
  })

  it("classifies transport failures as retryable without leaking the raw error", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("socket exposed detail"))
    const { getConnectedAccountBalances } = await import("@/providers/lightning/speedWalletManagement")
    await expect(getConnectedAccountBalances(context)).rejects.toMatchObject({
      category: "provider_unavailable",
      retryable: true,
      message: "Speed API is temporarily unreachable.",
    })
  })

  it("aborts a timed-out provider request and classifies it as retryable", async () => {
    vi.useFakeTimers()
    vi.spyOn(global, "fetch").mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
    }))
    const { getConnectedAccountBalances } = await import("@/providers/lightning/speedWalletManagement")
    const request = getConnectedAccountBalances(context)
    const rejection = expect(request).rejects.toMatchObject({ providerCode: "timeout", retryable: true })
    await vi.advanceTimersByTimeAsync(12_000)
    await rejection
  })

  it("lists a cursor page using ending_before and the same connected account", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      object: "list",
      has_more: true,
      data: [{
        id: "txn_1", object: "balance_transaction", amount: 100, fee: 7, net: 93,
        target_currency: "SATS", type: "Withdraw", transaction_type: "debit", source: "wi_1", created: 1655442814345,
      }],
    }), { status: 200 }))
    const { listConnectedAccountTransactions } = await import("@/providers/lightning/speedWalletManagement")
    const result = await listConnectedAccountTransactions({ ...context, cursor: "txn_cursor", limit: 25 })
    expect(result.has_more).toBe(true)
    expect(String(fetchSpy.mock.calls[0][0])).toContain("limit=25&ending_before=txn_cursor")
    expect(new Headers(fetchSpy.mock.calls[0][1]?.headers).get("speed-account")).toBe("acct_merchant_1")
  })

  it("creates Instant Send with the documented body/header and no invented retry", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      id: "is_1", object: "instant_send", status: "unpaid", withdraw_id: "wi_1", amount: 1000,
      currency: "SATS", target_amount: 1000, target_currency: "SATS", fees: 1,
      withdraw_method: "lightning", withdraw_request: "lnbc1invoice", withdraw_type: "lightning_invoice",
      created: 1721732656358, modified: 1721732656358,
    }), { status: 200 }))
    const { createConnectedAccountWithdrawal } = await import("@/providers/lightning/speedWalletManagement")
    const result = await createConnectedAccountWithdrawal({
      ...context, amount: 1000, currency: "SATS", withdrawMethod: "lightning",
      withdrawRequest: "lnbc1invoice", idempotencyKey: "local-key",
    })
    expect(result).toMatchObject({ id: "is_1", status: "unpaid", withdraw_id: "wi_1" })
    const init = fetchSpy.mock.calls[0][1]
    expect(new Headers(init?.headers).get("speed-account")).toBe("acct_merchant_1")
    expect(new Headers(init?.headers).has("idempotency-key")).toBe(false)
    expect(JSON.parse(String(init?.body))).toEqual({
      amount: 1000, currency: "SATS", target_currency: "SATS",
      withdraw_method: "lightning", withdraw_request: "lnbc1invoice",
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("scopes connected-account payment creation with the same canonical header", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      id: "pay_1", status: "unpaid", payment_request: "lnbc1paymentrequest",
    }), { status: 200 }))
    const { createSpeedLightningPayment } = await import("@/providers/lightning/speedClient")
    await createSpeedLightningPayment({
      amount: 10, currency: "USD", merchantAmount: 9, pineTreeFeeAmount: 1,
      merchantSpeedAccountId: "acct_merchant_1", pineTreePaymentId: "payment-1",
      merchantId: "merchant-1", settlementMode: "speed_connect_split",
    })
    const init = fetchSpy.mock.calls[0][1]
    expect(new Headers(init?.headers).get("speed-account")).toBe("acct_merchant_1")
    expect(JSON.parse(String(init?.body))).toMatchObject({ application_fee: 1 })
    expect(JSON.parse(String(init?.body))).not.toHaveProperty("account_id")
  })

  it("scopes connected-account payment retrieval with the same canonical header", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      id: "pay_1", status: "paid",
    }), { status: 200 }))
    const { retrieveSpeedPayment } = await import("@/providers/lightning/speedClient")
    await retrieveSpeedPayment("pay_1", {
      merchantId: "merchant-1",
      connectedAccountId: "acct_merchant_1",
      operation: "payment.retrieve",
    })
    expect(new Headers(fetchSpy.mock.calls[0][1]?.headers).get("speed-account")).toBe("acct_merchant_1")
  })

  it("fails closed on a missing connected account before fetch and never uses the root account", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")
    const { getConnectedAccountBalances } = await import("@/providers/lightning/speedWalletManagement")
    await expect(getConnectedAccountBalances({ merchantId: "merchant-1", speedAccountId: "" }))
      .rejects.toMatchObject({ providerCode: "connected_account_missing", retryable: false })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("fails closed on a non-canonical connected account before fetch", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")
    const { getConnectedAccountBalances } = await import("@/providers/lightning/speedWalletManagement")
    await expect(getConnectedAccountBalances({ merchantId: "merchant-1", speedAccountId: "ca_relationship" }))
      .rejects.toMatchObject({ providerCode: "connected_account_invalid", retryable: false })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("keeps two merchant account headers isolated", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async () => new Response(JSON.stringify({
      object: "balance", available: [{ amount: 0, target_currency: "SATS" }],
    }), { status: 200 }))
    const { getConnectedAccountBalances } = await import("@/providers/lightning/speedWalletManagement")
    await getConnectedAccountBalances({ merchantId: "merchant-a", speedAccountId: "acct_a" })
    await getConnectedAccountBalances({ merchantId: "merchant-b", speedAccountId: "acct_b" })
    expect(fetchSpy.mock.calls.map((call) => new Headers(call[1]?.headers).get("speed-account"))).toEqual(["acct_a", "acct_b"])
  })
})
