import { NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import {
  getMerchantById,
  getMerchantBusinessOwnerProfile,
  updateMerchantBusinessOwnerProfile
} from "@/database/merchants"
import { ensureManagedLightningForMerchant } from "@/engine/pineTreeWalletReadiness"

/**
 * GET /api/merchant/business-owner-profile
 * Returns whether the merchant has already saved the business-owner identity
 * fields required for automatic Speed Custom Connect provisioning.
 */
export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const merchant = await getMerchantById(merchantId)
    const profile = getMerchantBusinessOwnerProfile(merchant)
    return NextResponse.json({ profile })
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load business owner profile" },
      { status: getRouteErrorStatus(error) }
    )
  }
}

/**
 * POST /api/merchant/business-owner-profile
 * Saves the merchant's business-owner identity fields (first/last name,
 * country) once, then triggers Lightning readiness so Speed Custom Connect
 * provisioning can run immediately without a separate step.
 *
 * SECURITY: No Speed credentials are collected or returned here.
 */
export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

    const ownerFirstName = String(body.owner_first_name || "").trim()
    const ownerLastName = String(body.owner_last_name || "").trim()
    const businessCountry = String(body.business_country || "").trim().toUpperCase()

    if (!ownerFirstName) {
      return NextResponse.json({ error: "owner_first_name is required" }, { status: 400 })
    }
    if (!ownerLastName) {
      return NextResponse.json({ error: "owner_last_name is required" }, { status: 400 })
    }
    if (!/^[A-Z]{2}$/.test(businessCountry)) {
      return NextResponse.json({ error: "business_country must be a 2-letter country code" }, { status: 400 })
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
      { error: "Failed to save business owner profile" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
