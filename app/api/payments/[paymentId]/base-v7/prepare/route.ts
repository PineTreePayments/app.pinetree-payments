import { NextRequest, NextResponse } from "next/server"
import { prepareBaseV7Authorization } from "@/engine/baseV7Relayer"

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ paymentId: string }> }
) {
  let paymentId = ""
  try {
    const params = await context.params
    paymentId = String(params.paymentId || "").trim()
    const body = (await req.json()) as { payerAddress?: string }
    const payerAddress = String(body.payerAddress || "").trim()

    console.info("[BASE V7] prepare route entry", { paymentId })

    const result = await prepareBaseV7Authorization({ paymentId, payerAddress })

    if (result.ok) {
      console.info("[BASE V7] prepare route success", {
        paymentId,
        hasTypedData: Boolean((result as Record<string, unknown>).typedData),
        hasAuthorization: Boolean((result as Record<string, unknown>).authorization)
      })
    } else {
      console.warn("[BASE V7] prepare route unavailable", {
        paymentId,
        code: (result as Record<string, unknown>).code || null
      })
    }

    return NextResponse.json(result)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to prepare Base V7 authorization"
    console.error("[BASE V7] prepare route error", { paymentId, error: message })
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
