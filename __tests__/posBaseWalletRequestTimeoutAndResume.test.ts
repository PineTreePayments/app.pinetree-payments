import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Regression coverage for the "stuck on 'Approve ETH payment in your
 * wallet.'" production symptom.
 *
 * The exact UI text quoted in the report ("Approve ETH payment in your
 * wallet." / "Please approve the transaction in your wallet.") only exists
 * in components/payment/BasePosCheckoutMirror.tsx's "payment_sending" step -
 * it mirrors the POS-owned session state written by
 * components/pos/POSLayout.tsx's runPosBaseFlow. Two independent gaps could
 * each produce this symptom:
 *
 * 1. lib/pos/posBaseWalletConnect.ts's PosWcProvider.request() (and every
 *    provider.request() call in POSLayout.tsx) had no timeout at all -
 *    unlike the customer-owned checkout flow in BaseWalletPayment.tsx, which
 *    already wraps every wallet request with a 90s bound
 *    (sendWalletConnectTransactionWithTimeout). A lost/delayed WalletConnect
 *    relay response after the customer approved in their wallet app left the
 *    POS terminal's request awaiting forever, with no bounded recovery.
 *
 * 2. BasePosCheckoutMirror.tsx's session-mirroring poll had no
 *    visibilitychange/focus/pageshow resume handling. Opening the wallet
 *    app backgrounds that exact browser tab, and mobile browsers commonly
 *    suspend/throttle setInterval while backgrounded - so even once the
 *    POS-owned session correctly advanced, the customer's tab could still
 *    be showing a stale step because its own poll loop never resumed
 *    promptly.
 */

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("POSLayout wallet request timeout", () => {
  const src = read("components/pos/POSLayout.tsx")

  it("defines a bounded timeout wrapper for WalletConnect provider.request() calls", () => {
    expect(src).toContain("function withPosWalletRequestTimeout<T>(")
    expect(src).toContain("const POS_BASE_WALLET_REQUEST_TIMEOUT_MS = 90_000")
  })

  it("the timeout message never matches the pairing-wait or rejection regexes, so it always falls through to the ambiguous-error precheck (canonical-status check) instead of an immediate abandon", () => {
    const rejectionRegex = /reject|cancel|denied|user denied/i
    const abandonRegex = /base payment attempt abandoned|timed out waiting for wallet to connect|wallet disconnected/i
    const messages = [...src.matchAll(/withPosWalletRequestTimeout\(\s*[\s\S]*?,\s*\n?\s*"([^"]+)"/g)].map(
      (m) => m[1]
    )
    expect(messages.length).toBeGreaterThanOrEqual(4)
    for (const message of messages) {
      expect(rejectionRegex.test(message)).toBe(false)
      expect(abandonRegex.test(message)).toBe(false)
    }
  })

  it("wraps the ETH eth_sendTransaction call", () => {
    const start = src.indexOf('if (asset === "ETH")')
    const end = src.indexOf('} else {', start)
    const block = src.slice(start, end)
    expect(block).toContain("withPosWalletRequestTimeout(")
    expect(block).toContain("eth_sendTransaction")
  })

  it("wraps the USDC EIP-3009 eth_signTypedData_v4 call", () => {
    const start = src.indexOf("async function executePosBaseEip3009(")
    const end = src.indexOf("\n}\n", start)
    const block = src.slice(start, end)
    expect(block).toContain("withPosWalletRequestTimeout(")
    expect(block).toContain("eth_signTypedData_v4")
  })

  it("wraps both USDC allowance-path eth_sendTransaction calls (approve and payment)", () => {
    const start = src.indexOf("async function executePosBaseAllowancePath(")
    const end = src.indexOf("export default function POSLayout(", start)
    const block = src.slice(start, end)
    const wrapCount = block.split("withPosWalletRequestTimeout(").length - 1
    expect(wrapCount).toBe(2)
  })

  it("logs the raw returned value's type and a safe prefix, never the full hash or address, right after the ETH request resolves", () => {
    const start = src.indexOf('console.log("[POS Base ETH] request_resolved"')
    const block = src.slice(start, start + 300)
    expect(block).toContain("returnedType: typeof rawTxHash")
    expect(block).toContain("returnedPrefix:")
    expect(block).not.toMatch(/walletAddress/)
  })

  it("logs a distinct validated checkpoint after txHash regex validation, before it is used", () => {
    expect(src).toContain('console.log("[POS Base ETH] tx_hash_validated"')
  })
})

describe("BasePosCheckoutMirror resume-on-visibility", () => {
  const src = read("components/payment/BasePosCheckoutMirror.tsx")

  it("registers visibilitychange, focus, and pageshow listeners to force an immediate catch-up poll", () => {
    expect(src).toContain('document.addEventListener("visibilitychange", handleVisibilityChange)')
    expect(src).toContain('window.addEventListener("focus", handleFocus)')
    expect(src).toContain('window.addEventListener("pageshow", handlePageShow)')
  })

  it("each resume path calls pollSession(), not a WalletConnect restart — this component never owns a WC session", () => {
    const start = src.indexOf("function handleResume(source: string) {")
    const end = src.indexOf("\n    }", start)
    const block = src.slice(start, end)
    expect(block).toContain("void pollSession()")
    expect(block).not.toMatch(/initPosBaseWalletConnect|eth_sendTransaction|connectAsync/)
  })

  it("a visibilitychange event while the tab is still hidden does not trigger a poll", () => {
    const start = src.indexOf("function handleResume(source: string) {")
    const block = src.slice(start, start + 200)
    expect(block).toContain('if (source === "visibilitychange" && document.visibilityState !== "visible") return')
  })

  it("resume listeners are torn down on unmount / when the payment reaches a terminal state", () => {
    const start = src.indexOf("// Mobile browsers commonly suspend/throttle")
    const end = src.indexOf("\n  }, [paymentReady, pollSession, terminalStatus, intentId])", start)
    const block = src.slice(start, end)
    expect(block).toContain("if (!paymentReady) return")
    expect(block).toContain("if (terminalStatus) return")
    expect(block).toContain("document.removeEventListener(\"visibilitychange\", handleVisibilityChange)")
    expect(block).toContain("window.removeEventListener(\"focus\", handleFocus)")
    expect(block).toContain("window.removeEventListener(\"pageshow\", handlePageShow)")
  })
})
