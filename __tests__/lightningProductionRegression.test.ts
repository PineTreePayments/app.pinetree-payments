import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const component = readFileSync("components/payment/LightningPayment.tsx", "utf8")
const poller = readFileSync("lib/lightning/lightningStatusPoller.ts", "utf8")
const intents = readFileSync("engine/paymentIntents.ts", "utf8")
const creation = readFileSync("engine/createPayment.ts", "utf8")

describe("production Lightning payment flow", () => {
  it("never fetches the removed debug endpoint", () => {
    expect(component).not.toContain("/api/debug/lightning")
    expect(component).not.toContain("debug/lightning")
  })

  it("uses one bounded controller instead of a React interval or focus retry", () => {
    expect(component).toContain("acquireLightningStatusPoller(paymentId")
    expect(component).not.toContain("setInterval")
    expect(component).toContain('window.addEventListener("offline"')
    expect(component).toContain('document.addEventListener("visibilitychange"')
    expect(poller).toContain("private inFlight = false")
    expect(poller).toContain("maxAttempts ?? 60")
    expect(poller).toContain("maxDurationMs ?? 6 * 60_000")
  })

  it("keeps one PineTree creation identity across rerenders and sanitizes raw provider errors", () => {
    expect(component).toContain("creationIdempotencyKey")
    expect(component).toContain("window.sessionStorage.getItem(storageKey)")
    expect(component).toContain("window.sessionStorage.setItem(storageKey, created)")
    expect(component).toContain('"Idempotency-Key": creationIdempotencyKey')
    expect(intents).toContain("clientAttemptId")
    expect(intents).toContain("payment-intent:${intent.id}:${normalizedNetwork}")
    expect(creation).toContain("shouldPreserveSpeedCreationIdempotencyClaim(error)")
    expect(component).not.toContain('throw new Error(data.error ||')
  })
})
