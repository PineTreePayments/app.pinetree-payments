This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Speed Bitcoin Lightning (PineTree Wallet Treasury Sweep)

Canonical Bitcoin Lightning uses PineTree's Speed/TrySpeed platform account. Merchants do **not** connect Speed, NWC, Spark, or any external Lightning wallet. PineTree Wallet is the merchant-facing product; its Bitcoin payout address is stored on the merchant's `pinetree_wallet_profiles` row.

Required server-only env vars:

```bash
PINE_TREE_LIGHTNING_PROVIDER=speed
PINE_TREE_LIGHTNING_SETTLEMENT_MODE=speed_platform_treasury_sweep
SPEED_API_KEY=<PineTree Speed live secret key>
SPEED_WEBHOOK_SECRET=<Speed webhook endpoint secret>
SPEED_API_BASE_URL=https://api.tryspeed.com
INTERNAL_API_SECRET=<shared secret for internal payout processing>
# or
CRON_SECRET=<shared secret for cron-triggered payout processing>
```

Recommended/optional env vars:

```bash
SPEED_ENVIRONMENT=production
SPEED_PLATFORM_ACCOUNT_ID=<PineTree Speed platform/account id>
SPEED_DASHBOARD_URL=https://app.tryspeed.com
SPEED_CONNECT_WEBHOOK_SECRET=<Speed connected-account webhook secret>
```

Never expose `SPEED_API_KEY`, `SPEED_WEBHOOK_SECRET`, `SPEED_CONNECT_WEBHOOK_SECRET`, `INTERNAL_API_SECRET`, or `CRON_SECRET` to the browser. Speed Connect env vars are **not required** for `speed_platform_treasury_sweep`. If `SPEED_CONNECT_WEBHOOK_SECRET` is unset, connected-account webhook events fall back to verifying against `SPEED_WEBHOOK_SECRET` and log a server warning.

Canonical live Speed Lightning flow:

- PineTree creates the Speed Lightning invoice with `SPEED_API_KEY`.
- The customer pays the gross total into PineTree's Speed account.
- PineTree records the service fee separately.
- A confirmed Speed payment creates one `lightning_payout_jobs` row for the merchant net amount.
- The payout processor calls Speed instant send (`POST /send`) to send merchant net sats to `pinetree_wallet_profiles.btc_address`.
- Payout status, Speed references, and txid are tracked on `lightning_payout_jobs`.

Bitcoin Lightning readiness requires:

- `PINE_TREE_LIGHTNING_PROVIDER=speed`
- `PINE_TREE_LIGHTNING_SETTLEMENT_MODE=speed_platform_treasury_sweep`
- PineTree Speed config present (`SPEED_API_KEY`, `SPEED_WEBHOOK_SECRET`, and Speed API base URL)
- Merchant PineTree Wallet BTC payout address present
- `btc_payout_enabled=true`

Speed webhook setup:

- Configure the Speed endpoint as `https://app.pinetree-payments.com/api/webhooks/speed`.
- Configure this endpoint inside PineTree's Speed dashboard, not inside each merchant account.
- The Speed dashboard also has a separate connected-account webhook pointing at the same URL. Its signing secret is `SPEED_CONNECT_WEBHOOK_SECRET`; the account-level webhook above uses `SPEED_WEBHOOK_SECRET`. Both post to `/api/webhooks/speed`, and the handler picks the right secret per event.
- Keep `/api/webhooks/lightning` in place for legacy/generic Lightning routing; canonical Speed platform payments use `/api/webhooks/speed`.

Environment/key safety:

- `SPEED_ENVIRONMENT=production` expects a live `sk_live_...` Speed secret key.
- `SPEED_ENVIRONMENT=test` expects a test `sk_test_...` Speed secret key.
- The app marks Speed not-ready when the configured environment and key prefix do not match.

Speed dashboard may warn about unrestricted API keys. Do not configure IP restrictions unless PineTree/Vercel has stable outbound IPs or fixed egress; otherwise Speed API calls may fail. For production, prefer restricted keys or fixed egress when available.

---

## Speed Connected-Account Wallet Management

PineTree can provision a Speed subaccount for a merchant while keeping Speed
provider details server-side. `merchant_lightning_profiles.speed_account_id`
is the canonical account identity. PineTree uses its platform credentials and
adds `speed-account: <acct_...>` to merchant-scoped payment, balance,
transaction-list, and Instant Send requests.

Connected-account mode requires:

```bash
SPEED_CONNECT_ENABLED=true
```

Balances are cached by merchant, provider, provider account, asset, and
network. Transaction sync is cursor-paginated and merges Speed transaction
IDs/source IDs into the existing wallet-operation ledger. User-triggered
Bitcoin Lightning withdrawals use Instant Send and are completed only when
Speed reports `paid`. Speed does not expose AutoSwap or AutoPayout APIs;
PineTree does not simulate either feature. See
`docs/environment/lightning-sweep-env-checklist.md`.

## Legacy Lightning Mode

NWC direct wallet mode requires a Nostr Wallet Connect URI with `make_invoice`, `lookup_invoice`, and `pay_invoice` permissions. The NWC URI is stored server-side in `merchant_providers.credentials` and never returned to the browser.

Optional public NWC setup/help links:

```bash
NEXT_PUBLIC_ALBY_HUB_URL=https://getalby.com/hub/apps
NEXT_PUBLIC_ZEUS_IOS_URL=https://apps.apple.com/us/app/zeus-ln/id1456038895
NEXT_PUBLIC_ZEUS_ANDROID_URL=https://play.google.com/store/apps/details?id=app.zeusln
NEXT_PUBLIC_ALBY_NWC_GUIDE_URL=https://guides.getalby.com/user-guide/alby-account-and-browser-extension/alby-hub/nwc
NEXT_PUBLIC_ZEUS_NWC_GUIDE_URL=https://zeusln.app
```

Do not add secret or private NWC connection values as `NEXT_PUBLIC_` variables.

The optional legacy PineTree treasury NWC URI used for post-payment fee collection is set as a server env var (not stored in the DB):

```bash
PINETREE_TREASURY_NWC_URI=nostr+walletconnect://...
```

---

## Mesh Connect — Exchange Address Import

Mesh Connect lets merchants connect their exchange account and import deposit addresses into PineTree's saved destination address book. Mesh is **not** involved in Speed/Lightning setup, Speed dashboard links, payment routing, or invoice creation.

Server-side secrets (never exposed to the browser):

```bash
MESH_CLIENT_ID=<from Mesh dashboard>
MESH_CLIENT_SECRET=<from Mesh dashboard>
MESH_API_BASE_URL=https://integration-api.meshconnect.com
```

Client-side (safe to expose):

```bash
NEXT_PUBLIC_MESH_CLIENT_ID=<same value as MESH_CLIENT_ID>
NEXT_PUBLIC_MESH_CONNECT_ENABLED=true
```

Set `NEXT_PUBLIC_MESH_CONNECT_ENABLED=true` to enable the Connect Exchange button on the Wallets page. The button is disabled/hidden when this is `false` or unset.

**Important separation:**

- TrySpeed shortcut buttons (Open Speed Dashboard, Open Associated Accounts, Open Auto Payout, Open Speed Login) are shown in the Lightning wallet drawer from client-safe `NEXT_PUBLIC_SPEED_*` URL variables. They have no dependency on Mesh.
- Mesh exchange connection is controlled only by `NEXT_PUBLIC_MESH_CONNECT_ENABLED` and requires `MESH_CLIENT_ID` / `MESH_CLIENT_SECRET` on the server. It has no dependency on Speed vars.

What Mesh does:
- Connects a merchant's exchange account (Coinbase, Kraken, etc.) via OAuth through the Mesh Link UI
- Imports deposit addresses into PineTree's saved destination address book (`merchant_settlement_destinations`)
- Marks imported destinations with `source=mesh` and `connected_provider=mesh`

What Mesh does **not** do:
- Does **not** move funds (PineTree Send / wallet approval still required)
- Does **not** affect Speed credentials, Speed invoice creation, or Speed webhooks
- Mesh managed transfers are not enabled

---

## Base V7 and Solana Pay

Base V7 (EIP-3009 / delegated USDC) and Solana Pay are separate payment rails with their own configuration. See `.env.local` for their respective env vars. These are not affected by Speed, NWC, or Mesh setup.
