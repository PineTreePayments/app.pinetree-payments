import { NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { supabaseAdmin, supabase as supabaseAnon } from "@/database/supabase"
import { getMerchantWebhook } from "@/database/merchantWebhooks"

const supabase = supabaseAdmin || supabaseAnon

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    // Run all queries in parallel. getMerchantWebhook error is absorbed so
    // a missing webhook table doesn't fail the entire stats response.
    const [txResult, linksResult, failedDeliveriesResult, webhookConfig] = await Promise.all([
      supabase
        .from("transactions")
        .select("status, total_amount")
        .eq("merchant_id", merchantId)
        .eq("channel", "online"),
      supabase
        .from("checkout_links")
        .select("status, expires_at")
        .eq("merchant_id", merchantId),
      // Exclude test webhook events from the failure count.
      // Current tests use `livemode: false`; old rows may still carry `_test`.
      supabase
        .from("webhook_deliveries")
        .select("id", { count: "exact", head: true })
        .eq("merchant_id", merchantId)
        .eq("status", "failed")
        .gte("created_at", yesterday)
        .not("payload", "cs", '{"livemode":false}')
        .not("payload", "cs", '{"_test":true}'),
      getMerchantWebhook(merchantId).catch(() => null),
    ])

    if (txResult.error) throw new Error(txResult.error.message)

    // ── Payment stats (from transactions) ─────────────────────────────────────
    const rows = (txResult.data ?? []) as { status: string; total_amount: number | null }[]
    const totalPayments = rows.length
    const confirmed = rows.filter((r) => r.status === "CONFIRMED")
    // total_amount is stored in cents in the transactions table
    const volumeCents = confirmed.reduce((sum, r) => sum + (Number(r.total_amount) || 0), 0)
    const volumeUsd = volumeCents / 100
    // Only compute success rate when there is data; null means "not enough data"
    const successRate = totalPayments > 0
      ? Math.round((confirmed.length / totalPayments) * 100)
      : null
    // Safe zero instead of null/NaN — means "no confirmed orders yet"
    const avgOrderValueUsd = confirmed.length > 0
      ? Math.round((volumeUsd / confirmed.length) * 100) / 100
      : 0

    // ── Link/session stats (from checkout_links) ──────────────────────────────
    // "expired" = status is active in DB but expires_at is in the past.
    // These have not been paid and would prevent further payments.
    // "disabled" = merchant explicitly disabled the link (status = "disabled").
    const now = new Date()
    const linkRows = (linksResult.data ?? []) as { status: string; expires_at: string | null }[]
    const activeLinks = linkRows.filter(
      (r) => r.status === "active" && (!r.expires_at || new Date(r.expires_at) > now)
    ).length
    const expiredLinks = linkRows.filter(
      (r) => r.status === "active" && r.expires_at !== null && new Date(r.expires_at) <= now
    ).length
    const disabledLinks = linkRows.filter((r) => r.status === "disabled").length
    const archivedLinks = linkRows.filter((r) => r.status === "archived").length

    // ── Webhook health (test events excluded, last 24 h) ──────────────────────
    const recentWebhookFailures = failedDeliveriesResult.count ?? 0

    return NextResponse.json({
      // Payment outcomes
      totalPayments,
      confirmedPayments: confirmed.length,
      volumeUsd,
      successRate,
      avgOrderValueUsd,

      // Checkout link inventory
      totalLinks: linkRows.length - archivedLinks,
      activeLinks,
      expiredLinks,
      disabledLinks,
      archivedLinks,

      // Webhook health
      recentWebhookFailures,

      // Webhook configuration state (used for dashboard insights)
      webhookConfigured: Boolean(webhookConfig),
      webhookEnabled: webhookConfig?.enabled ?? false,
    })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch stats" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
