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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save feedback" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
