import { NextRequest, NextResponse } from "next/server"
import {
  isCardSetupProvider,
  markCardProviderSetupReturned
} from "@/engine/cardProviderSetup"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<unknown> }
) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const params = await context.params as { provider?: unknown }
    const provider = String(params.provider || "")

    if (!isCardSetupProvider(provider)) {
      return NextResponse.json({ ok: false, error: "Unsupported provider" }, { status: 400 })
    }

    const result = await markCardProviderSetupReturned({ merchantId, provider })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error, "Failed to record provider setup return") },
      { status: getRouteErrorStatus(error) }
    )
  }
}
