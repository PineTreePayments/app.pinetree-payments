import { NextRequest, NextResponse } from "next/server"
import { getPaymentById, getPaymentEvents } from "@/database"
import { getTransactionByPaymentId } from "@/database/transactions"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import type { StoredPaymentSplitMetadata } from "@/types/payment"

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ paymentId: string }> }
) {
  try {
    await requireAdminFromRequest(req)

    const { paymentId } = await context.params

    if (!String(paymentId || "").trim()) {
      return NextResponse.json({ error: "Missing paymentId" }, { status: 400 })
    }

    const [payment, transaction, events] = await Promise.all([
      getPaymentById(paymentId),
      getTransactionByPaymentId(paymentId).catch(() => null),
      getPaymentEvents(paymentId).catch(() => [])
    ])

    if (!payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 })
    }

    const split = ((payment.metadata ?? null) as StoredPaymentSplitMetadata | null)?.split

    const safePayment = {
      id: payment.id,
      status: payment.status,
      network: payment.network ?? null,
      provider: payment.provider,
      provider_reference: payment.provider_reference ?? null,
      currency: payment.currency,
      merchant_amount: payment.merchant_amount,
      pinetree_fee: payment.pinetree_fee,
      gross_amount: payment.gross_amount,
      asset: split?.asset ?? null,
      baseUsdcStrategy: split?.baseUsdcStrategy ?? null,
      splitContract: split?.splitContract ?? null,
      feeCaptureMethod: split?.feeCaptureMethod ?? null,
      merchantNativeAmountAtomic: split?.merchantNativeAmountAtomic ?? null,
      feeNativeAmountAtomic: split?.feeNativeAmountAtomic ?? null,
      txHash: String(transaction?.provider_transaction_id || "").trim() || null,
      created_at: payment.created_at,
      updated_at: payment.updated_at
    }

    const safeEvents = events.map((e) => ({
      id: e.id,
      event_type: e.event_type,
      provider_event: e.provider_event ?? null,
      created_at: e.created_at
    }))

    console.info("[PineTreeBaseTrace] debug endpoint called", {
      step: "debug-read",
      paymentId,
      status: payment.status,
      network: payment.network,
      eventCount: safeEvents.length,
      hasTxHash: Boolean(safePayment.txHash)
    })

    return NextResponse.json({
      payment: safePayment,
      events: safeEvents
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Debug read failed"
    console.error("[PineTreeBaseTrace] debug endpoint error", { error: message })
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(err) })
  }
}
