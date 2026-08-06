import { NextRequest } from "next/server"

import {
  getBusinessVerificationEngine,
  getServiceTermsDisclosure,
} from "@/engine/businessVerification"
import {
  onboardingFailure,
  onboardingRouteError,
  onboardingSuccess,
  requireOnboardingMerchantSession,
} from "@/lib/api/onboardingRoutes"

/**
 * The authenticated merchant's PineTree business-verification state, plus the
 * current service-provider disclosure the consent step must display.
 *
 * Fast path: this is a database projection and does not wait on any provider.
 * It may advance the workflow as a side effect (submitting a fully-consented
 * merchant), which is idempotent. Use `/refresh` for an authoritative
 * provider lookup.
 */
export async function GET(req: NextRequest) {
  try {
    const { merchantId, actorId } = await requireOnboardingMerchantSession(req)
    const result = await getBusinessVerificationEngine({ merchantId, actorId })

    if (!result.ok) {
      return onboardingFailure({
        message: result.error,
        code: "verification_unavailable",
        status: result.retryable ? 503 : 409,
        correlationId: result.correlationId,
      })
    }

    return onboardingSuccess(
      { verification: result.verification, terms: getServiceTermsDisclosure() },
      result.correlationId
    )
  } catch (error) {
    return onboardingRouteError(error, "Unable to load your verification status right now.")
  }
}
