import { supabaseAdmin, supabase } from "@/database"

const db = supabaseAdmin || supabase

export type TerminalSessionData = {
  terminal: {
    id: string
    name: string
    pin: string
    autolock: string
    merchant_id: string
    drawer_starting_amount: number
    created_at?: string
  }
  provider: string
}

export async function getPosTerminalSessionEngine(terminalId: string): Promise<TerminalSessionData> {
  const { data: terminal, error: terminalError } = await db
    .from("terminals")
    .select("id,name,pin,autolock,merchant_id,drawer_starting_amount,created_at")
    .eq("id", terminalId)
    .single()

  if (terminalError || !terminal) {
    throw new Error("Terminal not found")
  }

  const { data: wallet } = await db
    .from("merchant_wallets")
    .select("network")
    .eq("merchant_id", terminal.merchant_id)
    .limit(1)
    .maybeSingle()

  return {
    terminal: {
      id: terminal.id,
      name: terminal.name,
      pin: terminal.pin,
      autolock: terminal.autolock,
      merchant_id: terminal.merchant_id,
      drawer_starting_amount: Number(terminal.drawer_starting_amount ?? 0),
      created_at: terminal.created_at
    },
    provider: wallet?.network || "solana"
  }
}
