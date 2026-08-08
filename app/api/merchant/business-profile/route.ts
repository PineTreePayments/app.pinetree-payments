import { NextRequest, NextResponse } from "next/server"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import {
  getMerchantBusinessProfile,
  saveMerchantBusinessProfile,
  type MerchantBusinessProfileInput
} from "@/engine/businessProfile"
import { getBusinessVerificationEngine } from "@/engine/businessVerification"
import { getMerchantBridgeConnection } from "@/database/merchantBridgeConnections"

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

/**
 * The masked state of the tax identifiers PineTree has already forwarded.
 *
 * PineTree never stores the identifiers themselves, so the profile form can
 * only be told whether one is on file and its last four - enough for the
 * merchant to see it does not need re-entering, and nothing more.
 */
async function verificationIdentifierState(merchantId: string) {
  const row = await getMerchantBridgeConnection(merchantId).catch(() => null)
  const credentials = row?.credentials || {}
  return {
    business_tax_id_last4: credentials.bridge_business_tax_id_last4 || null,
    owner_tax_id_last4: credentials.bridge_owner_tax_id_last4 || null,
    submitted_at: credentials.bridge_identity_submitted_at || null,
  }
}

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const [profile, identifiers] = await Promise.all([
      getMerchantBusinessProfile(merchantId),
      verificationIdentifierState(merchantId),
    ])
    return NextResponse.json({ profile, identifiers })
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "Failed to load Business Profile") },
      { status: getRouteErrorStatus(error) }
    )
  }
}

/**
 * Save the Business Profile.
 *
 * SENSITIVE DATA: `business_tax_id` and `owner_tax_id` may arrive in the body.
 * They are pulled out here and never reach `saveMerchantBusinessProfile`, which
 * has no column for them. They are handed to the Engine for the duration of
 * this one request, forwarded to the regulated provider, and dropped. Only the
 * masked last four and the submission timestamp survive.
 */
export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = (await req.json().catch(() => ({}))) as MerchantBusinessProfileInput &
      Record<string, unknown>

    const businessTaxId = String(body.business_tax_id || "").trim() || null
    const ownerTaxId = String(body.owner_tax_id || "").trim() || null
    const { business_tax_id: _businessTaxId, owner_tax_id: _ownerTaxId, ...profileInput } = body

    const profile = await saveMerchantBusinessProfile(
      merchantId,
      profileInput as MerchantBusinessProfileInput
    )

    // Saving a complete profile is exactly when verification can advance, so it
    // advances now rather than on some later page load. A failure here never
    // fails the save: the profile is stored either way and the next read
    // retries with the same deterministic idempotency key.
    const verification = await getBusinessVerificationEngine({
      merchantId,
      ...(businessTaxId || ownerTaxId ? { sensitive: { businessTaxId, ownerTaxId } } : {}),
    }).catch(() => null)

    const identifiers = await verificationIdentifierState(merchantId)

    return NextResponse.json({
      profile,
      identifiers,
      verification: verification?.ok ? verification.verification : null,
    })
  } catch (error) {
    const message = errorMessage(error, "Failed to save Business Profile")
    const status = message.includes("must be") || message.includes("required") || message.includes("too long")
      ? 400
      : getRouteErrorStatus(error)
    return NextResponse.json({ error: message }, { status })
  }
}
