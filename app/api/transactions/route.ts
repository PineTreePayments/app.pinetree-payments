import { NextRequest, NextResponse } from "next/server"
import {
  getTransactionsDashboardEngine,
  getTransactionsChartEngine
} from "@/engine/transactionsDashboard"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"
import { schedulePaymentMaintenance } from "@/lib/api/paymentMaintenance"

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    schedulePaymentMaintenance("transactions.list")

    const { searchParams } = new URL(req.url)
    const filter = (name: string) => {
      const value = String(searchParams.get(name) || "").trim()
      return value && value !== "all" ? value : undefined
    }
    const startDate = normalizeDateBoundary(filter("startDate"), false)
    const endDate = normalizeDateBoundary(filter("endDate"), true)
    if (startDate && endDate && startDate > endDate) {
      throw Object.assign(new Error("End date must be on or after start date"), { status: 400 })
    }
    const data = await getTransactionsDashboardEngine(merchantId, {
      provider: filter("provider"),
      network: filter("network"),
      channel: filter("channel"),
      status: filter("status"),
      rail: filter("rail"),
      asset: filter("asset"),
      currency: filter("currency"),
      source: filter("source"),
      method: filter("method"),
      startDate,
      endDate,
      page: Number(searchParams.get("page") || 1),
      pageSize: Number(searchParams.get("pageSize") || 50)
    })
    return NextResponse.json({ success: true, ...data })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to load transactions dashboard") },
      { status: getRouteErrorStatus(error) }
    )
  }
}

function normalizeDateBoundary(value: string | undefined, endOfDay: boolean): string | undefined {
  if (!value) return undefined
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
  }
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) {
    throw Object.assign(new Error("Invalid transaction date filter"), { status: 400 })
  }
  return parsed.toISOString()
}

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)

    const body = (await req.json()) as {
      action?: string
      range?: string
      mode?: "all" | "pos" | "online"
    }

    if (body.action === "chart") {
      const chartData = await getTransactionsChartEngine(
        merchantId,
        body.range || "24h",
        body.mode || "all"
      )

      return NextResponse.json({ success: true, chartData })
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to process transactions action") },
      { status: getRouteErrorStatus(error) }
    )
  }
}
