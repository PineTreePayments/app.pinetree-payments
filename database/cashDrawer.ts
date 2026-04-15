import { supabase } from "./supabase"

export type DrawerEntryType = "opening_balance" | "cash_sale" | "closeout"

export type DrawerEntry = {
  id: string
  terminal_id: string
  merchant_id: string
  type: DrawerEntryType
  amount: number
  running_balance: number
  sale_total?: number | null
  cash_tendered?: number | null
  change_given?: number | null
  actual_amount?: number | null
  notes?: string | null
  created_at: string
}

export type CreateDrawerEntryInput = {
  terminal_id: string
  merchant_id: string
  type: DrawerEntryType
  amount: number
  running_balance: number
  sale_total?: number
  cash_tendered?: number
  change_given?: number
  actual_amount?: number
  notes?: string
}

export async function logDrawerEntry(input: CreateDrawerEntryInput): Promise<DrawerEntry> {
  const { data, error } = await supabase
    .from("cash_drawer_log")
    .insert({
      terminal_id: input.terminal_id,
      merchant_id: input.merchant_id,
      type: input.type,
      amount: input.amount,
      running_balance: input.running_balance,
      sale_total: input.sale_total ?? null,
      cash_tendered: input.cash_tendered ?? null,
      change_given: input.change_given ?? null,
      actual_amount: input.actual_amount ?? null,
      notes: input.notes ?? null
    })
    .select()
    .single()

  if (error || !data) {
    throw new Error(error?.message || "Failed to log drawer entry")
  }

  return data as DrawerEntry
}

export async function getDrawerBalance(terminalId: string): Promise<number> {
  const { data, error } = await supabase
    .from("cash_drawer_log")
    .select("running_balance")
    .eq("terminal_id", terminalId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return 0
  return Number(data.running_balance || 0)
}

export async function getLatestDrawerEntry(terminalId: string): Promise<DrawerEntry | null> {
  const { data, error } = await supabase
    .from("cash_drawer_log")
    .select("*")
    .eq("terminal_id", terminalId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  return data as DrawerEntry
}

export async function getDrawerLog(terminalId: string, limit = 50): Promise<DrawerEntry[]> {
  const { data, error } = await supabase
    .from("cash_drawer_log")
    .select("*")
    .eq("terminal_id", terminalId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error || !data) return []
  return data as DrawerEntry[]
}

export async function getDrawerLogForMerchant(merchantId: string, limit = 200): Promise<DrawerEntry[]> {
  const { data, error } = await supabase
    .from("cash_drawer_log")
    .select("*")
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error || !data) return []
  return data as DrawerEntry[]
}
