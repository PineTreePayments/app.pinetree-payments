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

## Speed Bitcoin Lightning

PineTree uses platform Speed credentials from the server environment. Merchants only enter a Speed Account ID and BTC Lightning Address in the Providers tab. Customers pay with any compatible Bitcoin Lightning wallet.

Add these to `.env.local` for local development, and add them to Vercel Project Settings -> Environment Variables for deployed production. Redeploy Vercel after changing environment variables. Do not commit real secrets.

```bash
SPEED_API_KEY=
SPEED_PUBLISHABLE_KEY=
SPEED_API_BASE_URL=https://api.tryspeed.com
SPEED_WEBHOOK_SECRET=
SPEED_ENVIRONMENT=production
SPEED_PLATFORM_ACCOUNT_ID=
PINETREE_LIGHTNING_SUPPORTS_FEE_AT_PAYMENT_TIME=true
PINETREE_LIGHTNING_SUPPORTS_SPLIT_SETTLEMENT=true
```

`SPEED_API_KEY` and `SPEED_WEBHOOK_SECRET` are server-only secrets. Do not prefix secret keys with `NEXT_PUBLIC_`. `SPEED_PUBLISHABLE_KEY` may be stored for future client-side Speed features, but it is not required by the current checkout flow.
