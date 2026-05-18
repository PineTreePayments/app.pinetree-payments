import { PDFDocument, PDFPage, StandardFonts, rgb, type PDFFont } from "pdf-lib"
import { readFile } from "fs/promises"
import { join } from "path"
import { generateReportEngine, type ReportInput, type ReportSummary } from "./reports"
import { PDF_RGB } from "@/lib/reporting/reportTheme"

type PdfContext = {
  pdfDoc: PDFDocument
  page: PDFPage
  font: PDFFont
  bold: PDFFont
  y: number
}

// ── Colors from shared report theme ───────────────────────────────────────────
const BLUE  = rgb(...PDF_RGB.brand)
const TEXT  = rgb(...PDF_RGB.text)
const MUTED = rgb(...PDF_RGB.muted)
const LINE  = rgb(...PDF_RGB.line)
const WHITE = rgb(...PDF_RGB.white)

const TILE_BLUE_BG    = rgb(...PDF_RGB.tileBg.blue)
const TILE_GREEN_BG   = rgb(...PDF_RGB.tileBg.green)
const TILE_NEUTRAL_BG = rgb(...PDF_RGB.tileBg.neutral)
const TILE_RED_BG     = rgb(...PDF_RGB.tileBg.red)

const TILE_BLUE_BORDER    = rgb(...PDF_RGB.tileBorder.blue)
const TILE_GREEN_BORDER   = rgb(...PDF_RGB.tileBorder.green)
const TILE_NEUTRAL_BORDER = rgb(...PDF_RGB.tileBorder.neutral)
const TILE_RED_BORDER     = rgb(...PDF_RGB.tileBorder.red)

const TILE_BLUE_LABEL    = rgb(...PDF_RGB.tileLabel.blue)
const TILE_GREEN_LABEL   = rgb(...PDF_RGB.tileLabel.green)
const TILE_NEUTRAL_LABEL = rgb(...PDF_RGB.tileLabel.neutral)
const TILE_RED_LABEL     = rgb(...PDF_RGB.tileLabel.red)

type StatAccent = "blue" | "green" | "neutral" | "red"

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

// ── Dark premium stat tile ────────────────────────────────────────────────────
function drawStatCard(ctx: PdfContext, x: number, width: number, label: string, value: string, accent: StatAccent) {
  const H = 60
  const cardY = ctx.y - H
  const bg = {
    blue: TILE_BLUE_BG, green: TILE_GREEN_BG,
    neutral: TILE_NEUTRAL_BG, red: TILE_RED_BG
  }[accent]
  const border = {
    blue: TILE_BLUE_BORDER, green: TILE_GREEN_BORDER,
    neutral: TILE_NEUTRAL_BORDER, red: TILE_RED_BORDER
  }[accent]
  const lbl = {
    blue: TILE_BLUE_LABEL, green: TILE_GREEN_LABEL,
    neutral: TILE_NEUTRAL_LABEL, red: TILE_RED_LABEL
  }[accent]
  ctx.page.drawRectangle({ x, y: cardY, width, height: H, color: bg, borderColor: border, borderWidth: 1 })
  ctx.page.drawText(label.toUpperCase(), { x: x + 12, y: cardY + H - 19, size: 7, font: ctx.bold, color: lbl })
  ctx.page.drawText(value, { x: x + 12, y: cardY + 13, size: 16, font: ctx.bold, color: WHITE })
}

// 2-column grid of dark stat tiles (left col x=50, right col x=320, each 250 wide)
function drawPremiumSummaryGrid(ctx: PdfContext, items: Array<{ label: string; value: string; accent?: StatAccent }>) {
  const L = 50, R = 320, W = 250, H = 60, GAP = 8
  for (let i = 0; i < items.length; i += 2) {
    ensureSpace(ctx, H + GAP + 10)
    drawStatCard(ctx, L, W, items[i].label, items[i].value, items[i].accent ?? "neutral")
    if (items[i + 1]) {
      drawStatCard(ctx, R, W, items[i + 1].label, items[i + 1].value, items[i + 1].accent ?? "neutral")
    }
    ctx.y -= H + GAP
  }
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

  // ── Branded header bar (page 1 only) ───────────────────────────────────────
  firstPage.drawRectangle({ x: 0, y: 714, width: 620, height: 86, color: BLUE })

  let textX = 50
  try {
    const logoPng = await readFile(join(process.cwd(), "public", "pinetree-web-logo.png"))
    const logo = await pdfDoc.embedPng(logoPng)
    firstPage.drawImage(logo, { x: 50, y: 742, width: 30, height: 30 })
    textX = 90
  } catch {
    // Logo asset unavailable — header text rendered without logo
  }

  firstPage.drawText("PineTree Payments", { x: textX, y: 772, size: 16, font: bold, color: WHITE })
  firstPage.drawText("Financial Reporting", { x: textX, y: 751, size: 9, font, color: rgb(...PDF_RGB.headerSub) })
  ctx.y = 700

  // ── Report title block ─────────────────────────────────────────────────────
  draw(ctx, report.title, { size: 20, bold: true, lineHeight: 28 })
  draw(ctx, report.merchant.name, { size: 11, color: MUTED, lineHeight: 17 })
  draw(ctx, `${formatDate(report.startDate)} – ${formatDate(report.endDate)}`, { size: 10, color: MUTED, lineHeight: 15 })
  draw(ctx, `Generated: ${formatDateTime(report.generatedAt)}`, { size: 9, color: MUTED, lineHeight: 22 })

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

  // ── Financial Summary — dark premium stat tiles ────────────────────────────
  section(ctx, "Financial Summary")
  ctx.y -= 4
  drawPremiumSummaryGrid(ctx, [
    { label: "Gross Volume",    value: currency(report.grossVolume),    accent: "blue" },
    { label: "Net Settlements", value: currency(report.netSettlements), accent: "green" },
    { label: "PineTree Fees",   value: currency(report.pineTreeFees),   accent: "neutral" },
    { label: "Taxes Collected", value: currency(report.taxesCollected), accent: "neutral" },
    { label: "Transactions",    value: String(report.transactionCount), accent: "neutral" },
    { label: "Confirmed",       value: String(report.confirmedCount),   accent: "green" },
    { label: "Failed",          value: String(report.failedCount),      accent: "red" },
    { label: "Incomplete",      value: String(report.incompleteCount),  accent: "neutral" },
    { label: "Success Rate",    value: `${report.successRate}%`,        accent: "green" },
    { label: "Avg Transaction", value: currency(report.avgTransaction), accent: "blue" },
  ])
  ctx.y -= 8

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

  ctx.page.drawText("PineTree Payments  ·  Secure Financial Processing", {
    x: 50, y: 24, size: 8, font: ctx.font, color: MUTED
  })
  return pdfDoc.save()
}
