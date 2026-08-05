import { NextRequest } from "next/server"

import { getBridgeConnectionEngine } from "@/engine/bridgeConnect"
import {
  bridgeFailure,
  bridgeRouteError,
  bridgeSuccess,
  requireBridgeMerchantSession,
} from "@/lib/api/bridgeRoutes"

/**
 * The authenticated merchant's stored Bridge (by Stripe) connection state.
 *
 * A pure read of PineTree's own record - it never contacts Bridge, so the
 * providers page renders without provider latency. Use POST
 * /api/providers/bridge/sync to refresh from Bridge.
 */
export async function GET(req: NextRequest) {
  try {
    const { merchantId } = await requireBridgeMerchantSession(req)
    const result = await getBridgeConnectionEngine({ merchantId })

    if (!result.ok) {
      return bridgeFailure({
        message: result.error,
        code: "bridge_unavailable",
        status: 503,
        correlationId: result.correlationId,
      })
    }

    return bridgeSuccess({ connection: result.connection })
  } catch (error) {
    return bridgeRouteError(error, "Unable to load Bridge status right now.")
  }
}
