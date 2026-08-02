import { supabaseAdmin } from "./supabase"
import type { Shift4OnboardingStatus, Shift4OnboardingUpdate } from "@/providers/shift4/onboarding"

function db() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Shift4 onboarding requires service-role database access")
  return supabaseAdmin
}

export type Shift4OnboardingSessionRow = Readonly<{
  id: string; merchant_id: string; merchant_provider_connection_id: string; provider_application_id: string;
  launch_reference: string; hosted_application_url: string | null; status: Shift4OnboardingStatus;
  status_reason_code: string | null; correlation_id: string; submitted_at: string | null; received_at: string | null;
  reviewed_at: string | null; created_at: string; updated_at: string
}>

const COLUMNS = "id, merchant_id, merchant_provider_connection_id, provider_application_id, launch_reference, hosted_application_url, status, status_reason_code, correlation_id, submitted_at, received_at, reviewed_at, created_at, updated_at"

export async function createShift4OnboardingSession(input: {
  merchantId: string; merchantProviderConnectionId: string; providerApplicationId: string; launchReference: string;
  hostedApplicationUrl: string | null; status: Shift4OnboardingStatus; correlationId: string
}): Promise<Shift4OnboardingSessionRow> {
  const { data, error } = await db().rpc("create_shift4_onboarding_session", {
    p_merchant_id: input.merchantId, p_merchant_provider_connection_id: input.merchantProviderConnectionId,
    p_provider_application_id: input.providerApplicationId, p_launch_reference: input.launchReference,
    p_hosted_application_url: input.hostedApplicationUrl, p_status: input.status, p_correlation_id: input.correlationId,
  })
  if (error) throw new Error(`Failed to create Shift4 onboarding session: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error("Shift4 onboarding session creation returned no row")
  return row as Shift4OnboardingSessionRow
}

export async function getLatestShift4OnboardingSession(merchantId: string): Promise<Shift4OnboardingSessionRow | null> {
  const { data, error } = await db().from("shift4_onboarding_sessions").select(COLUMNS)
    .eq("merchant_id", merchantId).order("created_at", { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error(`Failed to load Shift4 onboarding session: ${error.message}`)
  return (data || null) as Shift4OnboardingSessionRow | null
}

export async function applyShift4OnboardingUpdate(input: { merchantId: string; update: Shift4OnboardingUpdate }): Promise<Shift4OnboardingSessionRow> {
  const { data, error } = await db().rpc("apply_shift4_onboarding_update", {
    p_merchant_id: input.merchantId, p_provider_application_id: input.update.providerApplicationId,
    p_update_reference: input.update.updateReference, p_status: input.update.status,
    p_status_reason_code: input.update.reasonCode, p_occurred_at: input.update.occurredAt,
    p_correlation_id: input.update.correlationId, p_verified: input.update.verified,
    p_source: input.update.source,
  })
  if (error) throw new Error(`Failed to apply Shift4 onboarding update: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error("Shift4 onboarding update returned no session")
  return row as Shift4OnboardingSessionRow
}
