# Shift4 route authentication and tenancy matrix

All JSON routes use the standard `{ ok, data }` / `{ ok: false, error: { code, message, correlationId } }` envelope unless marked as an existing legacy/webhook route. Merchant identity is derived from authenticated PineTree credentials; request bodies cannot choose another merchant.

| Path | Method | Authentication / role | Merchant resolution | Gates | Engine/service | Allowed response fields |
|---|---|---|---|---|---|---|
| `/api/admin/shift4/readiness` | GET | PineTree bearer session; admin | validated `merchantId` query after admin check | certification mode; read-only | `resolveShift4Readiness` | merchantId, readiness capabilities/reasons, case counts, liveExecutionEnabled=false |
| `/api/admin/shift4/onboarding` | GET | PineTree bearer session; admin | validated `merchantId` query after admin check | certification mode; read-only | onboarding persistence read service | safe session/status/references/timestamps only |
| `/api/admin/shift4/certification` | POST | PineTree bearer session; admin | synthetic fixture namespace; no merchant from body | certification mode; fixture adapter only; live/test rejected | `runShift4CertificationFixture` | run/manifest IDs, safe cases/states/evidence, providerRequestsSent |
| `/api/internal/shift4/readiness` | GET | **Shift4 operator** (`requireShift4OperatorFromRequest`): admin role AND exact confirmed-email match against `SHIFT4_OPERATOR_EMAIL` | operator's own session | read-only; generic 404 for everyone else | `getShift4ReadinessForMerchant` | server-derived readiness only |
| `/api/internal/shift4/connect` | GET | **Shift4 operator** | operator's own session | read-only | `getShift4RetailConnectSurface` | `enabled` boolean + coarse reason, merchant time zone, non-secret channel status |
| `/api/internal/shift4/connect` | POST | **Shift4 operator** | operator's own session; a body `merchantId` is rejected with 403 | authorization precedes body parsing; JSON content type; 4 KB body cap; `channel` must be `retail` or `ecommerce`; IANA time zone required; unsupported fields rejected; auth-token replay guarded by `api_idempotency_claims` | `connectShift4Merchant` (Access Token Exchange) | connectionId, environment, channel, accessTokenFingerprint, connectedAt, correlationId — never the auth token, client GUID, access token, or encrypted envelope |
| `/api/internal/shift4/merchant` | GET | merchant session/API key | authenticated merchant | read-only; `channel` query parameter required | certification merchant-information service | normalized merchant capability information |
| `/api/internal/shift4/attempts` | GET | `payments:read` | authenticated merchant + payment ownership | read-only | attempt listing service | redacted attempt views |
| `/api/internal/shift4/invoices/[invoice]` | GET | `payments:read` | authenticated merchant + invoice ownership | read-only | invoice evidence service | normalized attempt evidence or not-found |
| `/api/internal/shift4/tenders` | GET | `payments:read` | authenticated merchant + payment ownership | read-only | tender progress Engine | safe totals/state/references |
| `/api/internal/shift4/recovery` | POST | `checkout.sessions:write` | authenticated merchant + attempt ownership | readiness and unknown-outcome policy | recovery Engine | normalized recovery outcome/state |
| `/api/internal/shift4/payments/[operation]` | POST | `checkout.sessions:write` | authenticated merchant + connection/payment ownership | operation capability, certification, environment, production; simulator unavailable | payment execution Engine | normalized payment result/attempt identifiers only |
| `/api/internal/shift4/tokenization/sessions` | POST | `checkout.sessions:create` | authenticated merchant + payment/connection ownership | hosted-checkout/i4Go readiness | hosted-checkout Engine | safe session ID, expiry, browser config; never token/secret |
| `/api/internal/shift4/tokenization/complete` | POST | `checkout.sessions:write` | authenticated merchant + session/payment ownership | hosted-checkout readiness; one-time consumption | hosted-checkout Engine | normalized/resumed attempt state; never raw token |
| `/api/internal/shift4/onboarding/start` | POST | `checkout.sessions:write` | authenticated merchant | onboarding configuration or explicit fixture selection constrained by server | onboarding Engine | safe application/launch reference and status |
| `/api/internal/shift4/onboarding/status` | GET | `checkout.sessions:read` | authenticated merchant | read-only | onboarding persistence read service | safe session/status/references/timestamps |
| `/api/internal/shift4/onboarding/fixture-update` | POST | `checkout.sessions:write` | authenticated merchant | certification mode; fixture update only | onboarding Engine | normalized safe update result |
| `/api/webhooks/shift4` | GET | none; health response only | none | no processing | static health | health status only |
| `/api/webhooks/shift4` | POST | verified webhook signature | merchant resolved by verified event/connection | webhook verification + event lifecycle | event processor | acknowledgement or generic error only |

## Enforced invariants

- Admin routes call `requireAdminFromRequest` before accepting a merchant query.
- Merchant routes call `requireMerchantIdFromRequest`; no body `merchantId` is authoritative.
- The Shift4 credential-exchange and raw-readiness surfaces are internal operator tools, not merchant features. They require BOTH the existing admin role AND an exact match between the account's confirmed primary email and the server-only `SHIFT4_OPERATOR_EMAIL` (compared after trim + lowercase; no domain, prefix, or substring matching). Every failure — unauthenticated, non-admin, other admin, unverified email, unconfigured deployment — returns one identical generic 404, so the routes cannot be probed. The configured address is never returned, logged, or placed in an error, and is never exposed through `NEXT_PUBLIC_*`.
- Fixture certification accepts only `mode: fixture`; `mode: test` fails closed and no real-adapter selector exists.
- Production payment routes compose real adapters through Engine readiness and cannot select the simulator.
- Browser responses omit access tokens, client GUIDs, service-role keys, card tokens, authorization codes, raw provider/database payloads, and applicant data.
- Standard route errors replace unexpected server messages with a generic fallback plus a new correlation ID.
- Merchant Auth Tokens are runtime-only inputs to `/api/internal/shift4/connect`. They are never environment variables, never persisted, and never logged; only a SHA-256 hash is retained, as the single-use replay key.
- A stored Access Token is resolved for exactly one channel. Retail never falls back to the E-commerce credential or the reverse, and a credential minted for a different `SHIFT4_REST_ENVIRONMENT` is refused before decryption.
