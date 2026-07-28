import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Regression coverage for the Solana hosted-checkout redirecting to the
 * Apple App Store / Google Play Store AFTER the payment already reached
 * PROCESSING/CONFIRMED.
 *
 * Root cause, traced end to end (not guessed):
 *  openMobileWalletBrowser() (Solflare and generic/Phantom/Trust/etc.
 *  branches) arms a 1.4s window.setTimeout "the wallet app must not be
 *  installed, send the customer to the store" fallback. The ONLY thing
 *  that ever cancelled it was a one-shot `pagehide` listener - which does
 *  not reliably fire when iOS/Android hands off a Universal Link to a
 *  native wallet app (the tab is backgrounded, not unloaded). Mobile
 *  browsers throttle/suspend a background setTimeout and only actually run
 *  it once the tab is foregrounded again - which is also the exact moment
 *  the customer returns from approving the payment and PROCESSING/
 *  CONFIRMED become visible. The timer's only firing guard,
 *  `document.visibilityState === "visible"`, is satisfied by that same
 *  return, so it fires the store redirect right after confirmation.
 *
 * Fix: the timer now lives in a ref (fallbackTimerRef) that every relevant
 * signal can cancel - document becoming hidden, the tab regaining
 * focus/pageshow, a transaction signature being obtained, PROCESSING,
 * CONFIRMED, and component unmount - not just the unreliable one-shot
 * pagehide event (which remains, now routed through the same helper).
 * Also adds a single-use guard (walletLaunchInFlightRef) so one wallet
 * launch can never execute twice concurrently.
 */

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("SolanaWalletPayment — app-store fallback timer cancellation", () => {
  const src = read("components/payment/SolanaWalletPayment.tsx")

  it("the fallback timer is stored in a ref shared across effects, not a function-local const", () => {
    expect(src).toContain("const fallbackTimerRef = useRef<number | null>(null)")
    expect(src).not.toContain("const fallbackTimer = window.setTimeout")
    // Both arming sites (Solflare branch, generic branch) assign through the ref.
    const armingSites = src.split("fallbackTimerRef.current = window.setTimeout(").length - 1
    expect(armingSites).toBe(2)
  })

  it("clearWalletFallbackTimer clears and nulls the ref, and is used by the pagehide listener instead of an inline arrow closing over a local variable", () => {
    const fnStart = src.indexOf("const clearWalletFallbackTimer = useCallback(")
    const fnEnd = src.indexOf("}, [])", fnStart)
    const block = src.slice(fnStart, fnEnd)
    expect(block).toContain("window.clearTimeout(fallbackTimerRef.current)")
    expect(block).toContain("fallbackTimerRef.current = null")

    const pagehideSites = src.split('window.addEventListener("pagehide", clearWalletFallbackTimer').length - 1
    expect(pagehideSites).toBe(2)
  })

  it("cancels the timer when the document becomes hidden (the wallet app opening), not just on the unreliable pagehide event", () => {
    const visIndex = src.indexOf("function handleVisibility() {")
    const visEnd = src.indexOf("\n    }\n    document.addEventListener", visIndex)
    const block = src.slice(visIndex, visEnd)
    expect(block).toContain('document.visibilityState === "visible"')
    expect(block).toContain("clearWalletFallbackTimer()")
  })

  it("cancels the timer when the customer returns to the tab (visibilitychange-visible, pageshow, AND focus)", () => {
    const fnStart = src.indexOf("function handleReturn() {")
    const fnEnd = src.indexOf("\n    }\n    function handleVisibility", fnStart)
    const block = src.slice(fnStart, fnEnd)
    expect(block).toContain("clearWalletFallbackTimer()")

    expect(src).toContain('window.addEventListener("pageshow", handleReturn)')
    expect(src).toContain('window.addEventListener("focus", handleReturn)')
  })

  it("cancels the timer as soon as a transaction signature is obtained (injected-provider path)", () => {
    const sigIndex = src.indexOf("const signature = await sendWalletTransaction(")
    expect(sigIndex).toBeGreaterThan(-1)
    const block = src.slice(sigIndex, sigIndex + 500)
    expect(block).toContain("clearWalletFallbackTimer()")
  })

  it("cancels the timer the moment payment status is PROCESSING", () => {
    const start = src.indexOf('const normalized = String(paymentStatus || "").toUpperCase()')
    const end = src.indexOf("}, [execStage, paymentStatus, clearWalletFallbackTimer])", start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const block = src.slice(start, end)
    expect(block).toContain('if (normalized !== "PROCESSING") return')
    expect(block).toContain("clearWalletFallbackTimer()")
  })

  it("cancels the timer the moment payment status is CONFIRMED", () => {
    const start = src.indexOf('if (terminalStatus !== "CONFIRMED") return')
    expect(start).toBeGreaterThan(-1)
    const block = src.slice(start, start + 150)
    expect(block).toContain("clearWalletFallbackTimer()")
  })

  it("cancels the timer on component unmount, independent of any status transition ever being observed", () => {
    expect(src).toContain("return () => clearWalletFallbackTimer()")
  })
})

describe("SolanaWalletPayment — single-use wallet-launch guard", () => {
  const src = read("components/payment/SolanaWalletPayment.tsx")

  it("openMobileWalletBrowser refuses to run a second concurrent launch", () => {
    const fnStart = src.indexOf("const openMobileWalletBrowser = useCallback(")
    const block = src.slice(fnStart, fnStart + 400)
    expect(block).toContain("if (walletLaunchInFlightRef.current) return")
    expect(block).toContain("walletLaunchInFlightRef.current = true")
  })

  it("startPayment (injected-provider path) shares the same guard", () => {
    const fnStart = src.indexOf("const startPayment = useCallback(")
    const block = src.slice(fnStart, fnStart + 400)
    expect(block).toContain("if (walletLaunchInFlightRef.current) return")
    expect(block).toContain("walletLaunchInFlightRef.current = true")
  })

  it("the guard is released on a failure that never navigated away, so a retry is never permanently blocked", () => {
    // openMobileWalletBrowser's catch block.
    const catchStart = src.indexOf('const message = err instanceof Error ? err.message : "Failed to open Solana wallet"')
    const catchBlock = src.slice(catchStart, catchStart + 600)
    expect(catchBlock).toContain("walletLaunchInFlightRef.current = false")

    // startPayment's finally block (the window now also spans the customer-
    // facing execution-error classification added between catch and finally).
    const finallyStart = src.indexOf('const message = err instanceof Error ? err.message : "Failed to send Solana transaction"')
    const finallyBlock = src.slice(finallyStart, finallyStart + 1600)
    expect(finallyBlock).toContain("walletLaunchInFlightRef.current = false")
  })

  it("the guard is also released whenever the customer returns to the tab", () => {
    const fnStart = src.indexOf("function handleReturn() {")
    const block = src.slice(fnStart, fnStart + 150)
    expect(block).toContain("walletLaunchInFlightRef.current = false")
  })
})

describe("SolanaWalletPayment — no wallet/store navigation from a status-driven effect", () => {
  const src = read("components/payment/SolanaWalletPayment.tsx")

  it("the CONFIRMED effect only clears the timer and sets local UI state — no navigation", () => {
    const start = src.indexOf('if (terminalStatus !== "CONFIRMED") return')
    const end = src.indexOf("}, [terminalStatus, paymentData?.paymentId, clearWalletFallbackTimer])", start)
    const block = src.slice(start, end)
    expect(block).not.toContain("window.location")
    expect(block).not.toContain("window.open")
    expect(block).not.toContain("buildInstallUrl")
  })

  it("the PROCESSING effect only clears the timer and sets local UI state — no navigation", () => {
    const start = src.indexOf('const normalized = String(paymentStatus || "").toUpperCase()')
    const end = src.indexOf("}, [execStage, paymentStatus, clearWalletFallbackTimer])", start)
    const block = src.slice(start, end)
    expect(block).not.toContain("window.location")
    expect(block).not.toContain("window.open")
    expect(block).not.toContain("buildInstallUrl")
  })

  it("every window.location.href navigation to a wallet/store URL is reachable only from an explicit tap handler (openMobileWalletBrowser or openInstallPage), never from a bare top-level effect", () => {
    const openInstallStart = src.indexOf("const openInstallPage = useCallback(")
    expect(openInstallStart).toBeGreaterThan(-1)

    // Every window.location.href assignment in the file falls inside one of
    // these three callbacks (openMobileWalletBrowser, its Solflare branch,
    // openInstallPage) - not inside a useEffect body.
    const navigationSites = [...src.matchAll(/window\.location\.href\s*=/g)].map((m) => m.index!)
    expect(navigationSites.length).toBeGreaterThan(0)
    for (const index of navigationSites) {
      const precedingUseEffect = src.lastIndexOf("useEffect(", index)
      const precedingCallback = src.lastIndexOf("useCallback(", index)
      // The nearest enclosing hook call before this navigation must be a
      // useCallback (an explicit-invocation handler), not a useEffect.
      expect(precedingCallback).toBeGreaterThan(precedingUseEffect)
    }
  })
})
