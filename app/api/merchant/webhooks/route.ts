import { NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import {
  getMerchantWebhook,
  upsertMerchantWebhook,
  deleteMerchantWebhook,
  SUPPORTED_WEBHOOK_EVENTS,
  normalizeWebhookEventType,
  type CanonicalWebhookEvent,
  type WebhookEvent,
} from "@/database/merchantWebhooks"
import { generateWebhookSecret } from "@/engine/webhookDelivery"
import { insertMerchantAuditEvent } from "@/database/merchantAuditEvents"

const VALID_EVENTS: readonly WebhookEvent[] = SUPPORTED_WEBHOOK_EVENTS

type UpsertBody = {
  url: string
  events?: WebhookEvent[]
  regenerateSecret?: boolean
  enabled?: boolean
}

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req, "webhooks:read")
    const config = await getMerchantWebhook(merchantId)
    return NextResponse.json({
      webhook: config
        ? {
            ...config,
            events: Array.from(new Set(config.events.map((event) => normalizeWebhookEventType(event)).filter(Boolean))),
          }
        : config,
    })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch webhook config" },
      { status: getRouteErrorStatus(error) }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req, "webhooks:write")
    const body = (await req.json()) as UpsertBody

    const url = String(body.url || "").trim()
    if (!url) return NextResponse.json({ error: "url is required" }, { status: 400 })

    try {
      const parsed = new URL(url)
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return NextResponse.json({ error: "url must be http or https" }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: "url must be a valid URL" }, { status: 400 })
    }

    const requestedEvents = Array.isArray(body.events) ? body.events : VALID_EVENTS
    const events = Array.from(new Set(
      requestedEvents
        .map((e) => normalizeWebhookEventType(String(e)))
        .filter((e): e is CanonicalWebhookEvent => Boolean(e))
    ))

    const existing = await getMerchantWebhook(merchantId)
    const isRegeneratingSecret = Boolean(body.regenerateSecret) && Boolean(existing?.secret)
    const secret = isRegeneratingSecret || !existing?.secret
      ? generateWebhookSecret()
      : existing.secret

    // Preserve existing enabled state when not explicitly provided
    const enabled = typeof body.enabled === "boolean" ? body.enabled : (existing?.enabled ?? true)

    const webhook = await upsertMerchantWebhook({ merchantId, url, secret, events, enabled })

    // ── Audit: secret regeneration ─────────────────────────────────────────────
    // Write an audit record when the signing secret is intentionally rotated.
    // The old and new secrets are never stored here.
    if (isRegeneratingSecret) {
      void insertMerchantAuditEvent({
        merchantId,
        eventType: "webhook.secret_regenerated",
        actorId: merchantId,
        metadata: {
          webhookId: webhook.id,
          regeneratedAt: new Date().toISOString(),
        },
      })
    }

    return NextResponse.json({ webhook }, { status: 201 })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save webhook config" },
      { status: getRouteErrorStatus(error) }
    )
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req, "webhooks:write")
    await deleteMerchantWebhook(merchantId)
    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete webhook config" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
