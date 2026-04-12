import { NextResponse } from "next/server"
import { applyShift4OnboardingEngine } from "@/engine/shift4Onboarding"

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { email?: string }
    const result = await applyShift4OnboardingEngine({
      email: String(body?.email || "")
    })

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start Shift4 onboarding"
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}