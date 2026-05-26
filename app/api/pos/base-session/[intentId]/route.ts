import { NextRequest, NextResponse } from "next/server"
import { requireTerminalSession } from "@/lib/api/terminalAuth"
import { getPaymentIntentById } from "@/database"
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

    return NextResponse.json({ session })
  } catch {
    return NextResponse.json({ error: "Failed to read session" }, { status: 500 })
  }
}

// POST — POS terminal writes or updates the session state.
// Requires terminal session auth (same as other POS routes).
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { intentId } = await params
    requireTerminalSession(req)

    const id = String(intentId || "").trim()
    if (!id) {
      return NextResponse.json({ error: "Missing intentId" }, { status: 400 })
    }

    const intent = await getPaymentIntentById(id)
    if (!intent) {
      return NextResponse.json({ error: "Payment intent not found" }, { status: 404 })
    }

    const body = (await req.json()) as Partial<PosBaseSession>

    if (body.step && !ALLOWED_STEPS.has(body.step)) {
      return NextResponse.json({ error: "Invalid step value" }, { status: 400 })
    }

    if (body.pairingUri && !String(body.pairingUri).startsWith("wc:")) {
      return NextResponse.json({ error: "Invalid pairing URI format" }, { status: 400 })
    }

    const existingMeta = (intent.metadata || {}) as Record<string, unknown>
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
