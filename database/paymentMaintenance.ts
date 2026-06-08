import type { Payment } from "./payments"
import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const db = supabaseAdmin || supabaseAnon

export async function getPaymentMaintenanceCandidates(limit: number): Promise<Payment[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 25))
  const { data, error } = await db
    .from("payments")
    .select("*")
    .in("status", ["PENDING", "PROCESSING"])
    .order("updated_at", { ascending: true })
    .limit(boundedLimit)

  if (error) {
    throw new Error(`Failed to load payment maintenance candidates: ${error.message}`)
  }

  return (data || []) as Payment[]
}

export async function getTerminalPaymentMaintenanceCandidates(
  limit: number
): Promise<Array<Pick<Payment, "id" | "status">>> {
  const boundedLimit = Math.max(1, Math.min(limit, 25))
  const perStatusLimit = Math.max(1, Math.ceil(boundedLimit / 3))
  const terminalStatuses = ["CONFIRMED", "FAILED", "INCOMPLETE"] as const
  const results = await Promise.all(terminalStatuses.map(async (status) => {
    const { data, error } = await db
      .from("payments")
      .select("id,status,transactions!inner(status)")
      .eq("status", status)
      .neq("transactions.status", status)
      .order("updated_at", { ascending: true })
      .limit(perStatusLimit)

    if (error) {
      throw new Error(
        `Failed to load ${status} payment maintenance candidates: ${error.message}`
      )
    }

    return (data || []).map((row) => ({
      id: String(row.id),
      status: row.status as Payment["status"]
    }))
  }))

  const unique = new Map<string, Pick<Payment, "id" | "status">>()
  for (const row of results.flat()) {
    unique.set(row.id, row)
  }

  return Array.from(unique.values()).slice(0, boundedLimit)
}
