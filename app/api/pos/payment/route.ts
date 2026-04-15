import { NextRequest, NextResponse } from "next/server"
import { createPosPaymentIntentEngine } from "@/engine/posPayments"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { amount, currency, terminal } = body

    if (!amount || !terminal?.merchantId) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    const result = await createPosPaymentIntentEngine({
      amount: Number(amount),
      currency: String(currency || "USD"),
      terminal: {
        merchantId: String(terminal.merchantId),
        terminalId: terminal.terminalId ? String(terminal.terminalId) : undefined,
        preferredNetwork: terminal.provider ? String(terminal.provider) : undefined
      }
    })

    return NextResponse.json({
      paymentId: result.paymentId,
      intentId: result.intentId,
      paymentUrl: result.paymentUrl,
      qrCodeUrl: result.qrCodeUrl,
      availableNetworks: result.availableNetworks,
      breakdown: result.breakdown
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error"
    const status = (err as Error & { status?: number }).status || 500
    return NextResponse.json({ error: message }, { status })
  }
}
