import { beforeEach, describe, expect, it, vi } from "vitest"
import { getAssociatedTokenAddress } from "@solana/spl-token"
import { PublicKey } from "@solana/web3.js"

/**
 * Chain-evidence recovery for signed-but-never-completed Dynamic withdrawals.
 *
 * Production incident this reproduces: withdrawal b591c14b (1.03 Solana USDC)
 * was signed and broadcast by the browser (confirmed on-chain, funds
 * delivered) but the /submit persistence call never landed, so the canonical
 * row sat at status="pending" with no tx_hash forever - invisible to the
 * processing reconciler and projected as "Waiting" indefinitely.
 *
 * The recovery engine must adopt ONLY an exact, successful on-chain match
 * (source, destination, asset/mint, amount, no execution error, block time
 * not before the request) and take submitted_at from the chain block time.
 */

const listMock = vi.fn()
const updateMock = vi.fn()
const auditMock = vi.fn().mockResolvedValue(undefined)

vi.mock("@/database/walletWithdrawalRequests", () => ({
  listPendingDynamicWithdrawalsForRecovery: (...args: unknown[]) => listMock(...args),
  updateWalletWithdrawalRequest: (...args: unknown[]) => updateMock(...args),
}))
vi.mock("@/database/merchantAuditEvents", () => ({
  insertWithdrawalAuditEvent: (...args: unknown[]) => auditMock(...args),
}))

import { recoverPendingDynamicWithdrawals } from "@/engine/withdrawals/pendingDynamicWithdrawalRecovery"

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
const SOURCE = "3WTdFRCXYsMeQ3kDrrZBG48W5PMNCXHEC5VpU8dnmMMG"
const DEST = "ByEf3tYsGRSoN7P3QdNNjVNq5ErfVNG6KV8cWFQv3VyC"
const SIGNATURE = "5SXeL6zVjv5szqHbq7WAV3Fj7m8HoCPwBEi19VU9eyGyT5zNsiuZt8ZaANjE23wDMMKYnBkoKa9RzyDBLqsjCMAG"
const CREATED_AT = "2026-07-28T02:54:08.362Z"
const BLOCK_TIME_S = Math.floor(new Date("2026-07-28T02:54:18.000Z").getTime() / 1000)

function solanaUsdcRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: "b591c14b-b97f-4ef5-9e38-8d8d31b2c311",
    merchant_id: "merchant_1",
    rail: "solana",
    asset: "USDC",
    status: "pending",
    amount_decimal: "1.03",
    destination_address: DEST,
    tx_hash: null,
    provider_reference: null,
    created_at: CREATED_AT,
    unsigned_transaction_payload: { kind: "solana_transaction", from: SOURCE },
    ...overrides,
  }
}

function baseEthRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: "req-base-eth",
    merchant_id: "merchant_1",
    rail: "base",
    asset: "ETH",
    status: "pending",
    amount_decimal: "0.001",
    destination_address: "0xB54205bB0000000000000000000000000000dEaD",
    tx_hash: null,
    provider_reference: null,
    created_at: CREATED_AT,
    unsigned_transaction_payload: { kind: "evm_transaction", from: "0x95b4bf550000000000000000000000000000bEEF" },
    ...overrides,
  }
}

async function destinationUsdcAta() {
  return (await getAssociatedTokenAddress(new PublicKey(USDC_MINT), new PublicKey(DEST))).toBase58()
}

function mockRpc(handlers: Record<string, (params: unknown[]) => unknown>) {
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || "{}")) as { method: string; params: unknown[] }
    const handler = handlers[body.method]
    if (!handler) return { json: async () => ({ error: { message: `method ${body.method} not found` } }) } as Response
    return { json: async () => ({ result: handler(body.params) }) } as Response
  }))
}

beforeEach(() => {
  listMock.mockReset()
  updateMock.mockReset().mockResolvedValue({})
  auditMock.mockClear()
  vi.unstubAllGlobals()
  process.env.BASE_RPC_URL = "https://base-mainnet.g.alchemy.com/v2/test"
})

describe("recoverPendingDynamicWithdrawals - Solana", () => {
  it("adopts the exact on-chain USDC transfer (production incident shape)", async () => {
    const ata = await destinationUsdcAta()
    listMock.mockResolvedValue([solanaUsdcRequest()])
    mockRpc({
      getSignaturesForAddress: () => [{ signature: SIGNATURE, blockTime: BLOCK_TIME_S, err: null }],
      getTransaction: () => ({
        meta: { err: null },
        transaction: {
          message: {
            instructions: [{
              program: "spl-token",
              parsed: {
                type: "transferChecked",
                info: { authority: SOURCE, mint: USDC_MINT, destination: ata, tokenAmount: { amount: "1030000" } },
              },
            }],
          },
        },
      }),
    })

    const result = await recoverPendingDynamicWithdrawals({ limit: 5 })
    expect(result.recovered).toBe(1)
    expect(updateMock).toHaveBeenCalledTimes(1)
    const [merchantId, withdrawalId, fields] = updateMock.mock.calls[0]
    expect(merchantId).toBe("merchant_1")
    expect(withdrawalId).toBe("b591c14b-b97f-4ef5-9e38-8d8d31b2c311")
    expect(fields.status).toBe("processing")
    expect(fields.txHash).toBe(SIGNATURE)
    expect(fields.providerReference).toBe(SIGNATURE)
    // submitted_at is the chain block time - never invented.
    expect(fields.submittedAt).toBe("2026-07-28T02:54:18.000Z")
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "withdrawal.processing",
      metadata: expect.objectContaining({ recovered_from_chain: true }),
    }))
  })

  it("does not adopt a transfer with the wrong amount", async () => {
    const ata = await destinationUsdcAta()
    listMock.mockResolvedValue([solanaUsdcRequest()])
    mockRpc({
      getSignaturesForAddress: () => [{ signature: SIGNATURE, blockTime: BLOCK_TIME_S, err: null }],
      getTransaction: () => ({
        meta: { err: null },
        transaction: {
          message: {
            instructions: [{
              program: "spl-token",
              parsed: { type: "transferChecked", info: { authority: SOURCE, mint: USDC_MINT, destination: ata, tokenAmount: { amount: "999999" } } },
            }],
          },
        },
      }),
    })
    const result = await recoverPendingDynamicWithdrawals({ limit: 5 })
    expect(result.recovered).toBe(0)
    expect(result.unmatched).toBe(1)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it("does not adopt an errored transaction", async () => {
    listMock.mockResolvedValue([solanaUsdcRequest()])
    mockRpc({
      getSignaturesForAddress: () => [{ signature: SIGNATURE, blockTime: BLOCK_TIME_S, err: { InstructionError: [0, "Custom"] } }],
      getTransaction: () => { throw new Error("must not be fetched for errored signature") },
    })
    const result = await recoverPendingDynamicWithdrawals({ limit: 5 })
    expect(result.recovered).toBe(0)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it("does not adopt a transaction older than the request", async () => {
    const ata = await destinationUsdcAta()
    listMock.mockResolvedValue([solanaUsdcRequest()])
    const staleBlockTime = Math.floor((new Date(CREATED_AT).getTime() - 10 * 60 * 1000) / 1000)
    mockRpc({
      getSignaturesForAddress: () => [{ signature: SIGNATURE, blockTime: staleBlockTime, err: null }],
      getTransaction: () => ({
        meta: { err: null },
        transaction: {
          message: {
            instructions: [{
              program: "spl-token",
              parsed: { type: "transferChecked", info: { authority: SOURCE, mint: USDC_MINT, destination: ata, tokenAmount: { amount: "1030000" } } },
            }],
          },
        },
      }),
    })
    const result = await recoverPendingDynamicWithdrawals({ limit: 5 })
    expect(result.recovered).toBe(0)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it("adopts an exact SOL system transfer", async () => {
    listMock.mockResolvedValue([solanaUsdcRequest({ asset: "SOL", amount_decimal: "0.013" })])
    mockRpc({
      getSignaturesForAddress: () => [{ signature: SIGNATURE, blockTime: BLOCK_TIME_S, err: null }],
      getTransaction: () => ({
        meta: { err: null },
        transaction: {
          message: {
            instructions: [{
              program: "system",
              parsed: { type: "transfer", info: { source: SOURCE, destination: DEST, lamports: 13000000 } },
            }],
          },
        },
      }),
    })
    const result = await recoverPendingDynamicWithdrawals({ limit: 5 })
    expect(result.recovered).toBe(1)
    expect(updateMock.mock.calls[0][2].txHash).toBe(SIGNATURE)
  })
})

describe("targeted client-triggered discovery", () => {
  it("scopes to one withdrawal and bypasses the background grace window", async () => {
    const ata = await destinationUsdcAta()
    listMock.mockResolvedValue([solanaUsdcRequest()])
    mockRpc({
      getSignaturesForAddress: () => [{ signature: SIGNATURE, blockTime: BLOCK_TIME_S, err: null }],
      getTransaction: () => ({
        meta: { err: null },
        transaction: {
          message: {
            instructions: [{
              program: "spl-token",
              parsed: { type: "transferChecked", info: { authority: SOURCE, mint: USDC_MINT, destination: ata, tokenAmount: { amount: "1030000" } } },
            }],
          },
        },
      }),
    })

    const result = await recoverPendingDynamicWithdrawals({
      limit: 1,
      merchantId: "merchant_1",
      withdrawalId: "b591c14b-b97f-4ef5-9e38-8d8d31b2c311",
      minAgeMs: 0,
    })

    expect(result.recovered).toBe(1)
    // The query must be scoped by merchant AND withdrawal, with no age delay:
    // the grace window only exists to avoid racing a live /submit during the
    // background sweep, which an explicit per-row request cannot do.
    expect(listMock).toHaveBeenCalledWith(1, "merchant_1", 0, "b591c14b-b97f-4ef5-9e38-8d8d31b2c311")
  })

  it("the background sweep keeps its default grace window", async () => {
    listMock.mockResolvedValue([])
    await recoverPendingDynamicWithdrawals({ limit: 20 })
    expect(listMock).toHaveBeenCalledWith(20, undefined, undefined, undefined)
  })
})

describe("recoverPendingDynamicWithdrawals - Base", () => {
  it("adopts an exact successful ETH transfer via alchemy_getAssetTransfers + receipt", async () => {
    listMock.mockResolvedValue([baseEthRequest()])
    const hash = "0x" + "ab".repeat(32)
    mockRpc({
      alchemy_getAssetTransfers: () => ({
        transfers: [{
          hash,
          rawContract: { value: "0x38d7ea4c68000" }, // 0.001 ETH in wei
          metadata: { blockTimestamp: "2026-07-28T02:55:00.000Z" },
        }],
      }),
      eth_getTransactionReceipt: () => ({ status: "0x1" }),
    })
    const result = await recoverPendingDynamicWithdrawals({ limit: 5 })
    expect(result.recovered).toBe(1)
    const fields = updateMock.mock.calls[0][2]
    expect(fields.txHash).toBe(hash)
    expect(fields.status).toBe("processing")
    expect(fields.submittedAt).toBe("2026-07-28T02:55:00.000Z")
  })

  it("does not adopt a reverted transaction", async () => {
    listMock.mockResolvedValue([baseEthRequest()])
    mockRpc({
      alchemy_getAssetTransfers: () => ({
        transfers: [{
          hash: "0x" + "cd".repeat(32),
          rawContract: { value: "0x38d7ea4c68000" },
          metadata: { blockTimestamp: "2026-07-28T02:55:00.000Z" },
        }],
      }),
      eth_getTransactionReceipt: () => ({ status: "0x0" }),
    })
    const result = await recoverPendingDynamicWithdrawals({ limit: 5 })
    expect(result.recovered).toBe(0)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it("skips conservatively when the RPC does not support the transfers API", async () => {
    listMock.mockResolvedValue([baseEthRequest()])
    mockRpc({}) // every method returns a JSON-RPC error
    const result = await recoverPendingDynamicWithdrawals({ limit: 5 })
    expect(result.recovered).toBe(0)
    expect(result.errors).toBe(1)
    expect(updateMock).not.toHaveBeenCalled()
  })
})
