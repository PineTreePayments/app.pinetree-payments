import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  listProcessingWithdrawalsForReconciliation: vi.fn(),
  updateWalletWithdrawalRequest: vi.fn(),
  insertWithdrawalAuditEvent: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock("@/database/walletWithdrawalRequests", () => ({
  listProcessingWithdrawalsForReconciliation: mocks.listProcessingWithdrawalsForReconciliation,
  updateWalletWithdrawalRequest: mocks.updateWalletWithdrawalRequest,
}))

vi.mock("@/database/merchantAuditEvents", () => ({
  insertWithdrawalAuditEvent: mocks.insertWithdrawalAuditEvent,
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

  it("skips bitcoin withdrawals without touching the DB", async () => {
    const record = makeRecord({ rail: "bitcoin", asset: "BTC", tx_hash: "btc-txid-001" })
    mocks.listProcessingWithdrawalsForReconciliation.mockResolvedValue([record])

    const result = await reconcileProcessingWithdrawals({})

    expect(result.skipped).toBe(1)
    expect(result.confirmed).toBe(0)
    expect(result.failed).toBe(0)
    expect(mocks.updateWalletWithdrawalRequest).not.toHaveBeenCalled()
    expect(mocks.insertWithdrawalAuditEvent).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it("uses the provided limit when querying processing withdrawals", async () => {
    mocks.listProcessingWithdrawalsForReconciliation.mockResolvedValue([])

    await reconcileProcessingWithdrawals({ limit: 10 })

    expect(mocks.listProcessingWithdrawalsForReconciliation).toHaveBeenCalledWith(10)
  })

  it("defaults limit to 50 when not provided", async () => {
    mocks.listProcessingWithdrawalsForReconciliation.mockResolvedValue([])

    await reconcileProcessingWithdrawals({})

    expect(mocks.listProcessingWithdrawalsForReconciliation).toHaveBeenCalledWith(50)
  })
})
