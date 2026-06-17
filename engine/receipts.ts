import { PDFDocument, StandardFonts, rgb } from "pdf-lib"
import { supabaseAdmin, supabase } from "@/database"
import {
  cashTransactionSecondaryLabel,
  formatTransactionProviderLabel,
  isCashTransactionProvider
} from "@/lib/transactionRailDisplay"
import { normalizeReportNetwork } from "./reportDisplayNormalization"
import { getPaymentStatusLabel } from "@/lib/utils/paymentStatus"
import { getPaymentAssetDisplay, type PaymentMetadataForAssetDisplay } from "@/lib/paymentAssetDisplay"

const db = supabaseAdmin || supabase

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

export async function getMerchantReceipt(
  merchantId: string,
  paymentId: string
): Promise<ReceiptData> {
  const [{ data: payment, error: paymentError }, { data: transaction }, { data: settings }, { data: receiptSettings }] =
    await Promise.all([
      db
        .from("payments")
        .select("id,merchant_id,gross_amount,currency,provider,network,status,provider_reference,created_at,metadata")
        .eq("id", paymentId)
        .eq("merchant_id", merchantId)
        .maybeSingle(),
      db
        .from("transactions")
        .select("id,provider_transaction_id")
        .eq("payment_id", paymentId)
        .eq("merchant_id", merchantId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("merchant_settings")
        .select("business_name,address,address_line_2,city,state,zip")
        .eq("merchant_id", merchantId)
        .maybeSingle(),
      db
        .from("merchant_operations_settings")
        .select("show_business_name,show_business_address,show_transaction_id,show_network,show_provider,show_wallet_reference,receipt_footer")
        .eq("merchant_id", merchantId)
        .maybeSingle()
    ])

  if (paymentError) throw new Error(`Failed to load receipt: ${paymentError.message}`)
  if (!payment) throw new Error("Payment not found")
  if (payment.status !== "CONFIRMED") throw new Error("Receipt is available after payment confirmation")

  const showBusinessName = receiptSettings?.show_business_name !== false
  const showBusinessAddress = receiptSettings?.show_business_address !== false
  const showTransactionId = receiptSettings?.show_transaction_id !== false
  const showNetwork = receiptSettings?.show_network !== false
  const showProvider = receiptSettings?.show_provider !== false
  const showWalletReference = receiptSettings?.show_wallet_reference === true
  const address = [
    settings?.address,
    settings?.address_line_2,
    [settings?.city, settings?.state, settings?.zip].filter(Boolean).join(", ")
  ].filter(Boolean).join("\n")

  const assetDisplay = getPaymentAssetDisplay(
    String(payment.network || "") || null,
    payment.metadata as PaymentMetadataForAssetDisplay | null,
    Number(payment.gross_amount || 0)
  )

  return {
    paymentId: String(payment.id),
    transactionId: showTransactionId ? String(transaction?.id || "") || null : null,
    businessName: showBusinessName ? String(settings?.business_name || "PineTree Merchant") : null,
    businessAddress: showBusinessAddress ? address || null : null,
    createdAt: String(payment.created_at),
    amount: Number(payment.gross_amount || 0),
    currency: String(payment.currency || "USD"),
    provider: showProvider ? String(payment.provider || "Unknown") : "",
    network: showNetwork ? String(payment.network || "") || null : null,
    status: String(payment.status),
    reference: showWalletReference
      ? String(transaction?.provider_transaction_id || payment.provider_reference || "") || null
      : null,
    footer: String(receiptSettings?.receipt_footer || "") || null,
    assetLabel: assetDisplay.assetLabel,
    amountPaidLabel: assetDisplay.amountPaidLabel,
    rateLabel: assetDisplay.rateLabel
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

export async function renderReceiptPdf(receipt: ReceiptData) {
  const displayRail = getReceiptDisplayRail(receipt)
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([360, 600])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  let y = 555

  const line = (label: string, value: string, emphasize = false) => {
    page.drawText(label, { x: 28, y, size: 9, font, color: rgb(0.39, 0.45, 0.55) })
    page.drawText(value.slice(0, 45), { x: 132, y, size: 9, font: emphasize ? bold : font, color: rgb(0.06, 0.09, 0.16) })
    y -= 24
  }

  if (receipt.businessName) {
    page.drawText(receipt.businessName.slice(0, 40), { x: 28, y, size: 18, font: bold, color: rgb(0, 0.32, 1) })
    y -= 26
  }
  if (receipt.businessAddress) {
    for (const addressLine of receipt.businessAddress.split("\n")) {
      page.drawText(addressLine.slice(0, 50), { x: 28, y, size: 9, font, color: rgb(0.39, 0.45, 0.55) })
      y -= 14
    }
  }
  y -= 14
  page.drawText(formatAmount(receipt.amount, receipt.currency), { x: 28, y, size: 24, font: bold, color: rgb(0.06, 0.09, 0.16) })
  y -= 38

  line("Receipt ID", receipt.paymentId)
  if (receipt.transactionId) line("Transaction ID", receipt.transactionId)
  line("Date / Time", formatDate(receipt.createdAt))
  line("Currency", receipt.currency)
  if (receipt.assetLabel) line("Asset", receipt.assetLabel)
  if (receipt.amountPaidLabel) line("Amount Paid", receipt.amountPaidLabel)
  if (receipt.rateLabel) line("Rate at Payment", receipt.rateLabel)
  if (receipt.provider) line("Provider", displayRail.provider)
  if (receipt.network || cashTransactionSecondaryLabel(receipt.provider)) line("Network", displayRail.network)
  line("Status", getPaymentStatusLabel(receipt.status), true)
  if (receipt.reference) line("Reference", receipt.reference)

  y -= 12
  if (receipt.footer) {
    page.drawText(receipt.footer.slice(0, 60), { x: 28, y, size: 9, font, color: rgb(0.39, 0.45, 0.55) })
    y -= 20
  }
  page.drawText("Powered by PineTree Payments", { x: 28, y, size: 8, font, color: rgb(0.39, 0.45, 0.55) })
  return pdf.save()
}
