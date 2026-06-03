import { NextRequest, NextResponse } from "next/server"
import { applyShift4OnboardingEngine } from "@/engine/shift4Onboarding"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

// Permissive but practical email regex — rejects obvious typos without being
// overly strict.  The Shift4 API will do the authoritative validation.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export async function POST(req: NextRequest) {
  try {
    // Must be an authenticated merchant — prevents anonymous onboarding attempts
    await requireMerchantIdFromRequest(req)

    const body = (await req.json().catch(() => null)) as { email?: string } | null

    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const email = String(body.email || "").trim()

    if (!email) {
      return NextResponse.json({ error: "email is required" }, { status: 400 })
    }
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 })
    }

    const result = await applyShift4OnboardingEngine({ email })
    return NextResponse.json(result)
  } catch (err) {
    const message = getErrorMessage(err, "Failed to start Shift4 onboarding")
    const status  = getRouteErrorStatus(err)
    return NextResponse.json({ error: message }, { status })
  }
}
