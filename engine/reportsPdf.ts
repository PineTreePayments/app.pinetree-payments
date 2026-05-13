import { PDFDocument, PDFPage, StandardFonts, rgb, type PDFFont } from "pdf-lib"
import { generateReportEngine, type ReportInput, type ReportSummary } from "./reports"

type PdfContext = {
  pdfDoc: PDFDocument
  page: PDFPage
  font: PDFFont
  bold: PDFFont
  y: number
}

const BLUE = rgb(0, 0.321, 1)
const TEXT = rgb(0.08, 0.1, 0.16)
const MUTED = rgb(0.35, 0.39, 0.47)
const LINE = rgb(0.86, 0.89, 0.94)

function currency(value: number) {
  return `$${value.toFixed(2)}`
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit"
  })
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit"
  })
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value
}

function addPage(ctx: PdfContext) {
  ctx.page = ctx.pdfDoc.addPage([620, 800])
  ctx.y = 750
}

function ensureSpace(ctx: PdfContext, height: number) {
  if (ctx.y < height) {
    addPage(ctx)
  }
}

function draw(ctx: PdfContext, text: string, options?: {
  x?: number
  size?: number
  bold?: boolean
  color?: ReturnType<typeof rgb>
  lineHeight?: number
}) {
  const size = options?.size || 10
  ctx.page.drawText(text, {
    x: options?.x || 50,
    y: ctx.y,
    size,
    font: options?.bold ? ctx.bold : ctx.font,
    color: options?.color || TEXT
  })
  ctx.y -= options?.lineHeight || size + 6
}

function section(ctx: PdfContext, title: string) {
  ensureSpace(ctx, 80)
  ctx.y -= 8
  ctx.page.drawLine({
    start: { x: 50, y: ctx.y },
    end: { x: 570, y: ctx.y },
    thickness: 1,
    color: LINE
  })
  ctx.y -= 22
  draw(ctx, title.toUpperCase(), { size: 11, bold: true, color: BLUE, lineHeight: 18 })
}

function drawKeyValueGrid(ctx: PdfContext, items: Array<[string, string]>) {
  const leftX = 50
  const rightX = 310
  for (let index = 0; index < items.length; index += 2) {
    ensureSpace(ctx, 36)
    const left = items[index]
    const right = items[index + 1]
    ctx.page.drawText(left[0], { x: leftX, y: ctx.y, size: 8, font: ctx.bold, color: MUTED })
    ctx.page.drawText(left[1], { x: leftX, y: ctx.y - 13, size: 12, font: ctx.bold, color: TEXT })
    if (right) {
      ctx.page.drawText(right[0], { x: rightX, y: ctx.y, size: 8, font: ctx.bold, color: MUTED })
      ctx.page.drawText(right[1], { x: rightX, y: ctx.y - 13, size: 12, font: ctx.bold, color: TEXT })
    }
    ctx.y -= 36
  }
}

function drawBreakdown(ctx: PdfContext, title: string, totals: Record<string, number>) {
  section(ctx, title)
  const entries = Object.entries(totals)
  if (!entries.length) {
    draw(ctx, "No confirmed volume in this report window.", { color: MUTED })
    return
  }

  for (const [label, value] of entries) {
    ensureSpace(ctx, 24)
    ctx.page.drawText(truncate(label, 38), { x: 50, y: ctx.y, size: 10, font: ctx.font, color: TEXT })
    ctx.page.drawText(currency(value), { x: 470, y: ctx.y, size: 10, font: ctx.bold, color: TEXT })
    ctx.y -= 18
  }
}

function drawLedger(ctx: PdfContext, report: ReportSummary) {
  section(ctx, "Transaction Ledger")
  const headers = ["Date", "Reference", "Provider", "Network", "Asset", "Subtotal", "Tax", "Fee", "Gross", "Status"]
  const x = [50, 100, 180, 250, 310, 350, 400, 440, 480, 530]

  ensureSpace(ctx, 40)
  headers.forEach((header, index) => {
    ctx.page.drawText(header, { x: x[index], y: ctx.y, size: 7, font: ctx.bold, color: MUTED })
  })
  ctx.y -= 11
  ctx.page.drawLine({ start: { x: 50, y: ctx.y }, end: { x: 570, y: ctx.y }, thickness: 1, color: LINE })
  ctx.y -= 13

  for (const row of report.transactionsTable) {
    ensureSpace(ctx, 38)
    const values = [
      formatDate(row.dateTime),
      truncate(row.reference, 12),
      truncate(row.provider, 12),
      truncate(row.network, 10),
      truncate(row.asset, 7),
      currency(row.subtotal),
      currency(row.tax),
      currency(row.pinetreeFee),
      currency(row.gross),
      truncate(row.status, 10)
    ]
    values.forEach((value, index) => {
      ctx.page.drawText(value, { x: x[index], y: ctx.y, size: 7, font: index >= 5 ? ctx.bold : ctx.font, color: TEXT })
    })
    ctx.y -= 14
  }
}

export async function generateReportPdfEngine(input: ReportInput) {
  const report = await generateReportEngine(input)
  return generateReportPdfFromSummary(report)
}

export async function generateReportPdfFromSummary(report: ReportSummary) {
  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const firstPage = pdfDoc.addPage([620, 800])
  const ctx: PdfContext = { pdfDoc, page: firstPage, font, bold, y: 750 }

  draw(ctx, "PINETREE REPORT", { size: 9, bold: true, color: BLUE, lineHeight: 16 })
  draw(ctx, report.title, { size: 22, bold: true, lineHeight: 28 })
  draw(ctx, report.merchant.name, { size: 12, color: MUTED, lineHeight: 18 })
  draw(ctx, `Date Range: ${formatDate(report.startDate)} to ${formatDate(report.endDate)}`, { size: 10, color: MUTED })
  draw(ctx, `Generated: ${formatDateTime(report.generatedAt)}`, { size: 10, color: MUTED })

  section(ctx, "Merchant Info")
  const location = [
    report.merchantSettings.address,
    report.merchantSettings.city,
    report.merchantSettings.state,
    report.merchantSettings.zip,
    report.merchantSettings.country
  ].filter(Boolean).join(", ")
  draw(ctx, `Business: ${report.merchant.name}`)
  draw(ctx, `Email: ${report.merchant.email || "Not provided"}`)
  draw(ctx, `Address: ${location || "Not provided"}`)

  section(ctx, "Financial Summary")
  drawKeyValueGrid(ctx, [
    ["Gross Volume", currency(report.grossVolume)],
    ["Net Settlements", currency(report.netSettlements)],
    ["PineTree Fees", currency(report.pineTreeFees)],
    ["Taxes Collected", currency(report.taxesCollected)],
    ["Transactions", String(report.transactionCount)],
    ["Confirmed", String(report.confirmedCount)],
    ["Failed", String(report.failedCount)],
    ["Incomplete", String(report.incompleteCount)],
    ["Success Rate", `${report.successRate}%`],
    ["Average Transaction", currency(report.avgTransaction)]
  ])

  if (report.reportType === "tax") {
    section(ctx, "Tax Detail")
    drawKeyValueGrid(ctx, [
      ["Tax Name", report.taxSettings.tax_name],
      ["Tax Rate", `${report.taxSettings.tax_rate}%`],
      ["Taxable Sales", currency(report.taxableSales)],
      ["Tax Collected", currency(report.taxesCollected)]
    ])
  }

  drawBreakdown(ctx, "Payment Provider Breakdown", report.providerTotals)
  drawBreakdown(ctx, "Network / Asset Breakdown", {
    ...report.networkTotals,
    ...Object.fromEntries(Object.entries(report.assetTotals).map(([asset, value]) => [`Asset: ${asset}`, value]))
  })
  drawBreakdown(ctx, "Channel Breakdown", report.channelTotals)
  drawLedger(ctx, report)

  ctx.page.drawText("Generated by PineTree Payments", { x: 50, y: 30, size: 9, font: ctx.font, color: MUTED })
  return pdfDoc.save()
}
