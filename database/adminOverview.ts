import { supabase, supabaseAdmin } from "./supabase"

const db = supabaseAdmin || supabase

export type AdminOverviewMetrics = {
  totalTransactions: number
  confirmedTransactions: number
  pendingTransactions: number
  failedTransactions: number
  totalConfirmedVolume: number
  totalFeesCollected: number
  activeMerchants: number
  totalUsers: number
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

export async function getAdminPaymentMetrics(): Promise<
  Pick<
    AdminOverviewMetrics,
    | "totalTransactions"
    | "confirmedTransactions"
    | "pendingTransactions"
    | "failedTransactions"
    | "totalConfirmedVolume"
    | "totalFeesCollected"
  >
> {
  const { data, error } = await db
    .from("payments")
    .select("status, gross_amount, pinetree_fee")

  if (error) {
    throw new Error(`Failed to load payment metrics: ${error.message}`)
  }

  const rows = (data || []) as Array<{
    status: string | null
    gross_amount: number | string | null
    pinetree_fee: number | string | null
  }>

  let confirmedTransactions = 0
  let pendingTransactions = 0
  let failedTransactions = 0
  let totalConfirmedVolume = 0
  let totalFeesCollected = 0

  for (const row of rows) {
    const gross = Number(row.gross_amount ?? 0)
    const fee = Number(row.pinetree_fee ?? 0)
    const status = row.status ?? ""

    if (status === "CONFIRMED") {
      confirmedTransactions++
      totalConfirmedVolume += gross
      totalFeesCollected += fee
    } else if (status === "FAILED" || status === "INCOMPLETE" || status === "EXPIRED") {
      failedTransactions++
    } else if (status === "CREATED" || status === "PENDING" || status === "PROCESSING") {
      pendingTransactions++
    }
  }

  return {
    totalTransactions: rows.length,
    confirmedTransactions,
    pendingTransactions,
    failedTransactions,
    totalConfirmedVolume,
    totalFeesCollected,
  }
}

export async function getAdminMerchantMetrics(): Promise<
  Pick<AdminOverviewMetrics, "activeMerchants" | "totalUsers">
> {
  const { count: activeMerchants, error: activeErr } = await db
    .from("merchants")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")

  if (activeErr) {
    throw new Error(`Failed to load merchant count: ${activeErr.message}`)
  }

  const { count: totalUsers, error: totalErr } = await db
    .from("merchants")
    .select("id", { count: "exact", head: true })

  if (totalErr) {
    throw new Error(`Failed to load total user count: ${totalErr.message}`)
  }

  return {
    activeMerchants: activeMerchants ?? 0,
    totalUsers: totalUsers ?? 0,
  }
}

export async function getAdminProviderMetrics(): Promise<
  Pick<AdminOverviewMetrics, "connectedProviders">
> {
  const { count, error } = await db
    .from("merchant_providers")
    .select("id", { count: "exact", head: true })
    .in("status", ["connected", "active"])

  if (error) {
    throw new Error(`Failed to load provider count: ${error.message}`)
  }

  return { connectedProviders: count ?? 0 }
}

export async function getAdminGrowthMetrics(): Promise<AdminGrowthMetrics> {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const [{ count: usersThisMonth, error: userErr }, { data: txRows, error: txErr }] =
    await Promise.all([
      db
        .from("merchants")
        .select("id", { count: "exact", head: true })
        .gte("created_at", monthStart),
      db
        .from("payments")
        .select("gross_amount, status")
        .gte("created_at", monthStart),
    ])

  if (userErr) throw new Error(`Failed to load monthly user growth: ${userErr.message}`)
  if (txErr) throw new Error(`Failed to load monthly transaction growth: ${txErr.message}`)

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
}

export async function getAdminRecentTransactions(limit = 10): Promise<AdminRecentTransaction[]> {
  const { data, error } = await db
    .from("payments")
    .select("id, merchant_id, status, provider, network, gross_amount, currency, created_at")
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(`Failed to load recent transactions: ${error.message}`)
  }

  return (data || []) as AdminRecentTransaction[]
}

export async function getAdminRecentTickets(limit = 5): Promise<AdminRecentTicket[]> {
  const { data, error } = await db
    .from("support_tickets")
    .select("id, subject, status, priority, merchant_email, merchant_business_name, created_at")
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(`Failed to load recent tickets: ${error.message}`)
  }

  return (data || []) as AdminRecentTicket[]
}

export async function getAdminRecentFeedback(limit = 5): Promise<AdminRecentFeedback[]> {
  const { data, error } = await db
    .from("merchant_feedback")
    .select("id, merchant_id, type, message, rating, created_at")
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(`Failed to load recent feedback: ${error.message}`)
  }

  return (data || []) as AdminRecentFeedback[]
}
