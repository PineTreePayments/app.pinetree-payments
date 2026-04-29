import { NextRequest, NextResponse } from "next/server"
import { Transaction } from "@solana/web3.js"
import { buildSolanaSplitTransactionEngine } from "@/engine/solanaSplitTransaction"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(req: NextRequest) {
  const paymentId = String(req.nextUrl.searchParams.get("paymentId") || "").trim()
  console.log("SOLANA PAY GET HIT", paymentId)

  return NextResponse.json({
    label: "PineTree Payments",
    icon: "https://app.pinetree-payments.com/pinetree-icon.png"
  }, { headers: CORS_HEADERS })
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now()

  try {
    const paymentId = String(req.nextUrl.searchParams.get("paymentId") || "").trim()
    if (!paymentId) {
      return NextResponse.json({ error: "Missing paymentId" }, { status: 400, headers: CORS_HEADERS })
    }

    const body = (await req.json()) as {
      account?: string
    }

    console.log("SOLANA POST HIT", body?.account)
    console.log("[SOLANA PAY][POST] transaction request", {
      paymentId,
      sender: body?.account,
      url: req.url,
      headers: Object.fromEntries(req.headers.entries())
    })

    const senderAccount = String(body?.account || "").trim()
    if (!senderAccount) {
      return NextResponse.json({ error: "Missing sender account" }, { status: 400, headers: CORS_HEADERS })
    }

    const serializedTxBase64 = await buildSolanaSplitTransactionEngine({
      paymentId,
      senderAccount
    })

    console.log("[SOLANA PAY][POST] transaction response", {
      paymentId,
      senderAccount,
      base64Length: serializedTxBase64.length,
      durationMs: Date.now() - startedAt
    })

    const serialized = Buffer.from(serializedTxBase64, "base64")
    const transaction = Transaction.from(serialized)

    console.log("TX DEBUG", {
      feePayer: transaction.feePayer?.toBase58() || senderAccount,
      blockhash: transaction.recentBlockhash,
      instructions: transaction.instructions.length
    })

    console.log("TX SIZE", serialized.length)

    return NextResponse.json(
      {
        transaction: serializedTxBase64,
        message: "PineTree Payment",
        label: "PineTree"
      },
      {
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS
        }
      }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build Solana split transaction"
    const lower = message.toLowerCase()

    console.error("[SOLANA PAY][POST] transaction error", {
      message,
      durationMs: Date.now() - startedAt,
      stack: error instanceof Error ? error.stack : undefined
    })

    if (
      lower.includes("missing paymentid") ||
      lower.includes("missing sender account") ||
      lower.includes("invalid payer account")
    ) {
      return NextResponse.json({ error: message }, { status: 400, headers: CORS_HEADERS })
    }

    if (lower.includes("payment not found")) {
      return NextResponse.json({ error: message }, { status: 404, headers: CORS_HEADERS })
    }

    if (lower.includes("not solana network")) {
      return NextResponse.json({ error: message }, { status: 400, headers: CORS_HEADERS })
    }

    if (lower.includes("unsupported solana asset") || lower.includes("no longer payable")) {
      return NextResponse.json({ error: message }, { status: 400, headers: CORS_HEADERS })
    }

    if (lower.includes("missing split wallet metadata")) {
      return NextResponse.json({ error: message }, { status: 500, headers: CORS_HEADERS })
    }

    if (lower.includes("invalid lamport amount")) {
      return NextResponse.json({ error: message }, { status: 422, headers: CORS_HEADERS })
    }

    return NextResponse.json({ error: message }, { status: 500, headers: CORS_HEADERS })
  }
}
