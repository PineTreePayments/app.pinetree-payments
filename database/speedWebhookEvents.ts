import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const supabase = supabaseAdmin || supabaseAnon

const TABLE = "speed_webhook_events"

export type SpeedWebhookEventRecord = {
  id: string
  provider_event_id: string
  event_type: string
  account_id: string | null
  merchant_id: string | null
  wallet_operation_id: string | null
  processed_at: string | null
  received_at: string
  raw_payload: Record<string, unknown> | null
}

/**
 * Claims a webhook event by its provider event id (Speed's `webhook-id`
 * header). Returns `claimed: false` when the event was already recorded -
 * callers must treat that as "already processed, acknowledge and stop" so a
 * redelivered/duplicate webhook can never normalize into a wallet operation
 * twice.
 */
export async function claimSpeedWebhookEvent(input: {
  providerEventId: string
  eventType: string
  accountId: string | null
  merchantId: string | null
  rawPayload: Record<string, unknown> | null
}): Promise<{ claimed: true; record: SpeedWebhookEventRecord } | { claimed: false; record: SpeedWebhookEventRecord }> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      provider_event_id: input.providerEventId,
      event_type: input.eventType,
      account_id: input.accountId,
      merchant_id: input.merchantId,
      raw_payload: input.rawPayload,
    })
    .select()
    .single()

  if (!error) return { claimed: true, record: data as SpeedWebhookEventRecord }
  if (error.code !== "23505") {
    throw new Error(`Failed to claim Speed webhook event: ${error.message}`)
  }

  const { data: existing, error: lookupError } = await supabase
    .from(TABLE)
    .select("*")
    .eq("provider_event_id", input.providerEventId)
    .maybeSingle()

  if (lookupError || !existing) {
    throw new Error("Failed to load existing Speed webhook event after idempotency conflict")
  }
  return { claimed: false, record: existing as SpeedWebhookEventRecord }
}

export async function markSpeedWebhookEventProcessed(
  id: string,
  walletOperationId: string | null
): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .update({ processed_at: new Date().toISOString(), wallet_operation_id: walletOperationId })
    .eq("id", id)

  if (error) throw new Error(`Failed to mark Speed webhook event processed: ${error.message}`)
}
