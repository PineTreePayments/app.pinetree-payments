import { NextRequest } from "next/server"

import { syncBridgeConnectionEngine } from "@/engine/bridgeConnect"
import {
  bridgeFailure,
  bridgeRouteError,
  bridgeSuccess,
  requireBridgeMerchantSession,
} from "@/lib/api/bridgeRoutes"

/**
 * Refresh the authenticated merchant's Bridge (by Stripe) state from Bridge
 * and synchronize PineTree's database, which is the source of truth for
 * provider connection status.
 *
 * This is the authoritative approval check. A browser redirect back from the
 * hosted KYB flow proves only that the merchant returned - approval comes from
 * this lookup or from a verified Bridge webhook.
 *
 * Idempotent: repeated calls converge on the same state.
 */
export async function POST(req: NextRequest) {
  try {
    const { merchantId } = await requireBridgeMerchantSession(req)
    const result = await syncBridgeConnectionEngine({ merchantId })

    if (!result.ok) {
      return bridgeFailure({
        message: result.error,
        code: result.retryable ? "bridge_unavailable" : "bridge_not_ready",
        status: result.retryable ? 503 : 409,
        correlationId: result.correlationId,
      })
    }

    return bridgeSuccess({ connection: result.connection }, undefined)
  } catch (error) {
    return bridgeRouteError(error, "Unable to refresh Bridge status right now.")
  }
}
