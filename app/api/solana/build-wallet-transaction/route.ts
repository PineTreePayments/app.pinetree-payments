import { NextRequest } from "next/server"
import { buildSolanaSplitTransactionEngine } from "@/engine/solanaSplitTransaction"

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { paymentId?: unknown; walletPublicKey?: unknown }
  const paymentId = String(body.paymentId || "").trim()
  const walletPublicKey = String(body.walletPublicKey || "").trim()

  if (!paymentId) {
    return new Response(JSON.stringify({ error: "Missing paymentId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }
  if (!walletPublicKey) {
    return new Response(JSON.stringify({ error: "Missing walletPublicKey" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  try {
    const transaction = await buildSolanaSplitTransactionEngine({
      paymentId,
      senderAccount: walletPublicKey,
    })

    return new Response(JSON.stringify({ transaction }), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build transaction"
    const lower = message.toLowerCase()

    if (lower.includes("missing") || lower.includes("invalid")) {
      return new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (lower.includes("not found")) {
      return new Response(JSON.stringify({ error: message }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (lower.includes("no longer payable") || lower.includes("not solana network")) {
      return new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (
      lower.includes("solana usdc token account") ||
      lower.includes("insufficient solana usdc balance") ||
      lower.includes("pinetree solana usdc mint")
    ) {
      return new Response(JSON.stringify({ error: message }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      })
    }

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
}
