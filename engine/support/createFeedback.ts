import { createFeedbackRecord, type MerchantFeedbackRecord } from "@/database/feedback"
import { feedbackTypes } from "@/lib/help/supportOptions"

type FeedbackValidationError = Error & { status?: number }

function createValidationError(message: string): FeedbackValidationError {
  const error: FeedbackValidationError = new Error(message)
  error.status = 400
  return error
}

export type CreateFeedbackInput = {
  merchantId: string
  userId?: string | null
  type: string
  message: string
  rating?: number | null
}

export async function createFeedback(input: CreateFeedbackInput): Promise<MerchantFeedbackRecord> {
  const merchantId = String(input.merchantId || "").trim()
  const message = String(input.message || "").trim()
  const normalizedType = String(input.type || "").trim().toLowerCase()
  const type = feedbackTypes.find((item) => item.toLowerCase() === normalizedType) ?? "Other"

  if (!merchantId) {
    throw createValidationError("merchantId is required")
  }

  if (!message) {
    throw createValidationError("message is required")
  }

  const numericRating = input.rating === null || input.rating === undefined
    ? null
    : Number(input.rating)
  const rating = numericRating === null || Number.isNaN(numericRating)
    ? null
    : Math.min(5, Math.max(1, Math.round(numericRating)))

  return createFeedbackRecord({
    merchantId,
    userId: input.userId ?? null,
    type,
    message: message.slice(0, 4000),
    rating
  })
}
