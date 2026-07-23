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

  const paymentInput = {
    amount: 10,
    currency: "USD",
    merchantAmount: 9,
    pineTreeFeeAmount: 1,
    pineTreeFeeSats: 1500,
    merchantSpeedAccountId: "acct_merchant_1",
    pineTreePaymentId: "payment-1",
    pineTreePaymentIntentId: "intent-1",
    merchantId: "merchant-1",
    settlementMode: "speed_connect_split" as const,
  }

  it("sanitizes a payment.create 400 and never retries it", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      code: "invalid_request", message: "invalid amount from provider",
    }), { status: 400 }))
    const { createSpeedLightningPayment, getSafeSpeedCustomerErrorMessage } = await import("@/providers/lightning/speedClient")
    const error = await createSpeedLightningPayment(paymentInput).catch((caught) => caught)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(getSafeSpeedCustomerErrorMessage(error)).toBe("We couldn't create this Bitcoin Lightning payment. Please choose another payment method or try again.")
    expect(getSafeSpeedCustomerErrorMessage(error)).not.toContain("400")
  })

  it("honors Retry-After for 429 with one bounded retry", async () => {
    vi.useFakeTimers()
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "rate_limited" }), { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "pay_1", status: "unpaid", payment_request: "lnbc1invoice" }), { status: 200 }))
    const { createSpeedLightningPayment } = await import("@/providers/lightning/speedClient")
    const promise = createSpeedLightningPayment(paymentInput)
    await vi.advanceTimersByTimeAsync(0)
    await expect(promise).resolves.toMatchObject({ speedPaymentId: "pay_1" })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("bounds 500/503 retries to two total provider requests", async () => {
    vi.useFakeTimers()
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
    const { createSpeedLightningPayment } = await import("@/providers/lightning/speedClient")
    const promise = createSpeedLightningPayment(paymentInput)
    const assertion = expect(promise).rejects.toMatchObject({ status: 503, retryable: true })
    await vi.advanceTimersByTimeAsync(1_000)
    await assertion
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("retries a pre-response transport failure once", async () => {
    vi.useFakeTimers()
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockRejectedValueOnce(new TypeError("connection reset"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "pay_1", status: "unpaid", payment_request: "lnbc1invoice" }), { status: 200 }))
    const { createSpeedLightningPayment } = await import("@/providers/lightning/speedClient")
    const promise = createSpeedLightningPayment(paymentInput)
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(promise).resolves.toMatchObject({ speedPaymentId: "pay_1" })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("does not retry an uncertain post-dispatch timeout", async () => {
    vi.useFakeTimers()
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true })
    }))
    const { createSpeedLightningPayment, shouldPreserveSpeedCreationIdempotencyClaim } = await import("@/providers/lightning/speedClient")
    const promise = createSpeedLightningPayment(paymentInput)
    const errorPromise = promise.catch((error) => error)
    await vi.advanceTimersByTimeAsync(8_000)
    const error = await errorPromise
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(error).toMatchObject({ timedOut: true, outcomeUncertain: true })
    expect(shouldPreserveSpeedCreationIdempotencyClaim(error)).toBe(true)
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

  it("logs safe balance request diagnostics with the connected account suffix", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined)
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      object: "balance",
      available: [{ amount: 1596.27, target_currency: "SATS" }],
    }), { status: 200 }))
    const { getConnectedAccountBalances } = await import("@/providers/lightning/speedWalletManagement")
    await getConnectedAccountBalances(context)

    expect(infoSpy).toHaveBeenCalledWith(
      "[pinetree-withdrawals] SPEED_BALANCE_CONTEXT_READY",
      expect.objectContaining({
        merchantId: "merchant-1",
        providerAccountSuffix: "hant_1",
        operation: "balance.retrieve",
      })
    )
    expect(infoSpy).toHaveBeenCalledWith(
      "[pinetree-withdrawals] SPEED_BALANCE_RESPONSE_RECEIVED",
      expect.objectContaining({
        merchantId: "merchant-1",
        providerAccountSuffix: "hant_1",
        operation: "balance.retrieve",
        httpStatus: 200,
      })
    )
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

  it("logs the raw Speed balances response before provider error normalization", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      error: { code: "workspace_disabled", message: "Workspace is not enabled for balances" },
    }), {
      status: 503,
      headers: {
        "speed-request-id": "req_balance_503",
        "x-provider-diagnostic": "workspace-disabled",
      },
    }))

    const { getConnectedAccountBalances } = await import("@/providers/lightning/speedWalletManagement")
    await expect(getConnectedAccountBalances(context)).rejects.toMatchObject({
      category: "provider_unavailable",
      httpStatus: 503,
    })

    expect(warnSpy).toHaveBeenCalledWith(
      "[pinetree-withdrawals] SPEED_BALANCE_PROVIDER_RESPONSE_RAW",
      expect.objectContaining({
        requestUrl: "https://api.tryspeed.com/balances",
        method: "GET",
        responseStatus: 503,
        responseBody: expect.stringContaining("workspace_disabled"),
        authorizationHeaderPresent: true,
        speedAccountHeaderPresent: true,
        connectedAccountId: "acct_merchant_1",
        merchantId: "merchant-1",
        environment: "test",
        requestId: "req_balance_503",
        ok: false,
      })
    )
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

  it("persists successful /send response diagnostics before validation", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      id: "is_1", object: "instant_send", status: "unpaid", withdraw_id: "wi_1", amount: 1000,
      currency: "SATS", target_amount: 1000, target_currency: "SATS", fees: 1,
      withdraw_method: "lightning", withdraw_request: "lnbc1invoice", withdraw_type: "lightning_invoice",
      created: 1721732656358, modified: 1721732656358,
    }), { status: 200, headers: { "content-type": "application/json", "speed-request-id": "req_send_200" } }))
    const markProviderResponseReceived = vi.fn()
    const { createConnectedAccountWithdrawal } = await import("@/providers/lightning/speedWalletManagement")
    await createConnectedAccountWithdrawal({
      ...context, amount: 1000, currency: "SATS", withdrawMethod: "lightning",
      withdrawRequest: "lnbc1invoice", idempotencyKey: "local-key",
      diagnostics: { markProviderResponseReceived },
    })

    expect(markProviderResponseReceived).toHaveBeenCalledWith(expect.objectContaining({
      endpointPath: "/send",
      httpStatus: 200,
      speedRequestId: "req_send_200",
      responseContentType: "application/json",
      responseBodyJsonParsed: true,
      responseParseSucceeded: true,
      instantSendIdFound: true,
      withdrawalIdFound: true,
      classificationReason: "speed_send_http_response_received",
    }))
  })

  it("accepts the production HTTP 201 Instant Send creation shape with null fees and explorer link", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      id: "is_mrwnlysi8R99Tzf5",
      object: "instant_send",
      status: "unpaid",
      withdraw_id: "wi_mrwnlytyBh32rmJL",
      amount: 1000,
      currency: "SATS",
      target_amount: 1000,
      target_currency: "SATS",
      fees: null,
      speed_fee: { percentage: 0.5, amount: 5, fixed_amount: 0, total_fee: 5 },
      exchange_rate: 1,
      conversion: 1,
      withdraw_method: "onchain",
      withdraw_request: "bc1qaad23h6e20cej2rrj6vppz47nxdw30chpgyp62",
      withdraw_type: "onchain_address",
      failure_reason: null,
      explorer_link: null,
      created: 1784759306850,
      modified: 1784759307215,
    }), { status: 201, headers: { "content-type": "application/json", "speed-request-id": "req_send_201" } }))
    const markProviderResponseReceived = vi.fn()
    const { createConnectedAccountWithdrawal } = await import("@/providers/lightning/speedWalletManagement")
    const result = await createConnectedAccountWithdrawal({
      ...context,
      amount: 1000,
      currency: "SATS",
      withdrawMethod: "onchain",
      withdrawRequest: "bc1qaad23h6e20cej2rrj6vppz47nxdw30chpgyp62",
      idempotencyKey: "local-key",
      diagnostics: { markProviderResponseReceived },
    })

    expect(result).toMatchObject({
      id: "is_mrwnlysi8R99Tzf5",
      object: "instant_send",
      status: "unpaid",
      withdraw_id: "wi_mrwnlytyBh32rmJL",
      fees: null,
      explorer_link: null,
    })
    expect(markProviderResponseReceived).toHaveBeenCalledWith(expect.objectContaining({
      httpStatus: 201,
      instantSendIdFound: true,
      withdrawalIdFound: true,
      responseBodyJsonParsed: true,
      responseParseSucceeded: true,
    }))
  })

  it("keeps malformed HTTP 201 Instant Send bodies without provider IDs ambiguous", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      object: "instant_send",
      status: "unpaid",
      amount: 1000,
      currency: "SATS",
      target_amount: 1000,
      target_currency: "SATS",
      fees: null,
      failure_reason: null,
      created: 1784759306850,
      modified: 1784759307215,
    }), { status: 201, headers: { "content-type": "application/json", "speed-request-id": "req_send_bad_201" } }))
    const markProviderResponseReceived = vi.fn()
    const markProviderRejected = vi.fn()
    const { createConnectedAccountWithdrawal } = await import("@/providers/lightning/speedWalletManagement")
    await expect(createConnectedAccountWithdrawal({
      ...context,
      amount: 1000,
      currency: "SATS",
      withdrawMethod: "onchain",
      withdrawRequest: "bc1qaad23h6e20cej2rrj6vppz47nxdw30chpgyp62",
      idempotencyKey: "local-key",
      diagnostics: { markProviderResponseReceived, markProviderRejected },
    })).rejects.toMatchObject({
      category: "provider_unavailable",
      providerCode: "malformed_response",
    })

    expect(markProviderResponseReceived).toHaveBeenCalledWith(expect.objectContaining({
      httpStatus: 201,
      instantSendIdFound: false,
      withdrawalIdFound: false,
      responseBodyJsonParsed: true,
    }))
    expect(markProviderRejected).not.toHaveBeenCalled()
  })

  it("logs a safe failed-send diagnostic and preserves provider 400 classification", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      error: { code: "unsupported_destination", message: "destination is not supported" },
    }), { status: 400, headers: { "speed-request-id": "req_send_400" } }))
    const { createConnectedAccountWithdrawal } = await import("@/providers/lightning/speedWalletManagement")
    await expect(createConnectedAccountWithdrawal({
      ...context,
      amount: 1000,
      currency: "SATS",
      withdrawMethod: "onchain",
      withdrawRequest: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
      idempotencyKey: "local-key",
      correlationId: "5424ca86",
    })).rejects.toMatchObject({
      category: "validation",
      httpStatus: 400,
      providerCode: "unsupported_destination",
      requestId: "req_send_400",
      retryable: false,
    })

    expect(warnSpy).toHaveBeenCalledWith(
      "[pinetree-withdrawals] SPEED_SEND_FAILED",
      expect.objectContaining({
        correlationId: "5424ca86",
        merchantId: "merchant-1",
        providerAccountSuffix: "hant_1",
        destinationMethod: "onchain",
        amountSats: 1000,
        httpStatus: 400,
        speedRequestId: "req_send_400",
        normalizedErrorCode: "unsupported_destination",
        providerErrorCategory: "validation",
        retryable: false,
      })
    )
  })

  it("marks parsed /send validation errors as explicit provider rejection evidence", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      error: { code: "unsupported_destination", message: "destination is not supported" },
    }), { status: 400, headers: { "content-type": "application/json", "speed-request-id": "req_send_400" } }))
    const markProviderRejected = vi.fn()
    const markProviderResponseReceived = vi.fn()
    const { createConnectedAccountWithdrawal } = await import("@/providers/lightning/speedWalletManagement")
    await expect(createConnectedAccountWithdrawal({
      ...context,
      amount: 1000,
      currency: "SATS",
      withdrawMethod: "onchain",
      withdrawRequest: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
      idempotencyKey: "local-key",
      diagnostics: { markProviderRejected, markProviderResponseReceived },
    })).rejects.toMatchObject({ category: "validation", httpStatus: 400 })

    expect(markProviderRejected).toHaveBeenCalledWith(expect.objectContaining({
      httpStatus: 400,
      speedRequestId: "req_send_400",
      normalizedErrorCode: "unsupported_destination",
      providerErrorCategory: "validation",
      providerRejectionEvidence: true,
      responseBodyJsonParsed: true,
      instantSendIdFound: false,
      withdrawalIdFound: false,
      classificationReason: "speed_send_explicit_rejection_evidence",
    }))
    expect(markProviderResponseReceived).not.toHaveBeenCalled()
  })

  it("does not mark non-2xx /send responses as rejected without concrete rejection evidence", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      error: { code: "provider_unavailable", message: "temporarily unavailable" },
    }), { status: 503, headers: { "content-type": "application/json", "speed-request-id": "req_send_503" } }))
    const markProviderRejected = vi.fn()
    const markProviderResponseReceived = vi.fn()
    const { createConnectedAccountWithdrawal } = await import("@/providers/lightning/speedWalletManagement")
    await expect(createConnectedAccountWithdrawal({
      ...context,
      amount: 1000,
      currency: "SATS",
      withdrawMethod: "lightning",
      withdrawRequest: "lnbc1invoice",
      idempotencyKey: "local-key",
      diagnostics: { markProviderRejected, markProviderResponseReceived },
    })).rejects.toMatchObject({ category: "provider_unavailable", httpStatus: 503 })

    expect(markProviderRejected).not.toHaveBeenCalled()
    expect(markProviderResponseReceived).toHaveBeenCalledWith(expect.objectContaining({
      httpStatus: 503,
      speedRequestId: "req_send_503",
      normalizedErrorCode: "provider_unavailable",
      providerErrorCategory: "provider_unavailable",
      responseBodyJsonParsed: true,
      instantSendIdFound: false,
      withdrawalIdFound: false,
      classificationReason: "speed_send_non_2xx_without_rejection_evidence",
    }))
  })

  it("scopes connected-account payment creation with the same canonical header", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      id: "pay_1", status: "unpaid", payment_request: "lnbc1paymentrequest",
    }), { status: 200 }))
    const { createSpeedLightningPayment } = await import("@/providers/lightning/speedClient")
    await createSpeedLightningPayment({
      amount: 10, currency: "USD", merchantAmount: 9, pineTreeFeeAmount: 1, pineTreeFeeSats: 1500,
      merchantSpeedAccountId: "acct_merchant_1", pineTreePaymentId: "payment-1",
      merchantId: "merchant-1", settlementMode: "speed_connect_split",
    })
    const init = fetchSpy.mock.calls[0][1]
    expect(new Headers(init?.headers).get("speed-account")).toBe("acct_merchant_1")
    // application_fee is never sent - Speed's real unit contract for it is
    // unconfirmed (a prior production incident got an HTTP 400 sending a
    // sats-denominated value here). See docs/environment/bitcoin-fee-settlement.md.
    expect(JSON.parse(String(init?.body))).not.toHaveProperty("application_fee")
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

  it("uses the exact same connected account header for balances, transactions, payments, and Instant Send", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url, init) => {
      const path = String(url)
      if (path.includes("/balances")) {
        return new Response(JSON.stringify({ object: "balance", available: [{ amount: 0, target_currency: "SATS" }] }), { status: 200 })
      }
      if (path.includes("/balance-transactions")) {
        return new Response(JSON.stringify({ object: "list", has_more: false, data: [] }), { status: 200 })
      }
      if (path.includes("/payments")) {
        return new Response(JSON.stringify({ id: "pay_1", status: "unpaid", payment_request: "lnbc1paymentrequest" }), { status: 200 })
      }
      if (path.includes("/send")) {
        return new Response(JSON.stringify({
          id: "is_1", object: "instant_send", status: "unpaid", withdraw_id: "wi_1", amount: 1000,
          currency: "SATS", target_amount: 1000, target_currency: "SATS", fees: 1,
          withdraw_method: "lightning", withdraw_type: "lightning_invoice", withdraw_request: "lnbc1invoice",
          created: 1721732656358, modified: 1721732656358,
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    const {
      getConnectedAccountBalances,
      listConnectedAccountTransactions,
      createConnectedAccountWithdrawal,
    } = await import("@/providers/lightning/speedWalletManagement")
    const { createSpeedLightningPayment } = await import("@/providers/lightning/speedClient")

    await getConnectedAccountBalances(context)
    await listConnectedAccountTransactions(context)
    await createSpeedLightningPayment({
      amount: 10, currency: "USD", merchantAmount: 9, pineTreeFeeAmount: 1, pineTreeFeeSats: 1500,
      merchantSpeedAccountId: "acct_merchant_1", pineTreePaymentId: "payment-1",
      merchantId: "merchant-1", settlementMode: "speed_connect_split",
    })
    await createConnectedAccountWithdrawal({
      ...context, amount: 1000, currency: "SATS", withdrawMethod: "lightning",
      withdrawRequest: "lnbc1invoice", idempotencyKey: "local-key",
    })

    expect(fetchSpy.mock.calls.map((call) => ({
      path: String(call[0]).replace(/^https:\/\/api\.tryspeed\.com/, ""),
      speedAccount: new Headers(call[1]?.headers).get("speed-account"),
    }))).toEqual([
      { path: "/balances", speedAccount: "acct_merchant_1" },
      { path: "/balance-transactions?limit=50", speedAccount: "acct_merchant_1" },
      { path: "/payments", speedAccount: "acct_merchant_1" },
      { path: "/send", speedAccount: "acct_merchant_1" },
    ])
    expect(fetchSpy.mock.calls.map((call) => new Headers(call[1]?.headers).get("speed-account")))
      .not.toContain("ca_relationship_1")
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
