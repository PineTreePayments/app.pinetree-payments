import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase environment variables")
  }

  return createClient(supabaseUrl, serviceRoleKey)
}

export async function GET(req: NextRequest) {
  try {
    const sessionId = req.nextUrl.searchParams.get("session_id")
    const mode = req.nextUrl.searchParams.get("mode")

    if (!sessionId) {
      return NextResponse.json({ error: "Missing session_id" }, { status: 400 })
    }

    const admin = getAdminClient()

    // 🔥 MODE 1: GENERATE QR (THIS FIXES YOUR ISSUE)
    if (mode === "generate") {
      const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID

      if (!projectId) {
        return NextResponse.json(
          { error: "Missing WalletConnect Project ID" },
          { status: 500 }
        )
      }

      const symKey = crypto.randomUUID()

      const uri = `wc:${sessionId}@2?relay-protocol=irn&symKey=${symKey}&projectId=${projectId}`

      const qr = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(uri)}`

      return NextResponse.json({
        session_id: sessionId,
        uri,
        qr,
      })
    }

    // 🔥 MODE 2: FETCH SESSION (YOUR ORIGINAL LOGIC)
    const { data, error } = await admin
      .from("wallet_connection_sessions")
      .select("*")
      .eq("session_id", sessionId)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data ?? null)
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Unexpected error" },
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

    const admin = getAdminClient()

    const { data, error } = await admin
      .from("wallet_connection_sessions")
      .upsert(
        {
          session_id: body.session_id,
          merchant_id: body.merchant_id || null,
          provider: body.provider,
          wallet_type: body.wallet_type || null,
          wallet_address: body.wallet_address || null,
          status: body.status || "pending",
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "session_id",
        }
      )
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Unexpected error" },
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

    const admin = getAdminClient()

    const { error } = await admin
      .from("wallet_connection_sessions")
      .delete()
      .eq("session_id", sessionId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Unexpected error" },
      { status: 500 }
    )
  }
}