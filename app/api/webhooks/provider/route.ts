import { NextResponse } from "next/server"

/**
 * RETIRED — generic provider webhook intake.
 *
 * This route used to read the provider name from the caller's `x-provider`
 * header and hand the request to `processWebhook`, which selected an arbitrary
 * registered adapter. Combined with adapters whose `verifyWebhook` returned
 * `true`, that let an unauthenticated caller forge a payment confirmation:
 *
 *   POST /api/webhooks/provider
 *   x-provider: solana
 *   {"reference":"<paymentId>","confirmed":true,"feeCaptureValidated":true}
 *
 * No provider ever used this route. Every integrated provider posts to a
 * dedicated route that pins its own provider identity and runs a real
 * signature check before the engine is called:
 *
 *   Stripe   -> /api/webhooks/stripe
 *   Shift4   -> /api/webhooks/shift4
 *   Speed    -> /api/webhooks/speed  (and legacy /api/webhooks/lightning)
 *   Bridge   -> /api/webhooks/bridge
 *   Base     -> /api/webhooks/base    (Alchemy HMAC)
 *   Solana   -> /api/webhooks/solana  (Alchemy HMAC)
 *   MoonPay  -> /api/webhooks/moonpay/off-ramp
 *
 * A provider-selecting envelope is not a safe abstraction: the request cannot
 * be allowed to choose which verification contract applies to it. Rather than
 * keep it behind an allowlist that no caller needs, the route is retired and
 * answers 410 Gone.
 *
 * See docs/security/webhook-verification-fail-closed.md.
 */

const RETIRED_BODY = {
  error: "Gone",
  message:
    "The generic provider webhook endpoint has been retired. Use the dedicated route for your provider.",
} as const

function retired() {
  return NextResponse.json(RETIRED_BODY, {
    status: 410,
    headers: { "Cache-Control": "no-store" },
  })
}

export async function POST() {
  return retired()
}

export async function GET() {
  return retired()
}

export async function PUT() {
  return retired()
}

export async function PATCH() {
  return retired()
}

export async function DELETE() {
  return retired()
}
