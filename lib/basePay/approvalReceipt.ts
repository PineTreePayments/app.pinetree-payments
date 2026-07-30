export type BaseTransactionReceiptResult = "confirmed" | "failed" | "pending" | "unavailable"

type BaseReceiptProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
}

function receiptSucceeded(result: unknown): boolean | null {
  if (!result || typeof result !== "object") return null
  const status = (result as { status?: unknown }).status
  if (typeof status === "string") {
    const normalized = status.toLowerCase()
    if (normalized === "0x1" || normalized === "1") return true
    if (normalized === "0x0" || normalized === "0") return false
  }
  if (typeof status === "number") {
    if (status === 1) return true
    if (status === 0) return false
  }
  return null
}

/**
 * Waits only until an EVM transaction receipt proves the approval is usable.
 * A successful receipt is the authoritative boundary: callers can submit the
 * dependent PaymentSplit transaction immediately without re-polling allowance.
 */
export async function waitForBaseTransactionReceipt(input: {
  provider: BaseReceiptProvider
  txHash: string
  timeoutMs: number
  pollIntervalMs?: number
}): Promise<BaseTransactionReceiptResult> {
  const pollIntervalMs = input.pollIntervalMs ?? 250
  const startedAt = Date.now()

  while (Date.now() - startedAt < input.timeoutMs) {
    let receipt: unknown
    try {
      receipt = await input.provider.request({
        method: "eth_getTransactionReceipt",
        params: [input.txHash],
      })
    } catch {
      return "unavailable"
    }

    const succeeded = receiptSucceeded(receipt)
    if (succeeded === true) return "confirmed"
    if (succeeded === false) return "failed"

    const remainingMs = input.timeoutMs - (Date.now() - startedAt)
    if (remainingMs <= 0) break
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remainingMs)))
  }

  return "pending"
}
