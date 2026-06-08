import {
  expirePaymentIntent,
  getPaymentIntentByPaymentId
} from "@/database/paymentIntents"
import { supabaseAdmin, supabase as supabaseAnon } from "@/database/supabase"
import { markPaymentIncomplete } from "./paymentStateActions"
import { CHECKOUT_TIMEOUT_MS } from "./config"

// Re-export so existing importers of stalePaymentSweep do not need updating.
export { CHECKOUT_TIMEOUT_MS }

const db = supabaseAdmin || supabaseAnon

export type StalePaymentSweepSummary = {
  scanned: number
  markedIncomplete: number
  expiredIntents: number
  skipped: number
  cutoff: string
}

export async function sweepStalePayments(options?: {
  maxRows?: number
  staleAfterMs?: number
}): Promise<StalePaymentSweepSummary> {
  const maxRows = Math.max(1, Math.min(options?.maxRows ?? 250, 250))
  const staleAfterMs = Math.max(options?.staleAfterMs ?? CHECKOUT_TIMEOUT_MS, 60_000)
  const cutoff = new Date(Date.now() - staleAfterMs).toISOString()

  const { data, error } = await db
    .from("payments")
    .select("id")
    .in("status", ["CREATED", "PENDING"])
    .lt("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .limit(maxRows)

  if (error) {
    throw new Error(`Failed to load stale payment candidates: ${error.message}`)
  }

  let markedIncomplete = 0
  let expiredIntents = 0

  for (const row of (data || []) as Array<{ id: string }>) {
    const changed = await markPaymentIncomplete(row.id, {
      providerEvent: "maintenance.stale-cleanup",
      rawPayload: { cutoff, staleAfterMs },
      minimumAgeMs: staleAfterMs
    })
    if (!changed) continue

    markedIncomplete += 1
    const intent = await getPaymentIntentByPaymentId(row.id)
    if (intent) {
      await expirePaymentIntent(intent.id)
      expiredIntents += 1
    }
  }

  return {
    scanned: data?.length || 0,
    markedIncomplete,
    expiredIntents,
    skipped: (data?.length || 0) - markedIncomplete,
    cutoff
  }
}
