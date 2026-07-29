import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8")

function blockBetween(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function countOccurrences(source: string, needle: string) {
  return source.split(needle).length - 1
}

describe("active POS QR checkout layout", () => {
  const pos = read("components/pos/POSLayout.tsx")
  const activeQr = read("components/pos/ActiveQrCheckout.tsx")
  const posActiveBranch = blockBetween(pos, '{paymentMode !== "card" && (status === "waiting" || status === "processing")', "{/* -- CONFIRMED -- */}")

  it("keeps active QR separate from terminal payment-state cards", () => {
    expect(pos).not.toContain('import { PaymentStatusVisual } from "@/components/payment/PaymentStatusVisual"')
    expect(posActiveBranch).toContain("<ActiveQrCheckout")
    expect(posActiveBranch).toContain('status === "waiting" || status === "processing"')
    expect(activeQr).not.toContain("PaymentStatusVisual")
    expect(activeQr).not.toContain("data-payment-state-card")
    expect(activeQr).not.toContain("Waiting for payment")
  })

  it("renders the condensed scan, QR, waiting, totals, and cancel order", () => {
    const scanIndex = activeQr.indexOf("SCAN TO PAY")
    const qrIndex = activeQr.indexOf("src={qrCodeUrl}")
    const indicatorIndex = activeQr.indexOf('data-active-qr-waiting-indicator="true"')
    const waitingIndex = activeQr.indexOf("WAITING")
    const subtotalIndex = activeQr.indexOf("Subtotal")
    const taxIndex = activeQr.indexOf("Tax ({breakdown.taxRate}%)")
    const serviceFeeIndex = activeQr.indexOf("Service fee")
    const totalIndex = activeQr.indexOf("Total")
    const cancelIndex = activeQr.indexOf("Cancel Payment")

    expect(scanIndex).toBeGreaterThanOrEqual(0)
    expect(qrIndex).toBeGreaterThan(scanIndex)
    expect(indicatorIndex).toBeGreaterThan(qrIndex)
    expect(waitingIndex).toBeGreaterThan(indicatorIndex)
    expect(subtotalIndex).toBeGreaterThan(waitingIndex)
    expect(taxIndex).toBeGreaterThan(subtotalIndex)
    expect(serviceFeeIndex).toBeGreaterThan(taxIndex)
    expect(totalIndex).toBeGreaterThan(serviceFeeIndex)
    expect(cancelIndex).toBeGreaterThan(totalIndex)
  })

  it("keeps the waiting indicator compact and the QR large enough to scan", () => {
    expect(activeQr).toContain("h-8 w-8")
    expect(activeQr).toContain("<Clock3 size={17}")
    expect(activeQr).toContain("width={216}")
    expect(activeQr).toContain("height={216}")
    expect(activeQr).toContain("max-w-[216px]")
  })

  it("uses one compact checkout flow with one QR section and one totals section", () => {
    expect(countOccurrences(activeQr, 'data-active-qr-checkout-flow="true"')).toBe(1)
    expect(countOccurrences(activeQr, 'data-active-qr-section="true"')).toBe(2)
    expect(countOccurrences(activeQr, 'data-active-qr-totals-section="true"')).toBe(1)
    expect(activeQr).toContain("rounded-2xl border border-[#DDEBFF] bg-[#F7FAFF] px-4 py-4")
    expect(activeQr).toContain("rounded-xl border border-gray-100 bg-white px-4 py-3")
    expect(activeQr).not.toMatch(/bg-gradient|radial-gradient|linear-gradient|backdrop-blur/)
  })

  it("preserves QR payload, canonical status branch, totals fields, and cancel handler", () => {
    expect(posActiveBranch).toContain('paymentMode !== "card" && (status === "waiting" || status === "processing")')
    expect(posActiveBranch).toContain("qrCodeUrl={qrCodeUrl}")
    expect(posActiveBranch).toContain("breakdown={breakdown}")
    expect(posActiveBranch).toContain("onCancel={() => void cancelSale()}")
    expect(activeQr).toContain("src={qrCodeUrl}")
    expect(activeQr).toContain("fmtUsd(breakdown.subtotalAmount)")
    expect(activeQr).toContain("breakdown.taxEnabled")
    expect(activeQr).toContain("fmtUsd(breakdown.taxAmount)")
    expect(activeQr).toContain("fmtUsd(breakdown.serviceFee)")
    expect(activeQr).toContain("fmtUsd(breakdown.totalAmount)")
    expect(activeQr).toContain('<Button variant="danger" fullWidth disabled={canceling} onClick={onCancel}>')
  })

  it("keeps POS terminal results on the shared TransactionResult component", () => {
    const terminalResults = blockBetween(pos, "{/* -- CONFIRMED -- */}", "</div>")

    expect(terminalResults).toContain('<TransactionResult state="CONFIRMED" compact />')
    expect(terminalResults).toContain('<TransactionResult state="INCOMPLETE" compact')
    expect(terminalResults).toContain('<TransactionResult state="FAILED" compact')
    expect(terminalResults).toContain('<TransactionResult state="EXPIRED" compact')
    expect(terminalResults).toContain('<TransactionResult state="CANCELED" compact')
  })
})
