import { NextRequest, NextResponse, after } from "next/server"
import { buildSolanaSplitTransactionEngine } from "@/engine/solanaSplitTransaction"
import { getPaymentById } from "@/database"
import { queueSingleWatcherIteration } from "@/engine/paymentStatusOrchestrator"

// After the response is sent to the wallet, run staggered blockchain checks.
// Solana confirms in 1-3s; we check at 8s, 20s, and 40s from now.
// All three checks together stay well under Vercel's 60s function limit.
// This fires once per transaction regardless of how many POS terminals are watching.
function scheduleWatcherChecks(paymentId: string) {
  after(async () => {
    const start = Date.now()
    const checkOffsets = [8_000, 20_000, 40_000] // ms from start

    for (const offset of checkOffsets) {
      const wait = offset - (Date.now() - start)
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))

      try {
        const payment = await getPaymentById(paymentId)
        if (!payment) break
        const s = String(payment.status || "").toUpperCase()
        if (s === "CONFIRMED" || s === "FAILED" || s === "INCOMPLETE") break
        await queueSingleWatcherIteration(payment, "solana-pay:post:background")
      } catch {
        // non-fatal — Supabase realtime will still deliver updates when DB changes
      }
    }
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

    // Schedule background blockchain checks — fires after response is sent to the wallet
    scheduleWatcherChecks(paymentId)

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
