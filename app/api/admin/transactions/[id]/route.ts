import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import { getAdminTransactionDetailEngine } from "@/engine/adminTransactions"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id: rawId } = await context.params
    await requireAdminFromRequest(req)

    const id = String(rawId || "").trim()
    if (!id) {
      return NextResponse.json({ error: "Payment ID required" }, { status: 400 })
    }

    const result = await getAdminTransactionDetailEngine(id)
    if (!result) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    return NextResponse.json(result)
  } catch (err) {
    const status = getRouteErrorStatus(err)
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("[admin/transactions/[id]] error", { status, message })
    return NextResponse.json({ error: message }, { status })
  }
}