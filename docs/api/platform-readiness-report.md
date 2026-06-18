# PineTree API Platform — Readiness Report

**Date:** 2026-06-13
**Product:** PineTree API
**SDKs:** `@pinetreepayments/node` 0.1.0 · `@pinetreepayments/js` 0.3.0 (0.4.0-beta.1 planned) · `@pinetreepayments/react` 0.1.0 (public packages)

---

## Summary

The PineTree API platform and its companion Node SDK are feature-complete for
the core payment workflow.  Integration tests are in place and passing offline.
Several infrastructure prerequisites (database migrations, production webhook
registration, Mesh managed transfers) remain before the platform is ready for
public launch.

---

## Checkout Sessions

**Status: Complete**

| Operation | Route | SDK method |
|---|---|---|
| Create | `POST /api/v1/checkout/sessions` | `checkout.sessions.create()` |
| Retrieve | `GET /api/v1/checkout/sessions/:id` | `checkout.sessions.retrieve()` |
| List | `GET /api/v1/checkout/sessions` | `checkout.sessions.list()` |
| Cancel | `POST /api/v1/checkout/sessions/:id/cancel` | `checkout.sessions.cancel()` |
| Expire | `POST /api/v1/checkout/sessions/:id/expire` | `checkout.sessions.expire()` |

All five operations are implemented in the API and the SDK.  The SDK surfaces
`CheckoutSession` and `CheckoutSessionList` as exported types.

---

## Idempotency

**Status: Complete**

The SDK client accepts an `idempotencyKey` option on every mutating request and
forwards it as `x-idempotency-key`.  The API enforces idempotency on session
creation.  `IdempotencyConflictError` is exported from the SDK for consumer
error handling.

---

## Lifecycle Controls

**Status: Complete**

Cancel (`/cancel`) and expire (`/expire`) are distinct operations:

- **Cancel** — merchant-initiated termination; sets status to `canceled`.
- **Expire** — platform-initiated expiry; sets status to `expired`.

Both operations are idempotent against already-terminal sessions.

---

## Public Payments

**Status: Complete**

`GET /api/v1/payments/:id` returns a public payment facade — amount, currency,
status, and metadata — without exposing internal ledger details.  The SDK
surfaces `payments.retrieve()` and the `Payment` type.  Full payment details
remain private and are not part of the public API surface.

---

## Webhooks

**Status: Complete**

Webhook events use HMAC-SHA256 signing:

- Signature header: `PineTree-Signature`
- Timestamp header: `PineTree-Timestamp`
- Event ID header: `PineTree-Event-Id`
- Schema header: `PineTree-Event-Schema` (value: `payments-v1`; also sent as `PineTree-Webhook-Version` for legacy compatibility)

The SDK's `webhooks.constructEvent()` verifies the signature, validates the
replay window (default 300 s), parses the payload, and asserts the event
contract.  Both current (`PineTree-*`) and legacy (`X-PineTree-*`) header names
are supported for a smooth transition.  `WebhookVerificationError` is exported
for consumer error handling.

---

## Webhook Retry / Redelivery

**Status: Complete**

| Operation | Route | SDK method |
|---|---|---|
| List deliveries | `GET /api/v1/webhook-deliveries` | `webhookDeliveries.list()` |
| Retry delivery | `POST /api/v1/webhook-deliveries/:id/retry` | `webhookDeliveries.retry()` |

Deliveries carry `attemptCount`, `status`, `lastStatusCode`, `lastError`, and `deliveredAt`
metadata.  Retry is idempotent against already-successful deliveries.

---

## SDK Status

**Status: Three private SDKs — not published**

### @pinetreepayments/node 0.1.0

| Area | State |
|---|---|
| Visibility | `private: true` |
| Build targets | ESM, CJS, TypeScript declarations |
| Node support | `>=18` |
| Exported resources | `PineTree` client, `checkout.sessions`, `payments`, `webhookDeliveries`, `webhooks` |
| Exported errors | `PineTreeError`, `AuthenticationError`, `PermissionError`, `InvalidRequestError`, `APIConnectionError`, `IdempotencyConflictError`, `WebhookVerificationError` |
| Exported constants | `PineTreeWebhookHeaders`, `PineTreeWebhookVersion` |
| First publish target | `0.1.0-beta.1` |

### @pinetreepayments/js 0.3.0

| Area | State |
|---|---|
| Visibility | `private: true` |
| Build targets | ESM, CJS, TypeScript declarations |
| Browser-safe | No Node.js built-ins |
| Exported | `PineTree` client, `PineTreeBrowserError`, `CheckoutInitializationError`, `CheckoutSessionError`, all checkout types |
| Phase 14 lifecycle events | Implemented but not yet versioned (unreleased in changelog) |
| First publish target | `0.4.0-beta.1` (after Phase 14 version bump) |

### @pinetreepayments/react 0.1.0

| Area | State |
|---|---|
| Visibility | `private: true` |
| Build targets | ESM, CJS, TypeScript declarations |
| Peer dependencies | React 18+, react-dom 18+ |
| Exported | `PineTreeProvider`, `usePineTree`, `PineTreeCheckoutButton`, `PineTreeCheckout`, all types |
| First publish target | `0.1.0-beta.1` |

---

## Integration Testing Status

**Status: Infrastructure complete — opt-in only**

| Component | State |
|---|---|
| Test suite | `test/integration/sdk.integration.test.ts` — full CRUD + webhook coverage |
| Safety guards | `loadIntegrationEnvironment()` — rejects missing env vars, production without explicit flag, live keys against localhost |
| Guard tests | `test/integration/environment.test.ts` — 3 assertions, no credentials required, runs in CI |
| Helper utilities | `integrationReference()`, `createSignedWebhookFixture()` |
| CI trigger | `workflow_dispatch` only; never automatic |
| Production tests | Permanently disabled unless `PINETREE_ALLOW_PRODUCTION_INTEGRATION=true` is set manually |

Integration tests are run via:
```
PINETREE_RUN_INTEGRATION=true \
PINETREE_INTEGRATION_BASE_URL=<url> \
PINETREE_INTEGRATION_API_KEY=pt_test_... \
PINETREE_INTEGRATION_WEBHOOK_SECRET=whsec_... \
npm run test:integration --workspace packages/pinetree-node
```

---

## Remaining Blockers Before Public Launch

The following items must be resolved before the platform is opened to the public
or the SDK is published.

### Infrastructure — Must Complete

1. **Database migration `20260605`** (merchant send approval sessions) must be
   applied to staging and production.
2. **Prior API migrations** must be confirmed applied and healthy in all
   environments.
3. **Production webhook registration** — endpoint IDs and signing secrets must
   be configured and recorded in `INFRA.md`.
4. **Contract deployment** — any pending smart contract deployments must be
   completed and their addresses recorded in `INFRA.md`.

### Features — Deferred

5. **Mesh managed transfers** — first-pass Mesh Connect integration is done
   (routes, DB table, SDK wiring, import UI); managed transfers are intentionally
   deferred to a future release.
6. **Shopify / WooCommerce plugins** — not started; planned for a post-launch
   release.

### SDK — Must Complete Before Publish

7. **Remove `"private": true`** from each publishing package's `package.json`
   in the designated release commit only. See [npm-publish-checklist.md](./npm-publish-checklist.md).
8. **npm `@pinetree` organization** created and publish rights confirmed.
9. **`npm run release-candidate`** passes cleanly (18+ checks) against the release branch.
10. **Consumer validation typecheck** passes (step added to release-candidate script).
11. **Sandbox integration test** passes end-to-end against staging.
12. **Confirm repository URLs** — `repository`, `homepage`, and `bugs` fields in
    `package.json` files currently use placeholder GitHub URLs. Update to the real
    repo URL before publishing.
13. **LICENSE file** is present in each package directory (already added; verify
    it appears in `npm pack` output before publish).
14. **Bump `@pinetreepayments/js` to `0.4.0`** before publishing (Phase 14 lifecycle
    events are implemented but not reflected in the current `0.3.0` version tag).

### Before First npm Publish

- Full staging integration test run with real keys.
- `npm publish --tag beta` dry run against the npm registry.
- Per-package version bumps with beta suffix (see [version-strategy.md](./version-strategy.md)).
- Post-publish smoke test in a clean project (`npm install @pinetreepayments/node@beta`).
- Monitoring and alerting review.

---

*Report generated 2026-06-12.  Update before each release gate review.*
