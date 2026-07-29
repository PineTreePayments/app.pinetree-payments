import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Regression coverage for the "UI RECOVERY" requirement: once a Base webhook
 * (or any other server-side path) confirms a contract_split payment, the
 * customer-facing POS mirror must show success from canonical DB state —
 * it must never keep displaying a stale POS-session step (e.g. stuck on
 * "payment_sending" / "Approve ETH payment in your wallet.") just because
 * the POS terminal's own WalletConnect promise never itself resolved.
 *
 * Before this fix, `terminalStatus` (derived from the paymentStatus prop)
 * was only ever used to gate the polling effects (stop polling once
 * terminal) — it was never checked in the render output, which branched
 * entirely on the mirrored session.step. A payment that reached CONFIRMED
 * through a path this component never directly observed would leave the
 * UI frozen on whatever step was last polled.
 */

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("BasePosCheckoutMirror — canonical status overrides stale session step", () => {
  const src = read("components/payment/BasePosCheckoutMirror.tsx")

  it("checks terminalStatus before any session.step-based branch", () => {
    const terminalCheckIndex = src.indexOf('if (terminalStatus === "CONFIRMED")')
    // "const pairingUri = session?.pairingUri" only appears once, right next
    // to the render-time "const step = session?.step" — unlike "const step
    // = session?.step" alone, which also appears earlier inside the
    // onExecutionStarted effect.
    const stepDestructureIndex = src.indexOf("const pairingUri = session?.pairingUri")
    expect(terminalCheckIndex).toBeGreaterThan(-1)
    expect(stepDestructureIndex).toBeGreaterThan(-1)
    // The terminal-status check must come first, so it can override the
    // step-based render even before `step` is ever read.
    expect(terminalCheckIndex).toBeLessThan(stepDestructureIndex)
  })

  it("renders a CONFIRMED success view driven by canonical status alone, not session.step", () => {
    const start = src.indexOf('if (terminalStatus === "CONFIRMED")')
    const end = src.indexOf("if (terminalStatus) {", start)
    const block = src.slice(start, end)
    expect(block).toContain('<PaymentStatusVisual status="CONFIRMED"')
    expect(block).not.toContain('variant="card"')
  })

  it("renders a non-CONFIRMED terminal status (FAILED/INCOMPLETE/EXPIRED/CANCELED) driven by canonical status alone", () => {
    const start = src.indexOf("if (terminalStatus) {")
    const end = src.indexOf("const step = session?.step", start)
    const block = src.slice(start, end)
    expect(block).toContain("<PaymentStatusVisual")
    expect(block).toContain("status={terminalStatus}")
  })

  it("this override sits before the awaiting-wallet card render, so it applies even if the POS session mirror never loaded", () => {
    const overrideIndex = src.indexOf('if (terminalStatus === "CONFIRMED")')
    const awaitingCardGuardIndex = src.indexOf('if (!session || !step || step === "awaiting_wallet")')
    expect(awaitingCardGuardIndex).toBeGreaterThan(-1)
    expect(overrideIndex).toBeLessThan(awaitingCardGuardIndex)
  })

  it("the WalletConnect-in-progress step branches (payment_sending, wallet_connected, etc.) remain unchanged below the override — they still exist for the non-terminal case", () => {
    expect(src).toContain('if (step === "payment_sending")')
    expect(src).toContain('Approve ETH payment in your wallet.')
  })
})
