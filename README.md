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

## Speed Bitcoin Lightning (PineTree Platform Model)

Default Speed Lightning uses PineTree's Speed/TrySpeed platform account. Merchants do **not** paste Speed secret API keys, publishable keys, or webhook secrets into PineTree.

PineTree server-only Speed env vars:

```bash
SPEED_API_KEY=<PineTree Speed live secret key>
SPEED_API_BASE_URL=https://api.tryspeed.com
SPEED_WEBHOOK_SECRET=<Speed webhook endpoint secret>
SPEED_ENVIRONMENT=production
```

Recommended/optional Speed env vars:

```bash
SPEED_PLATFORM_ACCOUNT_ID=acct_mplomb77IViByQkA
SPEED_DASHBOARD_URL=https://app.tryspeed.com
SPEED_PUBLISHABLE_KEY=<PineTree Speed live publishable key if future client/Speed.js flow needs it>
```

Public dashboard links:

```bash
NEXT_PUBLIC_SPEED_DASHBOARD_URL=<TrySpeed dashboard URL>
NEXT_PUBLIC_SPEED_ACCOUNT_ID_URL=<TrySpeed account ID / associated accounts URL>
NEXT_PUBLIC_SPEED_API_KEYS_URL=<TrySpeed API keys URL>
NEXT_PUBLIC_SPEED_WEBHOOKS_URL=<TrySpeed webhooks URL>
NEXT_PUBLIC_SPEED_AUTOSWAP_URL=<TrySpeed auto-swap settings URL>
NEXT_PUBLIC_SPEED_PAYOUTS_URL=<TrySpeed payout settings URL>
NEXT_PUBLIC_SPEED_SETTLEMENTS_URL=<TrySpeed settlement settings URL>
NEXT_PUBLIC_SPEED_DOCS_URL=<TrySpeed docs URL>
```

Never expose `SPEED_API_KEY` or `SPEED_WEBHOOK_SECRET` to the browser. Use only `NEXT_PUBLIC_` variables for dashboard links. Older public aliases still supported by the UI are `NEXT_PUBLIC_SPEED_LOGIN_URL`, `NEXT_PUBLIC_SPEED_ASSOCIATED_ACCOUNTS_URL`, `NEXT_PUBLIC_SPEED_AUTO_SWAP_URL`, and `NEXT_PUBLIC_SPEED_AUTO_PAYOUT_URL`.

Merchant Speed setup in `merchant_providers.credentials` stores only safe settlement/onboarding fields:

- `speed_account_id`, the merchant Speed account/destination account ID
- `speed_account_status`
- `payout_destination`, optional notes for the settlement destination
- `payout_type`
- `setup_status`
- `last_tested_at`
- `provider_model: "pine_tree_speed_platform"`

Live Speed Lightning flow:

- PineTree creates the Speed Lightning payment with `SPEED_API_KEY`.
- The customer pays the gross total.
- Speed receives the payment through PineTree's Speed account.
- PineTree keeps the $0.15 service fee.
- Speed routes the merchant portion to `speed_account_id` using the payment `transfers` split.
- Webhooks from `/api/webhooks/speed` or the on-demand Lightning status check confirm the PineTree payment.

Speed readiness requires PineTree platform env, a successful platform test, and a merchant Speed account ID. Merchant-owned Speed API keys are not accepted.

Speed webhook setup:

- Configure the Speed endpoint as `https://app.pinetree-payments.com/api/webhooks/speed`.
- Configure this endpoint inside PineTree's Speed dashboard, not inside each merchant account.
- Keep `/api/webhooks/lightning` in place for legacy/generic Lightning routing; Speed platform payments use `/api/webhooks/speed`.

Account ID roles:

- PineTree Platform Account ID comes from PineTree's Speed dashboard Associated Accounts/Profile and may be stored as `SPEED_PLATFORM_ACCOUNT_ID`.
- Merchant Speed Account ID is the merchant destination account ID and is stored per merchant as `merchant_providers.credentials.speed_account_id`.
- Do not use PineTree's platform account ID as a merchant destination account.

Environment/key safety:

- `SPEED_ENVIRONMENT=production` expects a live `sk_live_...` Speed secret key.
- `SPEED_ENVIRONMENT=test` expects a test `sk_test_...` Speed secret key.
- The app marks Speed not-ready when the configured environment and key prefix do not match.

Speed dashboard may warn about unrestricted API keys. Do not configure IP restrictions unless PineTree/Vercel has stable outbound IPs or fixed egress; otherwise Speed API calls may fail. For production, prefer restricted keys or fixed egress when available.

---

## NWC Direct Lightning Wallet (Advanced/Beta)

Advanced/Beta option for technical merchants. Requires a Nostr Wallet Connect URI with `make_invoice`, `lookup_invoice`, and `pay_invoice` permissions. The NWC URI is stored server-side in `merchant_providers.credentials` and never returned to the browser.

The optional PineTree treasury NWC URI used for post-payment fee collection is set as a server env var (not stored in the DB):

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

- TrySpeed shortcut buttons (Open Speed Dashboard, Find Account ID, Auto-Swap Settings, etc.) are shown when the matching `NEXT_PUBLIC_SPEED_*` URL variables are configured. They have no dependency on Mesh.
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
