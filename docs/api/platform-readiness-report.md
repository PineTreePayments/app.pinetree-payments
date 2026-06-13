# PineTree API Platform — Readiness Report

**Date:** 2026-06-12  
**Version:** v1 (pre-launch)  
**SDK:** `@pinetree/node` 0.1.0 (private)

---

## Summary

The PineTree v1 API platform and its companion Node SDK are feature-complete for
the core payment workflow.  Integration tests are in place and passing offline.
Several infrastructure prerequisites (database migrations, production webhook
registration, Mesh managed transfers) remain before the platform is ready for
public launch.

---

## v1 Checkout Sessions

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
remain internal and are not part of the v1 public API surface.

---

## v1 Webhooks

**Status: Complete**

Webhook events use HMAC-SHA256 signing:

- Signature header: `PineTree-Signature`
- Timestamp header: `PineTree-Timestamp`
- Event ID header: `PineTree-Event-Id`
- Version header: `PineTree-Webhook-Version` (value: `2026-06-12`)

The SDK's `webhooks.constructEvent()` verifies the signature, validates the
replay window (default 300 s), parses the payload, and asserts the v1 event
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

Deliveries carry `attempt`, `status`, `responseStatus`, and `deliveredAt`
metadata.  Retry is idempotent against already-successful deliveries.

---

## SDK Status

**Status: Private 0.1.0 — not published**

| Area | State |
|---|---|
| Package name | `@pinetree/node` |
| Version | `0.1.0` |
| Visibility | `private: true` |
| Build targets | ESM, CJS, TypeScript declarations |
| Node support | `>=18`; Node 20 LTS recommended |
| Exported resources | `PineTree` client, `checkout.sessions`, `payments`, `webhookDeliveries`, `webhooks` |
| Exported errors | `PineTreeError`, `AuthenticationError`, `PermissionError`, `InvalidRequestError`, `APIConnectionError`, `IdempotencyConflictError`, `WebhookVerificationError` |
| Exported constants | `PineTreeWebhookHeaders`, `PineTreeWebhookVersion` |
| Build validation | Consumer type-check runs at build time; validated against strict TypeScript |
| npm publish | Disabled; `private: true` until explicitly approved |

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
2. **Prior API v1 migrations** must be confirmed applied and healthy in all
   environments.
3. **Production webhook registration** — endpoint IDs and signing secrets must
   be configured and recorded in `INFRA.md`.
4. **Contract deployment** — any pending smart contract deployments must be
   completed and their addresses recorded in `INFRA.md`.

### Features — Deferred (not blocking v1)

5. **Mesh managed transfers** — first-pass Mesh Connect integration is done
   (routes, DB table, SDK wiring, import UI); managed transfers are intentionally
   deferred to a future release.
6. **Shopify / WooCommerce plugins** — not started; planned for a post-launch
   release.

### SDK — Must Complete Before Publish

7. **Remove `"private": true`** from `packages/pinetree-node/package.json` in
   the designated release commit.
8. **npm organization and publish rights** confirmed.
9. **`npm run release-candidate`** passes cleanly against the release branch.
10. **Sandbox integration test** passes end-to-end against staging.
11. **README and API docs** reviewed and approved.

### Phase 9 Candidates

- Full staging integration test run with real `pt_test_*` keys.
- Changelog and release notes authored.
- npm publish dry run against the npm registry (`--dry-run`).
- SDK version bump to `1.0.0` (or agreed version) and `private` removal.
- Post-publish smoke test in a clean Node project.
- Monitoring and alerting review.

---

*Report generated 2026-06-12.  Update before each release gate review.*
