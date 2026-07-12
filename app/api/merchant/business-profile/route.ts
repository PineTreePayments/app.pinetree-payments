import { NextRequest, NextResponse } from "next/server"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import {
  getMerchantBusinessProfile,
  saveMerchantBusinessProfile,
  type MerchantBusinessProfileInput
} from "@/engine/businessProfile"

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const profile = await getMerchantBusinessProfile(merchantId)
    return NextResponse.json({ profile })
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "Failed to load Business Profile") },
      { status: getRouteErrorStatus(error) }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = (await req.json().catch(() => ({}))) as MerchantBusinessProfileInput
    const profile = await saveMerchantBusinessProfile(merchantId, body)

    return NextResponse.json({ profile })
  } catch (error) {
    const message = errorMessage(error, "Failed to save Business Profile")
    const status = message.includes("must be") || message.includes("required") || message.includes("too long")
      ? 400
      : getRouteErrorStatus(error)
    return NextResponse.json({ error: message }, { status })
  }
}
