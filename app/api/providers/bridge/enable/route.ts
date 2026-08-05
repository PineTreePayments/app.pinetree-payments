import { NextRequest } from "next/server"

import { setBridgeEnabledEngine } from "@/engine/bridgeConnect"
import {
  bridgeFailure,
  bridgeRouteError,
  bridgeSuccess,
  requireBridgeMerchantSession,
} from "@/lib/api/bridgeRoutes"

/**
 * Enable Bridge (by Stripe) settlement for the authenticated merchant.
 *
 * The Engine re-derives approval from stored Bridge state and refuses to
 * enable an unapproved connection, so a client cannot turn Bridge on by
 * asserting that it is approved.
 *
 * Idempotent: enabling an already-enabled connection returns the same state.
 */
export async function POST(req: NextRequest) {
  try {
    const { merchantId, actorId } = await requireBridgeMerchantSession(req)
    const result = await setBridgeEnabledEngine({ merchantId, enabled: true, actorId })

    if (!result.ok) {
      return bridgeFailure({
        message: result.error,
        code: result.retryable ? "bridge_unavailable" : "bridge_not_approved",
        status: result.retryable ? 503 : 409,
        correlationId: result.correlationId,
      })
    }

    return bridgeSuccess({ connection: result.connection })
  } catch (error) {
    return bridgeRouteError(error, "Unable to enable Bridge right now.")
  }
}
