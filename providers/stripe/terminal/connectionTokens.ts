import { StripeClient } from "../client"

/**
 * Terminal connection tokens for trusted native clients (future PineTree
 * mobile app running the Stripe Terminal iOS/Android/React Native SDK).
 *
 * SECURITY:
 *  - The token secret is short-lived, is returned to the caller once, and
 *    is never persisted or logged anywhere in PineTree.
 *  - The connected account and location are resolved server-side by
 *    PineTree Engine — a client-supplied account or location is never
 *    accepted as authoritative.
 */
export async function createStripeTerminalConnectionToken(params: {
  connectedAccountId: string
  stripeLocationId?: string
}): Promise<{ secret: string }> {
  const client = new StripeClient()
  const { secret } = await client.createTerminalConnectionToken(
    {
      ...(String(params.stripeLocationId || "").trim()
        ? { location: String(params.stripeLocationId).trim() }
        : {})
    },
    params.connectedAccountId
  )
  return { secret }
}
