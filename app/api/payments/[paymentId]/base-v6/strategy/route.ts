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

    console.info("[BaseV6] usdc_strategy_request_start", {
      paymentId,
      walletFamily: walletCapabilities.walletFamily,
      supportsTypedData: walletCapabilities.supportsTypedData,
      supportsSendCalls: walletCapabilities.supportsSendCalls
    })

    const result = await resolveBaseV6Strategy({ paymentId, payerAddress, walletCapabilities })

    console.info("[BaseV6] usdc_strategy_response", {
      paymentId,
      strategy: result.ok ? result.strategy : null,
      fallbackStrategy: result.ok ? result.fallbackStrategy : null,
      relayerAvailable: result.ok ? result.relayerAvailable : false,
      allowanceSufficient: result.ok ? result.allowanceSufficient : false,
      requiredUsdcAmount: result.ok ? result.requiredUsdcAmount : "0",
      currentAllowance: result.ok ? result.currentAllowance : "0",
      walletFamily: result.ok ? result.walletFamily : walletCapabilities.walletFamily,
      supportsTypedData: result.ok ? result.supportsTypedData : walletCapabilities.supportsTypedData,
      supportsSendCalls: result.ok ? result.supportsSendCalls : walletCapabilities.supportsSendCalls
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to resolve Base V6 strategy"
    console.error("[BaseV6] error", { paymentId, reason: message })
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
