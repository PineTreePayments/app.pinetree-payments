import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const supabase = supabaseAdmin || supabaseAnon

export type WebhookEvent =
  | "payment.confirmed"
  | "payment.failed"
  | "payment.incomplete"
  | "checkout.session.created"

export type MerchantWebhook = {
  id: string
  merchant_id: string
  url: string
  secret: string
  events: WebhookEvent[]
  enabled: boolean
  created_at: string
  updated_at: string
}

export type WebhookDeliveryStatus = "pending" | "delivered" | "failed"

export type WebhookDelivery = {
  id: string
  merchant_id: string
  webhook_id: string
  event: WebhookEvent
  payload: Record<string, unknown>
  status: WebhookDeliveryStatus
  response_status: number | null
  response_body: string | null
  attempt_count: number
  created_at: string
  updated_at: string
}

export async function getMerchantWebhook(merchantId: string): Promise<MerchantWebhook | null> {
  const { data, error } = await supabase
    .from("merchant_webhooks")
    .select("*")
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Failed to fetch webhook config: ${error.message}`)
  return data as MerchantWebhook | null
}

export async function upsertMerchantWebhook(input: {
  merchantId: string
  url: string
  secret: string
  events: WebhookEvent[]
  enabled?: boolean
}): Promise<MerchantWebhook> {
  const existing = await getMerchantWebhook(input.merchantId)

  if (existing) {
    const { data, error } = await supabase
      .from("merchant_webhooks")
      .update({
        url: input.url,
        secret: input.secret,
        events: input.events,
        enabled: input.enabled ?? true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .eq("merchant_id", input.merchantId)
      .select()
      .single()

    if (error) throw new Error(`Failed to update webhook config: ${error.message}`)
    return data as MerchantWebhook
  }

  const { data, error } = await supabase
    .from("merchant_webhooks")
    .insert({
      id: crypto.randomUUID(),
      merchant_id: input.merchantId,
      url: input.url,
      secret: input.secret,
      events: input.events,
      enabled: input.enabled ?? true,
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create webhook config: ${error.message}`)
  return data as MerchantWebhook
}

export async function deleteMerchantWebhook(merchantId: string): Promise<void> {
  // Remove delivery records first to satisfy the FK constraint
  // (webhook_deliveries.webhook_id references merchant_webhooks.id).
  // Delivery history is scoped to the endpoint being removed and is no
  // longer actionable once the webhook config is gone.
  const { error: deliveryError } = await supabase
    .from("webhook_deliveries")
    .delete()
    .eq("merchant_id", merchantId)

  if (deliveryError) {
    console.warn("[webhook] failed to delete delivery logs before config delete:", deliveryError.message)
    // Log but do not abort — attempt the config delete anyway
  }

  const { error } = await supabase
    .from("merchant_webhooks")
    .delete()
    .eq("merchant_id", merchantId)

  if (error) throw new Error(`Failed to delete webhook config: ${error.message}`)
}

export async function insertWebhookDelivery(input: {
  merchantId: string
  webhookId: string
  event: WebhookEvent
  payload: Record<string, unknown>
  status: WebhookDeliveryStatus
  responseStatus: number | null
  responseBody: string | null
  attemptCount: number
}): Promise<void> {
  const { error } = await supabase.from("webhook_deliveries").insert({
    id: crypto.randomUUID(),
    merchant_id: input.merchantId,
    webhook_id: input.webhookId,
    event: input.event,
    payload: input.payload,
    status: input.status,
    response_status: input.responseStatus,
    response_body: input.responseBody,
    attempt_count: input.attemptCount,
  })

  if (error) {
    console.error("[webhook] failed to log delivery:", error.message)
  }
}
