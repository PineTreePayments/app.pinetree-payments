import { NextRequest, NextResponse } from "next/server"
import {
  createPosPaymentEngine,
  getPosTaxSettingsEngine,
  getPosPaymentStatusEngine,
  checkPosReadinessEngine
} from "@/engine/posPayments"

type ErrorWithStatus = Error & { status?: number }

function getErrorStatus(error: unknown, fallback = 500) {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as ErrorWithStatus).status
    if (typeof status === "number") return status
  }
  return fallback
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export async function GET(req: NextRequest) {
  try {
    const mode = req.nextUrl.searchParams.get("mode") || ""

    if (mode === "status") {
      const paymentId = req.nextUrl.searchParams.get("paymentId") || ""
      const data = await getPosPaymentStatusEngine(paymentId)
      return NextResponse.json({ success: true, ...data })
    }

    const merchantId = req.nextUrl.searchParams.get("merchantId") || ""
    const provider = req.nextUrl.searchParams.get("provider") || ""
    if (!merchantId) {
      return NextResponse.json({ error: "Missing merchantId" }, { status: 400 })
    }

    const [tax, readiness] = await Promise.all([
      getPosTaxSettingsEngine(merchantId),
      checkPosReadinessEngine(merchantId, provider)
    ])

    return NextResponse.json({
      success: true,
      tax,
      connected: readiness.connected,
      reason: readiness.reason,
      context: {
        merchantId,
        provider: provider || null
      }
    })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to load POS payment data") },
      { status: getErrorStatus(error) }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const idempotencyKey = req.headers.get("idempotency-key") || undefined
    const body = (await req.json()) as {
      amount?: number
      currency?: string
      terminal?: {
        merchantId?: string
        terminalId?: string
        provider?: string
      }
    }

    const data = await createPosPaymentEngine({
      amount: Number(body.amount || 0),
      currency: body.currency || "USD",
      idempotencyKey,
      terminal: {
        merchantId: String(body.terminal?.merchantId || ""),
        terminalId: body.terminal?.terminalId,
        provider: body.terminal?.provider
      }
    })

    return NextResponse.json(data)
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to create POS payment") },
      { status: getErrorStatus(error) }
    )
  }
}
