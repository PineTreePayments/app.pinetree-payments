import { NextRequest, NextResponse } from "next/server"
import { getOffRampDepositInstructionPreviewForMerchant } from "@/engine/offRampOperations"
import { OffRampProviderError } from "@/providers/offramp/types"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

type RouteContext = {
  params: Promise<{ id: string }>
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function getPreviewStatus(error: unknown) {
  if (error instanceof OffRampProviderError) return error.status

  const message = getErrorMessage(error, "")
  if (message === "Off-ramp session not found") return 404
  if (
    message === "Missing off-ramp session ID" ||
    message === "Invalid off-ramp amount" ||
    message.includes("Unsupported off-ramp") ||
    message.includes("not ready for deposit instruction preview")
  ) {
    return 400
  }

  return getRouteErrorStatus(error)
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const { id } = await context.params
    const result = await getOffRampDepositInstructionPreviewForMerchant({
      merchantId,
      sessionId: id
    })

    return NextResponse.json({
      success: true,
      ...result
    })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to preview deposit instructions") },
      { status: getPreviewStatus(error) }
    )
  }
}
