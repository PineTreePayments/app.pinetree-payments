import { NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { supabaseAdmin, supabase as supabaseAnon } from "@/database/supabase"

const supabase = supabaseAdmin || supabaseAnon

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)

    const { data, error } = await supabase
      .from("transactions")
      .select("status, total_amount")
      .eq("merchant_id", merchantId)
      .eq("channel", "online")

    if (error) throw new Error(error.message)

    const rows = (data ?? []) as { status: string; total_amount: number | null }[]

    const total = rows.length
    const confirmed = rows.filter((r) => r.status === "CONFIRMED")
    const volume = confirmed.reduce((sum, r) => sum + (Number(r.total_amount) || 0), 0)
    const successRate =
      total > 0 ? Math.round((confirmed.length / total) * 100) : null

    return NextResponse.json({
      totalPayments: total,
      confirmedPayments: confirmed.length,
      volumeCents: volume,
      volumeUsd: volume / 100,
      successRate,
    })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch stats" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
