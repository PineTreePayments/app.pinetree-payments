import { supabase, supabaseAdmin } from "@/database/supabase"
import {
  isCardSetupProvider,
  type CardSetupProvider,
  type CardSetupStatus
} from "@/engine/cardProviderSetup"

const db = supabaseAdmin || supabase

type JsonObject = { [key: string]: unknown }

export type AdminProviderOnboardingRow = {
  merchantId: string
  provider: CardSetupProvider
  status: string
  enabled: boolean
  applicationStatus: CardSetupStatus
  setupStartedAt: string | null
  setupSubmittedAt: string | null
  setupReturnedAt: string | null
  approvedAt: string | null
  deniedAt: string | null
  updatedAt: string | null
}

function normalizeApplicationStatus(value: unknown): CardSetupStatus {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "approved") return "approved"
  if (normalized === "denied" || normalized === "rejected" || normalized === "declined") return "denied"
  if (normalized === "pending" || normalized === "setup_started") return "pending"
  return "not_started"
}

function toAdminRow(row: {
  merchant_id?: string
  provider?: string
  status?: string
  enabled?: boolean
  credentials?: JsonObject | null
  updated_at?: string | null
}): AdminProviderOnboardingRow | null {
  const provider = String(row.provider || "")
  if (!isCardSetupProvider(provider)) return null
  const credentials = row.credentials || {}

  return {
    merchantId: String(row.merchant_id || ""),
    provider,
    status: String(row.status || ""),
    enabled: Boolean(row.enabled),
    applicationStatus: normalizeApplicationStatus(credentials.application_status || row.status),
    setupStartedAt: typeof credentials.setup_started_at === "string" ? credentials.setup_started_at : null,
    setupSubmittedAt: typeof credentials.setup_submitted_at === "string" ? credentials.setup_submitted_at : null,
    setupReturnedAt: typeof credentials.setup_returned_at === "string" ? credentials.setup_returned_at : null,
    approvedAt: typeof credentials.approved_at === "string" ? credentials.approved_at : null,
    deniedAt: typeof credentials.denied_at === "string" ? credentials.denied_at : null,
    updatedAt: row.updated_at || null
  }
}

export async function listAdminProviderOnboarding(): Promise<AdminProviderOnboardingRow[]> {
  const { data, error } = await db
    .from("merchant_providers")
    .select("merchant_id,provider,status,enabled,credentials,updated_at")
    .in("provider", ["stripe", "fluidpay"])
    .order("updated_at", { ascending: false })

  if (error) {
    throw new Error(`Failed to load provider onboarding: ${error.message}`)
  }

  return ((data || []) as Array<{
    merchant_id?: string
    provider?: string
    status?: string
    enabled?: boolean
    credentials?: JsonObject | null
    updated_at?: string | null
  }>)
    .map(toAdminRow)
    .filter((row): row is AdminProviderOnboardingRow => Boolean(row))
}

export async function updateAdminProviderOnboardingStatus(args: {
  merchantId: string
  provider: string
  applicationStatus: "approved" | "denied"
  adminId: string
}): Promise<AdminProviderOnboardingRow> {
  if (!isCardSetupProvider(args.provider)) {
    throw new Error("Unsupported provider")
  }

  const now = new Date().toISOString()
  const { data: existing, error: lookupError } = await db
    .from("merchant_providers")
    .select("merchant_id,provider,status,enabled,credentials,updated_at")
    .eq("merchant_id", args.merchantId)
    .eq("provider", args.provider)
    .maybeSingle()

  if (lookupError) {
    throw new Error(`Failed loading provider onboarding: ${lookupError.message}`)
  }
  if (!existing) {
    throw new Error("Provider onboarding record not found")
  }

  const existingCredentials = (existing.credentials || {}) as JsonObject
  const credentials: JsonObject = {
    ...existingCredentials,
    application_status: args.applicationStatus,
    reviewed_at: now,
    reviewed_by: args.adminId
  }

  const approvedProviderCanProcessPayments = args.provider === "stripe"
  const update = args.applicationStatus === "approved"
    ? {
        status: "active",
        enabled: approvedProviderCanProcessPayments,
        credentials: {
          ...credentials,
          approved_at: now,
          denied_at: existingCredentials.denied_at || null
        },
        updated_at: now
      }
    : {
        status: "denied",
        enabled: false,
        credentials: {
          ...credentials,
          denied_at: now,
          approved_at: existingCredentials.approved_at || null
        },
        updated_at: now
      }

  const { data, error } = await db
    .from("merchant_providers")
    .update(update)
    .eq("merchant_id", args.merchantId)
    .eq("provider", args.provider)
    .select("merchant_id,provider,status,enabled,credentials,updated_at")
    .single()

  if (error || !data) {
    throw new Error(`Failed updating provider onboarding: ${error?.message || "unknown error"}`)
  }

  const row = toAdminRow(data)
  if (!row) throw new Error("Updated provider onboarding record is invalid")
  return row
}
