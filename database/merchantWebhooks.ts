import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"
export {
  LEGACY_WEBHOOK_EVENTS,
  SUPPORTED_WEBHOOK_EVENTS,
  WEBHOOK_SCHEMA,
  normalizeWebhookEventType,
  webhookSubscriptionMatches,
  type CanonicalWebhookEvent,
  type LegacyWebhookEvent,
  type WebhookEvent,
} from "@/lib/webhooks/events"
import type { WebhookEvent } from "@/lib/webhooks/events"

const supabase = supabaseAdmin || supabaseAnon

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

export type WebhookDeliveryStatus = "pending" | "delivered" | "failed" | "dead_letter"

export const WEBHOOK_MAX_DELIVERY_ATTEMPTS = 10
export const WEBHOOK_RETRY_DELAYS_SECONDS = [60, 120, 240, 480, 960, 1800, 3600] as const

function getNextRetryAt(status: WebhookDeliveryStatus, attemptCount: number) {
  if (status !== "failed") return null
  const index = Math.min(Math.max(attemptCount - 1, 0), WEBHOOK_RETRY_DELAYS_SECONDS.length - 1)
  return new Date(Date.now() + WEBHOOK_RETRY_DELAYS_SECONDS[index] * 1000).toISOString()
}

function normalizeDeliveryStatus(status: WebhookDeliveryStatus, attemptCount: number) {
  if (status === "failed" && attemptCount >= WEBHOOK_MAX_DELIVERY_ATTEMPTS) return "dead_letter" as const
  return status
}

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
  next_attempt_at: string | null
  last_attempt_at: string | null
  last_status_code: number | null
  last_error: string | null
  delivered_at: string | null
  dead_lettered_at: string | null
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

export async function getMerchantWebhookById(
  id: string,
  merchantId: string
): Promise<MerchantWebhook | null> {
  const { data, error } = await supabase
    .from("merchant_webhooks")
    .select("*")
    .eq("id", id)
    .eq("merchant_id", merchantId)
    .maybeSingle()

  if (error) throw new Error(`Failed to fetch webhook config: ${error.message}`)
  return (data ?? null) as MerchantWebhook | null
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
  lastError?: string | null
}): Promise<WebhookDelivery | null> {
  const now = new Date().toISOString()
  const status = normalizeDeliveryStatus(input.status, input.attemptCount)
  const { data, error } = await supabase.from("webhook_deliveries").insert({
    id: crypto.randomUUID(),
    merchant_id: input.merchantId,
    webhook_id: input.webhookId,
    event: input.event,
    payload: input.payload,
    status,
    response_status: input.responseStatus,
    response_body: input.responseBody,
    attempt_count: input.attemptCount,
    last_attempt_at: now,
    last_status_code: input.responseStatus,
    last_error: input.lastError ?? null,
    delivered_at: status === "delivered" ? now : null,
    dead_lettered_at: status === "dead_letter" ? now : null,
    next_attempt_at: getNextRetryAt(status, input.attemptCount),
  }).select().single()

  if (error) {
    console.error("[webhook] failed to log delivery:", error.message)
    return null
  }
  return data as WebhookDelivery
}

export async function getWebhookDeliveryById(
  id: string,
  merchantId: string
): Promise<WebhookDelivery | null> {
  const { data, error } = await supabase
    .from("webhook_deliveries")
    .select("*")
    .eq("id", id)
    .eq("merchant_id", merchantId)
    .maybeSingle()

  if (error) throw new Error(`Failed to load webhook delivery: ${error.message}`)
  return (data ?? null) as WebhookDelivery | null
}

export async function updateWebhookDeliveryAttempt(input: {
  id: string
  merchantId: string
  status: WebhookDeliveryStatus
  responseStatus: number | null
  responseBody: string | null
  lastError: string | null
  attemptCount: number
}): Promise<WebhookDelivery> {
  const now = new Date().toISOString()
  const status = normalizeDeliveryStatus(input.status, input.attemptCount)
  const { data, error } = await supabase
    .from("webhook_deliveries")
    .update({
      status,
      response_status: input.responseStatus,
      response_body: input.responseBody,
      attempt_count: input.attemptCount,
      last_attempt_at: now,
      last_status_code: input.responseStatus,
      last_error: input.lastError,
      delivered_at: status === "delivered" ? now : null,
      dead_lettered_at: status === "dead_letter" ? now : null,
      next_attempt_at: getNextRetryAt(status, input.attemptCount),
      updated_at: now,
    })
    .eq("id", input.id)
    .eq("merchant_id", input.merchantId)
    .select()
    .single()

  if (error) throw new Error(`Failed to update webhook delivery: ${error.message}`)
  return data as WebhookDelivery
}

export async function listWebhookDeliveriesForPublicApi(input: {
  merchantId: string
  limit: number
  cursor?: { createdAt: string; id: string }
  status?: WebhookDeliveryStatus
  eventType?: WebhookEvent
}): Promise<WebhookDelivery[]> {
  let query = supabase
    .from("webhook_deliveries")
    .select("*")
    .eq("merchant_id", input.merchantId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(input.limit)

  if (input.status) query = query.eq("status", input.status)
  if (input.eventType) query = query.eq("event", input.eventType)
  if (input.cursor) {
    query = query.or(
      `created_at.lt.${input.cursor.createdAt},and(created_at.eq.${input.cursor.createdAt},id.lt.${input.cursor.id})`
    )
  }

  const { data, error } = await query
  if (error) throw new Error(`Failed to list webhook deliveries: ${error.message}`)
  return (data ?? []) as WebhookDelivery[]
}

export async function listRetryEligibleWebhookDeliveries(
  limit = 50,
  now = new Date().toISOString()
): Promise<WebhookDelivery[]> {
  const { data, error } = await supabase
    .from("webhook_deliveries")
    .select("*")
    .eq("status", "failed")
    .lte("next_attempt_at", now)
    .order("next_attempt_at", { ascending: true })
    .limit(limit)

  if (error) throw new Error(`Failed to list retryable webhook deliveries: ${error.message}`)
  return (data ?? []) as WebhookDelivery[]
}
