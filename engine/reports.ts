import {
  getMerchantReportContext,
  type MerchantReportContext
} from "@/database/reports"
import { normalizeReportProvider } from "./reportDisplayNormalization"
import {
  getAllCanonicalTransactions,
  type CanonicalTransaction,
  type CanonicalTransactionAdjustmentStatus,
  type CanonicalTransactionRail
} from "./canonicalTransactions"
import {
  formatInMerchantTimeZone,
  resolveMerchantReportRange,
  type ReportPeriodType
} from "./reportPeriods"

export type ReportType =
  | "today"
  | "yesterday"
  | "weekly"
  | "month"
  | "tax"
  | "year"
  | "transactions"
  | "custom"
  | "end_of_day"

export type ReportInput = {
  merchantId: string
  startDate?: string
  endDate?: string
  type?: ReportType | string
  status?: string
}

export type ReportLedgerRow = {
  dateTime: string
  paymentId: string
  attemptId: string | null
  reference: string
  providerReference: string | null
  transactionHash: string | null
  provider: string
  rail: CanonicalTransactionRail
  network: string
  asset: string
  currency: string
  channel: string
  amountMinor: number
  displayAmount: string
  subtotal: number
  tax: number
  pinetreeFee: number
  gross: number
  netSettlement: number
  status: string
  canonicalStatus: string
  occurredAt: string
  createdAt: string
  confirmedAt: string | null
  source: string
  adjustmentStatus: CanonicalTransactionAdjustmentStatus
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
  waitingCount: number
  processingCount: number
  expiredCount: number
  canceledCount: number
  refundedCount: number
  refundedAmount: number
  statusCounts: Record<string, number>
  successRate: number
  avgTransaction: number
  failedPayments: number
  providerTotals: Record<string, number>
  railTotals: Record<string, number>
  channelTotals: Record<string, number>
  networkTotals: Record<string, number>
  assetTotals: Record<string, number>
  cardVolume: number
  cryptoVolume: number
  cashVolume: number
  timeZone: string
  isInProgress: boolean
  reconciliation: {
    providerMatchesGross: boolean
    railMatchesGross: boolean
    assetMatchesCrypto: boolean
    variance: number
  }
  transactionsTable: ReportLedgerRow[]
}

const REPORT_LABELS: Record<ReportType, string> = {
  today: "Today's Report",
  yesterday: "Yesterday's Report",
  weekly: "Weekly Report",
  month: "Monthly Report",
  tax: "Tax Report",
  year: "Yearly Summary",
  transactions: "Transaction Export",
  custom: "Custom Report",
  end_of_day: "End of Day Report"
}

export function normalizeReportType(type?: string | null): ReportType {
  const normalized = String(type || "month").trim().toLowerCase()
  if (normalized === "today" || normalized === "daily") return "today"
  if (normalized === "end-of-day" || normalized === "end_of_day" || normalized === "eod") return "end_of_day"
  if (normalized === "yesterday") return "yesterday"
  if (normalized === "weekly" || normalized === "week") return "weekly"
  if (normalized === "tax") return "tax"
  if (normalized === "year" || normalized === "yearly") return "year"
  if (normalized === "transactions" || normalized === "transaction-export" || normalized === "export") return "transactions"
  if (normalized === "custom") return "custom"
  return "month"
}

export function resolveReportRange(input: {
  type?: string | null
  startDate?: string | null
  endDate?: string | null
  timeZone?: string | null
  now?: Date
}) {
  return resolveMerchantReportRange({
    type: normalizeReportType(input.type) as ReportPeriodType,
    startDate: input.startDate,
    endDate: input.endDate,
    timeZone: input.timeZone,
    now: input.now,
  })
}

function titleForReport(type: ReportType) {
  return `PineTree ${REPORT_LABELS[type]}`
}

function displayChannelName(channel: string) {
  const normalized = String(channel || "").toLowerCase().trim()
  if (normalized === "pos") return "POS"
  if (normalized === "online") return "Online"
  if (normalized === "api") return "API"
  if (normalized === "invoice") return "Invoice"
  return channel || "Unknown"
}

const MONEY_SCALE = 100

function toMinorUnits(value: number): number {
  return Math.round(value * MONEY_SCALE)
}

function fromMinorUnits(value: number): number {
  return value / MONEY_SCALE
}

function getMetadataMinor(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key]
  if (typeof value !== "number" && typeof value !== "string") return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? toMinorUnits(numeric) : null
}

function addMinorTotal(target: Record<string, number>, key: string, value: number) {
  const normalized = key || "Unknown"
  target[normalized] = (target[normalized] || 0) + value
}

function minorTotalsToMoney(target: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(target).map(([key, value]) => [key, fromMinorUnits(value)])
  )
}

function reportRailGroup(rail: CanonicalTransactionRail): "Card" | "Crypto" | "Cash" | "Other" {
  if (rail === "Card" || rail === "Cash") return rail
  if (["Base", "Solana", "Ethereum", "Bitcoin Lightning", "Crypto"].includes(rail)) return "Crypto"
  return "Other"
}

/**
 * Report projection is intentionally an adapter over the shared canonical
 * transaction row. It never reads a second status field or replays events.
 */
export function buildReportLedgerRow(payment: CanonicalTransaction): ReportLedgerRow {
  const merchantAmountMinor = payment.merchantAmountMinor ?? payment.amountMinor
  const metadataTaxMinor = getMetadataMinor(payment.metadata, "taxAmount")
  const metadataSubtotalMinor =
    getMetadataMinor(payment.metadata, "subtotalAmount") ??
    getMetadataMinor(payment.metadata, "merchantAmount")
  const subtotalMinor = metadataSubtotalMinor ?? payment.subtotalAmountMinor ?? Math.max(
    0,
    merchantAmountMinor - (metadataTaxMinor ?? 0)
  )
  const taxMinor = metadataTaxMinor ?? Math.max(0, merchantAmountMinor - subtotalMinor)
  const grossMinor = payment.grossAmountMinor ?? payment.transactionAmountMinor ?? payment.amountMinor
  const feeMinor = payment.feeAmountMinor ?? 0
  const reference = payment.providerReference || payment.transactionHash || payment.paymentId

  return {
    dateTime: payment.occurredAt,
    paymentId: payment.paymentId,
    attemptId: payment.attemptId,
    reference,
    providerReference: payment.providerReference,
    transactionHash: payment.transactionHash,
    provider: normalizeReportProvider(payment.provider),
    rail: payment.rail,
    network: payment.network,
    asset: payment.asset,
    currency: payment.currency,
    channel: displayChannelName(payment.channel || "online"),
    amountMinor: payment.amountMinor,
    displayAmount: payment.displayAmount,
    subtotal: fromMinorUnits(subtotalMinor),
    tax: fromMinorUnits(taxMinor),
    pinetreeFee: fromMinorUnits(feeMinor),
    gross: fromMinorUnits(grossMinor),
    netSettlement: fromMinorUnits(Math.max(0, grossMinor - feeMinor)),
    status: payment.displayStatus,
    canonicalStatus: payment.canonicalStatus,
    occurredAt: payment.occurredAt,
    createdAt: payment.createdAt,
    confirmedAt: payment.confirmedAt,
    source: payment.source,
    adjustmentStatus: payment.adjustmentStatus,
  }
}

function matchesReportStatus(row: ReportLedgerRow, rawFilter: string | null | undefined) {
  const filter = String(rawFilter || "").trim().toUpperCase().replace(/[-\s]+/g, "_")
  if (!filter) return true
  if (filter === "REFUNDED" || filter === "DISPUTED") return row.adjustmentStatus === filter
  if (filter === "WAITING") return row.canonicalStatus === "CREATED" || row.canonicalStatus === "PENDING"
  return row.canonicalStatus === (filter === "CANCELLED" ? "CANCELED" : filter)
}

export async function generateReportEngine(input: ReportInput): Promise<ReportSummary> {
  const reportType = normalizeReportType(input.type)
  const context = await getMerchantReportContext(input.merchantId)
  const range = resolveReportRange({ ...input, timeZone: context.settings.timezone })
  const payments = await getAllCanonicalTransactions({
    scope: { type: "merchant", merchantId: input.merchantId },
    startDate: range.startDate,
    endDate: range.endDate
  })

  const providerTotalsMinor: Record<string, number> = {}
  const channelTotalsMinor: Record<string, number> = {}
  const railTotalsMinor: Record<string, number> = {}
  const networkTotalsMinor: Record<string, number> = {}
  const assetTotalsMinor: Record<string, number> = {}
  const transactionsTable = payments
    .map(buildReportLedgerRow)
    .filter((row) => matchesReportStatus(row, input.status))

  let grossVolumeMinor = 0
  let netSettlementsMinor = 0
  let pineTreeFeesMinor = 0
  let taxesCollectedMinor = 0
  let taxableSalesMinor = 0
  let confirmedCount = 0
  let failedCount = 0
  let waitingCount = 0
  let processingCount = 0
  let expiredCount = 0
  let canceledCount = 0
  let incompleteCount = 0
  let refundedCount = 0
  let refundedAmountMinor = 0
  const statusCounts: Record<string, number> = {}

  for (const row of transactionsTable) {
    statusCounts[row.status] = (statusCounts[row.status] || 0) + 1
    if (row.adjustmentStatus === "REFUNDED") {
      refundedCount++
      refundedAmountMinor += toMinorUnits(row.gross)
    }
    if (row.status === "Confirmed") {
      confirmedCount++
      const grossMinor = toMinorUnits(row.gross)
      grossVolumeMinor += grossMinor
      netSettlementsMinor += toMinorUnits(row.netSettlement)
      pineTreeFeesMinor += toMinorUnits(row.pinetreeFee)
      taxesCollectedMinor += toMinorUnits(row.tax)
      taxableSalesMinor += toMinorUnits(row.subtotal)
      addMinorTotal(providerTotalsMinor, row.provider, grossMinor)
      addMinorTotal(channelTotalsMinor, row.channel, grossMinor)
      addMinorTotal(railTotalsMinor, reportRailGroup(row.rail), grossMinor)
      addMinorTotal(networkTotalsMinor, row.network, grossMinor)
      if (reportRailGroup(row.rail) === "Crypto") addMinorTotal(assetTotalsMinor, row.asset, grossMinor)
    } else if (row.status === "Failed") {
      failedCount++
    } else if (row.status === "Waiting") {
      waitingCount++
    } else if (row.status === "Processing") {
      processingCount++
    } else if (row.canonicalStatus === "INCOMPLETE") {
      incompleteCount++
    } else if (row.status === "Expired") {
      expiredCount++
    } else if (row.status === "Canceled") {
      canceledCount++
    } else {
      throw new Error(`Invalid canonical report status: ${row.status}`)
    }
  }

  const transactionCount = transactionsTable.length
  const successRate = transactionCount > 0 ? Math.round((confirmedCount / transactionCount) * 100) : 0
  const totalOf = (values: Record<string, number>) => Object.values(values).reduce((sum, value) => sum + value, 0)
  const providerVarianceMinor = Math.abs(totalOf(providerTotalsMinor) - grossVolumeMinor)
  const railVarianceMinor = Math.abs(totalOf(railTotalsMinor) - grossVolumeMinor)
  const cryptoVolumeMinor = railTotalsMinor.Crypto || 0
  const assetVarianceMinor = Math.abs(totalOf(assetTotalsMinor) - cryptoVolumeMinor)
  const providerTotals = minorTotalsToMoney(providerTotalsMinor)
  const channelTotals = minorTotalsToMoney(channelTotalsMinor)
  const railTotals = minorTotalsToMoney(railTotalsMinor)
  const networkTotals = minorTotalsToMoney(networkTotalsMinor)
  const assetTotals = minorTotalsToMoney(assetTotalsMinor)
  const grossVolume = fromMinorUnits(grossVolumeMinor)
  const netSettlements = fromMinorUnits(netSettlementsMinor)
  const pineTreeFees = fromMinorUnits(pineTreeFeesMinor)
  const taxesCollected = fromMinorUnits(taxesCollectedMinor)
  const taxableSales = fromMinorUnits(taxableSalesMinor)

  return {
    reportType,
    title: titleForReport(reportType),
    startDate: range.startDate,
    endDate: range.endDate,
    timeZone: range.timeZone,
    isInProgress: range.isInProgress,
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
    waitingCount,
    processingCount,
    expiredCount,
    canceledCount,
    refundedCount,
    refundedAmount: fromMinorUnits(refundedAmountMinor),
    statusCounts,
    successRate,
    avgTransaction: confirmedCount > 0
      ? fromMinorUnits(Math.round(grossVolumeMinor / confirmedCount))
      : 0,
    failedPayments: failedCount,
    providerTotals,
    railTotals,
    channelTotals,
    networkTotals,
    assetTotals,
    cardVolume: railTotals.Card || 0,
    cryptoVolume: railTotals.Crypto || 0,
    cashVolume: railTotals.Cash || 0,
    reconciliation: {
      providerMatchesGross: providerVarianceMinor === 0,
      railMatchesGross: railVarianceMinor === 0,
      assetMatchesCrypto: assetVarianceMinor === 0,
      variance: fromMinorUnits(Math.max(providerVarianceMinor, railVarianceMinor, assetVarianceMinor)),
    },
    transactionsTable
  }
}

function csvValue(value: string | number, protectFormula = true) {
  let raw = String(value)
  if (protectFormula && /^[\t\r ]*[=+\-@]/.test(raw)) raw = `'${raw}`
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw
}

export function generateReportCsv(report: ReportSummary) {
  const headers = [
    "date_time",
    "payment_id",
    "attempt_id",
    "provider_reference",
    "transaction_hash",
    "provider",
    "rail",
    "network",
    "asset",
    "currency",
    "channel",
    "subtotal",
    "tax",
    "pinetree_fee",
    "gross_total",
    "net_settlement",
    "canonical_status",
    "display_status",
    "adjustment_status",
    "source"
  ]

  const rows = report.transactionsTable.map((row) => [
    formatInMerchantTimeZone(row.dateTime, report.timeZone),
    row.paymentId,
    row.attemptId || "",
    row.providerReference || "",
    row.transactionHash || "",
    row.provider,
    row.rail,
    row.network,
    row.asset,
    row.currency,
    row.channel,
    row.subtotal,
    row.tax,
    row.pinetreeFee,
    row.gross,
    row.netSettlement,
    row.canonicalStatus,
    row.status,
    row.adjustmentStatus || "",
    row.source,
  ])

  const numericColumns = new Set([
    "subtotal",
    "tax",
    "pinetree_fee",
    "gross_total",
    "net_settlement",
  ])

  return [
    headers.join(","),
    ...rows.map((row) => row.map((value, index) => {
      const numericColumn = numericColumns.has(headers[index])
      return csvValue(numericColumn && typeof value === "number" ? value.toFixed(2) : value, !numericColumn)
    }).join(","))
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
  if (report.reportType === "end_of_day") return `pinetree-end-of-day-${start}.${extension}`
  if (report.reportType === "custom") return `pinetree-custom-report-${start}_to_${end}.${extension}`
  return `pinetree-monthly-report-${start}_to_${end}.${extension}`
}
