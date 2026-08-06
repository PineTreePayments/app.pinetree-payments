import { NextRequest, NextResponse } from "next/server"

import { getBridgeAdminDiagnostics } from "@/engine/bridgeAdminDiagnostics"
import { setBridgeAdministrativeHoldEngine } from "@/engine/bridgeConnect"
import { getRouteErrorStatus, requireAdminFromRequest } from "@/lib/api/adminAuth"

function message(error: unknown) {
  return error instanceof Error ? error.message : "Business verification request failed"
}

/**
 * Administrator diagnostics for one merchant's business verification.
 *
 * This is the ONLY surface that exposes the underlying infrastructure provider
 * and its technical identifiers. Ordinary merchants never see any of it.
 *
 * Always merchant-scoped: the caller must name the merchant, and the read is
 * filtered to that merchant server-side.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdminFromRequest(req)

    const merchantId = String(req.nextUrl.searchParams.get("merchantId") || "").trim()
    if (!merchantId) {
      return NextResponse.json({ error: "merchantId is required" }, { status: 400 })
    }

    const diagnostics = await getBridgeAdminDiagnostics(merchantId)
    return NextResponse.json({ diagnostics })
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: getRouteErrorStatus(error) })
  }
}

/**
 * Apply or release an administrator activation hold for a controlled rollout.
 *
 * This is NOT a merchant setup step and has no merchant-facing equivalent: a
 * merchant can neither activate the capability early nor turn it off. Every
 * change is audited with the acting administrator.
 */
export async function PATCH(req: NextRequest) {
  try {
    const adminId = await requireAdminFromRequest(req)
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

    const merchantId = String(body?.merchantId || "").trim()
    if (!merchantId) {
      return NextResponse.json({ error: "merchantId is required" }, { status: 400 })
    }
    if (typeof body?.held !== "boolean") {
      return NextResponse.json({ error: "held must be a boolean" }, { status: 400 })
    }

    const result = await setBridgeAdministrativeHoldEngine({
      merchantId,
      held: body.held,
      adminId,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.retryable ? 503 : 409 })
    }

    const diagnostics = await getBridgeAdminDiagnostics(merchantId)
    return NextResponse.json({ diagnostics })
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: getRouteErrorStatus(error) })
  }
}
