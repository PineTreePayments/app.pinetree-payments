import { NextRequest, NextResponse } from "next/server"
import {
  getTransactionsDashboardEngine,
  getTransactionsChartEngine
} from "@/engine/transactionsDashboard"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)

    const data = await getTransactionsDashboardEngine(merchantId)
    return NextResponse.json({ success: true, ...data })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to load transactions dashboard") },
      { status: getRouteErrorStatus(error) }
    )
  }
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
