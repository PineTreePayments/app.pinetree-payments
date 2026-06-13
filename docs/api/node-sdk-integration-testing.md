# PineTree Node SDK Integration Testing

The private Node SDK has an opt-in integration suite under
`packages/pinetree-node/test/integration`. The normal SDK and repository test
commands remain offline and do not run this suite.

## API Key Format

PineTree uses **one key format for all environments**:

```
pt_live_<64 hex chars>
```

There is no `pt_test_*` variant.  A key created in your local database has the
same `pt_live_*` format as a production key.  Use the setup script to create a
key that lives only in your local Supabase instance.

> **Do not use a production `pt_live_*` key against a local server.**  
> The setup script creates a separate key in the local database.

## Migration Prerequisites

Before running integration tests, confirm these migrations are applied:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'api_idempotency_claims',
    'webhook_deliveries',
    'checkout_sessions',
    'merchant_api_keys'
  );
```

All four rows must be present.  If any are missing, apply the relevant migration
from `database/migrations/` before proceeding.

## Environment Variables

Required:

- `PINETREE_RUN_INTEGRATION` — must be `"true"` (set automatically by the runner script)
- `PINETREE_INTEGRATION_BASE_URL` — e.g. `http://localhost:3000`
- `PINETREE_INTEGRATION_API_KEY` — a `pt_live_*` key from the target database
- `PINETREE_INTEGRATION_WEBHOOK_SECRET` — any strong secret for signing fixtures

Optional:

- `PINETREE_INTEGRATION_PAYMENT_ID` — enables the payment retrieval test (skipped if absent).
- `PINETREE_ALLOW_PRODUCTION_INTEGRATION=true` — required for production hosts.

## Local Setup

### Step 1 — Start the dev server

```powershell
npm run dev
```

### Step 2 — Create a local integration key

```powershell
node packages/pinetree-node/scripts/setup-integration.mjs --merchant-id <your-merchant-uuid>
```

This creates a `pt_live_*` key in the local database and prints the env vars to
set.  The key value is shown only once.

### Step 3 — Set environment variables

```powershell
$env:PINETREE_RUN_INTEGRATION         = "true"
$env:PINETREE_INTEGRATION_BASE_URL    = "http://localhost:3000"
$env:PINETREE_INTEGRATION_API_KEY     = "pt_live_<value from setup script>"
$env:PINETREE_INTEGRATION_WEBHOOK_SECRET = "whsec_<value from setup script>"
```

### Step 4 — Run integration tests

```powershell
npm run test:integration:local --workspace packages/pinetree-node
```

`test:integration:local` sets `PINETREE_INTEGRATION_BASE_URL=http://localhost:3000`
as the default.  Override it if the server uses a different port.

## Staging

```powershell
$env:PINETREE_INTEGRATION_BASE_URL       = "https://staging.example.com"
$env:PINETREE_INTEGRATION_API_KEY        = "pt_live_..."
$env:PINETREE_INTEGRATION_WEBHOOK_SECRET = "whsec_..."
npm run test:integration --workspace packages/pinetree-node
```

Create a dedicated key in the staging database using the setup script pointed at
the staging Supabase instance.

## Production

Production execution creates and cancels real checkout sessions. It is disabled
unless the confirmation flag is present:

```powershell
$env:PINETREE_INTEGRATION_BASE_URL           = "https://app.pinetree-payments.com"
$env:PINETREE_INTEGRATION_API_KEY            = "pt_live_..."
$env:PINETREE_INTEGRATION_WEBHOOK_SECRET     = "whsec_..."
$env:PINETREE_ALLOW_PRODUCTION_INTEGRATION   = "true"
npm run test:integration --workspace packages/pinetree-node
```

Review the session amount ($1.00 USD) and remove `PINETREE_ALLOW_PRODUCTION_INTEGRATION`
immediately after the run.

## Production Safety Guard

The integration guard enforces these rules automatically:

1. `PINETREE_RUN_INTEGRATION` must be `"true"`.
2. All three required variables must be present.
3. Known production hosts (`app.pinetree-payments.com`) require
   `PINETREE_ALLOW_PRODUCTION_INTEGRATION=true`.

The guard does **not** filter on key prefix — PineTree uses a single `pt_live_*`
format and locally-created keys have the same format as production keys.  The
responsibility to use the correct key for the target environment rests with the
operator.

## What the Integration Suite Tests

| Test | API operation | Requires |
|---|---|---|
| Create and retrieve session | POST + GET `/checkout/sessions` | Always |
| List sessions | GET `/checkout/sessions?reference=...` | Always |
| Cancel session | POST `/checkout/sessions/:id/cancel` | Always |
| Expire session | POST `/checkout/sessions/:id/expire` | Always |
| Retrieve payment | GET `/payments/:id` | `PINETREE_INTEGRATION_PAYMENT_ID` |
| Webhook fixture verification | SDK only — no API call | Always |
| Tamper detection | SDK only | Always |
| Stale timestamp rejection | SDK only | Always |

## Known Limitations

- Webhook fixture tests are fully local — they sign and verify without calling
  the API.  Real end-to-end webhook delivery requires a publicly routable URL.
- The payment retrieval test is skipped unless a pre-existing payment ID is
  supplied.
- Idempotency replay is tested via unit tests, not live.

## Key Lifecycle

1. Create a dedicated local integration key with the setup script.
2. Grant only the scopes needed by the integration checks (all scopes by default).
3. Run the suite without sharing terminal output containing credentials.
4. Revoke the key after testing: set `revoked_at = now()` in `merchant_api_keys`.
5. Remove the env var values from the shell session.

Never commit API keys, webhook secrets, `.env` files, or test snapshots
containing credentials or tokens.

## CI

The `.github/workflows/sdk-ci.yml` workflow includes a separate `sdk-integration`
job that:

- Triggers only on `workflow_dispatch` (never automatic).
- Requires a protected `sdk-integration` environment for secret access.
- Uses `PINETREE_INTEGRATION_API_KEY` and `PINETREE_INTEGRATION_WEBHOOK_SECRET`
  from repository secrets.
- Never sets `PINETREE_ALLOW_PRODUCTION_INTEGRATION`.
