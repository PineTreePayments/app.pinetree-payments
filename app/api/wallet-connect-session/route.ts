import { NextRequest, NextResponse } from "next/server"
import {
  deleteWalletConnectSessionEngine,
  generateWalletConnectSessionQrEngine,
  getWalletConnectSessionEngine,
  upsertWalletConnectSessionEngine
} from "@/engine/walletConnectSession"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"

const MAX_SESSION_ID_LENGTH = 256
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_\-:.@]+$/
const ALLOWED_SESSION_STATUSES = new Set(["pending", "connected"])

function isValidSessionId(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false
  if (value.length > MAX_SESSION_ID_LENGTH) return false
  return SESSION_ID_PATTERN.test(value)
}

// GET — merchant dashboard polls for session status. Requires merchant auth.
export async function GET(req: NextRequest) {
  try {
    await requireMerchantIdFromRequest(req)

    const sessionId = req.nextUrl.searchParams.get("session_id")
    const mode = req.nextUrl.searchParams.get("mode")

    if (!isValidSessionId(sessionId)) {
      return NextResponse.json({ error: "Missing or invalid session_id" }, { status: 400 })
    }

    if (mode === "generate") {
      return NextResponse.json(
        generateWalletConnectSessionQrEngine({ sessionId })
      )
    }

    const data = await getWalletConnectSessionEngine({ sessionId })
    return NextResponse.json(data ?? null)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error"
    return NextResponse.json(
      { error: message },
      { status: getRouteErrorStatus(err) }
    )
  }
}

// POST — called from merchant dashboard (create session, status: "pending") and
// from mobile wallet return pages (update session, status: "connected").
// Return pages run in a popup with no auth context, so merchant auth is not
// required here. The session_id is an unguessable UUID that serves as a
// capability token; only one who created the session knows it.
// Status is restricted to the allowed set to prevent arbitrary injection.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (!isValidSessionId(body?.session_id) || !body?.provider) {
      return NextResponse.json(
        { error: "session_id and provider are required" },
        { status: 400 }
      )
    }

    const status = typeof body?.status === "string" ? body.status.trim().toLowerCase() : ""
    if (status && !ALLOWED_SESSION_STATUSES.has(status)) {
      return NextResponse.json({ error: "Invalid status value" }, { status: 400 })
    }

    const data = await upsertWalletConnectSessionEngine(body)

    return NextResponse.json(data)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error"
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}

// DELETE — merchant dashboard cleanup after saving provider credentials. Requires merchant auth.
export async function DELETE(req: NextRequest) {
  try {
    await requireMerchantIdFromRequest(req)

    const body = await req.json()
    const sessionId = body?.session_id

    if (!isValidSessionId(sessionId)) {
      return NextResponse.json({ error: "Missing or invalid session_id" }, { status: 400 })
    }

    const result = await deleteWalletConnectSessionEngine({
      session_id: sessionId
    })

    return NextResponse.json(result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error"
    return NextResponse.json(
      { error: message },
      { status: getRouteErrorStatus(err) }
    )
  }
}