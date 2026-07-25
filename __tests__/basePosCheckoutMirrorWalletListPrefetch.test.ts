import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Regression coverage proving the wallet list no longer waits on pairingUri
 * or a fresh network round trip inside the wallet-picker's critical path,
 * and that realtime-triggered polling remains additive to (never a
 * replacement for) the existing fallback interval.
 */

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("BasePosCheckoutMirror — wallet metadata prefetch", () => {
  const src = read("components/payment/BasePosCheckoutMirror.tsx")

  it("prefetches wallet metadata as soon as the component mounts, not gated on pairingUri", () => {
    const mountEffectStart = src.indexOf('markBaseCheckoutLatency("base_option_tapped"')
    const mountEffectBlock = src.slice(mountEffectStart, mountEffectStart + 400)
    expect(mountEffectStart).toBeGreaterThan(-1)
    expect(mountEffectBlock).toContain("prefetchBaseWalletMetadata()")
  })

  it("WalletLauncherModal loads from the prefetch cache, not a pairingUri-keyed fetch", () => {
    const modalStart = src.indexOf("function WalletLauncherModal(")
    const modalEnd = src.indexOf("\n}\n", modalStart)
    const block = src.slice(modalStart, modalEnd)

    expect(block).toContain("prefetchBaseWalletMetadata()")
    // The old design fetched a URL containing pairingUri directly - that
    // fetch call must be gone from this component now.
    expect(block).not.toMatch(/fetch\(\s*`\/api\/walletconnect\/base-wallets\?pairingUri=/)
  })

  it("computes each wallet's href from cached metadata + pairingUri via buildWalletHref, not from a server-provided href field", () => {
    const modalStart = src.indexOf("function WalletLauncherModal(")
    const modalEnd = src.indexOf("\n}\n", modalStart)
    const block = src.slice(modalStart, modalEnd)

    expect(block).toContain("buildWalletHref(entry, pairingUri)")
  })

  it("the WalletLauncherModal effect only depends on intentId/paymentId, not on pairingUri — it does not re-fetch every time pairingUri changes", () => {
    const effectStart = src.indexOf('markBaseCheckoutLatency("wallet_list_request_started"')
    const effectDepsEnd = src.indexOf("}, [intentId, paymentId])", effectStart)
    // If this indexOf failed (-1), the effect's dependency array isn't
    // exactly [intentId, paymentId] as expected — notably, not pairingUri.
    expect(effectDepsEnd).toBeGreaterThan(-1)
  })

  it("a wallet click fires no blocking work before following its href — href is already fully built by render time", () => {
    const onClickStart = src.indexOf("onClick={() => {")
    const onClickEnd = src.indexOf("}}", onClickStart)
    const block = src.slice(onClickStart, onClickEnd)
    // No preventDefault (would block native navigation) and no await
    // keyword (would make the handler itself async) — every statement in
    // here must be synchronous, fire-and-forget work.
    expect(block).not.toContain("preventDefault")
    expect(block).not.toMatch(/\bawait\b/)
  })
})

describe("BasePosCheckoutMirror — realtime is additive, fallback polling remains", () => {
  const src = read("components/payment/BasePosCheckoutMirror.tsx")

  it("still creates the steady/burst polling interval (fallback path unchanged)", () => {
    expect(src).toContain("setInterval(() => void pollSession(), ms)")
  })

  it("adds a realtime subscription on payment_intents alongside the fallback interval, not instead of it", () => {
    expect(src).toContain("pos-mirror-session-")
    expect(src).toContain('table: "payment_intents"')
    expect(src).toContain("void pollSession()")
  })

  it("the realtime channel is cleaned up on unmount", () => {
    const channelStart = src.indexOf("pos-mirror-session-")
    const cleanupIndex = src.indexOf("supabase.removeChannel(channel)", channelStart)
    expect(cleanupIndex).toBeGreaterThan(channelStart)
  })
})
