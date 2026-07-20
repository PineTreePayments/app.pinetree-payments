import { type NextRequest, NextResponse } from "next/server"
import {
  listMerchantWithdrawalDestinations,
  saveWithdrawalDestination,
} from "@/engine/withdrawals/withdrawalDestinations"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import type { WithdrawalDestinationMethod, WithdrawalDestinationRail } from "@/database/merchantWithdrawalDestinations"

function parseRailFilter(value: string | null): WithdrawalDestinationRail | undefined {
  if (value === "base" || value === "solana" || value === "bitcoin") return value
  return undefined
}

function parseMethodFilter(value: string | null): WithdrawalDestinationMethod | undefined {
  if (value === "onchain" || value === "lightning") return value
  return undefined
}

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const destinations = await listMerchantWithdrawalDestinations(merchantId, {
      rail: parseRailFilter(req.nextUrl.searchParams.get("rail")),
      method: parseMethodFilter(req.nextUrl.searchParams.get("method")),
    })
    return NextResponse.json({ destinations })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load saved destinations"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(error) })
  }
}

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = (await req.json()) as Record<string, unknown>
    const destination = await saveWithdrawalDestination(merchantId, {
      rail: String(body.rail || ""),
      asset: String(body.asset || ""),
      destinationAddress: String(body.destination_address || body.destinationAddress || ""),
      label: body.label !== undefined ? String(body.label) : undefined,
      isDefault: Boolean(body.is_default ?? body.isDefault),
    })
    return NextResponse.json({ destination })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save destination"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(error) })
  }
}
