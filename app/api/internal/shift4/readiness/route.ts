/**
 * Raw Shift4 REST readiness - Shift4 sandbox operator only.
 *
 * This projection exposes internal testing detail: credential presence per
 * channel, access-token fingerprints, certification blockers, and the specific
 * gate failing each capability. That is operator diagnostics, not merchant
 * information, so it requires the same authorization as the credential
 * exchange rather than ordinary merchant authentication.
 */
import { NextRequest } from "next/server"
import { getShift4ReadinessForMerchant } from "@/engine/shift4/services"
import { requireShift4OperatorFromRequest } from "@/lib/api/shift4OperatorAuth"
import { shift4Error, shift4Success } from "@/lib/api/shift4Routes"
import { buildShift4SupportDiagnostics } from "@/engine/shift4/diagnostics"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const merchantId = await requireShift4OperatorFromRequest(request)
    const readiness = await getShift4ReadinessForMerchant(merchantId)
    return shift4Success({ ...readiness, diagnostics: buildShift4SupportDiagnostics({ readiness }) })
  } catch (error) {
    return shift4Error(error, "Unable to load Shift4 readiness")
  }
}
