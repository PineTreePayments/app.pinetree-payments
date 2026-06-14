# PineTree Node SDK

The first PineTree Node SDK is available in this repository at
`packages/pinetree-node`. It is private and has not been published to npm.

```ts
import { PineTree } from "@pinetreepayments/node"

const pinetree = new PineTree(process.env.PINETREE_API_KEY!)

const session = await pinetree.checkout.sessions.create(
  {
    amount: 1000,
    currency: "USD",
  },
  {
    idempotencyKey: "order_1042",
  }
)

console.log(session.checkoutUrl)
```

The client can also be configured explicitly:

```ts
const pinetree = new PineTree({
  apiKey: process.env.PINETREE_API_KEY!,
  baseUrl: "https://app.pinetree-payments.com",
  timeout: 30_000,
})
```

## Checkout Sessions

```ts
await pinetree.checkout.sessions.retrieve(id)
await pinetree.checkout.sessions.list({ status: "paid", limit: 20 })
await pinetree.checkout.sessions.cancel(id)
await pinetree.checkout.sessions.expire(id)
```

## Payments

```ts
const payment = await pinetree.payments.retrieve(id)
```

Only the public payment facade is returned. Provider payloads, wallet internals,
and service-role fields are not exposed.

## Webhook Deliveries

```ts
const deliveries = await pinetree.webhookDeliveries.list({ status: "failed" })
await pinetree.webhookDeliveries.retry(deliveryId)
```

## Webhook Verification

Pass the unmodified raw request body:

```ts
const event = pinetree.webhooks.constructEvent(
  rawBody,
  request.headers["pinetree-signature"],
  request.headers["pinetree-timestamp"],
  process.env.PINETREE_WEBHOOK_SECRET!
)
```

The helper validates HMAC-SHA256 signatures and the timestamp replay window,
then returns the typed `Event`. Webhook delivery headers are:

- `PineTree-Signature`
- `PineTree-Timestamp`
- `PineTree-Event-Id`
- `PineTree-Webhook-Version: 2026-06-12`

Legacy `X-PineTree-*` headers remain a server compatibility feature.

The helper also accepts a Node-style header object:

```ts
const event = pinetree.webhooks.constructEvent(
  rawBody,
  request.headers,
  process.env.PINETREE_WEBHOOK_SECRET!
)
```

## Environment Testing

Use the configurable `baseUrl` to test the same SDK build against each
environment:

```ts
new PineTree({ apiKey: localKey, baseUrl: "http://localhost:3000" })
new PineTree({ apiKey: stagingKey, baseUrl: "https://staging.example.com" })
new PineTree({
  apiKey: productionKey,
  baseUrl: "https://app.pinetree-payments.com",
})
```

Use environment-specific test merchants and API keys. Never commit live keys,
webhook secrets, or production credentials to tests, fixtures, or snapshots.

See [Node SDK integration testing](./node-sdk-integration-testing.md) for the
opt-in local, staging, and production test harness and its safety controls.
