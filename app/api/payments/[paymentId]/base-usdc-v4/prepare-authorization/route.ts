import { NextRequest, NextResponse } from "next/server"
import { prepareBaseUsdcV4Authorization } from "@/engine/baseUsdcV4Relayer"

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ paymentId: string }> }
) {
  try {
    const { paymentId } = await context.params
    const body = (await req.json()) as { payerAddress?: string }

    const result = await prepareBaseUsdcV4Authorization({
      paymentId: String(paymentId || "").trim(),
      payerAddress: String(body.payerAddress || "").trim()
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to prepare Base USDC authorization"
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}