# PineTree Local Stack Release Validation

Use this checklist for a real local release-candidate pass across the PineTree API,
`@pinetree/node`, `@pinetree/js`, and `@pinetree/react`. Automated unit tests
remain offline; this checklist creates real local checkout sessions.

Never commit API keys, public-key management responses, webhook secrets,
checkout URLs, or `.env` files.

## 1. Prepare the Local Database

Configure `.env.local` for the local Supabase project, then apply every migration
in `database/migrations/` using the repository's normal Supabase migration
workflow. Confirm these platform tables exist:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'api_idempotency_claims',
    'checkout_sessions',
    'merchant_api_keys',
    'merchant_public_keys',
    'webhook_deliveries'
  );
```

Do not continue until all five rows are returned.

## 2. Start the App

```powershell
npm install
npm run dev
```

Keep the app available at `http://localhost:3000`.

## 3. Create Local Keys

Create a dedicated merchant secret key for Node SDK integration tests:

```powershell
node packages/pinetree-node/scripts/setup-integration.mjs `
  --merchant-id <local-merchant-uuid>
```

The command prints the secret once. Set the resulting
`PINETREE_INTEGRATION_*` variables only in the current shell.

Create a browser public key from **Dashboard > Developer > Public Keys**, or
while authenticated to the local dashboard call:

```text
POST http://localhost:3000/api/merchant/public-keys
Content-Type: application/json

{"name":"Local browser SDK validation"}
```

Use only the returned `pk_live_*` key in browser and React code. Never expose the
`pt_live_*` merchant key there.

## 4. Run Node SDK Integration Tests

```powershell
$env:PINETREE_INTEGRATION_BASE_URL = "http://localhost:3000"
npm run test:integration:local --workspace packages/pinetree-node
```

The opt-in suite creates, retrieves, lists, cancels, and expires local sessions.
Payment retrieval runs only when `PINETREE_INTEGRATION_PAYMENT_ID` is set.

## 5. Validate the Browser SDK

Initialize `@pinetree/js` with the local public key and base URL. Use
`redirect: false` to create a session without navigating away:

```ts
import { PineTree } from "@pinetree/js"

const pinetree = new PineTree({
  publicKey: "pk_live_local_value",
  baseUrl: "http://localhost:3000",
})

const checkout = await pinetree.checkout.open({
  amount: 100,
  currency: "USD",
  reference: `local-browser-${Date.now()}`,
  redirect: false,
})

console.log(checkout.sessionId, checkout.status)
checkout.destroy()
```

Confirm the session is merchant-scoped and its hosted checkout URL points to the
local app.

## 6. Run the React Smoke Test

Follow [React SDK integration testing](./react-sdk-integration-testing.md).
Validate both the checkout button and embedded iframe using the same local
`pk_live_*` key.

## 7. Verify Hosted Checkout Lifecycle Events

1. Open checkout in popup or embedded mode.
2. Register `complete`, `failed`, `expired`, `canceled`, and `closed` handlers.
3. Complete or terminate the local hosted checkout flow.
4. Confirm the matching handler receives only `event`, `status`, `sessionId`,
   `source`, and `version`.
5. Confirm messages from a wrong origin or session are ignored.
6. Call `checkout.destroy()` and confirm later messages are ignored.

The hosted checkout and SDK must share the same local origin configuration for
the postMessage origin check to pass.

## 8. Teardown

- Revoke the local `pt_live_*` integration key.
- Disable the local `pk_live_*` public key.
- Remove integration variables from the shell.
- Destroy checkout instances and stop the dev server.
- Do not paste full keys or tokenized checkout URLs into issues or test output.

## Automated Release Gate

Run the offline release candidate before and after the hands-on checklist:

```powershell
npm run release-candidate
```

To inspect the planned checks without building or testing:

```powershell
npm run release-candidate:dry-run
```
