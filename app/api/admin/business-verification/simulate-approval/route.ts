import { NextRequest, NextResponse } from "next/server"

import { getBridgeAdminDiagnostics } from "@/engine/bridgeAdminDiagnostics"
import { simulateBridgeKybApprovalEngine } from "@/engine/bridgeConnect"
import { getRouteErrorStatus, requireAdminFromRequest } from "@/lib/api/adminAuth"

/**
 * ADMINISTRATOR-ONLY, SANDBOX-ONLY: simulate KYB approval for one merchant.
 *
 * Exists so PineTree can exercise the full merchant journey without a real KYB
 * provider. There is no merchant-facing equivalent and never will be.
 *
 * Two independent guards, both server-side:
 *   1. PineTree administrator authorization (this route);
 *   2. BRIDGE_ENVIRONMENT === "sandbox", checked in the Engine and again in the
 *      provider client, both failing closed on an unset or invalid value.
 * Production is refused regardless of what any UI sends.
 */
export async function POST(req: NextRequest) {
  try {
    const adminId = await requireAdminFromRequest(req)
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

    const merchantId = String(body?.merchantId || "").trim()
    if (!merchantId) {
      return NextResponse.json({ error: "merchantId is required" }, { status: 400 })
    }

    const result = await simulateBridgeKybApprovalEngine({ merchantId, adminId })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.retryable ? 503 : 409 })
    }

    const diagnostics = await getBridgeAdminDiagnostics(merchantId)
    return NextResponse.json({ diagnostics })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Simulation request failed" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
