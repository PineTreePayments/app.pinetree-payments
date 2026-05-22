import { NextRequest, NextResponse } from "next/server"
import { prepareOffRampSessionForMerchant } from "@/engine/offRampOperations"
import { OffRampProviderError } from "@/providers/offramp/types"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

type PrepareBody = {
  merchantState?: string | null
  payoutMethod?: string | null
}

type RouteContext = {
  params: Promise<{ id: string }>
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function getPrepareStatus(error: unknown) {
  if (error instanceof OffRampProviderError) return error.status

  const message = getErrorMessage(error, "")
  if (
    message === "Missing off-ramp session ID" ||
    message === "Invalid off-ramp amount" ||
    message === "Off-ramp session not found" ||
    message.includes("Unsupported off-ramp")
  ) {
    return message === "Off-ramp session not found" ? 404 : 400
  }

  return getRouteErrorStatus(error)
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const { id } = await context.params
    const body = (await req.json().catch(() => ({}))) as PrepareBody
    const result = await prepareOffRampSessionForMerchant({
      merchantId,
      sessionId: id,
      merchantState: body.merchantState || null,
      payoutMethod: body.payoutMethod || null
    })

    const sessionFailed = result.session.status === "FAILED"
    const httpStatus = !sessionFailed
      ? 200
      : result.preparation.status === "NOT_IMPLEMENTED"
        ? 400
        : result.providerCallsEnabled ? 400 : 503

    return NextResponse.json(
      {
        success: !sessionFailed,
        session: result.session,
        quote: result.quote,
        preparation: result.preparation,
        providerCallsEnabled: result.providerCallsEnabled,
        fundMovementEnabled: false
      },
      { status: httpStatus }
    )
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to prepare off-ramp session") },
      { status: getPrepareStatus(error) }
    )
  }
}
