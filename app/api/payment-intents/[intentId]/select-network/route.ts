import { NextRequest, NextResponse } from "next/server"
import { selectPaymentIntentNetworkEngine } from "@/engine/paymentIntents"

type Params = { params: Promise<{ intentId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { intentId } = await params
    const body = (await req.json()) as { network?: string }
    const network = String(body?.network || "").trim().toLowerCase()

    if (!network) {
      return NextResponse.json({ error: "Missing network selection" }, { status: 400 })
    }

    const idempotencyKey = req.headers.get("idempotency-key") || undefined

    const result = await selectPaymentIntentNetworkEngine({
      intentId: String(intentId || "").trim(),
      network,
      idempotencyKey
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to select payment network"
    const status =
      message.includes("not found") ||
      message.includes("Unsupported") ||
      message.includes("not enabled")
        ? 400
        : 500

    return NextResponse.json({ error: message }, { status })
  }
}
