import { supabaseAdmin, supabase } from "@/database"
import { getDrawerState } from "./cashDrawer"
import { signTerminalSession } from "@/lib/api/terminalAuth"

const db = supabaseAdmin || supabase

export type TerminalDisplayData = {
  terminal: {
    id: string
    name: string
    autolock: string
    merchant_id: string
    drawer_starting_amount: number
    tax_mode: "none" | "merchant_default" | "custom"
    tax_rate: number | null
    tax_label: string
    created_at?: string
  }
  provider: string
  sessionToken: string
  drawer: {
    balance: number
    active: boolean
    lastEntryType: string | null
    lastEntryAt: string | null
  }
}

/**
 * Returns safe terminal display info for the POS screen.
 * Never includes the PIN. A scoped terminal session token is returned so the
 * terminal can call POS APIs without exposing merchant credentials.
 */
export async function getPosTerminalDisplayEngine(terminalId: string): Promise<TerminalDisplayData> {
  const { data: terminal, error: terminalError } = await db
    .from("terminals")
    .select("id,name,autolock,merchant_id,drawer_starting_amount,tax_mode,tax_rate,tax_label,created_at")
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

  const drawerState = await getDrawerState(terminal.id)
  const sessionToken = await signTerminalSession(terminal.merchant_id, terminal.id)

  return {
    terminal: {
      id: terminal.id,
      name: terminal.name,
      autolock: terminal.autolock,
      merchant_id: terminal.merchant_id,
      drawer_starting_amount: Number(terminal.drawer_starting_amount ?? 0),
      tax_mode: terminal.tax_mode || "none",
      tax_rate: terminal.tax_rate === null ? null : Number(terminal.tax_rate),
      tax_label: terminal.tax_label || "Sales tax",
      created_at: terminal.created_at
    },
    provider: wallet?.network || "solana",
    sessionToken,
    drawer: {
      balance: drawerState.balance,
      active: drawerState.active,
      lastEntryType: drawerState.lastEntry?.type || null,
      lastEntryAt: drawerState.lastEntry?.created_at || null
    }
  }
}

/**
 * Verifies a PIN server-side against the stored terminal PIN.
 * Only issues a session token on success. Throws on bad PIN or unknown terminal.
 */
export async function verifyPosTerminalPinEngine(
  terminalId: string,
  pin: string
): Promise<string> {
  const { data: terminal, error } = await db
    .from("terminals")
    .select("id,pin,merchant_id")
    .eq("id", terminalId)
    .single()

  if (error || !terminal) {
    throw Object.assign(new Error("Terminal not found"), { status: 404 })
  }

  if (!pin || pin.length !== 4 || pin !== String(terminal.pin)) {
    throw Object.assign(new Error("Incorrect PIN"), { status: 401 })
  }

  return signTerminalSession(terminal.merchant_id, terminal.id)
}
