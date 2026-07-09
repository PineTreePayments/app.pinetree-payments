import { type NextRequest, NextResponse } from "next/server"
import { requireMerchantAuthFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"

/**
 * POST /api/debug/pinetree-wallet/setup-event
 *
 * Temporary server-visible beacon for the PineTree Wallet creation flow. Frontend
 * console.info diagnostics never reach Vercel logs from a mobile browser, so this
 * route exists purely to make the same safe checkpoints visible server-side while
 * we track down a production wallet-creation timeout.
 *
 * Every event name is whitelisted and every detail value is sanitized to booleans,
 * small numbers, or short enum-shaped strings only - nothing that looks like an
 * email, wallet address, JWT, token, secret, or provider payload is ever accepted.
 * Nothing is persisted to a database; this only logs to the server console.
 */

const WHITELISTED_EVENTS = new Set([
  "wallet_page_loaded",
  "wallet_create_clicked",
  "wallet_retry_clicked",
  "wallet_dynamic_sdk_loaded",
  "wallet_dynamic_jwt_requested",
  "wallet_dynamic_jwt_authenticated",
  "wallet_dynamic_create_or_restore_started",
  "wallet_dynamic_create_or_restore_complete",
  "wallet_dynamic_create_embedded_wallet_started",
  "wallet_dynamic_create_embedded_wallet_complete",
  "wallet_dynamic_wallets_refresh_started",
  "wallet_dynamic_wallets_refresh_complete",
  "wallet_dynamic_wallets_detected_count",
  "wallet_dynamic_base_address_detected",
  "wallet_dynamic_solana_address_detected",
  "wallet_dynamic_missing_required_addresses",
  "wallet_profile_sync_eligible",
  "wallet_profile_sync_skipped_reason",
  "wallet_profile_post_attempting",
  "wallet_profile_post_response",
  "wallet_core_ready",
  "wallet_setup_timeout",
  "wallet_setup_retry_shown",
])

const MAX_DETAIL_KEYS = 12
const MAX_STRING_LENGTH = 40
const MAX_NUMBER = 1_000_000_000

// Key names that are never allowed through, regardless of their value.
const UNSAFE_KEY_PATTERN = /email|address|jwt|token|secret|password|privatekey|private_key|payload|credential/i

function looksUnsafeString(value: string) {
  if (value.length === 0 || value.length > MAX_STRING_LENGTH) return true
  if (value.includes("@")) return true // email-shaped
  if (/^bearer\s/i.test(value)) return true // "Bearer <token>"-shaped
  if (value.split(".").length === 3 && value.length > 20) return true // JWT-shaped
  if (/^0x[a-fA-F0-9]{16,}$/i.test(value)) return true // EVM address/hash-shaped
  if (/^[1-9A-HJ-NP-Za-km-z]{28,}$/.test(value)) return true // Solana base58 address-shaped
  if (/^[a-fA-F0-9]{32,}$/.test(value)) return true // raw hex key/hash-shaped
  return false
}

function sanitizeDetails(input: unknown): Record<string, boolean | number | string> {
  const safe: Record<string, boolean | number | string> = {}
  if (!input || typeof input !== "object" || Array.isArray(input)) return safe

  const entries = Object.entries(input as Record<string, unknown>).slice(0, MAX_DETAIL_KEYS)
  for (const [key, value] of entries) {
    if (typeof key !== "string" || key.length === 0 || key.length > MAX_STRING_LENGTH) continue
    if (UNSAFE_KEY_PATTERN.test(key)) continue

    if (typeof value === "boolean") {
      safe[key] = value
    } else if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_NUMBER) {
      safe[key] = value
    } else if (typeof value === "string" && !looksUnsafeString(value)) {
      safe[key] = value
    }
    // null, objects, arrays, and anything unsafe are dropped silently.
  }
  return safe
}

function debugEventsEnabled() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.NEXT_PUBLIC_WALLET_DEBUG_EVENTS === "true"
  )
}

export async function POST(req: NextRequest) {
  try {
    if (!debugEventsEnabled()) {
      return NextResponse.json({ error: "Wallet setup diagnostics are disabled" }, { status: 404 })
    }

    const auth = await requireMerchantAuthFromRequest(req)
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const event = typeof body.event === "string" ? body.event : ""

    if (!WHITELISTED_EVENTS.has(event)) {
      return NextResponse.json({ error: "Unknown wallet setup event" }, { status: 400 })
    }

    const details = sanitizeDetails(body.details)

    console.info("[pinetree-wallets] wallet_setup_client_event", {
      merchantId: auth.merchantId,
      event,
      details,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to record wallet setup event" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
