import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Regression coverage for the actual production regression introduced by
 * commit 706833a ("Repair Base payment confirmation lifecycle"):
 * components/pos/POSLayout.tsx's ambiguous-WalletConnect-error recovery path
 * called `POST /api/payments/[paymentId]/detect` with an empty body (no
 * txHash) purely to check whether the payment had already advanced. Because
 * engine/paymentDetect.ts always passes `forceWatcher: true` on every
 * /detect call regardless of whether a hash is present, and
 * engine/paymentMaintenance.ts's ensurePaymentFresh treats a bare
 * forceWatcher as sufficient to run the full Base watcher (including the
 * chunked eth_getLogs fallback scan when no txHash exists anywhere), this
 * precheck forced a real blockchain scan on every ambiguous WalletConnect
 * error - including while the payment was still genuinely PENDING and
 * nothing had ever been broadcast. That is the repeated-fallback-scan /
 * Alchemy 429 pattern reported in production.
 *
 * The restoration keeps the shared engine (engine/paymentMaintenance.ts)
 * exactly as it was at the known-good c7d9e6a baseline - forceWatcher alone
 * is sufficient there, same as always - and instead fixes the one new call
 * site that started exercising it with no evidence: this precheck now reads
 * canonical DB status via GET /api/payments/status (the same read-only
 * endpoint every other poller in the app already uses) instead of POSTing to
 * /detect at all.
 */

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

function extractAmbiguousPrecheckBlock(src: string): string {
  const start = src.indexOf("if (!isRejection && walletConnectedForAttempt && !finalTxHashSubmitted)")
  const end = src.indexOf("setPaymentError(message)", start)
  if (start === -1 || end === -1) {
    throw new Error("Could not locate the ambiguous-error precheck block in POSLayout.tsx")
  }
  return src.slice(start, end)
}

describe("POSLayout ambiguous WalletConnect error recovery", () => {
  const src = read("components/pos/POSLayout.tsx")
  const precheckBlock = extractAmbiguousPrecheckBlock(src)

  it("never POSTs to /detect from the ambiguous-error precheck", () => {
    expect(precheckBlock).not.toMatch(/\/detect/)
    expect(precheckBlock).not.toContain('method: "POST"')
  })

  it("reads canonical status via GET /api/payments/status instead", () => {
    expect(precheckBlock).toContain("/api/payments/status?paymentId=")
    expect(precheckBlock).toContain("encodeURIComponent(paymentId)")
  })

  it("continues into the confirming session step when canonical status is already PROCESSING or CONFIRMED", () => {
    expect(precheckBlock).toContain('precheckStatus === "PROCESSING" || precheckStatus === "CONFIRMED"')
    expect(precheckBlock).toContain('updatePosBaseSession(iid, { step: "confirming" })')
  })

  it("falls through to the failed/retry state when the payment is still PENDING with no evidence", () => {
    // The precheck block itself only handles the PROCESSING/CONFIRMED early
    // return; every other outcome (including a plain PENDING read) falls
    // through past the block to the existing setPaymentError/"failed" step
    // path, which is unchanged by this fix.
    const afterPrecheck = src.slice(src.indexOf(precheckBlock) + precheckBlock.length, src.indexOf(precheckBlock) + precheckBlock.length + 400)
    expect(afterPrecheck).toContain("setPaymentError(message)")
    expect(afterPrecheck).toContain('step: "failed"')
  })

  it("never references the Base watcher, eth_getLogs, or eth_getTransactionReceipt from this client-side precheck", () => {
    expect(precheckBlock).not.toMatch(/runPaymentWatcher|watchPaymentOnce|eth_getLogs|eth_getTransactionReceipt/)
  })

  it("the normal (non-ambiguous) submission path still POSTs to /detect with a real txHash", () => {
    const detectCallStart = src.indexOf('await fetch(`/api/payments/${encodeURIComponent(paymentId)}/detect`')
    const detectCallBlock = src.slice(detectCallStart, detectCallStart + 300)

    expect(detectCallStart).toBeGreaterThan(-1)
    expect(detectCallBlock).toContain('method: "POST"')
    expect(detectCallBlock).toContain("JSON.stringify({ txHash })")
  })

  it("still guards the precheck on wallet-connected-but-no-final-hash, never running for a payment truly still awaiting connection", () => {
    const guardLine = src.slice(
      src.indexOf("if (!isRejection && walletConnectedForAttempt && !finalTxHashSubmitted)"),
      src.indexOf("\n", src.indexOf("if (!isRejection && walletConnectedForAttempt && !finalTxHashSubmitted)"))
    )
    expect(guardLine).toContain("walletConnectedForAttempt")
    expect(guardLine).toContain("!finalTxHashSubmitted")
  })
})
