import { NextRequest } from "next/server"

import { acceptServiceTermsEngine } from "@/engine/businessVerification"
import {
  consentRequestMetadata,
  onboardingFailure,
  onboardingRouteError,
  onboardingSuccess,
  readOptionalJsonObject,
  requireOnboardingMerchantSession,
} from "@/lib/api/onboardingRoutes"

/**
 * Record the merchant's acceptance of PineTree's terms and the required
 * service-provider disclosure.
 *
 * This is the consent gate: PineTree creates no infrastructure-partner
 * customer until this succeeds. The client sends the terms version it
 * displayed, and the Engine refuses anything other than the current version so
 * a stale page cannot record consent to text the merchant never saw.
 *
 * Idempotent: accepting twice reuses the same consent record.
 */
export async function POST(req: NextRequest) {
  try {
    const { merchantId, actorId } = await requireOnboardingMerchantSession(req)
    const body = await readOptionalJsonObject(req)
    const termsVersion = String(body.termsVersion || "").trim()
    const accepted = body.accepted === true

    if (!accepted) {
      return onboardingFailure({
        message: "You must accept the service terms to continue.",
        code: "consent_required",
        status: 400,
      })
    }
    if (!termsVersion) {
      return onboardingFailure({
        message: "A terms version is required.",
        code: "terms_version_required",
        status: 400,
      })
    }

    const { sourceIp, userAgent } = consentRequestMetadata(req)
    const result = await acceptServiceTermsEngine({
      merchantId,
      actorId,
      termsVersion,
      sourceIp,
      userAgent,
    })

    if (!result.ok) {
      return onboardingFailure({
        message: result.error,
        code: result.retryable ? "verification_unavailable" : "consent_rejected",
        status: result.retryable ? 503 : 409,
        correlationId: result.correlationId,
      })
    }

    return onboardingSuccess({ verification: result.verification }, result.correlationId)
  } catch (error) {
    return onboardingRouteError(error, "Unable to record your acceptance right now.")
  }
}
