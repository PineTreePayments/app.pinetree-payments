import { NextRequest } from "next/server"

import { startBridgeOnboardingEngine } from "@/engine/bridgeConnect"
import {
  bridgeFailure,
  bridgeRouteError,
  bridgeSuccess,
  requireBridgeMerchantSession,
} from "@/lib/api/bridgeRoutes"

/**
 * Start or resume Bridge (by Stripe) onboarding for the authenticated merchant.
 *
 * Idempotent: a merchant with an existing Bridge onboarding gets that same
 * onboarding back rather than a second Bridge customer. The hosted KYB and
 * terms URLs are returned to this merchant only and are never persisted.
 */
export async function POST(req: NextRequest) {
  try {
    const { merchantId, actorId } = await requireBridgeMerchantSession(req)
    const result = await startBridgeOnboardingEngine({ merchantId, actorId })

    if (!result.ok) {
      return bridgeFailure({
        message: result.error,
        code: result.retryable ? "bridge_unavailable" : "bridge_not_ready",
        status: result.retryable ? 503 : 409,
        correlationId: result.correlationId,
      })
    }

    return bridgeSuccess(
      {
        kycUrl: result.kycUrl,
        tosUrl: result.tosUrl,
        reused: result.reused,
        connection: result.connection,
      },
      result.correlationId
    )
  } catch (error) {
    return bridgeRouteError(error, "Unable to start Bridge onboarding right now.")
  }
}
