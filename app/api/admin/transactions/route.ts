import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import { getAdminTransactionsEngine } from "@/engine/adminTransactions"
import type { AdminTransactionFilters } from "@/database/adminTransactions"
import { schedulePaymentMaintenance } from "@/lib/api/paymentMaintenance"

export async function GET(req: NextRequest) {
  try {
    await requireAdminFromRequest(req)
    schedulePaymentMaintenance("admin.transactions")

    const { searchParams } = req.nextUrl

    const filters: AdminTransactionFilters = {}

    const status     = searchParams.get("status")
    const network    = searchParams.get("network")
    const provider   = searchParams.get("provider")
    const merchantId = searchParams.get("merchantId")
    const from       = searchParams.get("from")
    const to         = searchParams.get("to")
    const search     = searchParams.get("search")

    if (status)     filters.status     = status
    if (network)    filters.network    = network
    if (provider)   filters.provider   = provider
    if (merchantId) filters.merchantId = merchantId
    if (from)       filters.from       = from
    if (to)         filters.to         = to
    if (search)     filters.search     = search.trim()

    const limit  = Math.min(Math.max(Number(searchParams.get("limit")  || 50),  1), 200)
    const offset = Math.max(Number(searchParams.get("offset") || 0), 0)

    const result = await getAdminTransactionsEngine(filters, limit, offset)
    return NextResponse.json(result)
  } catch (err) {
    const status  = getRouteErrorStatus(err)
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("[admin/transactions] error", { status, message, err })
    return NextResponse.json({ error: message }, { status })
  }
}
