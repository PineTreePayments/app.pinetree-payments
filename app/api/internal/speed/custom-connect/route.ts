import { NextRequest, NextResponse } from "next/server"
import { getMerchantLightningProfile } from "@/database/merchantLightningProfiles"
import { ensureManagedLightningForMerchant } from "@/engine/pineTreeWalletReadiness"

function isAuthorized(req: NextRequest) {
  const secret =
    String(process.env.INTERNAL_API_SECRET || "").trim() ||
    String(process.env.CRON_SECRET || "").trim()
  if (!secret) {
    console.error("[internal:speed:custom-connect] Missing INTERNAL_API_SECRET or CRON_SECRET")
    return false
  }
  const authHeader = req.headers.get("authorization") || ""
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""
  return bearer === secret
}

function readString(body: Record<string, unknown>, key: string) {
  return String(body[key] || "").trim()
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const merchantId = readString(body, "merchant_id")

    if (!merchantId) return NextResponse.json({ error: "merchant_id is required" }, { status: 400 })

    const result = await ensureManagedLightningForMerchant(merchantId)
    const profile = await getMerchantLightningProfile(merchantId)

    if (result.action === "needs_business_profile") {
      return NextResponse.json(
        { error: "Complete your Business Profile to activate payments.", action: result.action },
        { status: 409 }
      )
    }

    return NextResponse.json({
      profile: profile
        ? {
            id: profile.id,
            merchant_id: profile.merchant_id,
            provider: profile.provider,
            status: profile.status,
            speed_connected_account_id: profile.speed_connected_account_id,
            speed_connected_account_relationship_id: profile.speed_connected_account_relationship_id,
            speed_account_id: profile.speed_account_id,
            speed_connected_account_status: profile.speed_connected_account_status,
            last_checked_at: profile.last_checked_at,
          }
        : null,
      lightning: result
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Speed Custom Connect failed"
    console.error("[internal:speed:custom-connect] failed", { error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
