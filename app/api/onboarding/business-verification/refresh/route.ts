import { NextRequest } from "next/server"

import { getBusinessVerificationEngine } from "@/engine/businessVerification"
import {
  onboardingFailure,
  onboardingRouteError,
  onboardingSuccess,
  requireOnboardingMerchantSession,
} from "@/lib/api/onboardingRoutes"

/**
 * Authoritative verification refresh.
 *
 * Re-reads the regulated provider and synchronizes PineTree's database, which
 * is the source of truth for merchant-facing status. This is what runs on
 * return from the hosted verification step - a browser return by itself is
 * never treated as approval.
 *
 * Approved merchants have their wallet capability activated automatically as
 * part of this synchronization; there is no merchant enable step.
 *
 * Idempotent: repeated calls converge on the same state.
 */
export async function POST(req: NextRequest) {
  try {
    const { merchantId, actorId } = await requireOnboardingMerchantSession(req)
    const result = await getBusinessVerificationEngine({ merchantId, actorId, refresh: true })

    if (!result.ok) {
      return onboardingFailure({
        message: result.error,
        code: "verification_unavailable",
        status: result.retryable ? 503 : 409,
        correlationId: result.correlationId,
      })
    }

    return onboardingSuccess({ verification: result.verification }, result.correlationId)
  } catch (error) {
    return onboardingRouteError(error, "Unable to refresh your verification status right now.")
  }
}
