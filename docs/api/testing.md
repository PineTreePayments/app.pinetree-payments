# Testing

This guide covers how to test your PineTree integration locally, run the platform test suite, and validate your integration end-to-end before going live.

---

## Local development setup

### Required environment variables

```bash
# PineTree API
PINETREE_API_KEY="pt_live_..."              # Server API key
PINETREE_WEBHOOK_SECRET="whsec_..."         # Webhook signing secret

# Supabase (for the PineTree app itself)
NEXT_PUBLIC_SUPABASE_URL="..."
NEXT_PUBLIC_SUPABASE_ANON_KEY="..."
SUPABASE_SERVICE_ROLE_KEY="..."

# Required in production (also enforced in engine validation)
CHECKOUT_SESSION_SECRET="..."
TERMINAL_SESSION_SECRET="..."
SPEED_WEBHOOK_SECRET="..."                  # If using Lightning via Speed

# App URL
NEXT_PUBLIC_APP_URL="http://localhost:3000" # Set to your local URL
```

See `docs/environment/staging-setup.md` for the full environment checklist.

---

## Platform test suite

Run these four commands to validate the full repo before every deployment:

```bash
# 1. Lint — zero errors required
npm run lint

# 2. TypeScript type checking — zero errors required
npm run typecheck

# 3. Unit and integration tests — all 506 tests must pass
npx vitest run

# 4. Production build — must compile clean
npm run build
```

### Test summary

| Check | Scope |
|-------|-------|
| `npm run lint` | ESLint — enforces import rules, hook rules, type safety |
| `npm run typecheck` | TypeScript — strict mode, no implicit any |
| `npx vitest run` | 506 tests across 67 files: state machine, checkout, SDK, webhooks |
| `npm run build` | Full Next.js production build — catches missing env shapes and import errors |

---

## Sandbox / test mode

> **PineTree does not currently offer a sandbox mode or test API keys.**

All keys are `pt_live_*` keys connected to real accounts. For testing:

- Use **small amounts** (e.g., $0.01 = `amount: 1`)
- Perform real transactions on real networks (Solana devnet, Base Sepolia, or Lightning testnet depending on your provider config)
- Monitor the Dashboard for real-time session and payment status

---

## Testing checkout sessions

### Create a test session via cURL

```bash
curl -X POST https://app.pinetree-payments.com/api/v1/checkout/sessions \
  -H "Authorization: Bearer $PINETREE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 1,
    "currency": "USD",
    "reference": "test_order_001",
    "successUrl": "https://yoursite.com/success?test=1",
    "cancelUrl": "https://yoursite.com/cancel?test=1"
  }'
```

Open the returned `checkoutUrl` in a browser. Complete or cancel the checkout and confirm you receive the `payment.confirmed` or `payment.canceled` webhook.

### Create a session via the Node SDK

```typescript
import { PineTree } from "@pinetreepayments/node"

const pinetree = new PineTree(process.env.PINETREE_API_KEY!)

const session = await pinetree.checkout.sessions.create({
  amount: 1,
  currency: "USD",
  reference: `test_${Date.now()}`,
})

console.log("Open this URL:", session.checkoutUrl)
```

---

## Testing webhooks locally

Use [ngrok](https://ngrok.com) or a similar tunneling tool to expose your local server:

```bash
# Install ngrok and start a tunnel
ngrok http 3000

# Your public URL will look like:
# https://abc123.ngrok-free.app
```

1. Register `https://abc123.ngrok-free.app/webhooks/pinetree` in **Developer → Webhooks**
2. Create a test checkout session and complete a payment
3. Watch your local server logs for incoming webhook events
4. Confirm `pinetree.webhooks.constructEvent()` verifies successfully

### Test webhook verification locally

```typescript
// Minimal Express webhook handler for local testing
import express from "express"
import { PineTree } from "@pinetreepayments/node"

const app = express()
const pinetree = new PineTree(process.env.PINETREE_API_KEY!)

app.post("/webhooks/pinetree", express.raw({ type: "*/*" }), (req, res) => {
  try {
    const event = pinetree.webhooks.constructEvent(
      req.body,
      req.headers as Record<string, string>,
      process.env.PINETREE_WEBHOOK_SECRET!
    )
    console.log("✓ Verified event:", event.type, event.eventId)
    res.json({ ok: true })
  } catch (err) {
    console.error("✗ Verification failed:", (err as Error).message)
    res.status(400).send("Bad signature")
  }
})

app.listen(3000, () => console.log("Listening on :3000"))
```

---

## Testing failed, canceled, and expired payments

To test failure handling:
- **Failed payment**: Use a provider or wallet path that returns explicit failure evidence
- **Canceled payment**: Cancel the checkout before sending funds
- **Expired payment**: Create a session and let it expire (or call the expire endpoint)

```bash
# Manually expire a session
curl -X POST "https://app.pinetree-payments.com/api/v1/checkout/sessions/cs_01abc.../expire" \
  -H "Authorization: Bearer $PINETREE_API_KEY"
```

Confirm your server handles `payment.canceled` and `payment.expired` events gracefully (do not fulfill the order). `payment.incomplete` remains a compatibility event for abandoned payments without more specific evidence.

---

## Testing idempotency

```bash
# Send the same request twice with the same Idempotency-Key
for i in 1 2; do
  curl -X POST https://app.pinetree-payments.com/api/v1/checkout/sessions \
    -H "Authorization: Bearer $PINETREE_API_KEY" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: test_idem_001" \
    -d '{"amount": 100, "reference": "idem_test"}'
  echo ""
done

# Both responses should have the same "id"
```

---

## Testing the Browser SDK

Include the SDK in a local HTML file:

```html
<!DOCTYPE html>
<html>
<body>
  <button id="pay">Pay $25</button>
  <script type="module">
    import { PineTree } from "https://cdn.jsdelivr.net/npm/@pinetreepayments/js/dist/esm/index.js"
    const pinetree = new PineTree("pk_live_your_public_key")
    document.getElementById("pay").onclick = async () => {
      await pinetree.checkout.open({
        amount: 2500,
        currency: "USD",
        mode: "popup",
      })
    }
  </script>
</body>
</html>
```

---

## Go-Live Checklist

See [Go-Live Checklist](./go-live-checklist.md) for the full pre-production validation list.
