# Shift4 Payment Platform REST — environment checklist

Server-only configuration for the Shift4 REST integration (retail/POS via
Commerce Engine for Cloud, and e-commerce via the i4Go iframe).

**No value in this checklist may ever be committed.** Shift4 supplies the
credentials outside the repository; they are entered directly in the deployment
environment. `.env.example` carries blank placeholders only.

None of these may be prefixed with `NEXT_PUBLIC_`.

## Variables

| Variable | Required | Format | Purpose |
|---|---|---|---|
| `SHIFT4_REST_ENVIRONMENT` | yes | `test` or `production` | Selects the documented base URL. No default — an unset value fails closed. |
| `SHIFT4_REST_INTEGRATION_METHOD` | no | `host_direct` (default) or `commerce_engine_cloud` | Recorded so Commerce Engine request bodies and device timeouts can be selected in a later phase. Both resolve to the same host. |
| `SHIFT4_CLIENT_GUID` | yes | opaque, max 51 chars | The certified Client GUID from the Shift4 API Analyst. |
| `SHIFT4_INTERFACE_NAME` | yes | max 25 chars | `InterfaceName` header. |
| `SHIFT4_INTERFACE_VERSION` | yes | max 11 chars | `InterfaceVersion` header. |
| `SHIFT4_COMPANY_NAME` | yes | max 26 chars | `CompanyName` header. Must match what Shift4 has on file / the Integration Plan. |
| `SHIFT4_CREDENTIAL_ENCRYPTION_KEY` | yes | 64 hex chars (32 bytes) | Encrypts stored merchant access tokens and keys invoice derivation. |
| `SHIFT4_DEVICE_GLOBAL_TIMER_MS` | no | integer ms, default `120000` | Global Timer for UTG / Commerce Engine PIN pad card entry. |
| `SHIFT4_GLOBAL_TIMER_MS` | no | integer ms, default `65000` | Global Timer for all other card entry. |
| `SHIFT4_LOOKUP_TIMEOUT_MS` | no | integer ms, default `30000` | Invoice Information timeout. **PineTree-chosen** — Shift4 does not document a value for this. |

## Base URLs

Set by `SHIFT4_REST_ENVIRONMENT`; not configurable directly.

- test → `https://api.shift4test.com/api/rest/v1`
- production → `https://api.shift4api.net/api/rest/v1`

## Identity character rules

`InterfaceName`, `InterfaceVersion`, and `CompanyName` may not contain:

```
$ % : ^ - ~ ` < > , ? " " ' ' { } [ ] \ + =
```

Note the hyphen: `Pine-Tree` and `1.0-beta` are both invalid. Configuration
validation rejects these at startup rather than letting Shift4 reject the
request.

## Encryption key rotation

`SHIFT4_CREDENTIAL_ENCRYPTION_KEY` does two jobs: it encrypts stored access
tokens and it keys the deterministic invoice derivation.

**Do not rotate it while any Shift4 payment attempt is unsettled.** Rotating
changes every derived invoice number, which would break timeout recovery for
in-flight payments — the invoice lookup would query an invoice Shift4 never saw.
Rotation requires: no unsettled Shift4 attempts, re-running the access-token
exchange for every connected merchant, and a fresh Auth Token per merchant.

## Auth tokens are not environment variables

A merchant's Auth Token is supplied per merchant by their Lighthouse Transaction
Manager Account Administrator and is passed into
`connectShift4Merchant()` at connect time. It is single-use in production,
never stored, never logged, and never placed in an environment variable.

## Verification

```bash
npm run check:env
```

Shift4 REST is all-or-nothing: configuring some but not all of the required
variables is reported as a required failure.
