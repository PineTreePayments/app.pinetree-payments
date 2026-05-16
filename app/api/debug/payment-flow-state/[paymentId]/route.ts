import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import { getPaymentById, getPaymentEvents } from "@/database"
import { buildPaymentTimeline } from "@/lib/paymentTimeline"
import { getPaymentMode } from "@/lib/paymentMode"
import type { StoredPaymentSplitMetadata } from "@/types/payment"

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ paymentId: string }> },
) {
  try {
    await requireAdminFromRequest(req)

    const params = await context.params
    const paymentId = String(params.paymentId || "").trim()

    if (!paymentId) {
      return NextResponse.json({ error: "Missing paymentId" }, { status: 400 })
    }

    const [payment, rawEvents] = await Promise.all([
      getPaymentById(paymentId),
      getPaymentEvents(paymentId),
    ])

    if (!payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 })
    }

    const split = ((payment.metadata ?? null) as StoredPaymentSplitMetadata | null)?.split
    const timeline = buildPaymentTimeline(payment, rawEvents ?? [])

    // ── Strategy snapshot (from split metadata, set at payment creation) ──────
    const strategySnapshot = split
      ? {
          network: payment.network,
          asset: split.asset ?? null,
          baseUsdcStrategy: split.baseUsdcStrategy ?? null,
          splitContract: split.splitContract ?? null,
          feeCaptureMethod: split.feeCaptureMethod ?? null,
          merchantWallet: split.merchantWallet
            ? `${String(split.merchantWallet).slice(0, 6)}…${String(split.merchantWallet).slice(-4)}`
            : null,
        }
      : null

    // ── Deep link snapshot (reconstructed for diagnostic display) ─────────────
    const deepLinkSnapshot = buildDeepLinkSnapshot(payment)

    // ── Event timestamps ──────────────────────────────────────────────────────
    const events = rawEvents ?? []
    const lastWebhookEvent = [...events]
      .reverse()
      .find((e) => String(e.event_type || "").includes("payment."))
    const lastDetectEvent = [...events]
      .reverse()
      .find((e) => String(e.provider_event || "").includes("detect") || String(e.event_type || "") === "payment.pending")

    return NextResponse.json({
      ok: true,
      paymentId,
      status: String(payment.status || ""),
      network: String(payment.network || ""),
      paymentMode: getPaymentMode(payment),
      createdAt: payment.created_at ?? null,
      updatedAt: payment.updated_at ?? null,
      strategySnapshot,
      deepLinkSnapshot,
      timeline: {
        rail: timeline.rail,
        firstEventAt: timeline.firstEventAt,
        lastEventAt: timeline.lastEventAt,
        confirmedAt: timeline.confirmedAt,
        detectCalledAt: timeline.detectCalledAt,
        webhookReceivedAt: timeline.webhookReceivedAt,
        eventCount: timeline.entries.length,
        entries: timeline.entries,
      },
      lastWebhookAt: lastWebhookEvent?.created_at ?? null,
      lastWebhookEventType: lastWebhookEvent?.event_type ?? null,
      lastDetectAt: lastDetectEvent?.created_at ?? null,
    })
  } catch (err) {
    const status = getRouteErrorStatus(err)
    const message = err instanceof Error ? err.message : "Flow state lookup failed"
    return NextResponse.json({ error: message }, { status })
  }
}

type AnyPayment = {
  network?: string | null
  payment_url?: string | null
  provider_reference?: string | null
  metadata?: unknown
}

function buildDeepLinkSnapshot(payment: AnyPayment): Record<string, string | null> {
  const network = String(payment.network || "").toLowerCase()
  const paymentUrl = String(payment.payment_url || "").trim()

  if (network === "solana") {
    return {
      type: "solana_pay",
      solanaPayUri: paymentUrl ? `solana:${paymentUrl}` : null,
      transactionEndpoint: paymentUrl || null,
    }
  }

  if (network === "base" || network === "base_pay") {
    return {
      type: "base_evm",
      paymentUrl: paymentUrl || null,
      providerReference: payment.provider_reference
        ? `${String(payment.provider_reference).slice(0, 10)}…`
        : null,
    }
  }

  if (network === "bitcoin_lightning") {
    const invoicePreview = paymentUrl
      ? `${paymentUrl.slice(0, 20)}…${paymentUrl.slice(-8)}`
      : null
    return {
      type: "lightning_invoice",
      invoicePreview,
      lightningUri: paymentUrl ? `lightning:${paymentUrl.slice(0, 20)}…` : null,
    }
  }

  return { type: network || "unknown", paymentUrl: paymentUrl || null }
}
