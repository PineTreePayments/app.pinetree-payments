import { NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import {
  getMerchantById,
  getMerchantBusinessOwnerProfile,
  updateMerchantBusinessOwnerProfile
} from "@/database/merchants"
import { ensureManagedLightningForMerchant } from "@/engine/pineTreeWalletReadiness"
import { normalizeBusinessCountry } from "@/engine/businessProfileLocation"

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const merchant = await getMerchantById(merchantId)
    const profile = getMerchantBusinessOwnerProfile(merchant)
    return NextResponse.json({ profile })
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load Business Profile" },
      { status: getRouteErrorStatus(error) }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

    const ownerFirstName = String(body.owner_first_name || "").trim()
    const ownerLastName = String(body.owner_last_name || "").trim()
    const rawBusinessCountry = String(body.business_country || "").trim()

    if (!ownerFirstName) {
      return NextResponse.json({ error: "owner_first_name is required" }, { status: 400 })
    }
    if (!ownerLastName) {
      return NextResponse.json({ error: "owner_last_name is required" }, { status: 400 })
    }
    if (!rawBusinessCountry) {
      return NextResponse.json({ error: "Business country is required" }, { status: 400 })
    }

    let businessCountry: string
    try {
      businessCountry = normalizeBusinessCountry(rawBusinessCountry) as string
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Business country is invalid" },
        { status: 400 }
      )
    }

    await updateMerchantBusinessOwnerProfile(merchantId, {
      ownerFirstName,
      ownerLastName,
      businessCountry
    })

    const lightning = await ensureManagedLightningForMerchant(merchantId)

    return NextResponse.json({
      profile: { ownerFirstName, ownerLastName, businessCountry },
      lightning
    })
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to save Business Profile" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
