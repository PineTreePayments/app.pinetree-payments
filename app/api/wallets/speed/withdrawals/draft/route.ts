import { NextRequest, NextResponse } from "next/server"
import {
  createSpeedWithdrawalDraftForMerchant,
  type SpeedWithdrawalDestinationType
} from "@/engine/walletOperations"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

type SpeedWithdrawalDraftBody = {
  walletId?: string | null
  amount?: number | string
  destinationType?: SpeedWithdrawalDestinationType
  destinationValue?: string | null
  memo?: string | null
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = (await req.json().catch(() => null)) as SpeedWithdrawalDraftBody | null

    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const result = await createSpeedWithdrawalDraftForMerchant({
      merchantId,
      walletId: body.walletId || null,
      amount: Number(body.amount),
      destinationType: body.destinationType || "lightning_invoice",
      destinationValue: body.destinationValue || null,
      memo: body.memo || null
    })

    return NextResponse.json(
      {
        success: result.success,
        operation: result.operation,
        eventType: result.eventType,
        message: result.message,
        providerCallsEnabled: false,
        fundMovementEnabled: false,
        nextStep: result.nextStep
      },
      { status: result.success ? 201 : 400 }
    )
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to create Speed withdrawal draft") },
      { status: getRouteErrorStatus(error) }
    )
  }
}
