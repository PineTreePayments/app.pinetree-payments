import { NextRequest, NextResponse } from "next/server"
import { requireTerminalSession } from "@/lib/api/terminalAuth"
import { getPaymentIntentById, getPaymentIntentForMerchant } from "@/database"
import { supabaseAdmin } from "@/database/supabase"
import { getRouteErrorStatus } from "@/lib/api/merchantAuth"

type Params = { params: Promise<{ intentId: string }> }

const ALLOWED_STEPS = new Set([
  "awaiting_wallet",
  "wallet_connected",
  "payment_sending",
  "payment_submitted",
  "confirming",
  "failed",
])

// GET — hosted checkout polls for the POS-owned pairing URI.
// No auth required: the pairing URI is public (it contains only a public key
// and relay info — the symmetric session key is never transmitted).
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { intentId } = await params
    const id = String(intentId || "").trim()
    if (!id) {
      return NextResponse.json({ error: "Missing intentId" }, { status: 400 })
    }

    const intent = await getPaymentIntentById(id)
    if (!intent) {
      return NextResponse.json({ error: "Payment intent not found" }, { status: 404 })
    }

    const meta = (intent.metadata || {}) as Record<string, unknown>
    const session = (meta.pos_base_session || null) as PosBaseSession | null

    if (!session || session.controller !== "pos_terminal") {
      return NextResponse.json({ session: null })
    }

    // Return only safe mirror fields — no symmetric keys, no raw signatures,
    // no full wallet addresses. The pairing URI is safe: it contains only the
    // relay endpoint and a Curve25519 public key used for ECDH key agreement.
    const mirror = {
      pairingUri: session.pairingUri ?? null,
      selectedAsset: session.selectedAsset ?? null,
      step: session.step ?? null,
      walletConnected: session.step !== undefined && session.step !== "awaiting_wallet",
      walletAddressMasked: session.walletAddressMasked ?? null,
      txHash: session.txHash ?? null,
      status: session.step ?? null,
      errorMessage: session.errorMessage ?? null,
      updatedAt: session.updatedAt,
    }

    return NextResponse.json({ session: { controller: "pos_terminal" as const, ...mirror } })
  } catch {
    return NextResponse.json({ error: "Failed to read session" }, { status: 500 })
  }
}

/**
 * POST — the POS terminal writes or updates the session state.
 *
 * Requires a terminal session, and the verified claims from that session are the
 * only source of merchant and terminal identity. Audit finding RA-4 was that this
 * handler called `requireTerminalSession` but discarded its return value, then
 * loaded and updated the intent by id alone through the service-role client — so
 * any terminal session could overwrite any merchant's intent, including
 * substituting the `pairingUri` that the public GET mirror serves to the paying
 * customer.
 *
 * Ownership is now enforced three ways, deliberately overlapping:
 *   1. the read is merchant-scoped in the query;
 *   2. an explicit invariant re-checks merchant and terminal before any write;
 *   3. both service-role updates carry `merchant_id` in the query.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { intentId } = await params
    const { mid: merchantId, tid: terminalId } = requireTerminalSession(req)

    const id = String(intentId || "").trim()
    if (!id) {
      return NextResponse.json({ error: "Missing intentId" }, { status: 400 })
    }

    // Merchant-scoped read: RLS cannot help here because the client is
    // service-role, so merchant_id is part of the query. A foreign or unknown
    // intent is indistinguishable — both are 404.
    const intent = await getPaymentIntentForMerchant(id, merchantId)
    if (!intent) {
      return NextResponse.json({ error: "Payment intent not found" }, { status: 404 })
    }

    // Defence in depth: the query above already scoped by merchant, but assert it
    // so a future refactor that widens the read cannot silently widen access.
    if (String(intent.merchant_id) !== merchantId) {
      return NextResponse.json({ error: "Payment intent not found" }, { status: 404 })
    }

    // Terminal binding. POS-created intents carry the creating terminal
    // (engine/paymentIntents.ts sets terminal_id from the terminal claims), so a
    // populated value must match exactly — one terminal may not drive another
    // terminal's sale. Intents created outside the POS (hosted checkout, public
    // API) have terminal_id null; those stay merchant-scoped only, because there
    // is no terminal binding to enforce and refusing them would break the
    // legitimate flow where a terminal presents a non-POS intent.
    if (intent.terminal_id && String(intent.terminal_id) !== terminalId) {
      return NextResponse.json({ error: "Payment intent not found" }, { status: 404 })
    }

    const body = (await req.json()) as Partial<PosBaseSession> & { clear?: boolean }

    if (body.step && !ALLOWED_STEPS.has(body.step)) {
      return NextResponse.json({ error: "Invalid step value" }, { status: 400 })
    }

    if (body.pairingUri && !String(body.pairingUri).startsWith("wc:")) {
      return NextResponse.json({ error: "Invalid pairing URI format" }, { status: 400 })
    }

    const existingMeta = (intent.metadata || {}) as Record<string, unknown>
    if (body.clear === true) {
      const restMetadata = { ...existingMeta }
      delete restMetadata.pos_base_session
      const { error } = await supabaseAdmin
        .from("payment_intents")
        .update({ metadata: restMetadata, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("merchant_id", merchantId)

      if (error) {
        throw new Error(`DB update failed: ${error.message}`)
      }

      return NextResponse.json({ ok: true, session: null })
    }

    const existingSession = (existingMeta.pos_base_session || {}) as Partial<PosBaseSession>

    const updated: PosBaseSession = {
      controller: "pos_terminal",
      pairingUri: body.pairingUri ?? existingSession.pairingUri,
      selectedAsset: body.selectedAsset ?? existingSession.selectedAsset,
      step: body.step ?? existingSession.step,
      walletAddressMasked: body.walletAddressMasked ?? existingSession.walletAddressMasked,
      txHash: body.txHash ?? existingSession.txHash,
      errorMessage: body.errorMessage ?? existingSession.errorMessage,
      updatedAt: Date.now(),
    }

    const updatedMetadata = { ...existingMeta, pos_base_session: updated }

    const { error } = await supabaseAdmin
      .from("payment_intents")
      .update({ metadata: updatedMetadata, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("merchant_id", merchantId)

    if (error) {
      throw new Error(`DB update failed: ${error.message}`)
    }

    return NextResponse.json({ ok: true, session: updated })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(err) })
  }
}

type PosBaseSession = {
  controller: "pos_terminal"
  pairingUri?: string
  selectedAsset?: "ETH" | "USDC"
  step?: string
  walletAddressMasked?: string
  txHash?: string
  errorMessage?: string
  updatedAt: number
}
