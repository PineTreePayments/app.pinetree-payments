import { afterEach, describe, expect, it, vi } from "vitest"
import { WalletApiRouteError } from "@/engine/wallet/walletErrors"
import type { WalletProviderAdapter } from "@/engine/wallet/walletProviderAdapter"

function operation(status = "CREATED") {
  return {
    id: "op-1", merchant_id: "merchant-1", provider: "speed", provider_account_id: "acct_1",
    operation_type: "WITHDRAWAL", direction: "debit", status, asset: "SATS", network: "bitcoin_lightning",
    amount_base_units: "1000", fee_base_units: null, destination_summary: "lnbc1...0000", tx_hash: null,
    explorer_url: null, provider_reference: null, provider_transaction_id: null, provider_secondary_reference: null,
    provider_created_at: null, provider_status: null, raw_provider_status: null, failure_code: null,
    failure_reason: null, idempotency_key: "key-1", created_at: "2026-07-19T00:00:00.000Z",
    updated_at: "2026-07-19T00:00:00.000Z", completed_at: null, submitted_at: null,
    confirmed_at: null, failed_at: null,
    dispatch_started_at: null, dispatch_completed_at: null, provider_request_key: null,
    provider_request_attempted: null, provider_response_received: null,
    provider_acceptance_known: null, provider_acceptance_unknown: null,
    persistence_after_acceptance_failed: null,
  }
}

describe("account-scoped withdrawal safeguards", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    vi.doUnmock("@/engine/wallet/walletProviderResolution")
    vi.doUnmock("@/database/merchantWalletOperations")
    vi.doUnmock("@/database/merchantWalletBalanceSnapshots")
  })

  async function arrange(
    available: bigint,
    createWithdrawal = vi.fn(),
    overrides: {
      getBalances?: ReturnType<typeof vi.fn>
      validateWithdrawal?: ReturnType<typeof vi.fn>
    } = {}
  ) {
    const adapter = {
      provider: "speed",
      providerDisplayName: "Speed",
      requiresFreshBalanceForWithdrawal: true,
      resolveContext: vi.fn(),
      validateWithdrawal: overrides.validateWithdrawal ?? vi.fn(),
      getCapabilities: vi.fn().mockResolvedValue({
        balances: true, withdrawals: true, payouts: false, swaps: false,
        automaticPayouts: false, automaticConversion: false,
      }),
      getBalances: overrides.getBalances ?? vi.fn().mockResolvedValue([{ asset: "SATS", availableBaseUnits: available, pendingBaseUnits: BigInt(0), totalBaseUnits: available, network: "bitcoin_lightning", providerUpdatedAt: null }]),
      createWithdrawal,
    } as WalletProviderAdapter
    vi.doMock("@/engine/wallet/walletProviderResolution", () => ({
      resolveMerchantWalletProvider: vi.fn().mockResolvedValue({ provider: "speed", adapter, context: { merchantId: "merchant-1", providerAccountId: "acct_1" } }),
    }))
    const createWalletOperation = vi.fn().mockResolvedValue({ operation: operation(), created: true })
    const updateWalletOperation = vi.fn().mockImplementation(async (_merchant, _id, patch) => operation(patch.status || "CREATED"))
    vi.doMock("@/database/merchantWalletOperations", () => ({
      createWalletOperation,
      updateWalletOperation,
      getWalletOperationForMerchant: vi.fn(), listWalletOperations: vi.fn(),
      upsertWalletOperationFromProviderActivity: vi.fn(),
    }))
    vi.doMock("@/database/merchantWalletBalanceSnapshots", () => ({ listWalletBalanceSnapshots: vi.fn(), upsertWalletBalanceSnapshot: vi.fn() }))
    return { adapter, createWithdrawal, createWalletOperation, updateWalletOperation }
  }

  it("persists a failed operation and never dispatches when fresh balance is insufficient", async () => {
    const arranged = await arrange(BigInt(999))
    const { createWalletWithdrawal } = await import("@/engine/wallet/walletOperations")
    await expect(createWalletWithdrawal("merchant-1", {
      asset: "SATS", amountDecimal: "1000", destination: "lnbc1qqqqqqqqqqqqqqqqqqqq", idempotencyKey: "key-1",
    })).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" })
    expect(arranged.createWithdrawal).not.toHaveBeenCalled()
    expect(arranged.updateWalletOperation).toHaveBeenCalledWith("merchant-1", "op-1", expect.objectContaining({ status: "FAILED", failureCode: "INSUFFICIENT_BALANCE" }))
    expect(arranged.updateWalletOperation).toHaveBeenCalledWith("merchant-1", "op-1", expect.objectContaining({ failedAt: expect.any(String) }))
  })

  it("marks an adapter validation failure FAILED with failedAt and never dispatches", async () => {
    const createWithdrawal = vi.fn()
    const validateWithdrawal = vi.fn(() => {
      throw new WalletApiRouteError("WALLET_PROVIDER_UNAVAILABLE", "Connected account is not ready.", false)
    })
    const arranged = await arrange(BigInt(2000), createWithdrawal, { validateWithdrawal })
    const { createWalletWithdrawal } = await import("@/engine/wallet/walletOperations")

    await expect(createWalletWithdrawal("merchant-1", {
      asset: "SATS", amountDecimal: "1000", destination: "lnbc1qqqqqqqqqqqqqqqqqqqq", idempotencyKey: "key-1",
    })).rejects.toMatchObject({ code: "WALLET_PROVIDER_UNAVAILABLE" })

    expect(createWithdrawal).not.toHaveBeenCalled()
    expect(arranged.updateWalletOperation).toHaveBeenCalledWith(
      "merchant-1",
      "op-1",
      expect.objectContaining({
        status: "FAILED",
        failureCode: "WALLET_PROVIDER_UNAVAILABLE",
        failedAt: expect.any(String),
        rawProviderStatus: expect.objectContaining({ failureStage: "provider_account_validation" }),
      })
    )
  })

  it("marks balance verification failure FAILED with failedAt before dispatch", async () => {
    const createWithdrawal = vi.fn()
    const arranged = await arrange(BigInt(2000), createWithdrawal, {
      getBalances: vi.fn().mockRejectedValue(new Error("balance read failed")),
    })
    const { createWalletWithdrawal } = await import("@/engine/wallet/walletOperations")

    await expect(createWalletWithdrawal("merchant-1", {
      asset: "SATS", amountDecimal: "1000", destination: "lnbc1qqqqqqqqqqqqqqqqqqqq", idempotencyKey: "key-1",
    })).rejects.toThrow("balance read failed")

    expect(createWithdrawal).not.toHaveBeenCalled()
    expect(arranged.updateWalletOperation).toHaveBeenCalledWith(
      "merchant-1",
      "op-1",
      expect.objectContaining({
        status: "FAILED",
        failureCode: "WALLET_PROVIDER_UNAVAILABLE",
        failedAt: expect.any(String),
        rawProviderStatus: expect.objectContaining({ failureStage: "balance_retrieval" }),
      })
    )
  })

  it("marks a Speed client error before acceptance FAILED with failedAt", async () => {
    const createWithdrawal = vi.fn().mockRejectedValue(
      new WalletApiRouteError("WALLET_PROVIDER_UNAVAILABLE", "Speed client rejected the request before submission.", false)
    )
    const arranged = await arrange(BigInt(2000), createWithdrawal)
    const { createWalletWithdrawal } = await import("@/engine/wallet/walletOperations")

    await expect(createWalletWithdrawal("merchant-1", {
      asset: "SATS", amountDecimal: "1000", destination: "lnbc1qqqqqqqqqqqqqqqqqqqq", idempotencyKey: "key-1",
    })).rejects.toMatchObject({ code: "WALLET_PROVIDER_UNAVAILABLE" })

    expect(arranged.updateWalletOperation).toHaveBeenCalledWith(
      "merchant-1",
      "op-1",
      expect.objectContaining({
        status: "FAILED",
        failureCode: "WALLET_PROVIDER_UNAVAILABLE",
        failedAt: expect.any(String),
        rawProviderStatus: expect.objectContaining({ failureStage: "provider_submission" }),
      })
    )
  })

  it("marks an explicit provider rejection FAILED after a provider response", async () => {
    const createWithdrawal = vi.fn(async (_context, input) => {
      await input.diagnostics?.markDispatchStarted?.()
      await input.diagnostics?.markProviderRejected?.({
        httpStatus: 400,
        speedRequestId: "req_rejected",
        normalizedErrorCode: "unsupported_destination",
        providerErrorCategory: "validation",
        providerRejectionEvidence: true,
        responseBodySummary: '{"error":{"code":"unsupported_destination","message":"destination is not supported"}}',
        responseBodyJsonParsed: true,
        classificationReason: "speed_send_explicit_rejection_evidence",
      })
      throw new WalletApiRouteError("WALLET_VALIDATION_ERROR", "Provider rejected this withdrawal.", false)
    })
    const arranged = await arrange(BigInt(2000), createWithdrawal)
    const { createWalletWithdrawal } = await import("@/engine/wallet/walletOperations")

    await expect(createWalletWithdrawal("merchant-1", {
      asset: "SATS", amountDecimal: "1000", destination: "lnbc1qqqqqqqqqqqqqqqqqqqq", idempotencyKey: "key-1",
    })).rejects.toMatchObject({ code: "WALLET_VALIDATION_ERROR" })

    expect(arranged.updateWalletOperation).toHaveBeenCalledWith(
      "merchant-1",
      "op-1",
      expect.objectContaining({
        status: "FAILED",
        failureCode: "WALLET_VALIDATION_ERROR",
        providerResponseReceived: true,
        providerAcceptanceKnown: false,
        providerAcceptanceUnknown: false,
        rawProviderStatus: expect.objectContaining({
          explicitProviderRejection: true,
          providerRejectionEvidence: true,
          normalizedErrorCode: "unsupported_destination",
        }),
      })
    )
  })

  it("does not mark explicitProviderRejection when the callback lacks rejection evidence", async () => {
    const createWithdrawal = vi.fn(async (_context, input) => {
      await input.diagnostics?.markDispatchStarted?.()
      await input.diagnostics?.markProviderRejected?.({ httpStatus: 503, speedRequestId: "req_503" })
      throw new WalletApiRouteError("WALLET_PROVIDER_UNAVAILABLE", "Your wallet provider is temporarily unavailable.", true)
    })
    const arranged = await arrange(BigInt(2000), createWithdrawal)
    const { createWalletWithdrawal } = await import("@/engine/wallet/walletOperations")

    await expect(createWalletWithdrawal("merchant-1", {
      asset: "SATS", amountDecimal: "1000", destination: "lnbc1qqqqqqqqqqqqqqqqqqqq", idempotencyKey: "key-1",
    })).rejects.toMatchObject({ code: "WALLET_PROVIDER_UNAVAILABLE" })

    expect(arranged.updateWalletOperation).toHaveBeenCalledWith(
      "merchant-1",
      "op-1",
      expect.objectContaining({
        status: "REQUIRES_ACTION",
        failureCode: "STATUS_UNKNOWN",
        failedAt: null,
        providerResponseReceived: true,
        providerAcceptanceKnown: false,
        providerAcceptanceUnknown: true,
        rawProviderStatus: expect.objectContaining({
          explicitProviderRejection: false,
          providerRejectionCallbackWithoutEvidence: true,
        }),
      })
    )
    expect(arranged.updateWalletOperation).not.toHaveBeenCalledWith(
      "merchant-1",
      "op-1",
      expect.objectContaining({
        status: "FAILED",
        rawProviderStatus: expect.objectContaining({ explicitProviderRejection: true }),
      })
    )
  })

  it("classifies post-dispatch provider unavailable with a received response as REQUIRES_ACTION", async () => {
    const createWithdrawal = vi.fn(async (_context, input) => {
      await input.diagnostics?.markDispatchStarted?.()
      await input.diagnostics?.markProviderResponseReceived?.({
        endpointPath: "/send",
        httpStatus: 503,
        speedRequestId: "req_503",
        responseContentType: "application/json",
        responseBodySummary: '{"error":{"code":"provider_unavailable"}}',
        responseBodyJsonParsed: true,
        responseParseSucceeded: true,
        instantSendIdFound: false,
        withdrawalIdFound: false,
        classificationReason: "speed_send_non_2xx_without_rejection_evidence",
      })
      throw new WalletApiRouteError("WALLET_PROVIDER_UNAVAILABLE", "Your wallet provider is temporarily unavailable.", true)
    })
    const arranged = await arrange(BigInt(2000), createWithdrawal)
    const { createWalletWithdrawal } = await import("@/engine/wallet/walletOperations")

    await expect(createWalletWithdrawal("merchant-1", {
      asset: "SATS", amountDecimal: "1000", destination: "lnbc1qqqqqqqqqqqqqqqqqqqq", idempotencyKey: "key-1",
    })).rejects.toMatchObject({ code: "WALLET_PROVIDER_UNAVAILABLE" })

    expect(arranged.updateWalletOperation).toHaveBeenCalledWith(
      "merchant-1",
      "op-1",
      expect.objectContaining({
        status: "REQUIRES_ACTION",
        failureCode: "STATUS_UNKNOWN",
        failureReason: expect.stringContaining("outcome is still being verified"),
        failedAt: null,
        providerResponseReceived: true,
        providerAcceptanceKnown: false,
        providerAcceptanceUnknown: true,
        rawProviderStatus: expect.objectContaining({
          explicitProviderRejection: false,
          httpStatus: 503,
          responseBodyJsonParsed: true,
          instantSendIdFound: false,
          withdrawalIdFound: false,
          classificationReason: "speed_send_non_2xx_without_rejection_evidence",
        }),
      })
    )
    expect(arranged.updateWalletOperation).not.toHaveBeenCalledWith("merchant-1", "op-1", expect.objectContaining({ status: "FAILED" }))
  })

  it("classifies parse failure after a received Speed response as REQUIRES_ACTION", async () => {
    const createWithdrawal = vi.fn(async (_context, input) => {
      await input.diagnostics?.markDispatchStarted?.()
      await input.diagnostics?.markProviderResponseReceived?.({
        endpointPath: "/send",
        httpStatus: 200,
        speedRequestId: "req_bad_json",
        responseContentType: "application/json",
        responseBodySummary: "{bad json",
        responseBodyJsonParsed: false,
        responseParseSucceeded: false,
        instantSendIdFound: false,
        withdrawalIdFound: false,
        classificationReason: "speed_send_http_response_received",
      })
      throw new Error("Malformed Instant Send response")
    })
    const arranged = await arrange(BigInt(2000), createWithdrawal)
    const { createWalletWithdrawal } = await import("@/engine/wallet/walletOperations")

    await expect(createWalletWithdrawal("merchant-1", {
      asset: "SATS", amountDecimal: "1000", destination: "lnbc1qqqqqqqqqqqqqqqqqqqq", idempotencyKey: "key-1",
    })).rejects.toThrow("Malformed Instant Send response")

    expect(arranged.updateWalletOperation).toHaveBeenCalledWith(
      "merchant-1",
      "op-1",
      expect.objectContaining({
        status: "REQUIRES_ACTION",
        failureCode: "STATUS_UNKNOWN",
        failedAt: null,
        providerResponseReceived: true,
        providerAcceptanceKnown: false,
        providerAcceptanceUnknown: true,
        rawProviderStatus: expect.objectContaining({
          explicitProviderRejection: false,
          responseBodyJsonParsed: false,
          responseParseSucceeded: false,
          instantSendIdFound: false,
          withdrawalIdFound: false,
        }),
      })
    )
    expect(arranged.updateWalletOperation).not.toHaveBeenCalledWith("merchant-1", "op-1", expect.objectContaining({ status: "FAILED" }))
  })

  it("does not move an uncertain send timeout after dispatch to PROCESSING or dispatch again on retry", async () => {
    const createWithdrawal = vi.fn(async (_context, input) => {
      await input.diagnostics?.markDispatchStarted?.()
      await input.diagnostics?.markProviderResponseMissing?.({ timedOut: true })
      throw new WalletApiRouteError("STATUS_UNKNOWN", "Provider timeout.", false)
    })
    const arranged = await arrange(BigInt(2000), createWithdrawal)
    arranged.createWalletOperation
      .mockResolvedValueOnce({ operation: operation(), created: true })
      .mockResolvedValueOnce({
        operation: { ...operation("REQUIRES_ACTION"), destination_summary: "lnbc1q...qqqq", failure_code: "WALLET_PROVIDER_TIMEOUT" },
        created: false,
      })
    const { createWalletWithdrawal } = await import("@/engine/wallet/walletOperations")
    await expect(createWalletWithdrawal("merchant-1", {
      asset: "SATS", amountDecimal: "1000", destination: "lnbc1qqqqqqqqqqqqqqqqqqqq", idempotencyKey: "key-1",
    })).rejects.toMatchObject({ code: "STATUS_UNKNOWN", retryable: false })
    expect(arranged.updateWalletOperation).not.toHaveBeenCalledWith(
      "merchant-1",
      "op-1",
      expect.objectContaining({ status: "PROCESSING" })
    )
    expect(arranged.updateWalletOperation).toHaveBeenCalledWith(
      "merchant-1",
      "op-1",
      expect.objectContaining({
        status: "REQUIRES_ACTION",
        failureCode: "STATUS_UNKNOWN",
        rawProviderStatus: expect.objectContaining({ recoveryRequired: true }),
      })
    )

    const retry = await createWalletWithdrawal("merchant-1", {
      asset: "SATS", amountDecimal: "1000", destination: "lnbc1qqqqqqqqqqqqqqqqqqqq", idempotencyKey: "key-1",
    })
    expect(retry.operation.status).toBe("ACTION_REQUIRED")
    expect(createWithdrawal).toHaveBeenCalledTimes(1)
  })

  it("persists Speed provider identifiers and PROCESSING in the same successful write", async () => {
    const createWithdrawal = vi.fn().mockResolvedValue({
      providerReference: "is_123",
      providerTransactionId: "is_123",
      providerSecondaryReference: "wi_123",
      providerStatus: "unpaid",
      providerCreatedAt: "2026-07-22T07:12:49.000Z",
      status: "PROCESSING",
      feeBaseUnits: BigInt(4),
      txHash: "tx_abc",
      explorerUrl: "https://mempool.space/tx/tx_abc",
      rawProviderStatus: { id: "is_123", withdraw_id: "wi_123", status: "unpaid" },
    })
    const arranged = await arrange(BigInt(2000), createWithdrawal)
    const { createWalletWithdrawal } = await import("@/engine/wallet/walletOperations")

    await createWalletWithdrawal("merchant-1", {
      asset: "SATS", amountDecimal: "1000", destination: "lnbc1qqqqqqqqqqqqqqqqqqqq", idempotencyKey: "key-1",
    })

    expect(arranged.updateWalletOperation).toHaveBeenCalledTimes(1)
    expect(arranged.updateWalletOperation).toHaveBeenCalledWith(
      "merchant-1",
      "op-1",
      expect.objectContaining({
        status: "PROCESSING",
        providerReference: "is_123",
        providerTransactionId: "is_123",
        providerSecondaryReference: "wi_123",
        providerStatus: "unpaid",
        providerCreatedAt: "2026-07-22T07:12:49.000Z",
        submittedAt: expect.any(String),
        txHash: "tx_abc",
        explorerUrl: "https://mempool.space/tx/tx_abc",
        rawProviderStatus: expect.objectContaining({ id: "is_123", withdraw_id: "wi_123" }),
      })
    )
  })

  it("persists a completed Speed withdrawal as COMPLETED with terminal timestamps", async () => {
    const createWithdrawal = vi.fn().mockResolvedValue({
      providerReference: "is_done",
      providerTransactionId: "is_done",
      providerSecondaryReference: "wi_done",
      providerStatus: "completed",
      status: "COMPLETED",
      feeBaseUnits: BigInt(5),
      rawProviderStatus: { id: "is_done", withdraw_id: "wi_done", status: "completed" },
    })
    const arranged = await arrange(BigInt(2000), createWithdrawal)
    const { createWalletWithdrawal } = await import("@/engine/wallet/walletOperations")

    await createWalletWithdrawal("merchant-1", {
      asset: "SATS", amountDecimal: "1000", destination: "lnbc1qqqqqqqqqqqqqqqqqqqq", idempotencyKey: "key-1",
    })

    expect(arranged.updateWalletOperation).toHaveBeenCalledWith(
      "merchant-1",
      "op-1",
      expect.objectContaining({
        status: "COMPLETED",
        providerReference: "is_done",
        providerSecondaryReference: "wi_done",
        completedAt: expect.any(String),
        confirmedAt: expect.any(String),
      })
    )
  })

  it("does not write PROCESSING when a provider result lacks any reconciliation identifier", async () => {
    const createWithdrawal = vi.fn().mockResolvedValue({
      providerReference: null,
      providerTransactionId: null,
      providerSecondaryReference: null,
      providerStatus: "unpaid",
      status: "PROCESSING",
      rawProviderStatus: { status: "unpaid" },
    })
    const arranged = await arrange(BigInt(2000), createWithdrawal)
    const { createWalletWithdrawal } = await import("@/engine/wallet/walletOperations")

    await expect(createWalletWithdrawal("merchant-1", {
      asset: "SATS", amountDecimal: "1000", destination: "lnbc1qqqqqqqqqqqqqqqqqqqq", idempotencyKey: "key-1",
    })).rejects.toMatchObject({ code: "STATUS_UNKNOWN", retryable: false })

    expect(arranged.updateWalletOperation).not.toHaveBeenCalledWith(
      "merchant-1",
      "op-1",
      expect.objectContaining({ status: "PROCESSING" })
    )
    expect(arranged.updateWalletOperation).toHaveBeenCalledWith(
      "merchant-1",
      "op-1",
      expect.objectContaining({
        status: "REQUIRES_ACTION",
        failureCode: "STATUS_UNKNOWN",
        rawProviderStatus: expect.objectContaining({ recoveryRequired: true }),
      })
    )
    expect(arranged.updateWalletOperation).not.toHaveBeenCalledWith("merchant-1", "op-1", expect.objectContaining({ status: "FAILED" }))
  })

  it("does not dispatch a duplicate withdrawal after provider acceptance when persistence fails", async () => {
    const createWithdrawal = vi.fn().mockResolvedValue({
      providerReference: "is_accepted",
      providerTransactionId: "is_accepted",
      providerSecondaryReference: "wi_accepted",
      providerStatus: "unpaid",
      status: "PROCESSING",
      rawProviderStatus: { id: "is_accepted", withdraw_id: "wi_accepted", status: "unpaid" },
    })
    const arranged = await arrange(BigInt(2000), createWithdrawal)
    arranged.updateWalletOperation.mockImplementation(async (_merchant, _id, patch) => {
      if (patch.providerReference === "is_accepted") throw new Error("database unavailable")
      return operation(patch.status || "CREATED")
    })
    arranged.createWalletOperation
      .mockResolvedValueOnce({ operation: operation(), created: true })
      .mockResolvedValueOnce({
        operation: { ...operation("CREATED"), destination_summary: "lnbc1q...qqqq" },
        created: false,
      })
    const { createWalletWithdrawal } = await import("@/engine/wallet/walletOperations")

    await expect(createWalletWithdrawal("merchant-1", {
      asset: "SATS", amountDecimal: "1000", destination: "lnbc1qqqqqqqqqqqqqqqqqqqq", idempotencyKey: "key-1",
    })).rejects.toThrow("database unavailable")
    const retry = await createWalletWithdrawal("merchant-1", {
      asset: "SATS", amountDecimal: "1000", destination: "lnbc1qqqqqqqqqqqqqqqqqqqq", idempotencyKey: "key-1",
    })

    expect(retry.operation.id).toBe("op-1")
    expect(createWithdrawal).toHaveBeenCalledTimes(1)
    expect(arranged.updateWalletOperation).toHaveBeenCalledWith(
      "merchant-1",
      "op-1",
      expect.objectContaining({
        status: "REQUIRES_ACTION",
        failureCode: "STATUS_UNKNOWN",
        persistenceAfterAcceptanceFailed: true,
      })
    )
  })
})
