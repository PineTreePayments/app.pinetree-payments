import { NextRequest, NextResponse } from "next/server"
import {
  deleteWalletConnectSessionEngine,
  generateWalletConnectSessionQrEngine,
  getWalletConnectSessionEngine,
  upsertWalletConnectSessionEngine
} from "@/engine/walletConnectSession"

export async function GET(req: NextRequest) {
  try {
    const sessionId = req.nextUrl.searchParams.get("session_id")
    const mode = req.nextUrl.searchParams.get("mode")

    if (!sessionId) {
      return NextResponse.json({ error: "Missing session_id" }, { status: 400 })
    }

    // 🔥 MODE 1: GENERATE QR (THIS FIXES YOUR ISSUE)
    if (mode === "generate") {
      return NextResponse.json(
        generateWalletConnectSessionQrEngine({ sessionId })
      )
    }

    // 🔥 MODE 2: FETCH SESSION (YOUR ORIGINAL LOGIC)
    const data = await getWalletConnectSessionEngine({ sessionId })
    return NextResponse.json(data ?? null)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error"
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (!body?.session_id || !body?.provider) {
      return NextResponse.json(
        { error: "session_id and provider are required" },
        { status: 400 }
      )
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

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json()
    const sessionId = body?.session_id

    if (!sessionId) {
      return NextResponse.json({ error: "Missing session_id" }, { status: 400 })
    }

    const result = await deleteWalletConnectSessionEngine({
      session_id: sessionId
    })

    return NextResponse.json(result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error"
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}