import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  listProcessingWithdrawalsForReconciliation: vi.fn(),
  listProcessingBitcoinWithdrawalsForReconciliation: vi.fn(),
  updateWalletWithdrawalRequest: vi.fn(),
  insertWithdrawalAuditEvent: vi.fn(),
  getMerchantLightningProfile: vi.fn(),
  getConnectedAccountSendStatus: vi.fn(),
  listProcessingWalletOperationsForReconciliation: vi.fn(),
  getWalletWithdrawal: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock("@/database/walletWithdrawalRequests", () => ({
  listProcessingWithdrawalsForReconciliation: mocks.listProcessingWithdrawalsForReconciliation,
  listProcessingBitcoinWithdrawalsForReconciliation: mocks.listProcessingBitcoinWithdrawalsForReconciliation,
  updateWalletWithdrawalRequest: mocks.updateWalletWithdrawalRequest,
}))

vi.mock("@/database/merchantAuditEvents", () => ({
  insertWithdrawalAuditEvent: mocks.insertWithdrawalAuditEvent,
}))

vi.mock("@/database/merchantLightningProfiles", () => ({
  getMerchantLightningProfile: mocks.getMerchantLightningProfile,
}))

vi.mock("@/providers/lightning/speedWalletManagement", () => ({
  getConnectedAccountSendStatus: mocks.getConnectedAccountSendStatus,
}))

vi.mock("@/database/merchantWalletOperations", () => ({
  listProcessingWalletOperationsForReconciliation: mocks.listProcessingWalletOperationsForReconciliation,
}))

vi.mock("@/engine/wallet/walletOperations", () => ({
  getWalletWithdrawal: mocks.getWalletWithdrawal,
}))

vi.stubGlobal("fetch", mocks.fetch)

import { reconcileProcessingWithdrawals } from "@/engine/withdrawals/walletWithdrawalReconciliation"
import type { WalletWithdrawalRequestRecord } from "@/database/walletWithdrawalRequests"

function makeRecord(
  overrides: Partial<WalletWithdrawalRequestRecord> = {}
): WalletWithdrawalRequestRecord {
  return {
    id: "wd-001",
    merchant_id: "merch-001",
    wallet_profile_id: null,
    rail: "solana",
    asset: "SOL",
    destination_address: "SomeAddress",
    amount_decimal: "1.0",
    status: "processing",
    provider: "dynamic",
    provider_reference: null,
    tx_hash: "tx-abc123",
    unsigned_transaction_payload: null,
    signed_payload: null,
    approval_method: "dynamic_browser",
    chain_id: null,
    token_contract: null,
    token_mint: null,
    review_payload: {},
    error_message: null,
    source: "manual",
    destination_id: null,
    destination_snapshot: null,
    idempotency_key: null,
    fee_amount_decimal: null,
    native_fee_asset: null,
    error_code: null,
    created_at: "2026-06-28T00:00:00Z",
    updated_at: "2026-06-28T00:00:00Z",
    ...overrides,
  }
}

function makeSolanaRpcResponse(
  confirmationStatus: string | null,
  err: unknown = null
): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        value: [
          confirmationStatus === null
            ? null
            : { confirmationStatus, err },
        ],
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )
}

function makeBaseRpcResponse(status: string | null): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: status === null ? null : { status },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )
}

describe("reconcileProcessingWithdrawals", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.updateWalletWithdrawalRequest.mockResolvedValue({})
    mocks.insertWithdrawalAuditEvent.mockResolvedValue(undefined)
    mocks.listProcessingWithdrawalsForReconciliation.mockResolvedValue([])
    mocks.listProcessingBitcoinWithdrawalsForReconciliation.mockResolvedValue([])
    mocks.listProcessingWalletOperationsForReconciliation.mockResolvedValue([])
    // Clear any env vars that would affect Base RPC
    process.env.BASE_RPC_URL = "https://base-rpc.example.com"
    process.env.RPC_URL_SOLANA = "https://solana-rpc.example.com"
  })

  it("returns zero counts when no processing withdrawals exist", async () => {
    mocks.listProcessingWithdrawalsForReconciliation.mockResolvedValue([])

    const result = await reconcileProcessingWithdrawals({})

    expect(result).toEqual({
      checked: 0,
      confirmed: 0,
      failed: 0,
      still_processing: 0,
      skipped: 0,
    })
    expect(mocks.updateWalletWithdrawalRequest).not.toHaveBeenCalled()
    expect(mocks.insertWithdrawalAuditEvent).not.toHaveBeenCalled()
  })

  it("marks Solana withdrawal confirmed when RPC returns finalized with no error", async () => {
    const record = makeRecord({ rail: "solana", asset: "SOL", tx_hash: "sol-sig-001" })
    mocks.listProcessingWithdrawalsForReconciliation.mockResolvedValue([record])
    mocks.fetch.mockResolvedValue(makeSolanaRpcResponse("finalized", null))

    const result = await reconcileProcessingWithdrawals({})

    expect(result.confirmed).toBe(1)
    expect(result.failed).toBe(0)
    expect(mocks.updateWalletWithdrawalRequest).toHaveBeenCalledWith(
      "merch-001",
      "wd-001",
      { status: "confirmed" }
    )
    expect(mocks.insertWithdrawalAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "withdrawal.confirmed", withdrawalId: "wd-001" })
    )
  })

  it("marks Solana withdrawal confirmed when RPC returns confirmed (not yet finalized) with no error", async () => {
    const record = makeRecord({ rail: "solana", asset: "SOL", tx_hash: "sol-sig-002" })
    mocks.listProcessingWithdrawalsForReconciliation.mockResolvedValue([record])
    mocks.fetch.mockResolvedValue(makeSolanaRpcResponse("confirmed", null))

    const result = await reconcileProcessingWithdrawals({})

    expect(result.confirmed).toBe(1)
    expect(mocks.updateWalletWithdrawalRequest).toHaveBeenCalledWith(
      "merch-001",
      "wd-001",
      { status: "confirmed" }
    )
  })

  it("marks Solana withdrawal failed when RPC returns an error on the signature", async () => {
    const record = makeRecord({ rail: "solana", asset: "SOL", tx_hash: "sol-sig-err" })
    mocks.listProcessingWithdrawalsForReconciliation.mockResolvedValue([record])
    mocks.fetch.mockResolvedValue(makeSolanaRpcResponse("finalized", { InstructionError: [0, "Custom"] }))

    const result = await reconcileProcessingWithdrawals({})

    expect(result.failed).toBe(1)
    expect(result.confirmed).toBe(0)
    expect(mocks.updateWalletWithdrawalRequest).toHaveBeenCalledWith(
      "merch-001",
      "wd-001",
      { status: "failed" }
    )
    expect(mocks.insertWithdrawalAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "withdrawal.failed" })
    )
  })

  it("leaves Solana withdrawal as still_processing when RPC returns null status (not yet landed)", async () => {
    const record = makeRecord({ rail: "solana", asset: "SOL", tx_hash: "sol-sig-pending" })
    mocks.listProcessingWithdrawalsForReconciliation.mockResolvedValue([record])
    mocks.fetch.mockResolvedValue(makeSolanaRpcResponse(null))

    const result = await reconcileProcessingWithdrawals({})

    expect(result.still_processing).toBe(1)
    expect(result.confirmed).toBe(0)
    expect(result.failed).toBe(0)
    expect(mocks.updateWalletWithdrawalRequest).not.toHaveBeenCalled()
  })

  it("marks Base withdrawal confirmed when receipt status is 0x1", async () => {
    const record = makeRecord({ rail: "base", asset: "ETH", tx_hash: "0xabcdef" })
    mocks.listProcessingWithdrawalsForReconciliation.mockResolvedValue([record])
    mocks.fetch.mockResolvedValue(makeBaseRpcResponse("0x1"))

    const result = await reconcileProcessingWithdrawals({})

    expect(result.confirmed).toBe(1)
    expect(mocks.updateWalletWithdrawalRequest).toHaveBeenCalledWith(
      "merch-001",
      "wd-001",
      { status: "confirmed" }
    )
    expect(mocks.insertWithdrawalAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "withdrawal.confirmed" })
    )
  })

  it("marks Base withdrawal failed when receipt status is 0x0", async () => {
    const record = makeRecord({ rail: "base", asset: "ETH", tx_hash: "0xreverted" })
    mocks.listProcessingWithdrawalsForReconciliation.mockResolvedValue([record])
    mocks.fetch.mockResolvedValue(makeBaseRpcResponse("0x0"))

    const result = await reconcileProcessingWithdrawals({})

    expect(result.failed).toBe(1)
    expect(mocks.updateWalletWithdrawalRequest).toHaveBeenCalledWith(
      "merch-001",
      "wd-001",
      { status: "failed" }
    )
    expect(mocks.insertWithdrawalAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "withdrawal.failed" })
    )
  })

  it("leaves Base withdrawal as still_processing when receipt is null (not yet mined)", async () => {
    const record = makeRecord({ rail: "base", asset: "USDC", tx_hash: "0xpending" })
    mocks.listProcessingWithdrawalsForReconciliation.mockResolvedValue([record])
    mocks.fetch.mockResolvedValue(makeBaseRpcResponse(null))

    const result = await reconcileProcessingWithdrawals({})

    expect(result.still_processing).toBe(1)
    expect(mocks.updateWalletWithdrawalRequest).not.toHaveBeenCalled()
  })

  it("skips a bitcoin withdrawal with no provider_reference without touching the DB", async () => {
    const record = makeRecord({
      rail: "bitcoin", asset: "BTC", tx_hash: null, provider_reference: null,
    })
    mocks.listProcessingWithdrawalsForReconciliation.mockResolvedValue([record])

    const result = await reconcileProcessingWithdrawals({})

    expect(result.skipped).toBe(1)
    expect(mocks.updateWalletWithdrawalRequest).not.toHaveBeenCalled()
    expect(mocks.insertWithdrawalAuditEvent).not.toHaveBeenCalled()
  })

  it("marks a Bitcoin/Lightning withdrawal confirmed when Speed's Instant Send status is paid", async () => {
    const record = makeRecord({
      rail: "bitcoin", asset: "BTC", tx_hash: null, provider_reference: "is_123",
      merchant_id: "merch-btc",
    })
    mocks.listProcessingBitcoinWithdrawalsForReconciliation.mockResolvedValue([record])
    mocks.getMerchantLightningProfile.mockResolvedValue({ speed_account_id: "acct_btc" })
    mocks.getConnectedAccountSendStatus.mockResolvedValue({ id: "is_123", status: "paid", failure_reason: null })

    const result = await reconcileProcessingWithdrawals({})

    expect(result.confirmed).toBe(1)
    expect(mocks.getConnectedAccountSendStatus).toHaveBeenCalledWith({
      merchantId: "merch-btc",
      speedAccountId: "acct_btc",
      providerSendId: "is_123",
    })
    expect(mocks.updateWalletWithdrawalRequest).toHaveBeenCalledWith("merch-btc", "wd-001", { status: "confirmed" })
    expect(mocks.insertWithdrawalAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "withdrawal.confirmed", withdrawalId: "wd-001" })
    )
  })

  it("marks a Bitcoin/Lightning withdrawal failed when Speed reports a failure_reason", async () => {
    const record = makeRecord({
      rail: "bitcoin", asset: "BTC", tx_hash: null, provider_reference: "is_456",
      merchant_id: "merch-btc",
    })
    mocks.listProcessingBitcoinWithdrawalsForReconciliation.mockResolvedValue([record])
    mocks.getMerchantLightningProfile.mockResolvedValue({ speed_account_id: "acct_btc" })
    mocks.getConnectedAccountSendStatus.mockResolvedValue({
      id: "is_456", status: "unpaid", failure_reason: "insufficient_balance",
    })

    const result = await reconcileProcessingWithdrawals({})

    expect(result.failed).toBe(1)
    expect(mocks.updateWalletWithdrawalRequest).toHaveBeenCalledWith("merch-btc", "wd-001", { status: "failed" })
  })

  it("leaves a Bitcoin/Lightning withdrawal still_processing on an ambiguous Speed status", async () => {
    const record = makeRecord({
      rail: "bitcoin", asset: "BTC", tx_hash: null, provider_reference: "is_789",
      merchant_id: "merch-btc",
    })
    mocks.listProcessingBitcoinWithdrawalsForReconciliation.mockResolvedValue([record])
    mocks.getMerchantLightningProfile.mockResolvedValue({ speed_account_id: "acct_btc" })
    mocks.getConnectedAccountSendStatus.mockResolvedValue({ id: "is_789", status: "unpaid", failure_reason: null })

    const result = await reconcileProcessingWithdrawals({})

    expect(result.still_processing).toBe(1)
    expect(mocks.updateWalletWithdrawalRequest).not.toHaveBeenCalled()
  })

  it("uses the provided limit when querying processing withdrawals", async () => {
    await reconcileProcessingWithdrawals({ limit: 10 })

    expect(mocks.listProcessingWithdrawalsForReconciliation).toHaveBeenCalledWith(10)
    expect(mocks.listProcessingBitcoinWithdrawalsForReconciliation).toHaveBeenCalledWith(10)
    expect(mocks.listProcessingWalletOperationsForReconciliation).toHaveBeenCalledWith(10)
  })

  it("defaults limit to 50 when not provided", async () => {
    await reconcileProcessingWithdrawals({})

    expect(mocks.listProcessingWithdrawalsForReconciliation).toHaveBeenCalledWith(50)
    expect(mocks.listProcessingBitcoinWithdrawalsForReconciliation).toHaveBeenCalledWith(50)
    expect(mocks.listProcessingWalletOperationsForReconciliation).toHaveBeenCalledWith(50)
  })

  // Bitcoin withdrawals actually submitted through the live UI write to
  // merchant_wallet_operations (engine/wallet/walletOperations.ts), not
  // wallet_withdrawal_requests - listProcessingBitcoinWithdrawalsForReconciliation
  // above only ever covers the separate, unreachable-from-the-UI legacy
  // engine. Without this second path, a real Bitcoin/Speed withdrawal had no
  // reconciliation at all and stayed "Processing" forever.
  describe("merchant_wallet_operations (the real live Bitcoin/Speed execution path)", () => {
    function makeOperation(overrides: Record<string, unknown> = {}) {
      return {
        id: "op-001",
        merchant_id: "merch-btc",
        provider: "speed",
        status: "PROCESSING",
        operation_type: "WITHDRAWAL",
        asset: "BTC",
        provider_reference: "is_999",
        ...overrides,
      }
    }

    it("marks a wallet operation confirmed when the adapter reports COMPLETED", async () => {
      mocks.listProcessingWalletOperationsForReconciliation.mockResolvedValue([makeOperation()])
      mocks.getWalletWithdrawal.mockResolvedValue({ id: "op-001", status: "COMPLETED" })

      const result = await reconcileProcessingWithdrawals({})

      expect(mocks.getWalletWithdrawal).toHaveBeenCalledWith("merch-btc", "op-001")
      expect(result.confirmed).toBe(1)
      expect(result.checked).toBe(1)
    })

    it("marks a wallet operation failed when the adapter reports FAILED", async () => {
      mocks.listProcessingWalletOperationsForReconciliation.mockResolvedValue([makeOperation({ id: "op-002" })])
      mocks.getWalletWithdrawal.mockResolvedValue({ id: "op-002", status: "FAILED" })

      const result = await reconcileProcessingWithdrawals({})

      expect(result.failed).toBe(1)
    })

    it("leaves a wallet operation still_processing on an ambiguous status", async () => {
      mocks.listProcessingWalletOperationsForReconciliation.mockResolvedValue([makeOperation({ id: "op-003" })])
      mocks.getWalletWithdrawal.mockResolvedValue({ id: "op-003", status: "PROCESSING" })

      const result = await reconcileProcessingWithdrawals({})

      expect(result.still_processing).toBe(1)
    })

    it("skips one merchant's failed provider/account resolution without blocking the batch", async () => {
      mocks.listProcessingWalletOperationsForReconciliation.mockResolvedValue([
        makeOperation({ id: "op-broken", merchant_id: "merch-disconnected" }),
        makeOperation({ id: "op-ok", merchant_id: "merch-btc" }),
      ])
      mocks.getWalletWithdrawal.mockImplementation(async (merchantId: string) => {
        if (merchantId === "merch-disconnected") throw new Error("No Speed Custom Connect profile exists")
        return { id: "op-ok", status: "COMPLETED" }
      })

      const result = await reconcileProcessingWithdrawals({})

      expect(result.skipped).toBe(1)
      expect(result.confirmed).toBe(1)
      expect(result.checked).toBe(2)
    })
  })
})
