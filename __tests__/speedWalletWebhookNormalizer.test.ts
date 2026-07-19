import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

function claimedRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-row-1",
    provider_event_id: "wh_1",
    event_type: "payment.paid",
    account_id: "acct_1",
    merchant_id: "merchant-1",
    wallet_operation_id: null,
    processed_at: null,
    received_at: new Date().toISOString(),
    raw_payload: null,
    ...overrides,
  }
}

describe("normalizeSpeedWebhookForWallet", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.doUnmock("@/database/merchantLightningProfiles")
    vi.doUnmock("@/database/speedWebhookEvents")
    vi.doUnmock("@/database/merchantWalletOperations")
  })

  it("ignores a platform-level event with no account_id and never claims/writes anything", async () => {
    const claimSpeedWebhookEvent = vi.fn()
    const getMerchantIdBySpeedAccountId = vi.fn()
    vi.doMock("@/database/speedWebhookEvents", () => ({ claimSpeedWebhookEvent, markSpeedWebhookEventProcessed: vi.fn() }))
    vi.doMock("@/database/merchantLightningProfiles", () => ({ getMerchantIdBySpeedAccountId }))
    vi.doMock("@/database/merchantWalletOperations", () => ({ upsertWalletOperationFromWebhook: vi.fn() }))

    const { normalizeSpeedWebhookForWallet } = await import("@/engine/wallet/speedWalletWebhookNormalizer")
    const result = await normalizeSpeedWebhookForWallet({ type: "payment.paid", id: "pay_1" }, { "webhook-id": "wh_1" })

    expect(result).toEqual({ handled: false, reason: "not_connected_account_event" })
    expect(claimSpeedWebhookEvent).not.toHaveBeenCalled()
    expect(getMerchantIdBySpeedAccountId).not.toHaveBeenCalled()
  })

  it("refuses to process a connected-account event with no webhook-id header (cannot dedupe safely)", async () => {
    const claimSpeedWebhookEvent = vi.fn()
    vi.doMock("@/database/speedWebhookEvents", () => ({ claimSpeedWebhookEvent, markSpeedWebhookEventProcessed: vi.fn() }))
    vi.doMock("@/database/merchantLightningProfiles", () => ({ getMerchantIdBySpeedAccountId: vi.fn() }))
    vi.doMock("@/database/merchantWalletOperations", () => ({ upsertWalletOperationFromWebhook: vi.fn() }))

    const { normalizeSpeedWebhookForWallet } = await import("@/engine/wallet/speedWalletWebhookNormalizer")
    const result = await normalizeSpeedWebhookForWallet({ type: "payment.paid", account_id: "acct_1" }, {})

    expect(result).toEqual({ handled: false, reason: "missing_webhook_id" })
    expect(claimSpeedWebhookEvent).not.toHaveBeenCalled()
  })

  it("treats a duplicate/redelivered event as already processed and never writes a second wallet operation", async () => {
    const claimSpeedWebhookEvent = vi.fn().mockResolvedValue({ claimed: false, record: claimedRecord() })
    const upsertWalletOperationFromWebhook = vi.fn()
    vi.doMock("@/database/speedWebhookEvents", () => ({ claimSpeedWebhookEvent, markSpeedWebhookEventProcessed: vi.fn() }))
    vi.doMock("@/database/merchantLightningProfiles", () => ({ getMerchantIdBySpeedAccountId: vi.fn().mockResolvedValue("merchant-1") }))
    vi.doMock("@/database/merchantWalletOperations", () => ({ upsertWalletOperationFromWebhook }))

    const { normalizeSpeedWebhookForWallet } = await import("@/engine/wallet/speedWalletWebhookNormalizer")
    const result = await normalizeSpeedWebhookForWallet(
      { type: "payment.paid", account_id: "acct_1", data: { object: { id: "pay_1", target_amount: 1000, target_currency: "SATS" } } },
      { "webhook-id": "wh_1" }
    )

    expect(result).toEqual({ handled: false, reason: "duplicate_event" })
    expect(upsertWalletOperationFromWebhook).not.toHaveBeenCalled()
  })

  it("acknowledges but does not write a wallet operation when the account_id does not match any PineTree merchant", async () => {
    const claimSpeedWebhookEvent = vi.fn().mockResolvedValue({ claimed: true, record: claimedRecord({ merchant_id: null }) })
    const upsertWalletOperationFromWebhook = vi.fn()
    vi.doMock("@/database/speedWebhookEvents", () => ({ claimSpeedWebhookEvent, markSpeedWebhookEventProcessed: vi.fn() }))
    vi.doMock("@/database/merchantLightningProfiles", () => ({ getMerchantIdBySpeedAccountId: vi.fn().mockResolvedValue(null) }))
    vi.doMock("@/database/merchantWalletOperations", () => ({ upsertWalletOperationFromWebhook }))

    const { normalizeSpeedWebhookForWallet } = await import("@/engine/wallet/speedWalletWebhookNormalizer")
    const result = await normalizeSpeedWebhookForWallet(
      { type: "payment.paid", account_id: "acct_unknown", data: { object: { id: "pay_1", target_amount: 1000, target_currency: "SATS" } } },
      { "webhook-id": "wh_1" }
    )

    expect(result).toEqual({ handled: false, reason: "merchant_not_matched" })
    expect(upsertWalletOperationFromWebhook).not.toHaveBeenCalled()
  })

  it("does not normalize an event type outside the documented wallet-relevant set", async () => {
    const claimSpeedWebhookEvent = vi.fn().mockResolvedValue({ claimed: true, record: claimedRecord({ event_type: "connect.completed" }) })
    const upsertWalletOperationFromWebhook = vi.fn()
    vi.doMock("@/database/speedWebhookEvents", () => ({ claimSpeedWebhookEvent, markSpeedWebhookEventProcessed: vi.fn() }))
    vi.doMock("@/database/merchantLightningProfiles", () => ({ getMerchantIdBySpeedAccountId: vi.fn().mockResolvedValue("merchant-1") }))
    vi.doMock("@/database/merchantWalletOperations", () => ({ upsertWalletOperationFromWebhook }))

    const { normalizeSpeedWebhookForWallet } = await import("@/engine/wallet/speedWalletWebhookNormalizer")
    const result = await normalizeSpeedWebhookForWallet(
      { type: "connect.completed", account_id: "acct_1" },
      { "webhook-id": "wh_1" }
    )

    expect(result).toEqual({ handled: false, reason: "event_not_wallet_relevant" })
    expect(upsertWalletOperationFromWebhook).not.toHaveBeenCalled()
  })

  it("updates only the matched account-scoped Instant Send operation for withdraw.paid", async () => {
    const claimSpeedWebhookEvent = vi.fn().mockResolvedValue({ claimed: true, record: claimedRecord({ event_type: "withdraw.paid" }) })
    const markSpeedWebhookEventProcessed = vi.fn()
    const updateWalletOperationFromProviderEvent = vi.fn().mockResolvedValue({ id: "op-withdraw-1" })
    vi.doMock("@/database/speedWebhookEvents", () => ({ claimSpeedWebhookEvent, markSpeedWebhookEventProcessed }))
    vi.doMock("@/database/merchantLightningProfiles", () => ({ getMerchantIdBySpeedAccountId: vi.fn().mockResolvedValue("merchant-1") }))
    vi.doMock("@/database/merchantWalletOperations", () => ({
      upsertWalletOperationFromWebhook: vi.fn(),
      updateWalletOperationFromProviderEvent,
    }))

    const { normalizeSpeedWebhookForWallet } = await import("@/engine/wallet/speedWalletWebhookNormalizer")
    const result = await normalizeSpeedWebhookForWallet({
      type: "withdraw.paid",
      account_id: "acct_1",
      data: { object: {
        id: "wi_1", reference_id: "is_1", reference_type: "instant_send",
        status: "paid", transaction_hash: "tx_1",
      } },
    }, { "webhook-id": "wh_withdraw_1" })

    expect(result).toEqual({ handled: true, reason: "withdraw_operation_updated" })
    expect(updateWalletOperationFromProviderEvent).toHaveBeenCalledWith(expect.objectContaining({
      merchantId: "merchant-1",
      providerAccountId: "acct_1",
      providerReference: "is_1",
      providerSecondaryReference: "wi_1",
      status: "COMPLETED",
    }))
    expect(markSpeedWebhookEventProcessed).toHaveBeenCalledWith("event-row-1", "op-withdraw-1")
  })

  it("normalizes payment.paid on a matched connected account into a COMPLETED PAYMENT wallet operation, keyed for idempotent replay", async () => {
    const claimSpeedWebhookEvent = vi.fn().mockResolvedValue({ claimed: true, record: claimedRecord() })
    const markSpeedWebhookEventProcessed = vi.fn().mockResolvedValue(undefined)
    const upsertWalletOperationFromWebhook = vi.fn().mockResolvedValue({ operation: { id: "op-1" }, created: true })
    vi.doMock("@/database/speedWebhookEvents", () => ({ claimSpeedWebhookEvent, markSpeedWebhookEventProcessed }))
    vi.doMock("@/database/merchantLightningProfiles", () => ({ getMerchantIdBySpeedAccountId: vi.fn().mockResolvedValue("merchant-1") }))
    vi.doMock("@/database/merchantWalletOperations", () => ({ upsertWalletOperationFromWebhook }))

    const { normalizeSpeedWebhookForWallet } = await import("@/engine/wallet/speedWalletWebhookNormalizer")
    const result = await normalizeSpeedWebhookForWallet(
      {
        type: "payment.paid",
        account_id: "acct_1",
        data: { object: { id: "pay_1", target_amount: 5000, target_currency: "sats" } },
      },
      { "webhook-id": "wh_1" }
    )

    expect(result).toEqual({ handled: true, reason: "wallet_operation_upserted" })
    expect(upsertWalletOperationFromWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: "merchant-1",
        operationType: "PAYMENT",
        direction: "credit",
        status: "COMPLETED",
        asset: "SATS",
        amountBaseUnits: BigInt(5000),
        providerReference: "pay_1",
        idempotencyKey: "speed:payment:pay_1",
      })
    )
    expect(markSpeedWebhookEventProcessed).toHaveBeenCalledWith("event-row-1", "op-1")
  })
})
