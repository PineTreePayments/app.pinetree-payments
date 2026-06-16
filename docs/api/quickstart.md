# Quickstart

This guide walks you through a complete integration in under 10 minutes: create an API key, create a checkout session, redirect your customer, listen for the payment confirmation webhook, and verify the result.

---

## Step 1 — Get an API key

1. Log into your PineTree dashboard at [app.pinetree-payments.com](https://app.pinetree-payments.com)
2. Go to **Developer → API Keys**
3. Click **Create key** and give it a name (e.g., `production-server`)
4. Copy the key — it starts with `pt_live_`

Store it as an environment variable. Never commit it to version control.

```bash
export PINETREE_API_KEY="pt_live_..."
export PINETREE_WEBHOOK_SECRET="whsec_..."
```

---

## Step 2 — Create a checkout session

Send a `POST` to `/api/v1/checkout/sessions` with the payment amount and redirect URLs.

### With the Node SDK

```bash
npm install @pinetreepayments/node
```

```typescript
import { PineTree } from "@pinetreepayments/node"

const pinetree = new PineTree(process.env.PINETREE_API_KEY!)

const session = await pinetree.checkout.sessions.create({
  amount: 2500,           // in USD cents — $25.00
  currency: "USD",
  reference: "order_1042",
  customer: { email: "customer@example.com" },
  successUrl: "https://yoursite.com/success",
  cancelUrl: "https://yoursite.com/cancel",
})

console.log(session.checkoutUrl) // redirect customer here
```

### With the REST API directly

```bash
curl -X POST https://app.pinetree-payments.com/api/v1/checkout/sessions \
  -H "Authorization: Bearer $PINETREE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 2500,
    "currency": "USD",
    "reference": "order_1042",
    "customer": { "email": "customer@example.com" },
    "successUrl": "https://yoursite.com/success",
    "cancelUrl": "https://yoursite.com/cancel"
  }'
```

**Response:**

```json
{
  "id": "cs_01abc...",
  "object": "checkout.session",
  "status": "open",
  "amount": 2500,
  "currency": "USD",
  "checkoutUrl": "https://app.pinetree-payments.com/pay?token=...",
  "createdAt": "2026-06-16T12:00:00.000Z"
}
```

---

## Step 3 — Redirect the customer

Send the customer to `session.checkoutUrl`. PineTree hosts the entire checkout experience, including network/wallet selection, payment confirmation, and error handling.

```typescript
// Express example
res.redirect(session.checkoutUrl)

// Next.js example
return NextResponse.redirect(session.checkoutUrl)
```

When the customer completes or cancels, PineTree redirects them to your `successUrl` or `cancelUrl`.

---

## Step 4 — Listen for the webhook

Create an HTTP endpoint to receive webhook events. PineTree posts to this URL whenever payment status changes.

```typescript
// Express example
import express from "express"
import { PineTree } from "@pinetreepayments/node"

const app = express()
const pinetree = new PineTree(process.env.PINETREE_API_KEY!)

app.post("/webhooks/pinetree", express.raw({ type: "application/json" }), (req, res) => {
  const signature = req.headers["pinetree-signature"] as string
  const timestamp  = req.headers["pinetree-timestamp"] as string

  let event
  try {
    event = pinetree.webhooks.constructEvent(
      req.body,
      signature,
      timestamp,
      process.env.PINETREE_WEBHOOK_SECRET!
    )
  } catch (err) {
    return res.status(400).send(`Webhook verification failed: ${(err as Error).message}`)
  }

  if (event.type === "payment.confirmed") {
    const payment = event.data.object
    // fulfill the order using payment.reference (your order ID)
    console.log("Payment confirmed:", payment.id, payment.reference)
  }

  res.json({ received: true })
})
```

Register this endpoint in **Developer → Webhooks** in your dashboard.

---

## Step 5 — Retrieve payment/session status

You can also poll for status server-side instead of (or in addition to) webhooks.

```typescript
// Retrieve a checkout session
const session = await pinetree.checkout.sessions.retrieve("cs_01abc...")
console.log(session.status) // "open" | "processing" | "paid" | "failed" | "expired"

// Retrieve the linked payment (once session.paymentId is set)
const payment = await pinetree.payments.retrieve(session.paymentId!)
console.log(payment.status) // "paid" when confirmed on-chain
```

---

## Step 6 — Test locally

Use a tool like [ngrok](https://ngrok.com) to expose your local server:

```bash
ngrok http 3000
```

Then set your webhook URL in the dashboard to `https://your-ngrok-url.ngrok-free.app/webhooks/pinetree`.

Create a test checkout session, complete a real (small-amount) payment in the checkout, and confirm the webhook fires and your order is fulfilled.

> **Note:** PineTree issues `pt_live_*` keys only. There is no sandbox mode. Use small amounts (e.g., $0.01) for testing and monitor the Dashboard for real-time status.

---

## Go-Live Checklist

- [ ] API key created and stored in environment variables
- [ ] `successUrl` and `cancelUrl` set to production URLs
- [ ] Webhook endpoint registered and signature verification working
- [ ] `payment.confirmed` event handled and order fulfillment tested
- [ ] Failed/expired sessions handled gracefully
- [ ] No API keys in client-side code

See [Go-Live Checklist](./go-live-checklist.md) for the full production readiness guide.
