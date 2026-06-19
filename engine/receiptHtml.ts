import {
  formatTransactionProviderLabel,
  isCashTransactionProvider
} from "@/lib/transactionRailDisplay"
import { getPaymentStatusLabel } from "@/lib/utils/paymentStatus"
import { normalizeReportNetwork } from "./reportDisplayNormalization"

export type ReceiptData = {
  paymentId: string
  transactionId: string | null
  businessName: string | null
  businessAddress: string | null
  createdAt: string
  amount: number
  currency: string
  provider: string
  network: string | null
  status: string
  reference: string | null
  footer: string | null
  assetLabel: string | null
  amountPaidLabel: string | null
  rateLabel: string | null
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;")
}

function formatAmount(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD"
  }).format(amount)
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Chicago"
  })
}

export function getReceiptDisplayRail(receipt: Pick<ReceiptData, "provider" | "network">) {
  return {
    provider: formatTransactionProviderLabel(receipt.provider),
    network: normalizeReportNetwork(receipt.network, receipt.provider)
  }
}

export function renderReceiptHtml(receipt: ReceiptData) {
  const displayRail = getReceiptDisplayRail(receipt)
  const rows = [
    ["Receipt ID", receipt.paymentId],
    ["Transaction ID", receipt.transactionId],
    ["Date / Time", formatDate(receipt.createdAt)],
    ["Amount", formatAmount(receipt.amount, receipt.currency)],
    ["Currency", receipt.currency],
    ["Asset", receipt.assetLabel],
    ["Amount Paid", receipt.amountPaidLabel],
    ["Rate at Payment", receipt.rateLabel],
    ["Provider", receipt.provider ? displayRail.provider : null],
    ["Network", receipt.network || isCashTransactionProvider(receipt.provider) ? displayRail.network : null],
    ["Status", getPaymentStatusLabel(receipt.status)],
    ["Reference", receipt.reference]
  ].filter((row): row is [string, string] => Boolean(row[1]))

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Receipt ${escapeHtml(receipt.paymentId)}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #f4f7fb; color: #111827; }
    .toolbar { display: flex; justify-content: center; gap: 10px; padding: 20px; }
    .button { border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px 14px; background: white; color: #1d4ed8; font-weight: 700; cursor: pointer; text-decoration: none; }
    .button.primary { background: #0052ff; color: white; border-color: #0052ff; }
    .receipt { width: min(420px, calc(100% - 32px)); margin: 0 auto 32px; background: white; border: 1px solid #e5e7eb; border-radius: 20px; padding: 28px; box-shadow: 0 18px 50px rgba(15,23,42,.10); }
    h1 { margin: 0; font-size: 24px; }
    .address { white-space: pre-line; margin-top: 8px; color: #64748b; font-size: 13px; line-height: 1.5; }
    .amount { margin: 24px 0; padding: 18px; border-radius: 14px; background: #eff6ff; color: #0f172a; font-size: 28px; font-weight: 800; text-align: center; }
    dl { margin: 0; }
    .row { display: grid; grid-template-columns: 120px minmax(0,1fr); gap: 12px; padding: 10px 0; border-bottom: 1px solid #f1f5f9; }
    dt { color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; }
    dd { margin: 0; overflow-wrap: anywhere; font-size: 13px; text-align: right; }
    .footer { margin-top: 22px; text-align: center; color: #64748b; font-size: 12px; line-height: 1.5; }
    @media print { body { background: white; } .toolbar { display: none; } .receipt { box-shadow: none; border: 0; margin: 0 auto; } }
  </style>
</head>
<body>
  <div class="toolbar">
    <button class="button primary" onclick="window.print()">Print Receipt</button>
  </div>
  <main class="receipt">
    ${receipt.businessName ? `<h1>${escapeHtml(receipt.businessName)}</h1>` : ""}
    ${receipt.businessAddress ? `<div class="address">${escapeHtml(receipt.businessAddress)}</div>` : ""}
    <div class="amount">${escapeHtml(formatAmount(receipt.amount, receipt.currency))}</div>
    <dl>${rows.map(([label, value]) => `<div class="row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
    <div class="footer">
      ${receipt.footer ? `<div>${escapeHtml(receipt.footer)}</div>` : ""}
      <div>Powered by PineTree Payments</div>
    </div>
  </main>
</body>
</html>`
}
