import { afterEach, describe, expect, it, vi } from "vitest"

const config = vi.hoisted(() => ({ getRpcUrl: vi.fn(), getBaseV7UsdcToken: vi.fn(() => "") }))
vi.mock("@/engine/config", () => config)
vi.mock("@/engine/eventProcessor", () => ({ processPaymentEvent: vi.fn() }))

afterEach(() => vi.restoreAllMocks())

describe("generic watcher routing", () => {
  it("bypasses Bitcoin Lightning without requesting RPC configuration or warning", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const { watchPaymentOnce } = await import("@/engine/paymentWatcher")
    await expect(watchPaymentOnce({
      merchantWallet: "", pinetreeWallet: "", merchantAmount: 1, pinetreeFee: 0,
      network: "bitcoin_lightning", paymentId: "payment-1",
    })).resolves.toBe(false)
    expect(config.getRpcUrl).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it("keeps unknown unsupported networks visibly rejected", async () => {
    config.getRpcUrl.mockImplementation(() => { throw new Error("missing") })
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const { watchPaymentOnce } = await import("@/engine/paymentWatcher")
    await expect(watchPaymentOnce({
      merchantWallet: "a", pinetreeWallet: "b", merchantAmount: 1, pinetreeFee: 0,
      network: "unknown_chain", paymentId: "payment-2",
    })).resolves.toBe(false)
    expect(error).toHaveBeenCalledWith("[watcher] No RPC configured for network: unknown_chain")
  })

  it("retains the existing Base and Solana watcher branches", async () => {
    const source = await import("node:fs").then((fs) => fs.readFileSync("engine/paymentWatcher.ts", "utf8"))
    expect(source).toContain('if (input.network === "solana")')
    expect(source).toContain('const isBaseNetwork = input.network === "base"')
    expect(source).toContain("getBaseV7UsdcToken")
  })
})
