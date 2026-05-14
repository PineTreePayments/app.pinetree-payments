import { supabase, supabaseAdmin } from "./supabase"

const db = supabaseAdmin || supabase

export type MerchantFeedbackRecord = {
  id: string
  merchant_id: string
  user_id: string | null
  type: string
  message: string
  rating: number | null
  created_at: string
}

export type CreateFeedbackRecordInput = {
  merchantId: string
  userId?: string | null
  type: string
  message: string
  rating?: number | null
}

export async function createFeedbackRecord(input: CreateFeedbackRecordInput) {
  const { data, error } = await db
    .from("merchant_feedback")
    .insert({
      merchant_id: input.merchantId,
      user_id: input.userId ?? null,
      type: input.type,
      message: input.message,
      rating: input.rating ?? null
    })
    .select("*")
    .single()

  if (error) {
    throw new Error(`Failed to save feedback: ${error.message}`)
  }

  return data as MerchantFeedbackRecord
}
