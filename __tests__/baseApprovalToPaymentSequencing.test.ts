import fs from "node:fs"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { waitForBaseTransactionReceipt } from "@/lib/basePay/approvalReceipt"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("Base approval receipt boundary", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("returns synchronously from the first successful receipt without scheduling a fixed delay", async () => {
    vi.useFakeTimers()
    const provider = {
      request: vi.fn(async () => ({ status: "0x1" })),
    }

    await expect(waitForBaseTransactionReceipt({
      provider,
      txHash: "0x" + "a".repeat(64),
      timeoutMs: 60_000,
    })).resolves.toBe("confirmed")

    expect(provider.request).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("reports a reverted approval and never treats it as usable", async () => {
    const provider = {
      request: vi.fn(async () => ({ status: "0x0" })),
    }

    await expect(waitForBaseTransactionReceipt({
      provider,
      txHash: "0x" + "a".repeat(64),
      timeoutMs: 60_000,
    })).resolves.toBe("failed")
  })

  it("returns unavailable so callers can use an authoritative allowance read when the wallet RPC cannot retrieve receipts", async () => {
    const provider = {
      request: vi.fn(async () => { throw new Error("receipt method unavailable") }),
    }

    await expect(waitForBaseTransactionReceipt({
      provider,
      txHash: "0x" + "a".repeat(64),
      timeoutMs: 60_000,
    })).resolves.toBe("unavailable")
  })
})

describe("hosted checkout approval-to-payment wiring", () => {
  const src = read("components/payment/BaseWalletPayment.tsx")

  it("uses a confirmed receipt as authoritative approval evidence without a duplicate allowance poll", () => {
    expect(src).toContain('approvalConfirmed: approvalReceiptStatus === "confirmed"')
    expect(src).toContain("let allowanceSufficient = input.approvalConfirmed === true")
  })

  it("dispatches the final wallet request directly, without a timer between confirmed approval and PaymentSplit", () => {
    expect(src).toContain('void dispatchPendingWalletActionRef.current?.("auto-usdc-final-after-approval")')
    expect(src).not.toMatch(/setTimeout\(\(\) => \{\s*void dispatchPendingWalletActionRef\.current\?\.\("auto-usdc-final-after-approval"\)/)
  })

  it("claims the in-flight guard before WalletConnect settlement and holds it through approval receipt confirmation", () => {
    const start = src.indexOf("const dispatchPendingWalletAction = useCallback")
    const end = src.indexOf("dispatchPendingWalletActionRef.current = dispatchPendingWalletAction", start)
    const block = src.slice(start, end)

    expect(block.indexOf("pendingActionInFlightRef.current = true")).toBeLessThan(
      block.indexOf("await waitForWalletConnectSettlement")
    )
    expect(block).toContain('if (kind !== "usdc_approve")')
  })

  it("keeps ETH outside the USDC approval branch and preserves the final payment hash as the submitted hash", () => {
    expect(src).toContain('if (kind === "usdc_approve")')
    expect(src).toContain('setSubmittedTxHash(txHash)')
    expect(src).toContain('kind === "eth_payment" ? "eth-payment-submitted" : "usdc-payment-submitted"')
  })
})

describe("POS approval-to-payment wiring", () => {
  const src = read("components/pos/POSLayout.tsx")

  it("has no fixed settlement sleep after approval becomes usable", () => {
    const start = src.indexOf("export async function executePosBaseAllowancePath(")
    const end = src.indexOf("export default function POSLayout(", start)
    const block = src.slice(start, end)

    expect(block).not.toContain("Settlement delay")
    expect(block).not.toContain("setTimeout(resolve, 1000)")
    expect(block.indexOf("waitForBaseTransactionReceipt")).toBeLessThan(block.indexOf("payment_tx_request_start"))
  })
})
