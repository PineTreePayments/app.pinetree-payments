import { NextRequest, NextResponse } from "next/server"
import {
  createSpeedCustomConnectedAccountForMerchant,
} from "@/providers/lightning/speedConnectedAccounts"
import { upsertMerchantLightningProfile } from "@/database/merchantLightningProfiles"
import { saveMerchantSpeedConnection } from "@/database/merchantProviders"

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
    const country = readString(body, "country").toUpperCase()
    const firstName = readString(body, "first_name")
    const lastName = readString(body, "last_name")
    const email = readString(body, "email").toLowerCase()
    const password = readString(body, "password")

    if (!merchantId) return NextResponse.json({ error: "merchant_id is required" }, { status: 400 })
    if (!country) return NextResponse.json({ error: "country is required" }, { status: 400 })
    if (!firstName) return NextResponse.json({ error: "first_name is required" }, { status: 400 })
    if (!lastName) return NextResponse.json({ error: "last_name is required" }, { status: 400 })
    if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 })
    if (!password) return NextResponse.json({ error: "password is required" }, { status: 400 })

    const result = await createSpeedCustomConnectedAccountForMerchant({
      merchant_id: merchantId,
      country,
      first_name: firstName,
      last_name: lastName,
      email,
      password
    })

    const status =
      result.readiness === "ready"
        ? "ready"
        : result.readiness === "needs_attention"
          ? "needs_attention"
          : "pending"

    const profile = await upsertMerchantLightningProfile({
      merchantId,
      status,
      speedConnectedAccountId: result.speed_account_id || result.speed_connected_account_id,
      speedConnectedAccountRelationshipId: result.speed_connected_account_relationship_id,
      speedAccountId: result.speed_account_id,
      speedConnectedAccountStatus: result.speed_connected_account_status,
      speedConnectSetupUrl: result.setup_url,
      providerResponseSummary: result.provider_response_summary,
      providerErrorMessage: result.error_message
    })

    if (result.speed_account_id) {
      await saveMerchantSpeedConnection(merchantId, {
        accountId: result.speed_account_id,
        accountStatus: result.speed_connected_account_status || undefined,
        setupStatus: result.readiness === "ready" ? "ready_for_payments" : result.readiness,
        mode: result.mode,
        enabled: result.readiness === "ready",
        notes: [
          "PineTree created this Speed Custom Connect merchant account server-side.",
          "Payments should use the connected account account_id, not the ca_ relationship id."
        ]
      })
    }

    return NextResponse.json({
      profile: {
        id: profile.id,
        merchant_id: profile.merchant_id,
        provider: profile.provider,
        status: profile.status,
        speed_connected_account_id: profile.speed_connected_account_id,
        speed_connected_account_relationship_id: profile.speed_connected_account_relationship_id,
        speed_account_id: profile.speed_account_id,
        speed_connected_account_status: profile.speed_connected_account_status,
        last_checked_at: profile.last_checked_at,
      },
      speed: {
        readiness: result.readiness,
        connected_account_relationship_id: result.speed_connected_account_relationship_id,
        account_id: result.speed_account_id,
        status: result.speed_connected_account_status,
        mode: result.mode,
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Speed Custom Connect failed"
    console.error("[internal:speed:custom-connect] failed", { error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
