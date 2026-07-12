import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("PayClient realtime payment subscription cleanup", () => {
  const src = read("app/pay/PayClient.tsx")
  const effectStart = src.indexOf("// ── Realtime subscription: instant status updates from DB")
  const effectEnd = src.indexOf(
    "loadIntentCallback])",
    effectStart
  ) + "loadIntentCallback])".length
  const effect = src.slice(effectStart, effectEnd)

  it("uses a per-payment channel topic, not a shared static topic reused across status transitions", () => {
    expect(effectStart).toBeGreaterThan(-1)
    expect(effect).toContain('.channel(`pay-payment-${paymentId}`)')
    expect(effect).not.toContain('.channel("payments")')
  })

  it("cleans up with removeChannel, not a bare unsubscribe (removeChannel also drops the client's channel registry entry)", () => {
    expect(effect).toContain("supabase.removeChannel(channel)")
    expect(effect).not.toContain("channel.unsubscribe()")
  })

  it("stops re-subscribing once the payment is terminal", () => {
    expect(effect).toContain("if (isTerminal) return")
  })
})

describe("PayClient checkout polling is visibility-aware without weakening realtime coverage", () => {
  const src = read("app/pay/PayClient.tsx")

  it("both fallback polling intervals skip a tick while the tab is hidden", () => {
    const pollSection = src.slice(
      src.indexOf("// ── Poll intent status once a payment has been created"),
      src.indexOf("// ── Wallet-browser mode: Phantom provider flow")
    )
    const visibilityGuards = pollSection.match(/if \(document\.visibilityState !== "visible"\) return/g) || []
    expect(visibilityGuards.length).toBe(2)
  })

  it("catches up immediately on visibility regain instead of waiting for the next poll tick", () => {
    expect(src).toContain("document.addEventListener(\"visibilitychange\", handleVisibilityChange)")
    expect(src).toContain('document.visibilityState === "visible"')
  })
})
