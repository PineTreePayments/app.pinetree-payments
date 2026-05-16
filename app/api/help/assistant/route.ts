import { NextRequest, NextResponse } from "next/server"
import { getPineTreeAssistantContext } from "@/lib/help/pinetreeAssistantContext"
import { answerPineTreeQuestion } from "@/lib/help/pinetreeAssistant"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

type AssistantRequestBody = {
  message?: string
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = (await req.json().catch(() => ({}))) as AssistantRequestBody
    const message = String(body.message || "").trim()

    if (!message) {
      return NextResponse.json(
        { error: "message is required" },
        { status: 400 }
      )
    }

    const context = await getPineTreeAssistantContext(merchantId)
    const answer = answerPineTreeQuestion(message, context)

    return NextResponse.json({
      answer,
      contextSummary: {
        merchantId: context.merchant?.id || merchantId,
        businessName: context.merchant?.businessName || null,
        walletCount: context.wallets.length,
        providerCount: context.providers.length,
        recentPaymentCount: context.recentPayments.length,
        recentTicketCount: context.recentTickets.length,
        setupSummary: context.setupSummary
      }
    })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to answer PineTree AI question") },
      { status: getRouteErrorStatus(error) }
    )
  }
}
