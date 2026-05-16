import { supabase, supabaseAdmin } from "./supabase"

const db = supabaseAdmin || supabase

// ─── Types ─────────────────────────────────────────────────────────────────────

export type AdminTransactionRow = {
  id: string
  merchant_id: string
  status: string
  provider: string
  network: string | null
  gross_amount: number
  merchant_amount: number
  pinetree_fee: number
  currency: string
  provider_reference: string | null
  created_at: string
  updated_at: string
}

export type AdminTransactionSummary = {
  totalCount: number
  confirmedCount: number
  processingCount: number
  pendingCount: number      // CREATED + PENDING (awaiting customer action)
  failedCount: number       // FAILED only (hard provider failure)
  incompleteCount: number   // INCOMPLETE (customer abandoned)
  expiredCount: number      // EXPIRED (timed out)
  confirmedVolume: number
  totalFees: number
}

export type AdminTransactionFilters = {
  status?: string
  network?: string
  provider?: string
  merchantId?: string
  from?: string
  to?: string
  search?: string
  // NOTE: No 'environment' or 'is_test' column exists in the payments table as of 2026-05-14.
  // The live/test filter is structured here for future implementation.
  // Do NOT add fake filtering logic without a real schema column.
}

// ─── Defaults ──────────────────────────────────────────────────────────────────

export const ADMIN_TX_SUMMARY_DEFAULT: AdminTransactionSummary = {
  totalCount: 0,
  confirmedCount: 0,
  processingCount: 0,
  pendingCount: 0,
  failedCount: 0,
  incompleteCount: 0,
  expiredCount: 0,
  confirmedVolume: 0,
  totalFees: 0,
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function sanitizeSearch(s: string): string {
  // Only allow chars that appear in UUIDs and common payment references
  return s.replace(/[^a-zA-Z0-9\-_.]/g, "").slice(0, 80)
}

// ─── Queries ───────────────────────────────────────────────────────────────────

/**
 * Paginated platform-wide payment rows with optional filtering.
 * No merchant_id scope — returns payments from all merchants.
 */
export async function getAdminTransactions(
  filters: AdminTransactionFilters = {},
  limit = 50,
  offset = 0
): Promise<{ rows: AdminTransactionRow[]; totalCount: number }> {
  try {
    let q = db
      .from("payments")
      .select(
        "id, merchant_id, status, provider, network, gross_amount, merchant_amount, pinetree_fee, currency, provider_reference, created_at, updated_at",
        { count: "exact" }
      )

    if (filters.status)     q = q.eq("status", filters.status)
    if (filters.network)    q = q.eq("network", filters.network)
    if (filters.provider)   q = q.eq("provider", filters.provider)
    if (filters.merchantId) q = q.eq("merchant_id", filters.merchantId)
    if (filters.from)       q = q.gte("created_at", filters.from)
    if (filters.to)         q = q.lte("created_at", filters.to)
    if (filters.search) {
      const safe = sanitizeSearch(filters.search)
      if (safe) {
        q = q.or(`id.ilike.${safe}%,provider_reference.ilike.%${safe}%`)
      }
    }

    const { data, error, count } = await q
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error("[admin/tx] getAdminTransactions error", error.message)
      return { rows: [], totalCount: 0 }
    }

    return {
      rows: (data || []) as AdminTransactionRow[],
      totalCount: count ?? 0,
    }
  } catch (err) {
    console.error("[admin/tx] getAdminTransactions exception", err)
    return { rows: [], totalCount: 0 }
  }
}

/**
 * Aggregate summary for the current filter context.
 * Fetches status + amounts for ALL matching rows (no pagination) to compute totals.
 */
export async function getAdminTransactionSummary(
  filters: AdminTransactionFilters = {}
): Promise<AdminTransactionSummary> {
  try {
    let q = db
      .from("payments")
      .select("status, gross_amount, pinetree_fee")

    if (filters.status)     q = q.eq("status", filters.status)
    if (filters.network)    q = q.eq("network", filters.network)
    if (filters.provider)   q = q.eq("provider", filters.provider)
    if (filters.merchantId) q = q.eq("merchant_id", filters.merchantId)
    if (filters.from)       q = q.gte("created_at", filters.from)
    if (filters.to)         q = q.lte("created_at", filters.to)
    if (filters.search) {
      const safe = sanitizeSearch(filters.search)
      if (safe) {
        q = q.or(`id.ilike.${safe}%,provider_reference.ilike.%${safe}%`)
      }
    }

    const { data, error } = await q
    if (error) {
      console.error("[admin/tx] getAdminTransactionSummary error", error.message)
      return ADMIN_TX_SUMMARY_DEFAULT
    }

    const rows = (data || []) as Array<{
      status: string
      gross_amount: number | string | null
      pinetree_fee: number | string | null
    }>

    let confirmedCount = 0
    let processingCount = 0
    let pendingCount = 0
    let failedCount = 0
    let incompleteCount = 0
    let expiredCount = 0
    let confirmedVolume = 0
    let totalFees = 0

    for (const row of rows) {
      const status = row.status ?? ""
      const gross = Number(row.gross_amount ?? 0)
      const fee = Number(row.pinetree_fee ?? 0)

      switch (status) {
        case "CONFIRMED":
          confirmedCount++
          confirmedVolume += gross
          totalFees += fee
          break
        case "PROCESSING":
          processingCount++
          break
        case "CREATED":
        case "PENDING":
          pendingCount++
          break
        case "FAILED":
          failedCount++
          break
        case "INCOMPLETE":
          incompleteCount++
          break
        case "EXPIRED":
          expiredCount++
          break
      }
    }

    return {
      totalCount: rows.length,
      confirmedCount,
      processingCount,
      pendingCount,
      failedCount,
      incompleteCount,
      expiredCount,
      confirmedVolume,
      totalFees,
    }
  } catch (err) {
    console.error("[admin/tx] getAdminTransactionSummary exception", err)
    return ADMIN_TX_SUMMARY_DEFAULT
  }
}

// ─── Single-payment detail ─────────────────────────────────────────────────────

export type AdminTxDetailRow = {
  id: string
  merchant_id: string
  status: string
  provider: string | null
  network: string | null
  gross_amount: number
  merchant_amount: number
  pinetree_fee: number
  currency: string
  provider_reference: string | null
  metadata: unknown
  created_at: string
  updated_at: string
}

export async function getAdminTransaction(id: string): Promise<AdminTxDetailRow | null> {
  const safeId = String(id || "").replace(/[^a-zA-Z0-9\-]/g, "").slice(0, 36)
  if (!safeId) return null
  try {
    const { data, error } = await db
      .from("payments")
      .select(
        "id, merchant_id, status, provider, network, gross_amount, merchant_amount, pinetree_fee, currency, provider_reference, metadata, created_at, updated_at"
      )
      .eq("id", safeId)
      .single()
    if (error || !data) return null
    return data as AdminTxDetailRow
  } catch {
    return null
  }
}

/**
 * Provider and network distribution for the current filter context.
 * Used to compute "top provider" and "top network" health insights.
 */
export async function getAdminTransactionDistribution(
  filters: AdminTransactionFilters = {}
): Promise<{ providers: Record<string, number>; networks: Record<string, number> }> {
  try {
    let q = db.from("payments").select("provider, network")

    if (filters.status)     q = q.eq("status", filters.status)
    if (filters.network)    q = q.eq("network", filters.network)
    if (filters.provider)   q = q.eq("provider", filters.provider)
    if (filters.merchantId) q = q.eq("merchant_id", filters.merchantId)
    if (filters.from)       q = q.gte("created_at", filters.from)
    if (filters.to)         q = q.lte("created_at", filters.to)

    const { data, error } = await q
    if (error) {
      console.error("[admin/tx] getAdminTransactionDistribution error", error.message)
      return { providers: {}, networks: {} }
    }

    const providers: Record<string, number> = {}
    const networks: Record<string, number> = {}

    for (const row of (data || [])) {
      if (row.provider) providers[row.provider] = (providers[row.provider] || 0) + 1
      if (row.network)  networks[row.network]   = (networks[row.network]   || 0) + 1
    }

    return { providers, networks }
  } catch (err) {
    console.error("[admin/tx] getAdminTransactionDistribution exception", err)
    return { providers: {}, networks: {} }
  }
}
