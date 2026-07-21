import { type NextRequest, NextResponse } from "next/server"
import {
  patchWithdrawalDestination,
  removeWithdrawalDestination,
} from "@/engine/withdrawals/withdrawalDestinations"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { makeRateLimiter, getRequestIp } from "@/lib/api/rateLimit"

const mutationRateLimiter = makeRateLimiter({ windowMs: 60_000, maxRequests: 20 })

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    if (!mutationRateLimiter.check(`${merchantId}:${getRequestIp(req)}`).allowed) {
      return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 })
    }
    const { id } = await params
    const body = (await req.json()) as Record<string, unknown>
    const destination = await patchWithdrawalDestination(merchantId, id, {
      label: body.label !== undefined ? String(body.label) : undefined,
      isDefault: body.is_default !== undefined ? Boolean(body.is_default) : undefined,
      isEnabled: body.is_enabled !== undefined ? Boolean(body.is_enabled) : undefined,
      providerName: body.provider_name !== undefined ? (body.provider_name === null ? null : String(body.provider_name)) : undefined,
    })
    return NextResponse.json({ destination })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update destination"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(error) })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    if (!mutationRateLimiter.check(`${merchantId}:${getRequestIp(req)}`).allowed) {
      return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 })
    }
    const { id } = await params
    const { archived } = await removeWithdrawalDestination(merchantId, id)
    return NextResponse.json({ success: true, archived })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete destination"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(error) })
  }
}
