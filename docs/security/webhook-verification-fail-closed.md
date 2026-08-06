# Security Decision — Webhook Verification Fails Closed; Generic Provider Route Retired

- **Status:** Implemented
- **Date:** 2026-08-06
- **Classification:** Canonical (security decision note)
- **Scope:** Provider webhook intake and event verification
- **Addresses:** Architecture-conformance audit findings **F-1** (Critical) and **F-2** (High)
- **Standards:** [05 §1, §4, §5](../standards/05-provider-connectors-events.md),
  [04 §7](../standards/04-database-identity-security.md),
  [01 §3](../standards/01-platform-architecture.md),
  [02 §2](../standards/02-lifecycle-and-merchant-status.md),
  [06 §7](../standards/06-roadmap-documentation-governance.md) (Coinbase retirement)

## Context

`POST /api/webhooks/provider` accepted the provider name from the caller's
`x-provider` request header and handed the request to `processWebhook`, which
resolved **any** registered adapter. The route was unauthenticated by design
(provider callbacks carry no session), and `proxy.ts` protects paths by
allowlist, which does not include `/api/webhooks/*`.

Verification then failed **open** in three separate places:

1. `engine/eventProcessor.ts` initialised `let verified = true`, so an adapter
   with no `verifyWebhook` was treated as verified.
2. `BaseProviderAdapter.verifyWebhook` returned `true`, so any adapter that did
   not override it inherited silent acceptance.
3. `providers/solana.ts` and `providers/basePay.ts` returned `true` outright,
   and `providers/coinbase.ts` returned `true` whenever
   `COINBASE_WEBHOOK_SHARED_SECRET` was unset — which it was, since the variable
   was not even in `.env.example`.

Two further links completed the chain: `resolvePaymentIdFromEvent` accepted the
translated payment id verbatim with no ownership check, and
`sanitizeProviderPayload` filtered fields only for Stripe, so the payload's
`feeCaptureValidated: true` satisfied the CONFIRMED fee-capture gate.

The result was a forged payment confirmation, reachable unauthenticated:

```
POST /api/webhooks/provider
x-provider: solana
{"reference":"<pending payment id>","confirmed":true,"feeCaptureValidated":true}
```

A payment reached `CONFIRMED` with no funds received, a ledger row was written,
and `payment.confirmed` was delivered to the merchant — who would then fulfil an
unpaid order.

## Decision

### 1. Retire the generic route rather than gate it

`POST /api/webhooks/provider` now returns **410 Gone** for every method.

A provider-selecting envelope is not a safe abstraction: **the request must never
choose which verification contract applies to it.** An allowlist would have
preserved the shape of the problem for no benefit, because the route had no
consumer — no source import, no test, no frontend reference, no deployment
configuration, and no provider callback URL pointed at it. Its only mentions were
three descriptive documentation inventories.

Every integrated provider already posts to a dedicated route that pins its own
provider identity and verifies a signature over the raw body before the engine is
called:

| Provider | Route | Verification |
|---|---|---|
| Stripe | `/api/webhooks/stripe` | HMAC-SHA256 over `t.rawBody`, timestamp tolerance, `timingSafeEqual` |
| Shift4 | `/api/webhooks/shift4` | Fails closed pending Shift4's documented signature contract |
| Speed | `/api/webhooks/speed`, `/api/webhooks/lightning` | Svix HMAC over raw body, requires `wsec_` secret + headers |
| Bridge | `/api/webhooks/bridge` | RSA-SHA256 over `timestamp.rawBody`, 10-minute replay window, `timingSafeEqual` |
| Base | `/api/webhooks/base` | Alchemy HMAC over raw body → `processAlchemyWebhook` |
| Solana | `/api/webhooks/solana` | Alchemy HMAC over raw body → `processAlchemyWebhook` |
| MoonPay | `/api/webhooks/moonpay/off-ramp` | `Moonpay-Signature-V2` |

Base and Solana confirmations never traversed `processWebhook`; they go through
`processAlchemyWebhook`. Their adapters' `verifyWebhook` was reachable **only**
through the retired generic route.

### 2. Verification fails closed everywhere

- `engine/eventProcessor.ts` refuses a provider whose adapter does not define
  `verifyWebhook`, and requires the result to be **strictly `true`**.
- A `verifyWebhook` that throws is classified as a rejection and logged with a
  reason only — never swallowed and never allowed to continue.
- `BaseProviderAdapter.verifyWebhook` throws by default.
- `providers/solana.ts` and `providers/basePay.ts` throw, declaring explicitly
  that they have no adapter webhook contract.
- `providers/coinbase.ts` returns `false` when its shared secret is missing.
- `providers/PROVIDER_TEMPLATE.ts` no longer teaches `return true`.

A missing secret is a misconfiguration, never a reason to trust a webhook.

### 3. Provider/payment rail correlation

After the signature check, a verified event must also belong to the payment's
rail. `engine/eventProcessor.ts` compares the webhook's provider against the
payment's network using the existing `types/payment.ts` contract
(`normalizePaymentAdapter` + `adapterSupportsNetwork`). No new schema field was
introduced.

Only a **positively determined** mismatch rejects (HTTP 403), so providers
outside the payment-adapter set (Bridge connection events, MoonPay off-ramp) and
payments with no stored network are unaffected. This stops possession of a
PineTree UUID from being sufficient to cross rails.

### 4. Internal trust flags are stripped from provider payloads

`feeCaptureValidated` is PineTree-internal — set only by on-chain watchers, the
NWC check, and Speed reconciliation after they verify both split legs themselves.
It is now stripped from **every** provider payload, at any nesting depth, before
the payload becomes `rawPayload`. The engine then recomputes the flag from the
payment's own fee-capture method, so a forged `true` becomes a computed `false`
and the CONFIRMED fee-capture gate rejects the attempt.

The existing Base, Solana, Stripe, Shift4, and Speed evidence rules are unchanged.

### 5. Coinbase Commerce runtime registration removed

[Standard 06 §7](../standards/06-roadmap-documentation-governance.md#7-retired-assumptions)
states Coinbase Commerce is not a current production provider. Registration is
now gated on `PINETREE_ENABLE_COINBASE_COMMERCE` (**default off**), so
`getProvider("coinbase")` throws "Provider not registered" and no route, router,
or selector can reach the adapter.

The module remains importable so historical behavior stays inspectable and
testable — retirement removes runtime **reachability**, not the code. Its
fail-open branch was fixed regardless, so re-enabling it cannot reintroduce the
vulnerability. Coinbase was **not** revived as a production provider.

## Consequences

- Any future caller of `/api/webhooks/provider` receives 410 rather than silent
  acceptance. Nothing was calling it.
- A new adapter that omits verification is refused at runtime instead of trusted.
- An adapter that legitimately has no webhook contract must say so by throwing.
- Enabling Coinbase requires both the feature flag and a configured
  `COINBASE_WEBHOOK_SHARED_SECRET`.

## Rejected non-2xx behavior

Rejected webhooks return 400/401/403/410 as appropriate and produce no canonical
state change, no ledger write, no payment event, and no outbound merchant
webhook. PineTree does **not** return 200 for an unsigned event to suppress
provider retries: an unauthenticated request has not earned an acknowledgement.

## Known residual items (not addressed here — out of this task's scope)

- `app/api/webhooks/base/route.ts:42` and `app/api/webhooks/solana/route.ts:36`
  compare the Alchemy signature with `===` rather than `timingSafeEqual`
  (audit finding **F-4**). The route-auth matrix marks these routes
  "Do not change per Phase 3C constraints", so this needs owner sign-off.
- `providers/shift4/verifyWebhook.ts:15` retains a test seam gated on
  **both** `NODE_ENV !== "production"` **and** `SHIFT4_WEBHOOK_TEST_BYPASS === "true"`.
  It cannot affect production and is asserted by
  `__tests__/shift4ProviderAdapter.test.ts`. Retained deliberately; production
  verification for Shift4 remains fail-closed.

## Verification

- `__tests__/webhookVerificationFailClosed.test.ts` — adapter and engine
  fail-closed contracts, payload trust, rail correlation, idempotency and
  terminal-state protection.
- `__tests__/webhookRouteAndRegistryContract.test.ts` — 410 on the retired route,
  a registry-wide contract over every actively registered adapter, Coinbase
  non-registration, and proof that a correctly signed Stripe webhook is still
  accepted while a tampered body is not.
