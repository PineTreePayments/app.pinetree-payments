import { supabaseAdmin, supabase } from "@/database"
import { getDrawerState } from "./cashDrawer"
import { signTerminalSession } from "@/lib/api/terminalAuth"

const db = supabaseAdmin || supabase

/**
 * Pre-authentication bootstrap projection for the terminal/PIN screen.
 *
 * This shape is served over an UNAUTHENTICATED route, so it is deliberately
 * narrow: only what the PIN screen and the post-unlock shift prompt need to
 * render. It carries no credential of any kind.
 *
 * Deliberately absent:
 *  - `sessionToken` — a terminal session is a credential and is issued only by
 *    `verifyPosTerminalPinEngine` after the PIN is verified.
 *  - `merchant_id` — the tenant binding travels with the verified credential,
 *    never with an unauthenticated bootstrap.
 *  - `drawer.balance` — the cash figure is not needed before PIN entry.
 *  - the PIN and the recovery phrase, which are never selected here.
 */
export type PosTerminalBootstrap = {
  terminal: {
    id: string
    name: string
    autolock: string
    drawer_starting_amount: number
    tax_mode: "none" | "merchant_default" | "custom"
    tax_rate: number | null
    tax_label: string
    created_at?: string
  }
  provider: string
  drawer: {
    active: boolean
    lastEntryType: string | null
    lastEntryAt: string | null
  }
}

/**
 * Returns the pre-authentication bootstrap for the POS terminal screen.
 *
 * This function must never mint a terminal session. `signTerminalSession` is
 * imported by this module for `verifyPosTerminalPinEngine` below; it must not
 * be reachable from this path. Audit finding RA-1 was exactly that: this
 * projection used to sign and return a 24-hour `pts_` token for any caller who
 * knew a terminal id, which bypassed the PIN gate entirely.
 */
export async function getPosTerminalBootstrapEngine(terminalId: string): Promise<PosTerminalBootstrap> {
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

  return {
    terminal: {
      id: terminal.id,
      name: terminal.name,
      autolock: terminal.autolock,
      drawer_starting_amount: Number(terminal.drawer_starting_amount ?? 0),
      tax_mode: terminal.tax_mode || "none",
      tax_rate: terminal.tax_rate === null ? null : Number(terminal.tax_rate),
      tax_label: terminal.tax_label || "Sales tax",
      created_at: terminal.created_at
    },
    provider: wallet?.network || "solana",
    drawer: {
      active: drawerState.active,
      lastEntryType: drawerState.lastEntry?.type || null,
      lastEntryAt: drawerState.lastEntry?.created_at || null
    }
  }
}

export type VerifiedPosTerminalSession = {
  sessionToken: string
  merchantId: string
  terminalId: string
}

/**
 * Verifies a PIN server-side against the stored terminal PIN.
 *
 * This is the ONLY place a terminal session credential is minted. It returns
 * the merchant and terminal identity alongside the token so the client never
 * has to learn its tenant binding from an unauthenticated bootstrap — the
 * identity and the credential come from the same verified decision.
 *
 * Throws on unknown terminal (404) or bad PIN (401), and returns nothing in
 * either case.
 */
export async function verifyPosTerminalPinEngine(
  terminalId: string,
  pin: string
): Promise<VerifiedPosTerminalSession> {
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

  return {
    sessionToken: signTerminalSession(terminal.merchant_id, terminal.id),
    merchantId: terminal.merchant_id,
    terminalId: terminal.id,
  }
}
