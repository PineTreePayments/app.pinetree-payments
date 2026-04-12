import { supabase, supabaseAdmin } from "./supabase"

const db = supabaseAdmin || supabase

type MerchantInsertRow = {
  id: string
  email: string
  business_name: string
  provider: string
  created_at?: string
}

export async function createValidationMerchantRecord(input: {
  email: string
  businessName: string
  provider: string
}) {
  const row: MerchantInsertRow = {
    id: crypto.randomUUID(),
    email: String(input.email || "").trim().toLowerCase(),
    business_name: String(input.businessName || "").trim(),
    provider: String(input.provider || "").trim(),
    created_at: new Date().toISOString()
  }

  const { data, error } = await db
    .from("merchants")
    .insert(row)
    .select("id,email,business_name,provider,created_at")
    .single()

  if (error) {
    throw new Error(`Failed to create validation merchant: ${error.message}`)
  }

  return data
}

export async function markMerchantShift4ApplicationPendingByEmail(email: string) {
  const normalizedEmail = String(email || "").trim().toLowerCase()
  if (!normalizedEmail) {
    throw new Error("Email is required")
  }

  const { data, error } = await db
    .from("merchants")
    .update({
      application_started: true,
      application_status: "pending",
      updated_at: new Date().toISOString()
    })
    .eq("email", normalizedEmail)
    .select("id,email,application_started,application_status")
    .single()

  if (error) {
    throw new Error(`Failed to update merchant onboarding status: ${error.message}`)
  }

  return data
}
