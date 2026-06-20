import { NextRequest, NextResponse } from "next/server"
import {
  isCardSetupProvider,
  startCardProviderSetup
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

    const returnUrl = new URL("/dashboard/providers", req.nextUrl.origin)
    returnUrl.searchParams.set("provider", provider)
    returnUrl.searchParams.set("setup", "returned")

    const result = await startCardProviderSetup({
      merchantId,
      provider,
      returnUrl: returnUrl.toString()
    })

    if (!result.ok) {
      return NextResponse.json(result, { status: 503 })
    }

    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error, "Failed to start provider setup") },
      { status: getRouteErrorStatus(error) }
    )
  }
}
