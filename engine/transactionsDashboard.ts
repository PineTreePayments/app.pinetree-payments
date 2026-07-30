import { supabaseAdmin, supabase } from "@/database"
import {
  getAllCanonicalTransactions,
  getCanonicalTransactionPage,
  type CanonicalTransaction,
} from "@/engine/canonicalTransactions"
import { getPaymentAssetDisplay } from "@/lib/paymentAssetDisplay"
import { normalizeTimeZone, resolveMerchantReportRange } from "@/engine/reportPeriods"
import type { TransactionLifecycleEvent } from "@/lib/transactionDisplay"

const db = supabaseAdmin || supabase

export type NormalizedTransactionEvent = {
  type: string
  status: string
  occurredAt: string | null
  message: string
}

export type MerchantTransactionAssetDetails = {
  amountPaidLabel: string | null
  rateLabel: string | null
  lightningInvoice: string | null
}

/**
 * Explicit merchant response DTO. Keep this list intentionally narrow: the
 * canonical engine model also contains internal metadata, raw values,
 * diagnostics, provider event ids, and every transaction attempt. None of
 * those fields belongs in an ordinary `payments:read` response.
 */
export type MerchantTransactionReadRow = {
  paymentId: string
  attemptId: string | null
  providerReference: string | null
  transactionHash: string | null
  rail: CanonicalTransaction["rail"]
  network: string
  asset: string
  currency: string
  amountMinor: number
  displayAmount: string
  canonicalStatus: CanonicalTransaction["canonicalStatus"]
  displayStatus: string
  occurredAt: string
  provider: string
  channel: string | null
  assetPaymentDetails: MerchantTransactionAssetDetails
  lifecycle_events: NormalizedTransactionEvent[]
}

export type TransactionsChartRow = {
  time: string
  solana: number
  base: number
  lightning: number
  coinbase: number
  shift4: number
  cash: number
}

export type TransactionsDashboardData = {
  transactions: MerchantTransactionReadRow[]
  todayVolume: number
  todayTransactions: number
  confirmedRate: number
  timeZone: string
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export type TransactionsDashboardFilters = {
  provider?: string | null
  network?: string | null
  channel?: string | null
  status?: string | null
  rail?: string | null
  asset?: string | null
  currency?: string | null
  source?: string | null
  method?: string | null
  startDate?: string | null
  endDate?: string | null
  timeFilter?: "last_hour" | "last_24_hours" | "last_7_days" | "last_30_days" | "this_month" | "all" | null
  page?: number
  pageSize?: number
}

export function resolveTransactionsTimeFilter(
  value: TransactionsDashboardFilters["timeFilter"],
  timeZone: string,
  now = new Date()
): { startDate?: string; endDate?: string } {
  if (!value || value === "all") return {}
  if (value === "this_month") {
    const range = resolveMerchantReportRange({ type: "month", timeZone, now })
    return { startDate: range.startDate, endDate: range.endDate }
  }
  const durationMs: Record<Exclude<NonNullable<TransactionsDashboardFilters["timeFilter"]>, "this_month" | "all">, number> = {
    last_hour: 60 * 60 * 1_000,
    last_24_hours: 24 * 60 * 60 * 1_000,
    last_7_days: 7 * 24 * 60 * 60 * 1_000,
    last_30_days: 30 * 24 * 60 * 60 * 1_000,
  }
  const duration = durationMs[value]
  return {
    startDate: new Date(now.getTime() - duration).toISOString(),
    endDate: now.toISOString(),
  }
}

export function normalizeTransactionEvent(event: TransactionLifecycleEvent): NormalizedTransactionEvent {
  const type = String(event.event_type || "payment.created").trim().toLowerCase()
  const suffix = type.split(".").pop()?.toUpperCase() || "CREATED"
  const status = suffix === "CANCELLED" ? "CANCELED" : suffix
  const messages: Record<string, string> = {
    CREATED: "Payment request created.",
    PENDING: "Payment is waiting for customer action.",
    PROCESSING: "Payment is processing.",
    CONFIRMED: "Payment confirmed.",
    FAILED: "Payment failed.",
    INCOMPLETE: "Payment was not completed.",
    CANCELED: "Payment canceled before completion.",
    EXPIRED: "Payment request expired.",
    REFUNDED: "Payment refunded.",
    DISPUTED: "Payment disputed.",
  }
  return {
    type,
    status,
    occurredAt: event.created_at || null,
    message: messages[status] || "Payment state updated.",
  }
}

export function isTerminalTransactionEvent(event: NormalizedTransactionEvent): boolean {
  return ["CONFIRMED", "FAILED", "INCOMPLETE", "CANCELED", "EXPIRED", "REFUNDED"].includes(event.status)
}

/**
 * Retained for callers/tests that handle raw PostgREST range results. The
 * canonical page loader now owns this database detail for the merchant list.
 */
export function isTransactionsEmptyPageResult(result: {
  status?: number
  error?: unknown
}): boolean {
  if (result.status === 416) return true
  return Boolean(
    result.error && typeof result.error === "object" && "code" in result.error &&
    String((result.error as { code?: unknown }).code || "") === "PGRST103"
  )
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized && normalized.length <= maxLength ? normalized : null
}

function merchantAssetPaymentDetails(
  transaction: CanonicalTransaction
): MerchantTransactionAssetDetails {
  const display = getPaymentAssetDisplay(
    transaction.network,
    transaction.metadata,
    transaction.amountMinor / 100
  )
  const split = record(record(transaction.metadata)?.split)

  return {
    amountPaidLabel: display.amountPaidLabel,
    rateLabel: display.rateLabel,
    // A BOLT11 invoice is already customer-visible payment evidence, but it
    // is copied explicitly and bounded rather than exposing the split object.
    lightningInvoice: boundedText(split?.lightningInvoice, 4_096),
  }
}

/**
 * Surface adapter for merchant-visible fields. Never spread the canonical
 * object here: new internal fields must remain private until deliberately
 * reviewed and added to this DTO.
 */
export function toMerchantTransactionReadRow(
  transaction: CanonicalTransaction
): MerchantTransactionReadRow {
  return {
    paymentId: transaction.paymentId,
    attemptId: transaction.attemptId,
    providerReference: transaction.providerReference,
    transactionHash: transaction.transactionHash,
    rail: transaction.rail,
    network: transaction.network,
    asset: transaction.asset,
    currency: transaction.currency,
    amountMinor: transaction.amountMinor,
    displayAmount: transaction.displayAmount,
    canonicalStatus: transaction.canonicalStatus,
    displayStatus: transaction.displayStatus,
    occurredAt: transaction.occurredAt,
    provider: transaction.provider,
    channel: transaction.channel,
    assetPaymentDetails: merchantAssetPaymentDetails(transaction),
    lifecycle_events: transaction.lifecycleEvents.map((event) => normalizeTransactionEvent({
      event_type: event.type,
      created_at: event.occurredAt || undefined,
    })),
  }
}

export function summarizeCanonicalTransactionActivity(rows: readonly CanonicalTransaction[]) {
  const confirmed = rows.filter((row) => row.canonicalStatus === "CONFIRMED")
  return {
    volume: confirmed.reduce((sum, row) => sum + row.amountMinor / 100, 0),
    transactionCount: rows.length,
    confirmedCount: confirmed.length,
    confirmedRate: rows.length > 0 ? Math.round((confirmed.length / rows.length) * 100) : 0,
  }
}

async function getMerchantTimeZone(merchantId: string): Promise<string> {
  const { data, error } = await db
    .from("merchant_settings")
    .select("timezone")
    .eq("merchant_id", merchantId)
    .maybeSingle()

  if (error) throw new Error(`Failed to load merchant timezone: ${error.message}`)
  return normalizeTimeZone(data?.timezone)
}

export async function getTransactionsDashboardEngine(
  merchantId: string,
  filters: TransactionsDashboardFilters = {}
): Promise<TransactionsDashboardData> {
  const pageSize = Math.min(100, Math.max(1, Math.trunc(filters.pageSize || 50)))
  const page = Math.max(1, Math.trunc(filters.page || 1))
  const scope = { type: "merchant" as const, merchantId }
  const timeZone = await getMerchantTimeZone(merchantId)
  const todayRange = resolveMerchantReportRange({ type: "today", timeZone })
  const semanticRange = resolveTransactionsTimeFilter(filters.timeFilter, timeZone)
  const startDate = semanticRange.startDate || filters.startDate
  const endDate = semanticRange.endDate || filters.endDate

  const [canonicalPage, todayRows] = await Promise.all([
    getCanonicalTransactionPage({
      scope,
      provider: filters.provider,
      network: filters.network,
      channel: filters.channel,
      status: filters.status,
      rail: filters.rail,
      asset: filters.asset,
      currency: filters.currency,
      source: filters.source,
      method: filters.method,
      startDate,
      endDate,
      page,
      pageSize,
    }),
    getAllCanonicalTransactions({
      scope,
      startDate: todayRange.startDate,
      endDate: todayRange.endDate,
    }),
  ])

  const today = summarizeCanonicalTransactionActivity(todayRows)
  return {
    transactions: canonicalPage.rows.map(toMerchantTransactionReadRow),
    todayVolume: today.volume,
    todayTransactions: today.transactionCount,
    confirmedRate: today.confirmedRate,
    timeZone,
    pagination: {
      page: canonicalPage.page,
      pageSize: canonicalPage.pageSize,
      total: canonicalPage.totalCount,
      totalPages: canonicalPage.totalPages,
    },
  }
}

type TransactionsChartProviderKey = Exclude<keyof TransactionsChartRow, "time">

function bucket(label: string): TransactionsChartRow {
  return {
    time: label,
    solana: 0,
    base: 0,
    lightning: 0,
    coinbase: 0,
    shift4: 0,
    cash: 0,
  }
}

function chartLabel(date: Date, range: string, timeZone: string): string {
  if (range === "24h") {
    const hour = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hourCycle: "h23",
    }).format(date)
    return `${Number(hour)}:00`
  }
  if (range === "1y") {
    return new Intl.DateTimeFormat("en-US", { timeZone, month: "short" }).format(date)
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(date)
}

function buildBuckets(range: string, timeZone: string, now = new Date()) {
  const buckets: Record<string, TransactionsChartRow> = {}
  let start = new Date(now)

  if (range === "24h") {
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 60 * 60 * 1_000)
      const label = chartLabel(d, range, timeZone)
      buckets[label] = bucket(label)
    }
    start = new Date(now.getTime() - 24 * 60 * 60 * 1_000)
  }

  const dayCounts: Record<string, number> = { "7d": 7, "1m": 30, "3m": 90, "6m": 180 }
  const dayCount = dayCounts[range]
  if (dayCount) {
    for (let i = dayCount - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1_000)
      const label = chartLabel(d, range, timeZone)
      buckets[label] = bucket(label)
    }
    start = new Date(now.getTime() - dayCount * 24 * 60 * 60 * 1_000)
  }

  if (range === "1y") {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 15, 12))
      const label = chartLabel(d, range, timeZone)
      buckets[label] = bucket(label)
    }
    start = new Date(now.getTime() - 366 * 24 * 60 * 60 * 1_000)
  }

  return { buckets, start }
}

function normalizeChartProvider(
  rawProvider?: string | null,
  rawNetwork?: string | null
): TransactionsChartProviderKey | null {
  const provider = String(rawProvider || "").toLowerCase().trim()
  const network = String(rawNetwork || "").toLowerCase().trim()

  if (provider === "solana" || network === "solana") return "solana"
  if (provider === "base" || network === "base") return "base"
  if (provider === "coinbase") return "coinbase"
  if (provider === "shift4" || network === "shift4") return "shift4"
  if (provider === "cash" || network === "cash") return "cash"

  if (
    provider === "lightning" ||
    provider === "lightning_speed" ||
    provider === "lightning_nwc" ||
    provider === "speed" ||
    provider === "nwc" ||
    provider === "btc_lightning" ||
    provider === "bitcoin_lightning" ||
    provider === "bitcoin lightning" ||
    network === "bitcoin_lightning" ||
    network === "bitcoin lightning" ||
    network === "btc_lightning" ||
    network === "lightning_btc" ||
    network === "lightning"
  ) {
    return "lightning"
  }

  return null
}

export async function getTransactionsChartEngine(
  merchantId: string,
  range: string,
  mode: "all" | "pos" | "online"
) {
  const timeZone = await getMerchantTimeZone(merchantId)
  const { buckets, start } = buildBuckets(range, timeZone)
  const payments = await getAllCanonicalTransactions({
    scope: { type: "merchant", merchantId },
    startDate: start.toISOString(),
    status: "CONFIRMED",
    mode,
  })

  payments.forEach((payment) => {
    const amount = payment.amountMinor / 100
    const d = new Date(payment.occurredAt)
    if (Number.isNaN(d.getTime())) return
    let label = ""

    label = chartLabel(d, range, timeZone)
    if (!buckets[label]) return

    const chartProvider = normalizeChartProvider(payment.provider, payment.network)
    if (chartProvider) buckets[label][chartProvider] += amount
  })

  return Object.values(buckets)
}
