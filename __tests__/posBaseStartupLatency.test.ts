import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Regression coverage for the Base POS startup-latency fixes.
 *
 * Production evidence: "select-network completed" at 18:33:51.98 but the
 * first Base session write didn't happen until 18:33:54.08 (~2.1s later) —
 * the POS terminal's Base-selection poll only checks every 3s, so
 * customers waited on average ~1.5s (worst case ~3s) purely for the next
 * scheduled tick, even though the intent row had already been updated.
 * Separately, two updatePosBaseSession() writes inside runPosBaseFlow were
 * awaited sequentially even though nothing downstream depended on their
 * completion, adding pure serialized network latency to every payment.
 */

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("POSLayout Base-selection detection — realtime fast path", () => {
  const src = read("components/pos/POSLayout.tsx")

  it("subscribes to postgres_changes on payment_intents for this intentId, in addition to the existing 3s poll", () => {
    const effectStart = src.indexOf("// Detect when the customer selects Base on the hosted checkout.")
    const effectEnd = src.indexOf("}, [intentId])", effectStart) + "}, [intentId])".length
    const block = src.slice(effectStart, effectEnd)

    expect(block).toContain("pos-base-selection-")
    expect(block).toContain('table: "payment_intents"')
    expect(block).toContain("void poll()")
  })

  it("the realtime handler re-runs the same poll() check rather than duplicating parsing/matching logic", () => {
    const channelStart = src.indexOf("pos-base-selection-")
    const channelBlock = src.slice(channelStart, channelStart + 500)
    // The callback body must just call poll() again, not re-implement its
    // own fetch/parse — a single source of truth for what "selectedNetwork
    // === base" means.
    expect(channelBlock).toMatch(/\(\)\s*=>\s*{\s*void poll\(\)\s*}/)
  })

  it("removes the realtime channel in the effect cleanup, alongside setting cancelled", () => {
    const effectStart = src.indexOf("// Detect when the customer selects Base on the hosted checkout.")
    const cleanupStart = src.indexOf("return () => {", effectStart)
    const cleanupEnd = src.indexOf("}, [intentId])", cleanupStart)
    const cleanupBlock = src.slice(cleanupStart, cleanupEnd)

    expect(cleanupBlock).toContain("cancelled = true")
    expect(cleanupBlock).toContain("supabase.removeChannel(")
  })
})

describe("POSLayout runPosBaseFlow — parallelized session-mirror writes", () => {
  const src = read("components/pos/POSLayout.tsx")

  it("does not block starting WalletConnect init on the first session-mirror write", () => {
    const flowStart = src.indexOf("async function runPosBaseFlow(")
    const initCallIndex = src.indexOf("await initPosBaseWalletConnect()", flowStart)
    const block = src.slice(flowStart, initCallIndex)

    // The pre-init session update must be fire-and-forget (void), not
    // awaited, so the network round trip to our own API no longer sits in
    // series before the WalletConnect relay handshake even starts.
    expect(block).toContain('void updatePosBaseSession(iid, { step: "awaiting_wallet", selectedAsset: asset })')
    expect(block).not.toContain('await updatePosBaseSession(iid, { step: "awaiting_wallet", selectedAsset: asset })')
  })

  it("does not block starting waitForWalletConnect on publishing the pairing URI", () => {
    const flowStart = src.indexOf("async function runPosBaseFlow(")
    const afterInitIndex = src.indexOf("await initPosBaseWalletConnect()", flowStart)
    const waitCallIndex = src.indexOf("waitForWalletConnect(wcResult.provider)", flowStart)
    const pairingWriteIndex = src.indexOf("void updatePosBaseSession(iid, {", afterInitIndex)
    const block = src.slice(pairingWriteIndex, waitCallIndex)

    expect(pairingWriteIndex).toBeGreaterThan(-1)
    expect(waitCallIndex).toBeGreaterThan(pairingWriteIndex)
    // The pairing-URI write must be fire-and-forget so waitForWalletConnect
    // starts immediately rather than waiting on that write to complete.
    expect(block).toContain("pairingUri: wcResult.pairingUri")
  })
})
