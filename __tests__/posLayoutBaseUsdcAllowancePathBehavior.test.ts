import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  executePosBaseAllowancePath,
  executePosBaseEip3009,
} from "@/components/pos/POSLayout"
import { PosBaseUsdcWalletRequestStageGuard } from "@/lib/pos/posBaseUsdcWalletRequestStage"
import type { PosWcProvider } from "@/lib/pos/posBaseWalletConnect"

/**
 * Behavioral coverage for executePosBaseAllowancePath/executePosBaseEip3009
 * — the two functions the production incident (payment
 * 54ca9536-a94d-438f-853c-dbd6ee089da8) traced through. These are exported
 * from components/pos/POSLayout.tsx specifically so they can be exercised
 * directly with a fake WalletConnect provider and fetch, rather than only
 * proven structurally (see posLayoutBaseUsdcFallbackWiring.test.ts).
 */

const PAYMENT_ID = "pay-1"
const OWNER = { paymentId: PAYMENT_ID, intentId: "intent-1", attemptId: 1 }
const APPROVE_TX_HASH = "0x" + "a".repeat(64)
const PAYMENT_TX_HASH = "0x" + "b".repeat(64)

function fakeProvider(requestImpl: (args: { method: string; params?: unknown[] }) => Promise<unknown>): PosWcProvider {
  return {
    accounts: ["0x1111111111111111111111111111111111111111"],
    request: vi.fn(requestImpl) as PosWcProvider["request"],
    disconnect: vi.fn(async () => {}),
    _provider: {} as PosWcProvider["_provider"],
    generation: 1,
  }
}

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response
}

describe("executePosBaseAllowancePath", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("existing allowance: skips the approval request entirely, sends only the final payment transaction", async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes("build-allowance-payment")) {
        return jsonResponse({
          ok: true,
          sufficient: true,
          approveTx: null,
          paymentTx: { to: "0xSplit", data: "0xdata", value: "0" },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as unknown as typeof fetch

    const provider = fakeProvider(async () => PAYMENT_TX_HASH)
    const stageGuard = new PosBaseUsdcWalletRequestStageGuard()

    const result = await executePosBaseAllowancePath(
      PAYMENT_ID,
      "0xpayer",
      provider,
      stageGuard,
      OWNER,
      async () => true
    )

    expect(result).toBe(PAYMENT_TX_HASH)
    expect(provider.request).toHaveBeenCalledTimes(1)
    expect(provider.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: "eth_sendTransaction" })
    )
    expect(stageGuard.getStage()).toBe("idle")
  })

  it("insufficient allowance: sends exactly one approval request, polls until sufficient, then sends exactly one final payment request", async () => {
    let allowanceCheckCalls = 0
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes("build-allowance-payment")) {
        return jsonResponse({
          ok: true,
          sufficient: false,
          approveTx: { to: "0xUsdc", data: "0xapprove", value: "0" },
          paymentTx: { to: "0xSplit", data: "0xpay", value: "0" },
        })
      }
      if (String(url).includes("allowance-check")) {
        allowanceCheckCalls += 1
        return jsonResponse({ ok: true, sufficient: true })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as unknown as typeof fetch

    const requestCalls: string[] = []
    const provider = fakeProvider(async (args) => {
      requestCalls.push(args.method)
      return requestCalls.length === 1 ? APPROVE_TX_HASH : PAYMENT_TX_HASH
    })
    const stageGuard = new PosBaseUsdcWalletRequestStageGuard()

    const resultPromise = executePosBaseAllowancePath(
      PAYMENT_ID,
      "0xpayer",
      provider,
      stageGuard,
      OWNER,
      async () => true
    )
    // Flush the allowance-poll's first (immediately-sufficient) check and the
    // 1s settlement delay between the approve and payment transactions.
    await vi.runAllTimersAsync()
    const result = await resultPromise

    expect(result).toBe(PAYMENT_TX_HASH)
    expect(provider.request).toHaveBeenCalledTimes(2)
    expect(requestCalls).toEqual(["eth_sendTransaction", "eth_sendTransaction"])
    expect(allowanceCheckCalls).toBeGreaterThanOrEqual(1)
    expect(stageGuard.getStage()).toBe("idle")
  })

  it("a stale attempt (verifyStillOwned resolves false) never sends the approval or payment transaction", async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes("build-allowance-payment")) {
        return jsonResponse({
          ok: true,
          sufficient: false,
          approveTx: { to: "0xUsdc", data: "0xapprove", value: "0" },
          paymentTx: { to: "0xSplit", data: "0xpay", value: "0" },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as unknown as typeof fetch

    const provider = fakeProvider(async () => APPROVE_TX_HASH)
    const stageGuard = new PosBaseUsdcWalletRequestStageGuard()

    await expect(
      executePosBaseAllowancePath(PAYMENT_ID, "0xpayer", provider, stageGuard, OWNER, async () => false)
    ).rejects.toThrow(/superseded/i)

    expect(provider.request).not.toHaveBeenCalled()
  })

  it("a wallet request already in flight on the shared stage guard blocks a second one from starting", async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes("build-allowance-payment")) {
        return jsonResponse({
          ok: true,
          sufficient: true,
          approveTx: null,
          paymentTx: { to: "0xSplit", data: "0xpay", value: "0" },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as unknown as typeof fetch

    const provider = fakeProvider(async () => PAYMENT_TX_HASH)
    const stageGuard = new PosBaseUsdcWalletRequestStageGuard()
    // Simulate a request already in flight (e.g. the EIP-3009 signature step
    // for this same attempt somehow still holding the guard).
    stageGuard.begin("typed_data_signing", OWNER)

    await expect(
      executePosBaseAllowancePath(PAYMENT_ID, "0xpayer", provider, stageGuard, OWNER, async () => true)
    ).rejects.toThrow(/already in progress/i)

    expect(provider.request).not.toHaveBeenCalled()
  })
})

describe("executePosBaseEip3009", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("on success: signs once, relays once, and leaves the stage guard idle", async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes("/prepare")) {
        return jsonResponse({
          ok: true,
          typedData: { domain: {}, types: {}, primaryType: "TransferWithAuthorization", message: {} },
          authorization: { validAfter: "0", validBefore: "9999999999", nonce: "0x00" },
        })
      }
      if (String(url).includes("/relay")) {
        return jsonResponse({ ok: true, txHash: PAYMENT_TX_HASH })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as unknown as typeof fetch

    const provider = fakeProvider(async () => "0x" + "c".repeat(130))
    const stageGuard = new PosBaseUsdcWalletRequestStageGuard()

    const result = await executePosBaseEip3009(
      PAYMENT_ID,
      "0xpayer",
      provider,
      stageGuard,
      OWNER,
      async () => true
    )

    expect(result).toBe(PAYMENT_TX_HASH)
    expect(provider.request).toHaveBeenCalledTimes(1)
    expect(provider.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: "eth_signTypedData_v4" })
    )
    expect(stageGuard.getStage()).toBe("idle")
  })

  it("a stale attempt never sends the signature request", async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes("/prepare")) {
        return jsonResponse({
          ok: true,
          typedData: { domain: {}, types: {}, primaryType: "TransferWithAuthorization", message: {} },
          authorization: { validAfter: "0", validBefore: "9999999999", nonce: "0x00" },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as unknown as typeof fetch

    const provider = fakeProvider(async () => "0x" + "c".repeat(130))
    const stageGuard = new PosBaseUsdcWalletRequestStageGuard()

    await expect(
      executePosBaseEip3009(PAYMENT_ID, "0xpayer", provider, stageGuard, OWNER, async () => false)
    ).rejects.toThrow(/superseded/i)

    expect(provider.request).not.toHaveBeenCalled()
  })

  it("the stage guard is released (end()) even when the signature request rejects", async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes("/prepare")) {
        return jsonResponse({
          ok: true,
          typedData: { domain: {}, types: {}, primaryType: "TransferWithAuthorization", message: {} },
          authorization: { validAfter: "0", validBefore: "9999999999", nonce: "0x00" },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as unknown as typeof fetch

    const provider = fakeProvider(async () => {
      throw { code: 4001, message: "User rejected the request." }
    })
    const stageGuard = new PosBaseUsdcWalletRequestStageGuard()

    await expect(
      executePosBaseEip3009(PAYMENT_ID, "0xpayer", provider, stageGuard, OWNER, async () => true)
    ).rejects.toMatchObject({ code: 4001 })

    // The finally block must have released the stage even on rejection —
    // otherwise every rejected signature would permanently wedge the guard.
    expect(stageGuard.getStage()).toBe("idle")
  })
})
