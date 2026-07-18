import {
  getMerchantPaymentsForReport,
  getMerchantReportContext,
  type MerchantReportContext,
  type MerchantReportPaymentRow
} from "@/database/reports"
import {
  normalizeReportAsset,
  normalizeReportNetwork,
  normalizeReportProvider,
  normalizeReportStatus
} from "./reportDisplayNormalization"
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
  reference: string
  provider: string
  rail: "Card" | "Crypto" | "Cash" | "Other"
  network: string
  asset: string
  channel: string
  subtotal: number
  tax: number
  pinetreeFee: number
  gross: number
  netSettlement: number
  status: string
  canonicalStatus: string
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
  unknownCount: number
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

function transactionCentsToDollars(value: number | string | null | undefined) {
  const numeric = Number(value || 0)
  return Number.isFinite(numeric) ? fromMinorUnits(Math.round(numeric)) : 0
}

function money(value: number | string | null | undefined) {
  const numeric = Number(value || 0)
  return Number.isFinite(numeric) ? fromMinorUnits(toMinorUnits(numeric)) : 0
}

const MONEY_SCALE = 100

function toMinorUnits(value: number): number {
  return Math.round(value * MONEY_SCALE)
}

function fromMinorUnits(value: number): number {
  return value / MONEY_SCALE
}

function getMetadataNumber(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key]
  return typeof value === "number" || typeof value === "string" ? Number(value || 0) : 0
}

function getRawAsset(payment: MerchantReportPaymentRow) {
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

function addMinorTotal(target: Record<string, number>, key: string, value: number) {
  const normalized = key || "Unknown"
  target[normalized] = (target[normalized] || 0) + value
}

function minorTotalsToMoney(target: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(target).map(([key, value]) => [key, fromMinorUnits(value)])
  )
}

function resolveRail(provider: string, network: string, channel: string): ReportLedgerRow["rail"] {
  const normalizedProvider = provider.toLowerCase()
  if (normalizedProvider === "cash" || network === "Cash" || channel === "Cash") return "Cash"
  if (["stripe", "shift4", "fluidpay"].some((value) => normalizedProvider.includes(value))) return "Card"
  if (["Solana", "Base", "Ethereum", "Bitcoin Lightning"].includes(network)) return "Crypto"
  return "Other"
}

function buildLedgerRow(payment: MerchantReportPaymentRow): ReportLedgerRow {
  const tx = primaryTransaction(payment)
  const metadata = payment.metadata || {}
  const transactionStatus = String(tx?.status || "").trim().toUpperCase()
  const hasRefundedTransaction = Array.isArray(payment.transactions) && payment.transactions.some(
    (transaction) => String(transaction.status || "").trim().toUpperCase() === "REFUNDED"
  )
  const statusCode = hasRefundedTransaction || transactionStatus === "REFUNDED"
    ? "REFUNDED"
    : String(payment.status || tx?.status || "PENDING").trim().toUpperCase()
  const status = normalizeReportStatus(statusCode, payment.created_at)
  // A recorded zero is authoritative (for example, a waived historical fee).
  // Fall back to the transaction only when the payment column is absent.
  const gross = payment.gross_amount == null
    ? transactionCentsToDollars(tx?.total_amount)
    : money(payment.gross_amount)
  const pinetreeFee = payment.pinetree_fee == null
    ? transactionCentsToDollars(tx?.platform_fee)
    : money(payment.pinetree_fee)
  const metadataSubtotal = getMetadataNumber(metadata, "subtotalAmount") || getMetadataNumber(metadata, "merchantAmount")
  const transactionSubtotal = transactionCentsToDollars(tx?.subtotal_amount)
  const subtotal = money(metadataSubtotal || transactionSubtotal || Math.max(0, money(payment.merchant_amount) - getMetadataNumber(metadata, "taxAmount")))
  const metadataTax = getMetadataNumber(metadata, "taxAmount")
  const tax = money(metadataTax || Math.max(0, money(payment.merchant_amount) - subtotal))
  const rawProvider = String(tx?.provider || payment.provider || "")
  const rawNetwork = tx?.network || payment.network
  const provider = normalizeReportProvider(rawProvider || "unknown")
  const network = normalizeReportNetwork(rawNetwork, rawProvider)
  const asset = normalizeReportAsset(getRawAsset(payment), rawNetwork, rawProvider, payment.currency)
  const channel = displayChannelName(String(tx?.channel || metadata.channel || "online"))
  const rail = resolveRail(provider, network, channel)
  const reference = String(tx?.provider_transaction_id || payment.provider_reference || payment.id)

  return {
    dateTime: payment.created_at,
    paymentId: payment.id,
    reference,
    provider,
    rail,
    network,
    asset,
    channel,
    subtotal,
    tax,
    pinetreeFee,
    gross,
    netSettlement: money(Math.max(0, gross - pinetreeFee)),
    status,
    canonicalStatus: statusCode
  }
}

export async function generateReportEngine(input: ReportInput): Promise<ReportSummary> {
  const reportType = normalizeReportType(input.type)
  const context = await getMerchantReportContext(input.merchantId)
  const range = resolveReportRange({ ...input, timeZone: context.settings.timezone })
  const payments = await getMerchantPaymentsForReport({
    merchantId: input.merchantId,
    startDate: range.startDate,
    endDate: range.endDate
  })

  const providerTotalsMinor: Record<string, number> = {}
  const channelTotalsMinor: Record<string, number> = {}
  const railTotalsMinor: Record<string, number> = {}
  const networkTotalsMinor: Record<string, number> = {}
  const assetTotalsMinor: Record<string, number> = {}
  const statusFilter = input.status
    ? normalizeReportStatus(input.status, "")
    : null
  const transactionsTable = payments
    .map(buildLedgerRow)
    .filter((row) => !statusFilter || row.status === statusFilter)

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
  let unknownCount = 0
  let refundedAmountMinor = 0
  const statusCounts: Record<string, number> = {}

  for (const row of transactionsTable) {
    statusCounts[row.status] = (statusCounts[row.status] || 0) + 1
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
      addMinorTotal(railTotalsMinor, row.rail, grossMinor)
      addMinorTotal(networkTotalsMinor, row.network, grossMinor)
      addMinorTotal(assetTotalsMinor, row.asset, grossMinor)
    } else if (row.status === "Failed") {
      failedCount++
    } else if (row.status === "Waiting") {
      waitingCount++
    } else if (row.status === "Processing") {
      processingCount++
    } else if (row.canonicalStatus === "INCOMPLETE") {
      incompleteCount++
      // The merchant-facing status label is currently "Canceled" for the
      // canonical INCOMPLETE state, but reporting keeps the lifecycle bucket
      // explicit for financial metrics while retaining the existing display
      // bucket for backward-compatible dashboards.
      canceledCount++
    } else if (row.status === "Expired") {
      expiredCount++
    } else if (row.status === "Canceled") {
      canceledCount++
    } else if (row.status === "Refunded") {
      refundedCount++
      refundedAmountMinor += toMinorUnits(row.gross)
    } else {
      unknownCount++
    }
  }

  const transactionCount = transactionsTable.length
  const successRate = transactionCount > 0 ? Math.round((confirmedCount / transactionCount) * 100) : 0
  const totalOf = (values: Record<string, number>) => Object.values(values).reduce((sum, value) => sum + value, 0)
  const providerVarianceMinor = Math.abs(totalOf(providerTotalsMinor) - grossVolumeMinor)
  const railVarianceMinor = Math.abs(totalOf(railTotalsMinor) - grossVolumeMinor)
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
    unknownCount,
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
      variance: fromMinorUnits(Math.max(providerVarianceMinor, railVarianceMinor)),
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
    "reference",
    "provider",
    "rail",
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
    formatInMerchantTimeZone(row.dateTime, report.timeZone),
    row.paymentId,
    row.reference,
    row.provider,
    row.rail,
    row.network,
    row.asset,
    row.channel,
    row.subtotal,
    row.tax,
    row.pinetreeFee,
    row.gross,
    row.netSettlement,
    row.status
  ])

  return [
    headers.join(","),
    ...rows.map((row) => row.map((value, index) => {
      const numericColumn = index >= 8 && index <= 12
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
