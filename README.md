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

## Speed Bitcoin Lightning (Merchant Setup Shell)

Merchants connect their own Speed account to PineTree. Each merchant provides their own Speed API key via the Providers dashboard. PineTree does not use a shared platform Speed account.

**Status:** Speed setup (credential entry, test, save, disconnect) is implemented. Speed payment processing (invoice creation, webhook confirmation) is pending a future integration phase. A connected Speed provider shows as "Setup connected — payment processing pending."

**What Speed setup covers:**
- Merchant enters their Speed secret API key in the Providers dashboard
- PineTree tests the key against the Speed API before saving
- Key is stored server-side only (never returned to the browser)
- Mode (test/live) is inferred from the key prefix (`sk_test_` / `sk_live_`)

**Server-only env var (add to `.env.local` / Vercel env):**

```bash
# Speed API base URL — defaults to https://api.tryspeed.com if not set
SPEED_API_BASE_URL=https://api.tryspeed.com
```

**Public env vars (UI links — optional, safe defaults used if not set):**

```bash
NEXT_PUBLIC_SPEED_SIGNUP_URL=https://www.tryspeed.com
NEXT_PUBLIC_SPEED_LOGIN_URL=https://app.tryspeed.com
NEXT_PUBLIC_SPEED_API_KEYS_URL=https://app.tryspeed.com/developers
NEXT_PUBLIC_SPEED_WEBHOOKS_URL=https://app.tryspeed.com/developers
NEXT_PUBLIC_SPEED_DOCS_URL=https://docs.tryspeed.com
NEXT_PUBLIC_SPEED_API_DOCS_URL=https://apidocs.tryspeed.com
```

Update `NEXT_PUBLIC_SPEED_API_KEYS_URL` and `NEXT_PUBLIC_SPEED_WEBHOOKS_URL` if Speed provides stable deep links to those specific sections.

**Credential security note:** Speed secret keys are currently stored as plain JSONB in `merchant_providers.credentials`. This matches the existing NWC URI storage pattern. Field-level encryption for Speed secret keys is a **production blocker** that must be addressed before live merchant keys are stored.

**NWC Direct Lightning Wallet (Advanced):** Available for technical merchants. Requires a Nostr Wallet Connect URI and `make_invoice`, `lookup_invoice`, `pay_invoice` permissions. See the Providers dashboard → Advanced Direct Lightning Wallet section.

```bash
PINETREE_LIGHTNING_SUPPORTS_FEE_AT_PAYMENT_TIME=true
PINETREE_LIGHTNING_SUPPORTS_SPLIT_SETTLEMENT=true
```
