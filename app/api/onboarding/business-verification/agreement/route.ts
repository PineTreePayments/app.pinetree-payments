import { type NextRequest } from "next/server"

import { recordBridgeSignedAgreementEngine } from "@/engine/bridgeConnect"
import { getBusinessVerificationEngine } from "@/engine/businessVerification"
import {
  onboardingFailure,
  onboardingRouteError,
  onboardingSuccess,
  readOptionalJsonObject,
  requireOnboardingMerchantSession,
} from "@/lib/api/onboardingRoutes"

/**
 * Capture the agreement reference the regulated provider returned with the
 * merchant's browser after its own terms step.
 *
 * A browser return is NOT approval and does not advance verification by itself.
 * All this records is WHICH agreement authorizes the later submission; the
 * provider confirms it when the customer is created, and approval still comes
 * only from an authoritative lookup or a signature-verified webhook.
 *
 * A merchant API key is rejected, like every other verification route: no
 * approved scope exists for advancing regulated verification on a business's
 * behalf.
 */
export async function POST(req: NextRequest) {
  try {
    const { merchantId, actorId } = await requireOnboardingMerchantSession(req)
    const body = await readOptionalJsonObject(req)

    const signedAgreementId = String(
      body.signedAgreementId || body.signed_agreement_id || ""
    ).trim()
    if (!signedAgreementId) {
      return onboardingFailure({ message: "That step could not be completed. Try again." })
    }

    const recorded = await recordBridgeSignedAgreementEngine({
      merchantId,
      signedAgreementId,
      actorId,
    })
    if (!recorded.ok) {
      return onboardingFailure({
        message: recorded.error,
        status: recorded.retryable ? 503 : 400,
        correlationId: recorded.correlationId,
      })
    }

    // Recording the agreement is exactly the moment submission becomes
    // possible, so verification is advanced immediately rather than making the
    // merchant wait for another page load.
    const verification = await getBusinessVerificationEngine({ merchantId, actorId })
    if (!verification.ok) {
      return onboardingFailure({
        message: verification.error,
        status: verification.retryable ? 503 : 400,
        correlationId: verification.correlationId,
      })
    }

    return onboardingSuccess(
      { verification: verification.verification },
      verification.correlationId
    )
  } catch (error) {
    return onboardingRouteError(error, "Unable to complete that step right now")
  }
}
