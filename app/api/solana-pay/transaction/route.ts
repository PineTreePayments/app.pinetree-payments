import { NextRequest, NextResponse } from "next/server"
import { buildSolanaSplitTransactionEngine } from "@/engine/solanaSplitTransaction"

/**
 * GET — Solana Pay Transaction Request metadata
 *
 * Solana Pay wallets perform a GET before POST to retrieve the label and icon.
 * Without this handler, all Solana Pay QR scans fail immediately in the wallet.
 */
export async function GET(_req: NextRequest) {
  return NextResponse.json({
    label: "PineTree Payments",
    icon: `${process.env.NEXT_PUBLIC_APP_URL || "https://app.pinetree-payments.com"}/pinetree-icon.png`
  })
}

export async function POST(req: NextRequest) {
  try {
    const paymentId = String(req.nextUrl.searchParams.get("paymentId") || "").trim()
    if (!paymentId) {
      return NextResponse.json({ error: "Missing paymentId" }, { status: 400 })
    }

    const body = (await req.json()) as {
      account?: string
    }

    const senderAccount = String(body?.account || "").trim()
    if (!senderAccount) {
      return NextResponse.json({ error: "Missing sender account" }, { status: 400 })
    }

    const serialized = await buildSolanaSplitTransactionEngine({
      paymentId,
      senderAccount
    })

    return NextResponse.json({
      transaction: serialized,
      message: "Sign to complete split payment"
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build Solana split transaction"
    const lower = message.toLowerCase()

    if (lower.includes("missing paymentid") || lower.includes("missing sender account")) {
      return NextResponse.json({ error: message }, { status: 400 })
    }

    if (lower.includes("payment not found")) {
      return NextResponse.json({ error: message }, { status: 404 })
    }

    if (lower.includes("not solana network")) {
      return NextResponse.json({ error: message }, { status: 400 })
    }

    if (lower.includes("missing split wallet metadata")) {
      return NextResponse.json({ error: message }, { status: 500 })
    }

    if (lower.includes("invalid lamport amount")) {
      return NextResponse.json({ error: message }, { status: 422 })
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
