import { EXCLUDE_TEST_PAYMENTS_FILTER } from "@/lib/paymentMode"
import { supabase, supabaseAdmin } from "./supabase"

const db = supabaseAdmin || supabase

/**
 * The canonical read starts at payments so PostgREST returns one row per
 * payment. Related transaction attempts and events are evidence only; neither
 * relation is allowed to become the current lifecycle source of truth.
 */
export type CanonicalTransactionReadScope =
  | { type: "merchant"; merchantId: string }
  | { type: "admin"; merchantId?: string | null }

export type CanonicalTransactionReadMode =
  | "all"
  | "live"
  | "test"
  | "pos"
  | "online"

export type CanonicalTransactionReadFilters = {
  scope: CanonicalTransactionReadScope
  startDate?: string | null
  endDate?: string | null
  provider?: string | null
  network?: string | null
  asset?: string | null
  currency?: string | null
  source?: string | null
  rail?: string | null
  method?: string | null
  mode?: CanonicalTransactionReadMode | null
  search?: string | null
  status?: string | readonly string[] | null
  channel?: string | null
}

export type CanonicalTransactionPageInput = CanonicalTransactionReadFilters & {
  page?: number
  pageSize?: number
}

export type RawCanonicalTransactionAttempt = {
  id: string
  payment_id?: string | null
  merchant_id?: string | null
  provider?: string | null
  provider_transaction_id?: string | null
  network?: string | null
  status?: string | null
  channel?: string | null
  total_amount?: number | string | null
  subtotal_amount?: number | string | null
  platform_fee?: number | string | null
  created_at?: string | null
  // The deployed transactions table records settlement time as completed_at.
  // updated_at is accepted for environments/fixtures that still carry it.
  completed_at?: string | null
  updated_at?: string | null
}

/** Settlement time of an attempt, tolerant of both deployed column names. */
export function canonicalAttemptSettledAt(
  attempt: Pick<RawCanonicalTransactionAttempt, "completed_at" | "updated_at">
): string | null {
  const completedAt = String(attempt.completed_at ?? "").trim()
  if (completedAt) return completedAt
  const updatedAt = String(attempt.updated_at ?? "").trim()
  return updatedAt || null
}

export type RawCanonicalPaymentEvent = {
  id: string
  payment_id?: string | null
  event_type?: string | null
  provider_event?: string | null
  created_at?: string | null
}

export type RawCanonicalTransactionPayment = {
  id: string
  merchant_id: string
  merchant_amount?: number | string | null
  pinetree_fee?: number | string | null
  gross_amount?: number | string | null
  currency?: string | null
  provider?: string | null
  provider_reference?: string | null
  status?: string | null
  network?: string | null
  metadata?: Record<string, unknown> | null
  created_at: string
  updated_at?: string | null
  transactions?: RawCanonicalTransactionAttempt[] | null
  payment_events?: RawCanonicalPaymentEvent[] | null
}

export type RawCanonicalTransactionPage = {
  rows: RawCanonicalTransactionPayment[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
}

const PAGE_SIZE_MAX = 250
const ALL_READ_BATCH_SIZE = 1_000

function relatedTransactionsSelect() {
  return `transactions (
    id,
    payment_id,
    merchant_id,
    provider,
    provider_transaction_id,
    network,
    status,
    channel,
    total_amount,
    subtotal_amount,
    platform_fee,
    created_at,
    completed_at
  )`
}

function selectClause() {
  return `
    id,
    merchant_id,
    merchant_amount,
    pinetree_fee,
    gross_amount,
    currency,
    provider,
    provider_reference,
    status,
    network,
    metadata,
    created_at,
    updated_at,
    ${relatedTransactionsSelect()},
    payment_events (
      id,
      payment_id,
      event_type,
      provider_event,
      created_at
    )
  `
}

function nonEmpty(value: unknown): string | null {
  const normalized = String(value ?? "").trim()
  return normalized || null
}

function requireScope(scope: CanonicalTransactionReadScope) {
  if (!scope || (scope.type !== "merchant" && scope.type !== "admin")) {
    throw new Error("Canonical transaction reads require an explicit merchant or admin scope")
  }
  if (scope.type === "merchant" && !nonEmpty(scope.merchantId)) {
    throw new Error("Canonical merchant transaction reads require a merchant id")
  }
}

/** Restrict PostgREST filter syntax to payment/reference characters. */
export function sanitizeCanonicalTransactionSearch(value: unknown): string {
  return String(value ?? "")
    .replace(/[^a-zA-Z0-9:_.-]/g, "")
    .slice(0, 100)
}

function normalizedStatusFilter(value: CanonicalTransactionReadFilters["status"]): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : []
  return values
    .map((status) => String(status || "").trim().toUpperCase())
    .filter(Boolean)
    .flatMap((status) => {
      if (status === "WAITING") return ["CREATED", "PENDING"]
      if (status === "CANCELED" || status === "CANCELLED") return ["CANCELED", "CANCELLED"]
      return [status]
    })
}

async function buildCanonicalTransactionQuery(
  filters: CanonicalTransactionReadFilters,
  withCount: boolean
) {
  requireScope(filters.scope)
  const mode = String(filters.mode || "all").trim().toLowerCase()
  let query = db
    .from("payments")
    .select(selectClause(), withCount ? { count: "exact" } : undefined)

  if (filters.scope.type === "merchant") {
    const merchantId = filters.scope.merchantId.trim()
    query = query
      .eq("merchant_id", merchantId)
      .eq("transactions.merchant_id", merchantId)
  } else if (nonEmpty(filters.scope.merchantId)) {
    query = query.eq("merchant_id", String(filters.scope.merchantId).trim())
  }

  const startDate = nonEmpty(filters.startDate)
  const endDate = nonEmpty(filters.endDate)
  if (startDate) query = query.gte("created_at", startDate)
  if (endDate) query = query.lte("created_at", endDate)
  const currency = String(filters.currency ?? "").trim().toUpperCase()
  if (currency && currency !== "ALL") query = query.eq("currency", currency)

  const statuses = normalizedStatusFilter(filters.status)
  if (statuses.length === 1) query = query.eq("status", statuses[0])
  else if (statuses.length > 1) query = query.in("status", [...new Set(statuses)])

  if (mode === "live") query = query.or(EXCLUDE_TEST_PAYMENTS_FILTER)
  else if (mode === "test") query = query.eq("metadata->>payment_mode", "test")

  // Provider/network/rail/asset/source/channel/search/method and POS/online
  // mode depend on the canonical projection (including selected-attempt
  // fallback). The Engine applies those predicates after one complete scoped
  // payment read; applying partial SQL predicates here would drop valid rows.
  // Wrapping also prevents this async function from assimilating Supabase's
  // PromiseLike query builder and executing it before pagination is attached.
  return { query }
}

function epoch(value: string | null | undefined): number {
  const parsed = Date.parse(String(value || ""))
  return Number.isFinite(parsed) ? parsed : 0
}

function compareAttemptsNewestFirst(
  left: RawCanonicalTransactionAttempt,
  right: RawCanonicalTransactionAttempt
) {
  const byCreatedAt = epoch(right.created_at) - epoch(left.created_at)
  if (byCreatedAt) return byCreatedAt
  const bySettledAt =
    epoch(canonicalAttemptSettledAt(right)) - epoch(canonicalAttemptSettledAt(left))
  if (bySettledAt) return bySettledAt
  return String(right.id || "").localeCompare(String(left.id || ""))
}

function compareEventsOldestFirst(
  left: RawCanonicalPaymentEvent,
  right: RawCanonicalPaymentEvent
) {
  const byCreatedAt = epoch(left.created_at) - epoch(right.created_at)
  if (byCreatedAt) return byCreatedAt
  return String(left.id || "").localeCompare(String(right.id || ""))
}

/**
 * Supabase does not guarantee ordering inside embedded relations. Normalize it
 * at the data boundary so every engine adapter receives identical evidence.
 */
export function orderRawCanonicalTransactionPayment(
  row: RawCanonicalTransactionPayment
): RawCanonicalTransactionPayment {
  const paymentId = String(row.id || "").trim()
  const merchantId = String(row.merchant_id || "").trim()
  return {
    ...row,
    transactions: Array.isArray(row.transactions)
      ? row.transactions
          .filter((attempt) => {
            const attemptPaymentId = nonEmpty(attempt.payment_id)
            const attemptMerchantId = nonEmpty(attempt.merchant_id)
            return (!attemptPaymentId || attemptPaymentId === paymentId) &&
              (!attemptMerchantId || attemptMerchantId === merchantId)
          })
          .sort(compareAttemptsNewestFirst)
      : [],
    payment_events: Array.isArray(row.payment_events)
      ? row.payment_events
          .filter((event) => {
            const eventPaymentId = nonEmpty(event.payment_id)
            return !eventPaymentId || eventPaymentId === paymentId
          })
          .sort(compareEventsOldestFirst)
      : [],
  }
}

function normalizeRows(data: unknown): RawCanonicalTransactionPayment[] {
  if (!Array.isArray(data)) return []
  return (data as RawCanonicalTransactionPayment[]).map(orderRawCanonicalTransactionPayment)
}

async function loadPage(
  input: CanonicalTransactionReadFilters,
  page: number,
  pageSize: number,
  pageSizeMax: number
): Promise<RawCanonicalTransactionPage> {
  const normalizedPage = Math.max(1, Math.trunc(Number(page) || 1))
  const normalizedPageSize = Math.min(
    pageSizeMax,
    Math.max(1, Math.trunc(Number(pageSize) || 50))
  )
  const offset = (normalizedPage - 1) * normalizedPageSize
  const { query } = await buildCanonicalTransactionQuery(input, true)
  const result = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + normalizedPageSize - 1)
  const { data, error, count } = result

  if (error) {
    const errorCode = String(error.code || "").toUpperCase()
    const errorMessage = String(error.message || "")
    if (
      result.status === 416 ||
      errorCode === "PGRST103" ||
      /requested range.*not satisfiable|range.*outside/i.test(errorMessage)
    ) {
      const totalCount = count ?? 0
      return {
        rows: [],
        totalCount,
        page: normalizedPage,
        pageSize: normalizedPageSize,
        totalPages: Math.max(1, Math.ceil(totalCount / normalizedPageSize)),
      }
    }
    throw new Error(`Failed to load canonical transactions: ${error.message}`)
  }

  const totalCount = count ?? 0
  return {
    rows: normalizeRows(data),
    totalCount,
    page: normalizedPage,
    pageSize: normalizedPageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / normalizedPageSize)),
  }
}

/** Paginated canonical payment-root read for merchant and admin surfaces. */
export async function loadCanonicalTransactionPage(
  input: CanonicalTransactionPageInput
): Promise<RawCanonicalTransactionPage> {
  return loadPage(input, input.page || 1, input.pageSize || 50, PAGE_SIZE_MAX)
}

/** Complete filtered dataset for totals, reports, and exports. */
export async function loadAllCanonicalTransactions(
  input: CanonicalTransactionReadFilters
): Promise<RawCanonicalTransactionPayment[]> {
  const rows: RawCanonicalTransactionPayment[] = []
  for (let page = 1; ; page += 1) {
    const result = await loadPage(input, page, ALL_READ_BATCH_SIZE, ALL_READ_BATCH_SIZE)
    rows.push(...result.rows)
    if (result.rows.length < result.pageSize) break
  }
  return rows
}

/** Canonical detail read; `paymentId` is deliberately the only primary id. */
export async function loadCanonicalTransactionById(
  paymentId: string,
  input: CanonicalTransactionReadFilters
): Promise<RawCanonicalTransactionPayment | null> {
  const id = nonEmpty(paymentId)
  if (!id) return null

  const { query } = await buildCanonicalTransactionQuery(input, false)
  const { data, error } = await query
    .eq("id", id)
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load canonical transaction: ${error.message}`)
  }
  return data
    ? orderRawCanonicalTransactionPayment(data as unknown as RawCanonicalTransactionPayment)
    : null
}

// Explicit raw aliases make the Data/Engine boundary self-documenting for
// consumers that import both modules in the same server file.
export const getRawCanonicalTransactionPage = loadCanonicalTransactionPage
export const getAllRawCanonicalTransactions = loadAllCanonicalTransactions
export const getRawCanonicalTransactionById = loadCanonicalTransactionById
