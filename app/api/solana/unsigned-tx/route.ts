import { NextRequest, NextResponse } from "next/server"
import { getSolanaUnsignedTransaction } from "@/engine/solanaSplitTransaction"

export async function GET(req: NextRequest) {
  const paymentId = String(req.nextUrl.searchParams.get("paymentId") || "").trim()
  const account = String(req.nextUrl.searchParams.get("account") || "").trim()

  if (!paymentId) {
    return NextResponse.json({ error: "Missing paymentId" }, { status: 400 })
  }
  if (!account) {
    return NextResponse.json({ error: "Missing account" }, { status: 400 })
  }

  try {
    const transaction = await getSolanaUnsignedTransaction({ paymentId, senderAccount: account })
    return NextResponse.json({ transaction, paymentId })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build transaction"
    const lower = message.toLowerCase()

    if (
      lower.includes("missing paymentid") ||
      lower.includes("missing sender") ||
      lower.includes("invalid payer")
    ) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    if (lower.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 })
    }
    if (lower.includes("no longer payable") || lower.includes("not solana network")) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    if (
      lower.includes("solana usdc token account") ||
      lower.includes("insufficient solana usdc balance") ||
      lower.includes("pinetree solana usdc mint")
    ) {
      return NextResponse.json({ error: message }, { status: 422 })
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
