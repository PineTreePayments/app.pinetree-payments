import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { getPaymentDisplayStatus } from "@/lib/utils/paymentStatus"

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8")

function terminalBlock(source: string, marker: string, nextMarker: string) {
  const start = source.indexOf(marker)
  const end = source.indexOf(nextMarker, start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe("shared payment-state visual contract", () => {
  const visual = read("components/payment/PaymentStatusVisual.tsx")
  const result = read("components/payment/TransactionResult.tsx")
  const checkout = read("app/pay/PayClient.tsx")
  const pos = read("components/pos/POSLayout.tsx")

  it("enforces a fixed, centered, non-shrinking 1:1 icon circle", () => {
    expect(visual).toContain("data-payment-state-icon-circle")
    expect(visual).toContain("inline-flex aspect-square flex-shrink-0 items-center justify-center")
    expect(visual).toContain("rounded-full")
    expect(visual).toContain('"h-[72px] w-[72px] sm:h-20 sm:w-20"')
    expect(visual).not.toMatch(/\bpx-\d+[^\n]*data-payment-state-icon-circle/)
  })

  it("uses one flat, solid, neutral status card with no gradient or glow", () => {
    const page = read("components/ui/PageContainer.tsx")
    const css = read("app/globals.css")
    const sharedSurfaces = `${visual}\n${result}\n${page}`

    expect(visual).toContain("data-payment-state-card")
    expect(visual).toContain("border border-gray-200 bg-white")
    expect(visual).toContain("rounded-2xl")
    expect(visual).toContain("shadow-sm")
    expect(sharedSurfaces).not.toMatch(/gradient|backdrop-blur|radial-gradient|linear-gradient/)
    expect(css).not.toContain("pinetree-waiting-glow")
    expect(result).toContain('variant="card"')
    expect(result).not.toContain("data-payment-state-card")
    expect(result).not.toContain("rounded-")
  })

  it("removes terminal checkout headings while retaining checkout branding on entry screens", () => {
    const terminal = terminalBlock(
      checkout,
      "if (isIntentMode && terminalPaymentStatus)",
      'normalizedPaymentStatus === "PROCESSING"'
    )
    const processing = terminalBlock(
      checkout,
      'normalizedPaymentStatus === "PROCESSING"',
      "if (isIntentMode) {"
    )

    expect(terminal).toContain("<TransactionResult")
    expect(processing).toContain("<TransactionResult")
    expect(terminal).not.toContain("PineTree Checkout")
    expect(processing).not.toContain("PineTree Checkout")
    expect(checkout).toContain(">PineTree Checkout</p>")
  })

  it("keeps POS to one visible card for canonical result states", () => {
    expect(pos).toContain("const showsStandalonePaymentStateCard")
    expect(pos).toContain('"bg-transparent p-0 shadow-none"')
    expect(pos).toContain('<TransactionResult state="CONFIRMED"')
    expect(pos).toContain('<TransactionResult state="FAILED"')
    expect(pos).toContain('<TransactionResult state="INCOMPLETE"')
    expect(pos).toContain('<TransactionResult state="EXPIRED"')
    expect(pos).toContain('<TransactionResult state="CANCELED"')

    const terminalResults = pos.slice(pos.indexOf("{/* -- CONFIRMED -- */}"))
    expect(terminalResults).not.toContain('variant="card"')
    expect(terminalResults).not.toMatch(/bg-gradient|radial-gradient|linear-gradient/)
  })

  it("routes hosted checkout, POS, card, and every crypto rail through the shared visual", () => {
    const base = read("components/payment/BaseWalletPayment.tsx")
    const solana = read("components/payment/SolanaWalletPayment.tsx")
    const lightning = read("components/payment/LightningPayment.tsx")
    const basePos = read("components/payment/BasePosCheckoutMirror.tsx")
    const card = read("components/pos/PosCardPaymentExperience.tsx")

    for (const source of [base, solana, lightning, basePos]) {
      expect(source).toContain("<PaymentStatusVisual")
    }
    expect(checkout).toContain("<TransactionResult")
    expect(pos).toContain("<TransactionResult")
    expect(card).toContain("<TransactionResult")

    const baseTerminal = terminalBlock(base, "if (terminalStatus)", "const amountDisplay")
    const solanaTerminal = terminalBlock(solana, "if (terminalStatus)", "const isExecuting")
    const lightningTerminal = terminalBlock(lightning, "if (terminalStatus)", "if (!hasInvoice)")
    expect(baseTerminal).not.toContain("Base Network Payment")
    expect(solanaTerminal).not.toContain("Solana Network Payment")
    expect(lightningTerminal).not.toContain("Bitcoin Lightning Payment")
  })

  it.each([
    ["PENDING", "blue"],
    ["PROCESSING", "blue"],
    ["CONFIRMED", "green"],
    ["FAILED", "red"],
    ["EXPIRED", "rose"],
    ["CANCELED", "gray"],
    ["INCOMPLETE", "amber"],
    ["UNKNOWN", "gray"],
  ])("maps %s to its architecture-approved color", (status, color) => {
    const display = getPaymentDisplayStatus(status)
    expect(`${display.classes} ${display.iconClassName} ${display.iconBgClassName}`).toContain(color)
  })

  it("preserves existing actions and handlers without mock navigation controls", () => {
    const card = read("components/pos/PosCardPaymentExperience.tsx")

    expect(checkout).toContain("label: returnLabel, href: returnUrl")
    expect(pos).toContain('{ label: "Back", onClick: resetSale')
    expect(pos).toContain('{ label: "New Sale", onClick: resetSale')
    expect(card).toContain('{ label: "Try Again", onClick: props.onTryAgain }')
    expect(card).toContain('{ label: "View Receipt", onClick: props.onViewReceipt')

    const combined = `${checkout}\n${pos}\n${card}\n${result}`
    expect(combined).not.toContain("Start new payment")
    expect(combined).not.toContain("Please wait</Button>")
  })
})
