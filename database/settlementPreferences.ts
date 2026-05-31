import { supabase, supabaseAdmin } from "./supabase"

const db = supabaseAdmin || supabase

const TABLE = "merchant_settlement_preferences"

export type SettlementMode = "manual" | "end_of_day" | "auto"

export type SettlementPreferenceRecord = {
  id: string
  merchant_id: string
  mode: SettlementMode
  end_of_day_time: string | null
  timezone: string | null
  created_at: string
  updated_at: string
}

const DEFAULT_PREFERENCE: Pick<SettlementPreferenceRecord, "mode" | "end_of_day_time" | "timezone"> = {
  mode: "manual",
  end_of_day_time: null,
  timezone: null
}

function normalize(row: Record<string, unknown>): SettlementPreferenceRecord {
  return {
    id: String(row.id || ""),
    merchant_id: String(row.merchant_id || ""),
    mode: (String(row.mode || "manual")) as SettlementMode,
    end_of_day_time: row.end_of_day_time != null ? String(row.end_of_day_time) : null,
    timezone: row.timezone != null ? String(row.timezone) : null,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || "")
  }
}

/**
 * Returns the merchant's settlement preference, or a default if none exists.
 * Resilient: returns the default if the table doesn't exist yet (migration not run).
 */
export async function getSettlementPreference(
  merchantId: string
): Promise<{ mode: SettlementMode; end_of_day_time: string | null; timezone: string | null; exists: boolean }> {
  try {
    const { data, error } = await db
      .from(TABLE)
      .select("*")
      .eq("merchant_id", merchantId)
      .maybeSingle()

    if (error) return { ...DEFAULT_PREFERENCE, exists: false }
    if (!data) return { ...DEFAULT_PREFERENCE, exists: false }

    const record = normalize(data as Record<string, unknown>)
    return { mode: record.mode, end_of_day_time: record.end_of_day_time, timezone: record.timezone, exists: true }
  } catch {
    return { ...DEFAULT_PREFERENCE, exists: false }
  }
}

/**
 * Upsert the merchant's settlement preference.
 * Resilient: silently returns the default if the table doesn't exist yet.
 */
export async function upsertSettlementPreference(
  merchantId: string,
  mode: SettlementMode,
  opts?: { endOfDayTime?: string | null; timezone?: string | null }
): Promise<{ mode: SettlementMode; saved: boolean }> {
  const now = new Date().toISOString()

  try {
    const { error } = await db
      .from(TABLE)
      .upsert({
        merchant_id: merchantId,
        mode,
        end_of_day_time: opts?.endOfDayTime ?? null,
        timezone: opts?.timezone ?? null,
        updated_at: now
      }, { onConflict: "merchant_id" })

    if (error) return { mode, saved: false }
    return { mode, saved: true }
  } catch {
    return { mode, saved: false }
  }
}
