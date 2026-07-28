/**
 * Revert-reason extraction and classification for failed Base payment
 * transactions.
 *
 * Production incident this closes (payment a29773b7-6da0-47ed-b3e5-
 * cb09a47fc392): the final USDC split-contract call reverted on-chain with
 * "ERC20: transfer amount exceeds balance" (payer USDC balance was 0 while
 * the 0.26 allowance had already been approved), the watcher correctly
 * marked the payment FAILED - but the revert reason was never extracted,
 * persisted, or shown. The merchant and customer saw only "Payment failed".
 *
 * Extraction replays the exact transaction with eth_call at its mined block
 * and decodes the standard Error(string) revert payload. Classification maps
 * known USDC/ERC-20 failure phrases to normalized codes with safe
 * customer/merchant copy. Everything here is diagnostic evidence attached to
 * an already-proven FAILED receipt - it never decides payment state.
 */

export type BaseUsdcRevertClassification = {
  code: "insufficient_usdc_balance" | "insufficient_allowance" | "payment_reverted"
  /** Safe for merchant and customer display. */
  message: string
  /** Raw decoded revert string (may be null when the node returns no data). */
  raw: string | null
}

const ERROR_STRING_SELECTOR = "0x08c379a0"

/**
 * Decodes a standard Error(string) revert payload (selector 0x08c379a0).
 * Returns null for empty/opaque/custom-error payloads.
 */
export function decodeEvmRevertReason(data: unknown): string | null {
  const normalized = String(data || "").trim().toLowerCase()
  if (!normalized.startsWith(ERROR_STRING_SELECTOR)) return null
  const body = normalized.slice(ERROR_STRING_SELECTOR.length)
  // ABI layout: 32-byte offset, 32-byte length, then the UTF-8 bytes.
  if (body.length < 128) return null
  const length = Number.parseInt(body.slice(64, 128), 16)
  if (!Number.isFinite(length) || length <= 0 || length > 512) return null
  const hexString = body.slice(128, 128 + length * 2)
  let decoded = ""
  for (let i = 0; i < hexString.length; i += 2) {
    const charCode = Number.parseInt(hexString.slice(i, i + 2), 16)
    if (!Number.isFinite(charCode)) return null
    decoded += String.fromCharCode(charCode)
  }
  const cleaned = decoded.replace(/[^\x20-\x7E]/g, "").trim()
  return cleaned || null
}

export function classifyBaseUsdcRevertReason(raw: string | null): BaseUsdcRevertClassification {
  const normalized = String(raw || "").toLowerCase()
  if (/transfer amount exceeds balance|insufficient balance|balance too low/.test(normalized)) {
    return {
      code: "insufficient_usdc_balance",
      message: "The paying wallet did not have enough USDC for this payment.",
      raw,
    }
  }
  if (/exceeds allowance|insufficient allowance|allowance too low/.test(normalized)) {
    return {
      code: "insufficient_allowance",
      message: "The USDC authorization did not cover this payment amount.",
      raw,
    }
  }
  return {
    code: "payment_reverted",
    message: "The payment transaction was rejected by the network.",
    raw,
  }
}

/**
 * Replays a mined, reverted transaction to recover its revert reason.
 * Never throws - a diagnostics failure must never block the FAILED
 * transition it accompanies.
 */
export async function extractBaseRevertReason(input: {
  rpcUrl: string
  transaction: { from?: string | null; to?: string | null; input?: string | null; value?: string | null } | null
  blockNumber?: string | number | null
}): Promise<BaseUsdcRevertClassification> {
  try {
    const { transaction } = input
    if (!transaction?.to || !transaction.input) return classifyBaseUsdcRevertReason(null)
    const block =
      typeof input.blockNumber === "string" && input.blockNumber.startsWith("0x")
        ? input.blockNumber
        : typeof input.blockNumber === "number"
          ? `0x${input.blockNumber.toString(16)}`
          : "latest"
    const res = await fetch(input.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [
          {
            from: transaction.from || undefined,
            to: transaction.to,
            data: transaction.input,
            value: transaction.value || undefined,
          },
          block,
        ],
      }),
      cache: "no-store",
    })
    const payload = (await res.json()) as {
      error?: { message?: string; data?: unknown }
      result?: unknown
    }
    if (!payload.error) return classifyBaseUsdcRevertReason(null)
    const decoded =
      decodeEvmRevertReason(payload.error.data) ??
      // Some nodes put "execution reverted: <reason>" in the message instead.
      (String(payload.error.message || "").match(/execution reverted:?\s*(.+)/i)?.[1]?.trim() || null)
    return classifyBaseUsdcRevertReason(decoded)
  } catch {
    return classifyBaseUsdcRevertReason(null)
  }
}
