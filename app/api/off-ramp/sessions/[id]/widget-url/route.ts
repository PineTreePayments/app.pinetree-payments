import { NextRequest, NextResponse } from "next/server"
import { createOffRampWidgetLaunchForMerchant } from "@/engine/offRampOperations"
import { OffRampProviderError } from "@/providers/offramp/types"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

type WidgetUrlBody = {
  sourceWalletAddress?: string | null
  refundWalletAddress?: string | null
  redirectPath?: string | null
  merchantState?: string | null
}

type RouteContext = {
  params: Promise<{ id: string }>
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function getWidgetUrlStatus(error: unknown) {
  if (error instanceof OffRampProviderError) return error.status

  const message = getErrorMessage(error, "")
  if (message === "Off-ramp session not found") return 404
  if (
    message === "Missing off-ramp session ID" ||
    message === "Invalid off-ramp amount" ||
    message.includes("Unsupported off-ramp") ||
    message.includes("must have a ready quote")
  ) {
    return 400
  }

  return getRouteErrorStatus(error)
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const { id } = await context.params
    const body = (await req.json().catch(() => ({}))) as WidgetUrlBody
    const result = await createOffRampWidgetLaunchForMerchant({
      merchantId,
      sessionId: id,
      sourceWalletAddress: body.sourceWalletAddress || null,
      refundWalletAddress: body.refundWalletAddress || null,
      redirectPath: body.redirectPath || null,
      merchantState: body.merchantState || null
    })

    return NextResponse.json({
      success: true,
      session: result.session,
      provider: result.provider,
      widgetUrl: result.widgetUrl,
      signed: result.signed,
      expiresAt: result.expiresAt || null,
      providerCallsEnabled: result.providerCallsEnabled,
      fundMovementEnabled: false,
      nextStep: result.nextStep
    })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to prepare MoonPay widget URL") },
      { status: getWidgetUrlStatus(error) }
    )
  }
}
