import { NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { createCheckoutSessionEngine } from "@/engine/checkoutSessions"
import { supabaseAdmin, supabase as supabaseAnon } from "@/database/supabase"

const supabase = supabaseAdmin || supabaseAnon

type SessionBody = {
  amount: number
  currency?: string
  orderId?: string
  reference?: string
  customerEmail?: string
  description?: string
  successUrl?: string
  cancelUrl?: string
  metadata?: Record<string, unknown>
}

async function digestHex(data: string): Promise<string> {
  const bytes = new TextEncoder().encode(data)
  const hash = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function buildCheckoutUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "") || "https://app.pinetree-payments.com"
  return `${base}/checkout/${encodeURIComponent(token)}`
}

export async function POST(req: NextRequest) {
  try {
    // API key callers must have checkout.sessions:create permission.
    // Dashboard session callers are always permitted (permission param is ignored for JWTs).
    const merchantId = await requireMerchantIdFromRequest(req, "checkout.sessions:create")

    const idempotencyKey = req.headers.get("idempotency-key") ?? req.headers.get("Idempotency-Key") ?? ""

    // ── Idempotency check ────────────────────────────────────────────────────
    // If the caller sent an Idempotency-Key header, look for an existing session
    // created with the same key within the last 24 hours and return it unchanged.
    // This prevents duplicate sessions when a network timeout causes a retry.
    if (idempotencyKey) {
      const hash = await digestHex(`${merchantId}:${idempotencyKey}`)
      const { data: existing } = await supabase
        .from("checkout_links")
        .select("id, public_token, amount, currency, expires_at")
        .eq("merchant_id", merchantId)
        .filter("link_metadata->>idempotency_hash", "eq", hash)
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .limit(1)
        .maybeSingle()

      if (existing) {
        return NextResponse.json({
          session: {
            sessionId: existing.id,
            token: existing.public_token,
            checkoutUrl: buildCheckoutUrl(existing.public_token as string),
            amount: Number(existing.amount),
            currency: existing.currency,
            status: "active",
            expiresAt: existing.expires_at ?? null,
          },
        }, { status: 200 })
      }
    }

    const body = (await req.json()) as SessionBody

    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 })
    }

    const baseMetadata: Record<string, unknown> =
      body.metadata && typeof body.metadata === "object" ? { ...body.metadata } : {}

    if (idempotencyKey) {
      const hash = await digestHex(`${merchantId}:${idempotencyKey}`)
      baseMetadata.idempotency_hash = hash
    }

    const session = await createCheckoutSessionEngine({
      merchantId,
      amount,
      currency: body.currency,
      orderId: body.orderId
        ? String(body.orderId).trim()
        : body.reference
        ? String(body.reference).trim()
        : undefined,
      customerEmail: body.customerEmail ? String(body.customerEmail).trim() : undefined,
      description: body.description ? String(body.description).trim() : undefined,
      successUrl: body.successUrl ? String(body.successUrl).trim() : undefined,
      cancelUrl: body.cancelUrl ? String(body.cancelUrl).trim() : undefined,
      metadata: Object.keys(baseMetadata).length ? baseMetadata : undefined,
    })

    return NextResponse.json({ session }, { status: 201 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create checkout session"
    const isValidation =
      message === "Invalid amount" ||
      message.startsWith("successUrl") ||
      message.startsWith("cancelUrl") ||
      message === "Missing merchant ID"
    return NextResponse.json(
      { error: message },
      { status: isValidation ? 400 : getRouteErrorStatus(error) }
    )
  }
}
