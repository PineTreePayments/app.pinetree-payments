import { NextRequest, NextResponse } from "next/server"
import { createFeedback } from "@/engine/support/createFeedback"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

type FeedbackBody = {
  type?: string
  message?: string
  rating?: number | null
}

function getFeedbackApiError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback
  const missingStorage =
    message.includes("merchant_feedback") ||
    message.includes("schema cache") ||
    message.includes("Could not find the table")

  if (missingStorage) {
    console.error("[support:feedback] storage unavailable", { error: message })
    return {
      message: "Support storage is not enabled yet. Apply the Help Center database migration to send feedback.",
      status: 503
    }
  }

  return {
    message,
    status: getRouteErrorStatus(error)
  }
}

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = (await req.json()) as FeedbackBody

    if (!body.message) {
      return NextResponse.json({ error: "message is required" }, { status: 400 })
    }

    const feedback = await createFeedback({
      merchantId,
      type: body.type || "Other",
      message: body.message,
      rating: body.rating
    })

    return NextResponse.json({ feedback }, { status: 201 })
  } catch (error: unknown) {
    const apiError = getFeedbackApiError(error, "Failed to save feedback")
    return NextResponse.json(
      { error: apiError.message },
      { status: apiError.status }
    )
  }
}
