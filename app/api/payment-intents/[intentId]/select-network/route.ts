import { NextRequest, NextResponse } from "next/server"
import { selectPaymentIntentNetworkEngine } from "@/engine/paymentIntents"

type Params = { params: Promise<{ intentId: string }> }

function classifySelectNetworkError(message: string) {
  const normalized = message.toLowerCase()

  if (normalized.includes("timed out")) {
    return { status: 504, code: "PAYMENT_DETAILS_TIMEOUT" }
  }

  if (
    normalized.includes("missing pinetree treasury wallet") ||
    normalized.includes("missing required environment variables") ||
    normalized.includes("invalid pinetree treasury wallet format")
  ) {
    return { status: 500, code: "TREASURY_CONFIG_ERROR" }
  }

  if (
    normalized.includes("payment intent not found") ||
    normalized.includes("unsupported") ||
    normalized.includes("not enabled") ||
    normalized.includes("no wallet configured for merchant") ||
    normalized.includes("no payment provider connected")
  ) {
    return { status: 400, code: "PAYMENT_SETUP_ERROR" }
  }

  return { status: 500, code: "SELECT_NETWORK_FAILED" }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { intentId } = await params
    const body = (await req.json()) as { network?: string; asset?: string }
    const network = String(body?.network || "").trim().toLowerCase()
    const asset = body?.asset ? String(body.asset).trim().toUpperCase() : undefined

    if (!network) {
      return NextResponse.json({ error: "Missing network selection" }, { status: 400 })
    }

    const idempotencyKey = req.headers.get("idempotency-key") || undefined

    const result = await selectPaymentIntentNetworkEngine({
      intentId: String(intentId || "").trim(),
      network,
      asset,
      idempotencyKey
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to select payment network"
    const { status, code } = classifySelectNetworkError(message)

    return NextResponse.json({ error: message, code }, { status })
  }
}
