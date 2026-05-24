import {
  getMerchantPaymentsForReport,
  getMerchantReportContext,
  type MerchantReportContext,
  type MerchantReportPaymentRow
} from "@/database/reports"
import { normalizeReportNetwork, normalizeReportStatus } from "./reportDisplayNormalization"

export type ReportType =
  | "today"
  | "yesterday"
  | "weekly"
  | "month"
  | "tax"
  | "year"
  | "transactions"

export type ReportInput = {
  merchantId: string
  startDate?: string
  endDate?: string
  type?: ReportType | string
}

export type ReportLedgerRow = {
  dateTime: string
  paymentId: string
  reference: string
  provider: string
  network: string
  asset: string
  channel: string
  subtotal: number
  tax: number
  pinetreeFee: number
  gross: number
  netSettlement: number
  status: string
}

export type ReportSummary = {
  reportType: ReportType
  title: string
  startDate: string
  endDate: string
  generatedAt: string
  merchant: MerchantReportContext["merchant"]
  merchantSettings: MerchantReportContext["settings"]
  taxSettings: MerchantReportContext["tax"]
  grossVolume: number
  totalVolume: number
  netSettlements: number
  merchantNet: number
  pineTreeFees: number
  estimatedTax: number
  taxesCollected: number
  taxableSales: number
  transactionCount: number
  confirmedCount: number
  failedCount: number
  incompleteCount: number
  successRate: number
  avgTransaction: number
  failedPayments: number
  providerTotals: Record<string, number>
  channelTotals: Record<string, number>
  networkTotals: Record<string, number>
  assetTotals: Record<string, number>
  transactionsTable: ReportLedgerRow[]
}

const REPORT_LABELS: Record<ReportType, string> = {
  today: "Today's Report",
  yesterday: "Yesterday's Report",
  weekly: "Weekly Report",
  month: "Monthly Report",
  tax: "Tax Report",
  year: "Yearly Summary",
  transactions: "Transaction Export"
}

export function normalizeReportType(type?: string | null): ReportType {
  const normalized = String(type || "month").trim().toLowerCase()
  if (normalized === "today") return "today"
  if (normalized === "yesterday") return "yesterday"
  if (normalized === "weekly" || normalized === "week") return "weekly"
  if (normalized === "tax") return "tax"
  if (normalized === "year" || normalized === "yearly") return "year"
  if (normalized === "transactions" || normalized === "transaction-export" || normalized === "export") return "transactions"
  return "month"
}

export function resolveReportRange(input: { type?: string | null; startDate?: string | null; endDate?: string | null }) {
  if (input.startDate && input.endDate) {
    return {
      startDate: new Date(input.startDate).toISOString(),
      endDate: new Date(input.endDate).toISOString()
    }
  }

  const type = normalizeReportType(input.type)
  const now = new Date()
  const start = new Date(now)
  const end = new Date(now)

  if (type === "today") {
    start.setHours(0, 0, 0, 0)
  } else if (type === "yesterday") {
    start.setDate(start.getDate() - 1)
    start.setHours(0, 0, 0, 0)
    end.setTime(start.getTime())
    end.setHours(23, 59, 59, 999)
  } else if (type === "weekly") {
    start.setDate(start.getDate() - 6)
    start.setHours(0, 0, 0, 0)
  } else if (type === "year") {
    start.setMonth(0, 1)
    start.setHours(0, 0, 0, 0)
  } else {
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
  }

  return {
    startDate: start.toISOString(),
    endDate: end.toISOString()
  }
}

function titleForReport(type: ReportType) {
  return `PineTree ${REPORT_LABELS[type]}`
}

function displayProviderName(provider: string) {
  const normalized = String(provider || "").toLowerCase().trim()
  if (normalized === "lightning" || normalized === "lightning_nwc") return "Bitcoin Lightning"
  if (normalized === "solana") return "Solana Pay"
  if (normalized === "base") return "Base Pay"
  if (normalized === "coinbase") return "Coinbase Business"
  if (normalized === "shift4") return "Shift4"
  if (normalized === "cash") return "Cash"
  return provider || "Unknown"
}


function displayChannelName(channel: string) {
  const normalized = String(channel || "").toLowerCase().trim()
  if (normalized === "pos") return "POS"
  if (normalized === "online") return "Online"
  if (normalized === "api") return "API"
  if (normalized === "invoice") return "Invoice"
  return channel || "Unknown"
}

function centsToDollars(value: number | string | null | undefined) {
  const numeric = Number(value || 0)
  return numeric > 999 ? numeric / 100 : numeric
}

function money(value: number | string | null | undefined) {
  return Number(value || 0)
}

function getMetadataNumber(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key]
  return typeof value === "number" || typeof value === "string" ? Number(value || 0) : 0
}

function getAsset(payment: MerchantReportPaymentRow) {
  const metadata = payment.metadata || {}
  const selectedAsset = String(metadata.selectedAsset || metadata.asset || "").trim().toUpperCase()
  if (selectedAsset) return selectedAsset
  return String(payment.currency || "USD").trim().toUpperCase() || "USD"
}

function primaryTransaction(payment: MerchantReportPaymentRow) {
  return Array.isArray(payment.transactions) && payment.transactions.length > 0
    ? payment.transactions[0]
    : null
}

function addTotal(target: Record<string, number>, key: string, value: number) {
  const normalized = key || "Unknown"
  target[normalized] = (target[normalized] || 0) + value
}

function buildLedgerRow(payment: MerchantReportPaymentRow): ReportLedgerRow {
  const tx = primaryTransaction(payment)
  const metadata = payment.metadata || {}
  const status = normalizeReportStatus(
    String(payment.status || tx?.status || "UNKNOWN"),
    payment.created_at
  )
  const gross = money(payment.gross_amount) || centsToDollars(tx?.total_amount)
  const pinetreeFee = money(payment.pinetree_fee) || centsToDollars(tx?.platform_fee)
  const metadataSubtotal = getMetadataNumber(metadata, "subtotalAmount") || getMetadataNumber(metadata, "merchantAmount")
  const transactionSubtotal = centsToDollars(tx?.subtotal_amount)
  const subtotal = metadataSubtotal || transactionSubtotal || Math.max(0, money(payment.merchant_amount) - getMetadataNumber(metadata, "taxAmount"))
  const metadataTax = getMetadataNumber(metadata, "taxAmount")
  const tax = metadataTax || Math.max(0, money(payment.merchant_amount) - subtotal)
  const rawProvider = String(tx?.provider || payment.provider || "")
  const provider = displayProviderName(rawProvider || "unknown")
  const network = normalizeReportNetwork(tx?.network || payment.network, rawProvider)
  const channel = displayChannelName(String(tx?.channel || metadata.channel || "online"))
  const reference = String(tx?.provider_transaction_id || payment.provider_reference || payment.id)

  return {
    dateTime: payment.created_at,
    paymentId: payment.id,
    reference,
    provider,
    network,
    asset: getAsset(payment),
    channel,
    subtotal,
    tax,
    pinetreeFee,
    gross,
    netSettlement: Math.max(0, gross - pinetreeFee),
    status
  }
}

export async function generateReportEngine(input: ReportInput): Promise<ReportSummary> {
  const reportType = normalizeReportType(input.type)
  const range = resolveReportRange(input)
  const [payments, context] = await Promise.all([
    getMerchantPaymentsForReport({
      merchantId: input.merchantId,
      startDate: range.startDate,
      endDate: range.endDate
    }),
    getMerchantReportContext(input.merchantId)
  ])

  const providerTotals: Record<string, number> = {}
  const channelTotals: Record<string, number> = {}
  const networkTotals: Record<string, number> = {}
  const assetTotals: Record<string, number> = {}
  const transactionsTable = payments.map(buildLedgerRow)

  let grossVolume = 0
  let netSettlements = 0
  let pineTreeFees = 0
  let taxesCollected = 0
  let taxableSales = 0
  let confirmedCount = 0
  let failedCount = 0
  let incompleteCount = 0

  for (const row of transactionsTable) {
    if (row.status === "CONFIRMED") {
      confirmedCount++
      grossVolume += row.gross
      netSettlements += row.netSettlement
      pineTreeFees += row.pinetreeFee
      taxesCollected += row.tax
      taxableSales += row.subtotal
      addTotal(providerTotals, row.provider, row.gross)
      addTotal(channelTotals, row.channel, row.gross)
      addTotal(networkTotals, row.network, row.gross)
      addTotal(assetTotals, row.asset, row.gross)
    } else if (row.status === "FAILED" || row.status === "EXPIRED") {
      failedCount++
    } else if (row.status === "INCOMPLETE" || row.status === "CANCELED" || row.status === "CANCELLED") {
      incompleteCount++
    }
  }

  const transactionCount = transactionsTable.length
  const successRate = transactionCount > 0 ? Math.round((confirmedCount / transactionCount) * 100) : 0

  return {
    reportType,
    title: titleForReport(reportType),
    startDate: range.startDate,
    endDate: range.endDate,
    generatedAt: new Date().toISOString(),
    merchant: context.merchant,
    merchantSettings: context.settings,
    taxSettings: context.tax,
    grossVolume,
    totalVolume: grossVolume,
    netSettlements,
    merchantNet: netSettlements,
    pineTreeFees,
    estimatedTax: taxesCollected,
    taxesCollected,
    taxableSales,
    transactionCount,
    confirmedCount,
    failedCount,
    incompleteCount,
    successRate,
    avgTransaction: confirmedCount > 0 ? grossVolume / confirmedCount : 0,
    failedPayments: failedCount,
    providerTotals,
    channelTotals,
    networkTotals,
    assetTotals,
    transactionsTable
  }
}

function csvValue(value: string | number) {
  const raw = String(value)
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw
}

export function generateReportCsv(report: ReportSummary) {
  const headers = [
    "date_time",
    "payment_id",
    "reference",
    "provider",
    "network",
    "asset_currency",
    "channel",
    "subtotal",
    "tax",
    "pinetree_fee",
    "gross_total",
    "net_settlement",
    "status"
  ]

  const rows = report.transactionsTable.map((row) => [
    row.dateTime,
    row.paymentId,
    row.reference,
    row.provider,
    row.network,
    row.asset,
    row.channel,
    row.subtotal.toFixed(2),
    row.tax.toFixed(2),
    row.pinetreeFee.toFixed(2),
    row.gross.toFixed(2),
    row.netSettlement.toFixed(2),
    row.status
  ])

  return [
    headers.join(","),
    ...rows.map((row) => row.map(csvValue).join(","))
  ].join("\n")
}

function slugDate(value: string) {
  return value.slice(0, 10)
}

export function getReportFilename(report: ReportSummary, format: "pdf" | "csv") {
  const start = slugDate(report.startDate)
  const end = slugDate(report.endDate)
  const extension = format === "csv" ? "csv" : "pdf"

  if (report.reportType === "today") return `pinetree-todays-report-${start}.${extension}`
  if (report.reportType === "yesterday") return `pinetree-yesterdays-report-${start}.${extension}`
  if (report.reportType === "weekly") return `pinetree-weekly-report-${start}_to_${end}.${extension}`
  if (report.reportType === "tax") return `pinetree-tax-report-${start}_to_${end}.${extension}`
  if (report.reportType === "year") return `pinetree-yearly-summary-${start}_to_${end}.${extension}`
  if (report.reportType === "transactions") return `pinetree-transaction-export-${start}_to_${end}.${extension}`
  return `pinetree-monthly-report-${start}_to_${end}.${extension}`
}
