import { NextResponse } from "next/server"

/**
 * RETIRED — Shopify checkout-session creation.
 *
 * This route used to create a PineTree checkout session from a storefront
 * request. Audit finding RA-2 was that it had no verification at all and
 * resolved the merchant from `body.shop`, so anyone who knew a connected
 * store's public `myshopify.com` domain could create real checkout sessions on
 * that merchant's account with an attacker-chosen amount and redirect URLs.
 *
 * An App Proxy signature was implemented first and did close merchant
 * selection, but it was not enough to make the route production-safe. Shopify
 * signs the proxied **query string only** — it does not sign the request body.
 * The order total, currency, order identity, customer email, and success/cancel
 * URLs therefore remained fully caller-controlled, and the signed `timestamp`
 * carries no nonce, so a request could be replayed inside its freshness window.
 * A verified store identity over an unverified financial payload is not an
 * acceptable contract for a route that creates checkout sessions.
 *
 * There is also no caller: the storefront/payment extension that would drive
 * this endpoint does not exist in this repository and has not been built or
 * published (see integrations/shopify/README.md). Nothing is broken by
 * retiring it.
 *
 * The route therefore answers 410 Gone and does no work at all: no signature
 * parsing, no body read, no Shopify connection lookup, no order validation, no
 * database access, and no checkout-session creation.
 *
 * ── Requirements for any future reactivation ────────────────────────────────
 * Verifying the shop is necessary but not sufficient. A future implementation
 * must ALSO obtain the authoritative order amount, currency, order identity,
 * and customer information **server-side** — by retrieving the order from
 * Shopify's Admin API with the stored access token, or through another equally
 * trusted server-side contract. Storefront-supplied body values must never
 * carry financial, merchant, or redirect authority.
 *
 * Shopify OAuth install, disconnect, status, and webhook handling are
 * unaffected and continue to verify as before.
 *
 * See docs/security/route-auth-matrix.md (RA-2).
 */

const RETIRED_BODY = {
  error: "Gone",
  message:
    "Shopify checkout-session creation has been retired. It will return only with server-side order verification against Shopify.",
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
