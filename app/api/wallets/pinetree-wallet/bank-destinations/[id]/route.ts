import { type NextRequest, NextResponse } from "next/server"

import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { removeBankDestinationEngine } from "@/engine/bridgeBankDestinations"

/**
 * Remove a merchant bank payout destination.
 *
 * Archive, never hard delete: withdrawal history references the destination and
 * the settlement provider's own semantics are deactivate-not-delete. The Engine
 * owns both sides of that.
 */
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const { id } = await context.params

    const result = await removeBankDestinationEngine({
      merchantId,
      destinationId: String(id || "").trim(),
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.retryable ? 503 : 404 })
    }
    return NextResponse.json({ removed: true })
  } catch (error) {
    return NextResponse.json(
      { error: "Unable to remove this bank account right now." },
      { status: getRouteErrorStatus(error) }
    )
  }
}
