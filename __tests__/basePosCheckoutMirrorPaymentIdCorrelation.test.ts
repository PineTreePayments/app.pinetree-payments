import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Regression coverage for correlating the customer-side approval-timing
 * trace with the POS terminal's own paymentId-keyed trace. The two devices
 * share no JS context — paymentId is the only identifier that already flows
 * to both sides (POS logs it from the start; this component previously only
 * had intentId in scope, so none of its markBaseCheckoutLatency calls could
 * be joined against the POS side's paymentId-keyed lines).
 *
 * Also confirms the pairing URI / topic is never logged, per the explicit
 * instruction not to log connection secrets even indirectly.
 */

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

const REQUIRED_MILESTONES = [
  "customer_pairing_uri_received",
  "wallet_list_rendered",
  "wallet_selected",
  "wallet_deeplink_launched",
  "browser_visibility_hidden",
  "browser_visibility_restored",
]

describe("BasePosCheckoutMirror — paymentId correlation", () => {
  const src = read("components/payment/BasePosCheckoutMirror.tsx")

  it("accepts paymentId as a prop", () => {
    const propsStart = src.indexOf("type Props = {")
    const propsEnd = src.indexOf("\n}", propsStart)
    const block = src.slice(propsStart, propsEnd)
    expect(block).toContain("paymentId?: string")
  })

  it("every required customer-side approval milestone logs both intentId and paymentId", () => {
    for (const milestone of REQUIRED_MILESTONES) {
      const callIndex = src.indexOf(`markBaseCheckoutLatency("${milestone}"`)
      expect(callIndex, `${milestone} call site not found`).toBeGreaterThan(-1)
      const call = src.slice(callIndex, src.indexOf(")", src.indexOf("{", callIndex)) + 1)
      expect(call, `${milestone} must log intentId`).toContain("intentId")
      expect(call, `${milestone} must log paymentId`).toContain("paymentId")
    }
  })

  it("WalletLauncherModal receives and threads paymentId through to its own markBaseCheckoutLatency calls", () => {
    const modalStart = src.indexOf("function WalletLauncherModal(")
    const modalEnd = src.indexOf("\n}\n", modalStart)
    const block = src.slice(modalStart, modalEnd)
    expect(block).toContain("{ intentId, paymentId, pairingUri, onClose, onWalletClick }: LauncherModalProps")
    expect(block).toContain('markBaseCheckoutLatency("wallet_selected", { intentId, paymentId')
    expect(block).toContain('markBaseCheckoutLatency("wallet_deeplink_launched", { intentId, paymentId')
  })

  it("the render call site passes paymentId into WalletLauncherModal", () => {
    const renderIndex = src.indexOf("<WalletLauncherModal")
    const block = src.slice(renderIndex, renderIndex + 200)
    expect(block).toContain("paymentId={paymentId}")
  })

  it("never logs the pairing URI or a full topic in any markBaseCheckoutLatency call", () => {
    const calls = [...src.matchAll(/markBaseCheckoutLatency\([^)]*\)/g)].map((m) => m[0])
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      expect(call).not.toMatch(/pairingUri/i)
      expect(call).not.toMatch(/\btopic\b/i)
    }
  })
})

describe("PayClient — passes paymentId into BasePosCheckoutMirror", () => {
  const src = read("app/pay/PayClient.tsx")

  it("threads intentPayload.paymentId into the POS-owned Base mirror", () => {
    const renderIndex = src.indexOf("<BasePosCheckoutMirror")
    const block = src.slice(renderIndex, renderIndex + 400)
    expect(block).toContain("paymentId={intentPayload?.paymentId || undefined}")
  })
})
