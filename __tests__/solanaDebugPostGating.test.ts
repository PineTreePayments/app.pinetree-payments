import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Regression coverage for the production noise fix: every Solana checkout
 * used to unconditionally POST to /api/debug/solana, a route that always
 * 404s in production, generating a logged 404 per call. logSolana() in
 * components/payment/SolanaWalletPayment.tsx no longer makes any network
 * request — it's a local-only console.debug gated to non-production, matching
 * the existing pattern in components/payment/LightningPayment.tsx's
 * logLightning(). This is a structural/string suite (see
 * posLayoutSaleCorrelationWiring.test.ts for the established rationale) since
 * no jsdom/@testing-library/react is configured (vitest.config.ts's
 * environment: "node").
 */

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("SolanaWalletPayment — debug logging never POSTs in production", () => {
  const src = read("components/payment/SolanaWalletPayment.tsx")

  it("12. logSolana no longer fetches /api/debug/solana at all", () => {
    expect(src).not.toMatch(/fetch\(\s*["']\/api\/debug\/solana["']/)
    expect(src).not.toContain('fetch("/api/debug/solana"')
  })

  it("logSolana is gated to non-production and logs locally only", () => {
    const start = src.indexOf("function logSolana(")
    const end = src.indexOf("\n}\n", start)
    const block = src.slice(start, end)
    expect(block).toContain('process.env.NODE_ENV !== "production"')
    expect(block).toContain("console.debug(")
    expect(block).not.toContain("fetch(")
  })

  it("every call site fires logSolana synchronously (never awaited) — safe now that it returns void, not a Promise", () => {
    const awaitCallSites = [...src.matchAll(/await logSolana\(/g)]
    expect(awaitCallSites.length).toBe(0)
    const callSites = [...src.matchAll(/\blogSolana\(/g)]
    // 1 definition + real call sites throughout the component.
    expect(callSites.length).toBeGreaterThan(1)
  })
})
