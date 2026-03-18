import { NextRequest, NextResponse } from "next/server"
import { processWebhook } from "@/lib/engine/webhookProcessor"

export async function POST(req: NextRequest) {

  try {

    const payload = await req.json()

    const provider =
      req.headers.get("x-provider") || "coinbase"

    const headers = Object.fromEntries(req.headers)

    await processWebhook({
      provider,
      payload,
      headers
    })

    return NextResponse.json({ received: true })

  } catch (err) {

    console.error("Webhook error:", err)

    return NextResponse.json(
      { error: "Webhook failed" },
      { status: 500 }
    )

  }

}