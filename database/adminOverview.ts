import { supabase, supabaseAdmin } from "./supabase"

const db = supabaseAdmin || supabase

export type AdminOverviewMetrics = {
  totalTransactions: number
  confirmedTransactions: number
  processingTransactions: number   // PROCESSING only (in-flight on-chain)
  pendingTransactions: number      // CREATED + PENDING (awaiting customer)
  failedTransactions: number       // FAILED only (hard provider failure)
  incompleteTransactions: number   // INCOMPLETE (customer abandoned)
  expiredTransactions: number      // EXPIRED (timed out)
  totalConfirmedVolume: number
  totalFeesCollected: number
  activeMerchants: number
  totalMerchants: number           // all merchant accounts (renamed from totalUsers)
  connectedProviders: number
}

export type AdminGrowthMetrics = {
  usersThisMonth: number
  transactionsThisMonth: number
  volumeThisMonth: number
}

export type AdminRecentTransaction = {
  id: string
  merchant_id: string
  status: string
  provider: string | null
  network: string | null
  gross_amount: number
  currency: string
  created_at: string
}

export type AdminRecentTicket = {
  id: string
  subject: string
  status: string
  priority: string
  merchant_email: string | null
  merchant_business_name: string | null
  created_at: string
}

export type AdminRecentFeedback = {
  id: string
  merchant_id: string
  type: string
  message: string
  rating: number | null
  created_at: string
}

// ─── Safe defaults ─────────────────────────────────────────────────────────────

export const PAYMENT_METRICS_DEFAULT: Pick<
  AdminOverviewMetrics,
  | "totalTransactions"
  | "confirmedTransactions"
  | "processingTransactions"
  | "pendingTransactions"
  | "failedTransactions"
  | "incompleteTransactions"
  | "expiredTransactions"
  | "totalConfirmedVolume"
  | "totalFeesCollected"
> = {
  totalTransactions: 0,
  confirmedTransactions: 0,
  processingTransactions: 0,
  pendingTransactions: 0,
  failedTransactions: 0,
  incompleteTransactions: 0,
  expiredTransactions: 0,
  totalConfirmedVolume: 0,
  totalFeesCollected: 0,
}

export const MERCHANT_METRICS_DEFAULT: Pick<AdminOverviewMetrics, "activeMerchants" | "totalMerchants"> = {
  activeMerchants: 0,
  totalMerchants: 0,
}

export const PROVIDER_METRICS_DEFAULT: Pick<AdminOverviewMetrics, "connectedProviders"> = {
  connectedProviders: 0,
}

export const GROWTH_METRICS_DEFAULT: AdminGrowthMetrics = {
  usersThisMonth: 0,
  transactionsThisMonth: 0,
  volumeThisMonth: 0,
}

// ─── Queries ───────────────────────────────────────────────────────────────────

export async function getAdminPaymentMetrics(): Promise<
  Pick<
    AdminOverviewMetrics,
    | "totalTransactions"
    | "confirmedTransactions"
    | "processingTransactions"
    | "pendingTransactions"
    | "failedTransactions"
    | "incompleteTransactions"
    | "expiredTransactions"
    | "totalConfirmedVolume"
    | "totalFeesCollected"
  >
> {
  try {
    const { data, error } = await db
      .from("payments")
      .select("status, gross_amount, pinetree_fee")

    if (error) {
      console.error("[admin/overview] getAdminPaymentMetrics failed", error.message)
      return PAYMENT_METRICS_DEFAULT
    }

    const rows = (data || []) as Array<{
      status: string | null
      gross_amount: number | string | null
      pinetree_fee: number | string | null
    }>

    let confirmedTransactions = 0
    let processingTransactions = 0
    let pendingTransactions = 0
    let failedTransactions = 0
    let incompleteTransactions = 0
    let expiredTransactions = 0
    let totalConfirmedVolume = 0
    let totalFeesCollected = 0

    for (const row of rows) {
      const gross = Number(row.gross_amount ?? 0)
      const fee = Number(row.pinetree_fee ?? 0)
      const status = row.status ?? ""

      switch (status) {
        case "CONFIRMED":
          confirmedTransactions++
          totalConfirmedVolume += gross
          totalFeesCollected += fee
          break
        case "PROCESSING":
          processingTransactions++
          break
        case "CREATED":
        case "PENDING":
          pendingTransactions++
          break
        case "FAILED":
          failedTransactions++
          break
        case "INCOMPLETE":
          incompleteTransactions++
          break
        case "EXPIRED":
          expiredTransactions++
          break
      }
    }

    return {
      totalTransactions: rows.length,
      confirmedTransactions,
      processingTransactions,
      pendingTransactions,
      failedTransactions,
      incompleteTransactions,
      expiredTransactions,
      totalConfirmedVolume,
      totalFeesCollected,
    }
  } catch (err) {
    console.error("[admin/overview] getAdminPaymentMetrics exception", err)
    return PAYMENT_METRICS_DEFAULT
  }
}

export async function getAdminMerchantMetrics(): Promise<
  Pick<AdminOverviewMetrics, "activeMerchants" | "totalMerchants">
> {
  try {
    const [
      { count: activeMerchants, error: activeErr },
      { count: totalUsers, error: totalErr },
    ] = await Promise.all([
      db.from("merchants").select("id", { count: "exact", head: true }).eq("status", "active"),
      db.from("merchants").select("id", { count: "exact", head: true }),
    ])

    if (activeErr) {
      console.error("[admin/overview] getAdminMerchantMetrics (active) failed", activeErr.message)
    }
    if (totalErr) {
      console.error("[admin/overview] getAdminMerchantMetrics (total) failed", totalErr.message)
    }

    return {
      activeMerchants: activeMerchants ?? 0,
      totalMerchants: totalUsers ?? 0,
    }
  } catch (err) {
    console.error("[admin/overview] getAdminMerchantMetrics exception", err)
    return MERCHANT_METRICS_DEFAULT
  }
}

export async function getAdminProviderMetrics(): Promise<
  Pick<AdminOverviewMetrics, "connectedProviders">
> {
  try {
    const { count, error } = await db
      .from("merchant_providers")
      .select("id", { count: "exact", head: true })
      .in("status", ["connected", "active"])

    if (error) {
      console.error("[admin/overview] getAdminProviderMetrics failed", error.message)
      return PROVIDER_METRICS_DEFAULT
    }

    return { connectedProviders: count ?? 0 }
  } catch (err) {
    console.error("[admin/overview] getAdminProviderMetrics exception", err)
    return PROVIDER_METRICS_DEFAULT
  }
}

export async function getAdminGrowthMetrics(): Promise<AdminGrowthMetrics> {
  try {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

    const [
      { count: usersThisMonth, error: userErr },
      { data: txRows, error: txErr },
    ] = await Promise.all([
      db
        .from("merchants")
        .select("id", { count: "exact", head: true })
        .gte("created_at", monthStart),
      db
        .from("payments")
        .select("gross_amount, status")
        .gte("created_at", monthStart),
    ])

    if (userErr) {
      console.error("[admin/overview] getAdminGrowthMetrics (users) failed", userErr.message)
    }
    if (txErr) {
      console.error("[admin/overview] getAdminGrowthMetrics (payments) failed", txErr.message)
    }

    const rows = (txRows || []) as Array<{
      gross_amount: number | string | null
      status: string | null
    }>

    const volumeThisMonth = rows
      .filter((r) => r.status === "CONFIRMED")
      .reduce((sum, r) => sum + Number(r.gross_amount ?? 0), 0)

    return {
      usersThisMonth: usersThisMonth ?? 0,
      transactionsThisMonth: rows.length,
      volumeThisMonth,
    }
  } catch (err) {
    console.error("[admin/overview] getAdminGrowthMetrics exception", err)
    return GROWTH_METRICS_DEFAULT
  }
}

export async function getAdminRecentTransactions(limit = 10): Promise<AdminRecentTransaction[]> {
  try {
    // Query only the core columns that are guaranteed to exist; extras are optional
    const { data, error } = await db
      .from("payments")
      .select("id, merchant_id, status, provider, network, gross_amount, currency, created_at")
      .order("created_at", { ascending: false })
      .limit(limit)

    if (error) {
      console.error("[admin/overview] getAdminRecentTransactions failed", error.message)

      // Retry with a minimal column set in case some optional columns don't exist yet
      const { data: fallback, error: fallbackErr } = await db
        .from("payments")
        .select("id, merchant_id, status, created_at")
        .order("created_at", { ascending: false })
        .limit(limit)

      if (fallbackErr) {
        console.error("[admin/overview] getAdminRecentTransactions fallback failed", fallbackErr.message)
        return []
      }

      return (fallback || []).map((row: Record<string, unknown>) => ({
        id: String(row.id ?? ""),
        merchant_id: String(row.merchant_id ?? ""),
        status: String(row.status ?? ""),
        provider: null,
        network: null,
        gross_amount: 0,
        currency: "USD",
        created_at: String(row.created_at ?? ""),
      }))
    }

    return (data || []) as AdminRecentTransaction[]
  } catch (err) {
    console.error("[admin/overview] getAdminRecentTransactions exception", err)
    return []
  }
}

export async function getAdminRecentTickets(limit = 5): Promise<AdminRecentTicket[]> {
  try {
    const { data, error } = await db
      .from("support_tickets")
      .select("id, subject, status, priority, merchant_email, merchant_business_name, created_at")
      .order("created_at", { ascending: false })
      .limit(limit)

    if (error) {
      console.error("[admin/overview] getAdminRecentTickets failed", error.message)
      return []
    }

    return (data || []) as AdminRecentTicket[]
  } catch (err) {
    console.error("[admin/overview] getAdminRecentTickets exception", err)
    return []
  }
}

export async function getAdminRecentFeedback(limit = 5): Promise<AdminRecentFeedback[]> {
  try {
    const { data, error } = await db
      .from("merchant_feedback")
      .select("id, merchant_id, type, message, rating, created_at")
      .order("created_at", { ascending: false })
      .limit(limit)

    if (error) {
      console.error("[admin/overview] getAdminRecentFeedback failed", error.message)
      return []
    }

    return (data || []) as AdminRecentFeedback[]
  } catch (err) {
    console.error("[admin/overview] getAdminRecentFeedback exception", err)
    return []
  }
}
