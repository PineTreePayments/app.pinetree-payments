import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

/**
 * A Bitcoin Lightning or Solana-only checkout must never initialize a
 * WalletConnect client. The prior fix to shave the "Preparing…" delay off
 * Base checkout (prewarming connector.getProvider() as soon as the page
 * became interactive) fired unconditionally for every checkout, including
 * ones that never offer Base at all — a real WalletConnect relay connection
 * was being opened for merchants who only accept Lightning or Solana.
 */
describe("PayClient WalletConnect prewarm is gated on Base availability", () => {
  const src = read("app/pay/PayClient.tsx")
  const effectStart = src.indexOf("// ── WalletConnect prewarm")
  const effectEnd = src.indexOf(
    "[baseAvailableForCheckout, connectors])",
    effectStart
  ) + "[baseAvailableForCheckout, connectors])".length
  const effect = src.slice(effectStart, effectEnd)

  it("locates the prewarm effect", () => {
    expect(effectStart).toBeGreaterThan(-1)
  })

  it("computes availability from the intent's availableNetworks including base", () => {
    expect(effect).toContain('intentPayload?.availableNetworks?.includes("base")')
  })

  it("early-returns before touching any connector when base is not available", () => {
    expect(effect).toContain("if (!baseAvailableForCheckout) return")
    // The early-return guard must appear before the actual prewarm call, not
    // just somewhere in an explanatory comment above it.
    const guardIndex = effect.indexOf("if (!baseAvailableForCheckout) return")
    const prewarmCallIndex = effect.indexOf("baseWalletConnectPrewarmed = true")
    expect(guardIndex).toBeGreaterThan(-1)
    expect(prewarmCallIndex).toBeGreaterThan(guardIndex)
  })

  it("depends on baseAvailableForCheckout so a merchant/intent without base never re-triggers it", () => {
    expect(effect).toMatch(/}, \[baseAvailableForCheckout, connectors\]\)/)
  })
})
