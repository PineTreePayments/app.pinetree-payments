import { NextRequest, NextResponse } from "next/server"
import {
  listAdminProviderOnboarding,
  updateAdminProviderOnboardingStatus
} from "@/engine/adminProviderOnboarding"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"

function message(error: unknown) {
  return error instanceof Error ? error.message : "Provider onboarding request failed"
}

export async function GET(req: NextRequest) {
  try {
    await requireAdminFromRequest(req)
    const providers = await listAdminProviderOnboarding()
    return NextResponse.json({ providers })
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: getRouteErrorStatus(error) })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const adminId = await requireAdminFromRequest(req)
    const body = await req.json() as Record<string, unknown>
    const provider = String(body.provider || "")
    const merchantId = String(body.merchantId || "")
    const applicationStatus = String(body.applicationStatus || "")

    if (!merchantId) {
      return NextResponse.json({ error: "merchantId is required" }, { status: 400 })
    }
    if (applicationStatus !== "approved" && applicationStatus !== "denied") {
      return NextResponse.json({ error: "applicationStatus must be approved or denied" }, { status: 400 })
    }

    const updated = await updateAdminProviderOnboardingStatus({
      merchantId,
      provider,
      applicationStatus,
      adminId
    })

    return NextResponse.json({ provider: updated })
  } catch (error) {
    const errorMessage = message(error)
    const status = errorMessage.includes("Unsupported") ||
      errorMessage.includes("not found")
      ? 400
      : getRouteErrorStatus(error)
    return NextResponse.json({ error: errorMessage }, { status })
  }
}
