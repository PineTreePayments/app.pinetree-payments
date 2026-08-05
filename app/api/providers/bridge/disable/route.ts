import { NextRequest } from "next/server"

import { setBridgeEnabledEngine } from "@/engine/bridgeConnect"
import {
  bridgeFailure,
  bridgeRouteError,
  bridgeSuccess,
  requireBridgeMerchantSession,
} from "@/lib/api/bridgeRoutes"

/**
 * Disable Bridge (by Stripe) settlement for the authenticated merchant.
 *
 * Disabling never disconnects or deletes the Bridge connection: the Bridge
 * customer, its KYB approval, and the connection history are preserved so the
 * merchant can re-enable without repeating onboarding.
 *
 * Idempotent: disabling an already-disabled connection returns the same state.
 */
export async function POST(req: NextRequest) {
  try {
    const { merchantId, actorId } = await requireBridgeMerchantSession(req)
    const result = await setBridgeEnabledEngine({ merchantId, enabled: false, actorId })

    if (!result.ok) {
      return bridgeFailure({
        message: result.error,
        code: result.retryable ? "bridge_unavailable" : "bridge_not_ready",
        status: result.retryable ? 503 : 409,
        correlationId: result.correlationId,
      })
    }

    return bridgeSuccess({ connection: result.connection })
  } catch (error) {
    return bridgeRouteError(error, "Unable to disable Bridge right now.")
  }
}
