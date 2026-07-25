import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Structural coverage proving components/pos/POSLayout.tsx actually wires
 * the Base USDC approval-prompt fix in — real wallet-capability evidence,
 * strict signing-error classification, the wallet-request-stage guard, and
 * the redacting error serializer — rather than the fix existing only as
 * unused library modules. Follows this file's established convention (see
 * posLayoutSaleCorrelationWiring.test.ts, posBaseAttemptOwnership.test.ts) of
 * asserting against the component's source, since no jsdom/@testing-library
 * is configured (vitest.config.ts's environment: "node").
 */

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("POSLayout — Base USDC EIP-3009 fallback wiring", () => {
  const src = read("components/pos/POSLayout.tsx")

  function usdcBranch(): string {
    const start = src.indexOf("USDC: resolve V7 strategy")
    const end = src.indexOf("session_step_update_start", start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    return src.slice(start, end)
  }

  it("derives wallet capabilities from the real WalletConnect session instead of hardcoded literals", () => {
    const block = usdcBranch()
    expect(block).toContain("detectCapabilitiesFromProvider(peerName, wcResult.provider._provider)")
    // The old bug: a hardcoded claim of full capability regardless of wallet.
    expect(src).not.toContain("supportsTypedData: true,\n                supportsSendCalls: false,")
  })

  it("remembers and honors a proven per-payment EIP-3009-unsupported result", () => {
    const block = usdcBranch()
    expect(block).toContain("hasProvenBaseUsdcEip3009MethodUnsupported(paymentId)")
    expect(block).toContain("rememberBaseUsdcEip3009MethodUnsupported(paymentId)")
    expect(block).toContain("skipEip3009: detectedCapabilities.skipEip3009 || eip3009ProvenUnsupported")
  })

  it("classifies every EIP-3009 failure before deciding whether to fall back", () => {
    const block = usdcBranch()
    expect(block).toContain("classifyBaseUsdcSigningError(eip3009Err)")
    expect(block).toContain('classification === "user_rejected"')
    expect(block).toContain('classification !== "method_unsupported"')
    // Rejection must stop the sequence immediately — thrown before any
    // fallback code is reachable.
    const rejectedIdx = block.indexOf('classification === "user_rejected"')
    const throwIdx = block.indexOf("throw eip3009Err", rejectedIdx)
    const fallbackIdx = block.indexOf("executePosBaseAllowancePath")
    expect(throwIdx).toBeGreaterThan(rejectedIdx)
    expect(throwIdx).toBeLessThan(fallbackIdx)
  })

  it("only a conclusive method_unsupported classification may reach the automatic fallback, re-verifying ownership and the wallet-request stage first", () => {
    const block = usdcBranch()
    const notUnsupportedIdx = block.indexOf('classification !== "method_unsupported"')
    const verifyIdx = block.indexOf("await verifyStillOwned()", notUnsupportedIdx)
    const stageIdx = block.indexOf('posBaseUsdcStageGuard.getStage() !== "idle"', notUnsupportedIdx)
    expect(notUnsupportedIdx).toBeGreaterThan(-1)
    expect(verifyIdx).toBeGreaterThan(notUnsupportedIdx)
    expect(stageIdx).toBeGreaterThan(verifyIdx)
  })

  it("uses the redacting serializer for every logged EIP-3009 failure, never a raw String(error)", () => {
    const block = usdcBranch()
    expect(block).toContain("serializeWalletError(eip3009Err")
    expect(block).not.toMatch(/String\(eip3009Err\)/)
  })

  it("passes the stage guard and an ownership record into both executePosBaseEip3009 and executePosBaseAllowancePath", () => {
    const block = usdcBranch()
    expect(block).toMatch(/executePosBaseEip3009\(\s*paymentId,\s*walletAddress,\s*wcResult\.provider,\s*posBaseUsdcStageGuard,\s*stageOwner,\s*verifyStillOwned\s*\)/)
    expect(block).toMatch(/executePosBaseAllowancePath\(\s*paymentId,\s*walletAddress,\s*wcResult\.provider,\s*posBaseUsdcStageGuard,\s*stageOwner,\s*verifyStillOwned\s*\)/)
  })

  it("verifyStillOwned checks attempt ownership, WalletConnect generation, and current-payment identity together", () => {
    const block = usdcBranch()
    const start = block.indexOf("const verifyStillOwned")
    const end = block.indexOf("\n\n", start)
    const fn = block.slice(start, end > start ? end : start + 300)
    expect(fn).toContain("isOwnedBaseAttempt(myAttempt)")
    expect(fn).toContain("isPosWcGenerationCurrent(wcGeneration)")
    expect(fn).toContain("isCurrentBasePayment(iid, paymentId)")
  })

  it("executePosBaseEip3009 begins/ends the typed_data_signing stage around the signature request only, inside try/finally", () => {
    const start = src.indexOf("async function executePosBaseEip3009(")
    const end = src.indexOf("async function executePosBaseAllowancePath(")
    const block = src.slice(start, end)
    expect(block).toContain('stageGuard.begin("typed_data_signing", owner)')
    expect(block).toContain("stageGuard.end(owner)")
    // The begin() failure path must throw rather than silently proceed to
    // send a second signature request.
    expect(block).toMatch(/if \(!stageGuard\.begin\("typed_data_signing", owner\)\) \{\s*throw new Error/)
    // end() happens in a finally so it always runs even if the request rejects.
    const beginIdx = block.indexOf('stageGuard.begin("typed_data_signing"')
    const tryIdx = block.indexOf("try {", beginIdx)
    const finallyIdx = block.indexOf("} finally {", tryIdx)
    const endIdx = block.indexOf("stageGuard.end(owner)", finallyIdx)
    expect(tryIdx).toBeGreaterThan(beginIdx)
    expect(finallyIdx).toBeGreaterThan(tryIdx)
    expect(endIdx).toBeGreaterThan(finallyIdx)
  })

  it("executePosBaseAllowancePath begins/ends a distinct stage for the approval and the final payment requests, each re-verifying ownership first", () => {
    const start = src.indexOf("async function executePosBaseAllowancePath(")
    const end = src.indexOf("function isRejectedError(") // next top-level helper after this function, or fall back to a generous window
    const block = end > start ? src.slice(start, end) : src.slice(start, start + 4000)
    expect(block).toContain('stageGuard.begin("allowance_approval", owner)')
    expect(block).toContain('stageGuard.begin("payment_sending", owner)')
    const approvalBeginIdx = block.indexOf('stageGuard.begin("allowance_approval"')
    const approvalVerifyIdx = block.lastIndexOf("await verifyStillOwned()", approvalBeginIdx)
    expect(approvalVerifyIdx).toBeGreaterThan(-1)
    expect(approvalVerifyIdx).toBeLessThan(approvalBeginIdx)
    const paymentBeginIdx = block.indexOf('stageGuard.begin("payment_sending"')
    const paymentVerifyIdx = block.lastIndexOf("await verifyStillOwned()", paymentBeginIdx)
    expect(paymentVerifyIdx).toBeGreaterThan(-1)
    expect(paymentVerifyIdx).toBeLessThan(paymentBeginIdx)
  })

  it("resetSale() resets the wallet-request-stage guard so a torn-down attempt's in-flight flag can never block a new sale", () => {
    const start = src.indexOf("function resetSale()")
    const end = src.indexOf("\n  }\n\n  async function cancelSale", start)
    const block = src.slice(start, end)
    expect(block).toContain("posBaseUsdcStageGuard.reset()")
  })

  it("a new intentId mount also resets the wallet-request-stage guard", () => {
    const idx = src.indexOf("posBaseUsdcStageGuard.reset()", src.indexOf("intent_attempt_reset") - 500)
    expect(idx).toBeGreaterThan(-1)
  })
})
