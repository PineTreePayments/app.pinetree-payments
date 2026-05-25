import { NextRequest, NextResponse } from "next/server"
import { resolveBaseV6Strategy } from "@/engine/baseV6StrategyResolver"
import type { BasePayWalletCapabilities } from "@/lib/basePay/strategyOrchestrator"

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ paymentId: string }> }
) {
  let paymentId = ""
  try {
    const params = await context.params
    paymentId = String(params.paymentId || "").trim()
    const body = (await req.json()) as {
      payerAddress?: string
      walletCapabilities?: Partial<BasePayWalletCapabilities>
    }
    const payerAddress = String(body.payerAddress || "").trim()
    const walletCapabilities: BasePayWalletCapabilities = {
      walletFamily: body.walletCapabilities?.walletFamily ?? "unknown",
      supportsSendCalls: body.walletCapabilities?.supportsSendCalls ?? false,
      supportsTypedData: body.walletCapabilities?.supportsTypedData ?? true,
      skipEip3009: body.walletCapabilities?.skipEip3009 ?? false,
      skipDelegatedBatch: body.walletCapabilities?.skipDelegatedBatch ?? true
    }

    console.info("[BASE V6] strategy route entry", {
      paymentId,
      payerAddress,
      walletFamily: walletCapabilities.walletFamily
    })

    const result = await resolveBaseV6Strategy({ paymentId, payerAddress, walletCapabilities })

    console.info("[BASE V6] strategy route response", {
      paymentId,
      ok: result.ok,
      strategy: result.ok ? result.strategy : null
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to resolve Base V6 strategy"
    console.error("[BASE V6] strategy route error", { paymentId, error: message })
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
