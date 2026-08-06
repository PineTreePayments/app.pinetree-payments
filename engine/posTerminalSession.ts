import { supabaseAdmin, supabase } from "@/database"
import { getDrawerState } from "./cashDrawer"
import { signTerminalSession } from "@/lib/api/terminalAuth"

const db = supabaseAdmin || supabase

/**
 * Everything the POS needs to open a terminal, including its scoped session
 * credential.
 *
 * This shape is only ever produced by `launchPosTerminalEngine`, which requires
 * a server-verified merchant identity and proves that the merchant owns the
 * terminal before signing anything. It is never served to an unauthenticated
 * caller.
 *
 * The PIN is deliberately absent: it is an exit secret, not part of the launch
 * payload, and it is never returned to a browser.
 */
export type PosTerminalLaunch = {
  merchantId: string
  /** Scoped `pts_` credential carrying this merchant and terminal. */
  sessionToken: string
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
    balance: number
    active: boolean
    lastEntryType: string | null
    lastEntryAt: string | null
  }
}

/**
 * Opens a terminal for an already-authenticated merchant.
 *
 * This is the ONLY place a terminal session credential is minted, and it signs
 * one only after proving ownership: the merchant id comes from the caller's
 * verified session and must match the terminal's stored `merchant_id`.
 *
 * Audit finding RA-1 was that the old display projection signed a 24-hour
 * `pts_` token for anyone who knew a terminal id. The fix is not to demand a
 * PIN before launch — the PIN is the exit gate — but to require a verified
 * merchant session and a server-side ownership check. Terminal id possession is
 * never authorization.
 *
 * `db` is the service-role client, so row-level security cannot compensate for
 * a missing ownership check; the `merchant_id` comparison below is what enforces
 * tenancy, and it must stay before the signing call.
 */
export async function launchPosTerminalEngine(args: {
  merchantId: string
  terminalId: string
}): Promise<PosTerminalLaunch> {
  const merchantId = String(args.merchantId || "").trim()
  const terminalId = String(args.terminalId || "").trim()

  if (!merchantId) {
    throw Object.assign(new Error("An authenticated merchant is required"), { status: 401 })
  }
  if (!terminalId) {
    throw Object.assign(new Error("Missing terminal id"), { status: 400 })
  }

  const { data: terminal, error: terminalError } = await db
    .from("terminals")
    .select("id,name,autolock,merchant_id,drawer_starting_amount,tax_mode,tax_rate,tax_label,created_at")
    .eq("id", terminalId)
    .single()

  if (terminalError || !terminal) {
    throw Object.assign(new Error("Terminal not found"), { status: 404 })
  }

  // Ownership gate. A terminal belonging to another merchant is reported as
  // "not found" so the route cannot be used to probe which terminal ids exist.
  if (String(terminal.merchant_id) !== merchantId) {
    console.warn("[pos-terminal] launch_ownership_rejected", {
      terminalIdPrefix: terminalId.slice(0, 8),
    })
    throw Object.assign(new Error("Terminal not found"), { status: 404 })
  }

  const { data: wallet } = await db
    .from("merchant_wallets")
    .select("network")
    .eq("merchant_id", terminal.merchant_id)
    .limit(1)
    .maybeSingle()

  const drawerState = await getDrawerState(terminal.id)

  return {
    merchantId,
    // Signed only after the ownership comparison above succeeded.
    sessionToken: signTerminalSession(terminal.merchant_id, terminal.id),
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
      balance: drawerState.balance,
      active: drawerState.active,
      lastEntryType: drawerState.lastEntry?.type || null,
      lastEntryAt: drawerState.lastEntry?.created_at || null
    }
  }
}

/**
 * Verifies the terminal PIN to authorize LEAVING the terminal.
 *
 * The PIN is an exit secret. It guards returning to the dashboard and the
 * protected terminal-management controls, not opening the POS — a cashier never
 * types a PIN to start selling.
 *
 * This function issues **no credential**. It deliberately returns nothing so a
 * successful exit check can never be turned into a replacement terminal
 * session, and both the merchant id and the terminal id are supplied by the
 * caller's already-verified `pts_` session rather than by request input.
 *
 * Throws on unknown terminal (404), a terminal owned by another merchant (404),
 * or an incorrect PIN (401).
 */
export async function verifyPosTerminalExitPinEngine(args: {
  merchantId: string
  terminalId: string
  pin: string
}): Promise<void> {
  const { data: terminal, error } = await db
    .from("terminals")
    .select("id,pin,merchant_id")
    .eq("id", args.terminalId)
    .single()

  if (error || !terminal) {
    throw Object.assign(new Error("Terminal not found"), { status: 404 })
  }

  // The session claims are signed by PineTree, so this should always hold; it is
  // asserted anyway so a future change to token minting cannot silently allow a
  // PIN from one merchant to unlock another merchant's terminal.
  if (String(terminal.merchant_id) !== String(args.merchantId)) {
    throw Object.assign(new Error("Terminal not found"), { status: 404 })
  }

  const pin = String(args.pin || "")
  if (!pin || pin.length !== 4 || pin !== String(terminal.pin)) {
    throw Object.assign(new Error("Incorrect PIN"), { status: 401 })
  }
}
