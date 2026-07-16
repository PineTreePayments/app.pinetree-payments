# Stripe Terminal Phase 2

PineTree keeps the existing boundary: UI → authenticated API → Engine → Stripe provider adapter → Stripe → verified webhook → event processor and ledger. Terminal Locations and Readers are provider objects synchronized into service-role-only PineTree tables; POS `terminals` remain PineTree device/PIN/tax records.

## Charge model

`PINE_TREE_STRIPE_CHARGE_MODEL=direct` is the supported default and matches the verified Connect foundation. PaymentIntents, Locations, Readers, and connection tokens belong to the connected account and use a server-resolved `Stripe-Account` context. `destination` is represented by the centralized helper but Terminal operations fail closed until that path is validated in Stripe test mode. `STRIPE_APPLICATION_FEE_ENABLED` defaults off; PineTree still persists its computed fee in the payment and ledger.

For POS manual entry, the authenticated manual-payment response returns the merchant's non-secret `acct_...` identifier because Stripe.js requires that connected-account context to initialize a direct-charge Payment Element with the platform publishable key. The response is private/no-store and whitelisted to payment ID, client secret, account context, and normalized status. Neither the account identifier nor PaymentIntent client secret is written to browser storage or logs.

## Browser and native boundary

There is no React Native, iOS, or Android application in this repository. The browser never advertises Tap to Pay and returns `native_app_required`. Do not add a Stripe Terminal native SDK to the Next.js bundle.

A future PineTree native client must:

- use the official Stripe Terminal iOS, Android, or React Native SDK;
- authenticate as a trusted PineTree client and fetch short-lived tokens from `POST /api/providers/stripe/terminal/connection-token`;
- fetch its location/capability state from `GET /api/providers/stripe/terminal/native-config`;
- detect supported hardware and OS versions locally;
- satisfy Stripe production entitlements and platform requirements before claiming production readiness.

`PINETREE_NATIVE_CLIENT_SECRET` is a temporary server-side trust boundary for a future first-party native client. It must never ship as a static secret in a distributable mobile binary; replace it with device-bound attestation/session credentials when that client is built.

## Configuration

- `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET` for platform events
- `STRIPE_CONNECT_WEBHOOK_SECRET` for connected-account payment, Terminal, and account events
- `PINE_TREE_STRIPE_CHARGE_MODEL=direct`
- `STRIPE_APPLICATION_FEE_ENABLED=false` until commercially approved
- `PINETREE_NATIVE_CLIENT_SECRET` only when exercising the trusted-native contract

Subscribe the Connect webhook to `payment_intent.created`, `payment_intent.processing`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, supported `terminal.reader.action_*` events, and `account.updated`.

## Migration and smoke test

Run `database/migrations/20260715_create_merchant_terminal_tables.sql` manually after review. It creates provider-generalized location/reader tables, RLS, ownership indexes, one-default-reader enforcement, and concurrency claims. It stores no card data, registration codes, client secrets, connection-token secrets, or webhook secrets.

After the migration, configure a local test-mode connected merchant and run `npm run smoke:stripe-terminal`. The harness creates/reuses a simulated reader, sends a PineTree payment to it, presents a Stripe test card, and waits for webhook-driven `CONFIRMED`. It cancels an unfinished payment on failure. Persistent synchronized reader/location rows are intentionally retained for reuse; disposable provider cleanup should be performed in the Stripe test Dashboard when needed.
