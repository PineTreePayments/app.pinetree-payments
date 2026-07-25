import fs from "node:fs"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  clearLightningCreationIdempotencyKey,
  getLightningCreationIdempotencyKey,
  lightningCreationIdempotencyStorageKey,
} from "@/components/payment/LightningPayment"

/**
 * Regression coverage for "back-to-back Bitcoin Lightning payments fail"
 * (production symptom: "Failed to create Lightning invoice" immediately
 * after a prior Lightning payment on the same intent had already been
 * confirmed or abandoned).
 *
 * Root cause, traced end to end (not guessed):
 *  - components/payment/LightningPayment.tsx caches its client-supplied
 *    Idempotency-Key in sessionStorage, keyed by intentId
 *    (getLightningCreationIdempotencyKey). This key is honoured verbatim by
 *    the server (engine/paymentIntents.ts:603-604 only falls back to its
 *    own prevPaymentId-scoped key when the client sends none).
 *  - engine/createPayment.ts:306-313 calls claimIdempotencyKey() and throws
 *    "Duplicate idempotency key..." the moment it sees a key already
 *    claimed by an earlier payment.
 *  - Because the cached key was never cleared after a successful
 *    invoice creation, a genuinely new attempt for the SAME intentId (the
 *    customer cancels/abandons an unpaid invoice and re-selects Bitcoin
 *    Lightning) resent the already-claimed key. engine/paymentIntents.ts's
 *    recovery path (resolveConcurrentSelectionWinner) then retries for
 *    ~2.4s looking for an active reusable payment on THIS intent, finds
 *    none (the earlier payment may already be inactive/expired), and
 *    throws "Payment selection is already in progress for this session.
 *    Please retry in a moment." — which the select-network route
 *    (app/api/payment-intents/[intentId]/select-network/route.ts) turns
 *    into the generic customer-facing message matching the reported
 *    "Failed to create Lightning invoice."
 *  - Separately, app/pay/PayClient.tsx rendered <LightningPayment> with no
 *    `key` prop, so React would reuse the same mounted instance (and all
 *    its stale useState/useRef values, including this cached key) across
 *    an intentId prop change instead of remounting fresh.
 *
 * Fix: clear the cached key as soon as an invoice is actually created
 * (LightningPayment.tsx), and force a full remount on intentId change
 * (PayClient.tsx `key={intentId}`) as defense in depth for every other
 * piece of this component's state.
 */

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

function createFakeSessionStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => store.clear(),
  }
}

describe("Lightning creation idempotency key — behavioral", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("generates a fresh key for a brand-new intentId and reuses it on a second call for the SAME intentId (protects an in-flight/uncertain retry)", () => {
    vi.stubGlobal("window", { sessionStorage: createFakeSessionStorage() })

    const first = getLightningCreationIdempotencyKey("intent-A")
    const second = getLightningCreationIdempotencyKey("intent-A")
    expect(first).toBe(second)
    expect(first.length).toBeGreaterThan(0)
  })

  it("gives a DIFFERENT intentId a completely different key", () => {
    vi.stubGlobal("window", { sessionStorage: createFakeSessionStorage() })

    const keyA = getLightningCreationIdempotencyKey("intent-A")
    const keyB = getLightningCreationIdempotencyKey("intent-B")
    expect(keyA).not.toBe(keyB)
  })

  it("after a successful invoice creation clears the cached key, so the NEXT attempt for the SAME intentId (cancel/abandon and retry) mints a fresh one instead of resending the already-claimed key", () => {
    vi.stubGlobal("window", { sessionStorage: createFakeSessionStorage() })

    const firstAttemptKey = getLightningCreationIdempotencyKey("intent-A")

    // The invoice-creation request succeeds — LightningPayment.tsx's
    // prepareInvoice() calls this immediately after setPayment(data).
    clearLightningCreationIdempotencyKey("intent-A")

    // Customer abandons the unpaid invoice, cancels, and re-selects
    // Bitcoin Lightning for the SAME intent — a fresh LightningPayment
    // mount calls this again.
    const secondAttemptKey = getLightningCreationIdempotencyKey("intent-A")

    expect(secondAttemptKey).not.toBe(firstAttemptKey)
  })

  it("clearing one intentId's key never touches a different intentId's cached key", () => {
    vi.stubGlobal("window", { sessionStorage: createFakeSessionStorage() })

    const keyA = getLightningCreationIdempotencyKey("intent-A")
    getLightningCreationIdempotencyKey("intent-B")
    clearLightningCreationIdempotencyKey("intent-A")

    // intent-B's key is untouched.
    expect(getLightningCreationIdempotencyKey("intent-B")).toBe(
      getLightningCreationIdempotencyKey("intent-B")
    )
    // intent-A gets a fresh key now that its old one was cleared.
    expect(getLightningCreationIdempotencyKey("intent-A")).not.toBe(keyA)
  })

  it("get and clear derive the exact same storage key format, so clearing can never silently miss the entry it just wrote", () => {
    expect(lightningCreationIdempotencyStorageKey("intent-X")).toBe(
      "pinetree:lightning:create:intent-X"
    )
  })

  it("never throws when sessionStorage is unavailable (privacy-restricted browsers) — falls back to a fresh key every call", () => {
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: () => {
          throw new Error("SecurityError: sessionStorage is disabled")
        },
        setItem: () => {
          throw new Error("SecurityError: sessionStorage is disabled")
        },
        removeItem: () => {
          throw new Error("SecurityError: sessionStorage is disabled")
        },
      },
    })

    expect(() => getLightningCreationIdempotencyKey("intent-A")).not.toThrow()
    expect(() => clearLightningCreationIdempotencyKey("intent-A")).not.toThrow()
  })
})

describe("LightningPayment.tsx — wiring", () => {
  const src = read("components/payment/LightningPayment.tsx")

  it("clears the cached idempotency key immediately on a successful invoice creation", () => {
    const successIndex = src.indexOf("setPayment(data)")
    expect(successIndex).toBeGreaterThan(-1)
    const block = src.slice(successIndex, successIndex + 120)
    expect(block).toContain("clearLightningCreationIdempotencyKey(intentId)")
  })

  it("does NOT clear the cached key in the failure path — a retry after an uncertain-outcome failure must keep reusing the same key", () => {
    const catchIndex = src.indexOf("} catch (err) {\n      setError((err as Error).message")
    const catchIndexFallback = catchIndex === -1 ? src.indexOf('setError((err as Error).message || "Unable to prepare Lightning invoice")') : catchIndex
    expect(catchIndexFallback).toBeGreaterThan(-1)
    const block = src.slice(Math.max(0, catchIndexFallback - 100), catchIndexFallback + 100)
    expect(block).not.toContain("clearLightningCreationIdempotencyKey")
  })

  it("only one call site clears the key — exactly the success path", () => {
    const callSites = src.split("clearLightningCreationIdempotencyKey(").length - 1
    // One in the function definition itself, one at the actual call site.
    expect(callSites).toBe(2)
  })
})

describe("PayClient.tsx — LightningPayment remounts on intentId change", () => {
  const src = read("app/pay/PayClient.tsx")

  it("passes key={intentId} to <LightningPayment>, forcing a full remount (fresh state, fresh cached idempotency key lookup) whenever intentId changes", () => {
    const renderIndex = src.indexOf("<LightningPayment")
    expect(renderIndex).toBeGreaterThan(-1)
    const block = src.slice(renderIndex, renderIndex + 2200)
    expect(block).toContain("key={intentId}")
    expect(block).toContain("intentId={intentId!}")
    // key must be set before intentId is read as a prop, i.e. present in
    // the same element - a sanity check that it wasn't accidentally added
    // to some other element instead.
    expect(block.indexOf("key={intentId}")).toBeLessThan(block.indexOf("intentId={intentId!}"))
  })
})
