import { NextRequest } from "next/server"

import { continueBusinessVerificationEngine } from "@/engine/businessVerification"
import {
  onboardingFailure,
  onboardingRouteError,
  onboardingSuccess,
  requireOnboardingMerchantSession,
} from "@/lib/api/onboardingRoutes"

/**
 * Hand the merchant into the provider-hosted compliance step, presented as a
 * continuous PineTree verification journey.
 *
 * The returned URL is a single-use capability handed only to the authenticated
 * merchant who asked for it, and is never persisted. Sensitive identity
 * documents go from the merchant's browser to the regulated provider and never
 * transit PineTree.
 *
 * Returning from that step is NOT proof of approval; the caller returns to a
 * PineTree route which re-synchronizes status from the provider.
 */
export async function POST(req: NextRequest) {
  try {
    const { merchantId, actorId } = await requireOnboardingMerchantSession(req)
    const result = await continueBusinessVerificationEngine({ merchantId, actorId })

    if (!result.ok) {
      return onboardingFailure({
        message: result.error,
        code: result.retryable ? "verification_unavailable" : "verification_not_ready",
        status: result.retryable ? 503 : 409,
        correlationId: result.correlationId,
      })
    }

    return onboardingSuccess(
      { verificationUrl: result.verificationUrl, verification: result.verification },
      result.correlationId
    )
  } catch (error) {
    return onboardingRouteError(error, "Unable to continue verification right now.")
  }
}
